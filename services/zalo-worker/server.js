import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { Zalo, ThreadType } from "zca-js";
import { CookieJar, Cookie } from "tough-cookie";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// zca-js's public API (the `Zalo` class) hides the decrypted getLoginInfo
// response even on failure — see probeLoginInfo() below for why we reach
// into its internals (via absolute path — its package.json "exports" only
// allows the "." entry point, so these must be filesystem-path imports).
const zcaUtils = await import(pathToFileURL(path.join(__dirname, "node_modules/zca-js/dist/utils.js")).href);
const zcaContext = await import(pathToFileURL(path.join(__dirname, "node_modules/zca-js/dist/context.js")).href);

const PORT = Number(process.env.PORT || 8090);
const FASTAPI_URL = (process.env.FASTAPI_URL || "http://backend:8000").replace(/\/+$/, "");
const INTERNAL_TOKEN = process.env.ZALO_WORKER_INTERNAL_TOKEN || "";
const AUTH_STORE_DIR = process.env.ZALO_ZCA_AUTH_STORE_DIR || path.join(__dirname, "artifacts", "zca-auth");

console.log("===============================================");
console.log("Starting Zalo Worker (zca-js persistent sidecar)");
console.log(`Auth store: ${AUTH_STORE_DIR} (one file per account)`);
console.log(`Backend:    ${FASTAPI_URL}`);
console.log("===============================================");

// ── Per-account session state ───────────────────────────────────
// Each Leader owns a fully independent Zalo login: its own zca-js `api`
// instance, its own saved-auth file, its own group/friend name caches, and
// its own reconnect bookkeeping. Everything that used to be a single
// module-level variable is now a field on one of these, keyed by
// account_id (the ZaloAccount.id the backend assigned) in the `sessions`
// map below.
class SessionState {
  constructor(accountId) {
    this.accountId = String(accountId);
    /** @type {import("zca-js").API | null} */
    this.api = null;
    this.listenerConnected = false;
    this.lastLoginAt = null;
    this.lastError = null;
    this.reconnecting = false;
    this.consecutiveReconnectFailures = 0;
    this.groupNameCache = new Map(); // group_id -> name
    this.friendNameCache = new Map(); // user_id -> name
    this.authFilePath = path.join(AUTH_STORE_DIR, `${this.accountId}.json`);
    // Set by POST /sessions/:accountId/disconnect — tells scheduleReconnect
    // to back off instead of auto-reviving the session. Without this, a
    // "closed" event fired by our own listener.stop() call (or a stray one
    // arriving right after) would silently re-log the user back in a few
    // seconds later. Cleared the moment a fresh login succeeds.
    this.manualDisconnect = false;
    // Set right before a fresh login when the previous session ended via an
    // explicit user-initiated disconnect (not an automatic recovery
    // reconnect after a dropped connection) — every message whose OWN Zalo
    // timestamp is older than this moment gets silently dropped in
    // forwardMessage(), from both the on-connect backfill AND the ongoing
    // 5s safety-net poll, so reconnecting starts clean instead of
    // re-pulling (and re-showing) days-old messages the user had just
    // disconnected to get away from. null = no filter (automatic recovery
    // reconnects never set this, so they keep catching up on anything
    // missed during the drop, same as before).
    this.freshReconnectAtMs = null;
    // requestOldMessages() backward-pagination walk state (see
    // requestGroupBackfill / the "old_messages" handler). Pages remaining
    // in the CURRENT walk (0 = no walk in flight) and the newest timestamp
    // a completed walk has confirmed is fully covered — the next walk only
    // needs to go back far enough to reach this point, not further.
    this.backfillWalkPagesLeft = 0;
    this.backfillWatermarkTs = 0;
    // Which attachListener() call currently "owns" this session's events.
    // zca-js's own reconnect handling can leave an old listener's socket
    // alive for a while after we've already attached a fresh one on
    // reconnect (no "closed" event fires for it, no way to force it shut) —
    // without this guard, both listeners forward messages concurrently,
    // and the OLD one resolves group/thread names against session.api
    // (already pointing at the NEW api by then), misattributing messages
    // to the wrong conversation. See attachListener's isActiveListener().
    this.listenerId = 0;
  }
}

/** @type {Map<string, SessionState>} */
const sessions = new Map();

let listenerIdCounter = 0;

function getOrCreateSession(accountId) {
  const key = String(accountId);
  if (!sessions.has(key)) sessions.set(key, new SessionState(key));
  return sessions.get(key);
}

// zca-js's own retryOnClose only retries codes/counts the SERVER told it to
// (ctx.settings.features.socket.{close_and_retry_codes,retries}) — plenty of
// real disconnects (e.g. code 1006 seen in practice) aren't covered, and it
// just gives up silently, permanently, with the listener dead until someone
// notices. This is our own watchdog on top: any "closed" we didn't cause
// ourselves triggers a full re-login (fresh Zalo instance + listener) from
// the saved auth file, same as a container restart would do. Scoped to one
// session — each account reconnects independently of every other.
function scheduleReconnect(session) {
  if (session.manualDisconnect) {
    console.log(`[reconnect:${session.accountId}] skipping — session was manually disconnected.`);
    return;
  }
  if (session.reconnecting) return;
  session.reconnecting = true;
  setTimeout(async () => {
    const saved = loadSavedAuth(session);
    if (!saved) {
      console.warn(`[reconnect:${session.accountId}] no saved auth on disk — cannot auto-reconnect, needs a fresh /session/import.`);
      session.reconnecting = false;
      return;
    }
    try {
      console.log(`[reconnect:${session.accountId}] attempting full re-login after listener closed...`);
      await loginWithAuth(session, saved);
      console.log(`[reconnect:${session.accountId}] succeeded.`);
      session.reconnecting = false;
    } catch (err) {
      session.consecutiveReconnectFailures += 1;
      session.lastError = err.message || String(err);
      console.error(`[reconnect:${session.accountId}] failed (attempt ${session.consecutiveReconnectFailures}), retrying in 5s:`, session.lastError);
      // After a few STRAIGHT failures re-logging in with the SAME saved
      // cookies, the session is provably dead (not a transient blip) —
      // stop reporting logged_in:true from /status, which was actively
      // misleading (every send/roster-fetch was silently failing
      // underneath while the UI showed "Đã kết nối"). Only a fresh
      // /session/import (re-login via the extension) can recover from
      // here; keep retrying in the background in case Zalo's side
      // self-heals, but don't claim to be connected while it doesn't.
      if (session.consecutiveReconnectFailures >= 3 && session.api) {
        console.error(`[reconnect:${session.accountId}] giving up on the current session after repeated failures — marking disconnected until a fresh /session/import.`);
        session.api = null;
        session.listenerConnected = false;
      }
      session.reconnecting = false;
      scheduleReconnect(session);
    }
  }, 5000);
}

// ── Auth file (cookie + stable imei) — one per account ──────────
function ensureAuthDir() {
  fs.mkdirSync(AUTH_STORE_DIR, { recursive: true });
}

function loadSavedAuth(session) {
  try {
    if (!fs.existsSync(session.authFilePath)) return null;
    return JSON.parse(fs.readFileSync(session.authFilePath, "utf-8"));
  } catch (err) {
    console.error(`[${session.accountId}] Failed to read saved auth file:`, err.message);
    return null;
  }
}

function saveAuth(session, auth) {
  ensureAuthDir();
  fs.writeFileSync(session.authFilePath, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

// Extension sends cookies in a shape close to, but not identical to, the
// zca-js Cookie type — normalize field-by-field rather than assuming exact
// match ("lấy được bao nhiêu dùng bấy nhiêu", same rule as the backend
// /import-session endpoint this is ported from).
function toZcaCookies(rawCookies) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return (rawCookies || []).map((c) => ({
    domain: c.domain || ".zalo.me",
    expirationDate: c.expirationDate || c.expires || nowSeconds + 60 * 60 * 24 * 30,
    hostOnly: false,
    httpOnly: !!c.httpOnly,
    name: c.name || c.key,
    path: c.path || "/",
    sameSite: c.sameSite || "unspecified",
    secure: c.secure !== undefined ? !!c.secure : true,
    session: false,
    storeId: "0",
    value: c.value,
  })).filter((c) => c.name && c.value !== undefined);
}

// ── Group/friend name resolution ────────────────────────────────
// zca-js group messages carry a `threadId` but NOT a group name — the
// reference implementation (CrawlDataLinkedin) resolves names via a
// separate `getAllGroups()` + `getGroupInfo()` (and `getAllFriends()` for
// DMs) lookup, caches them, and falls back to the sender's display name for
// DMs, NEVER showing a bare "Conversation {id}". Mirrored here, cached
// per-session so one account's groups never leak into another's names.
async function refreshGroupNames(session, zaloApi) {
  try {
    const allGroups = await zaloApi.getAllGroups();
    const groupIds = Object.keys(allGroups?.gridVerMap || {});
    for (let i = 0; i < groupIds.length; i += 50) {
      const chunk = groupIds.slice(i, i + 50);
      try {
        const info = await zaloApi.getGroupInfo(chunk);
        for (const [gid, g] of Object.entries(info?.gridInfoMap || {})) {
          if (g?.name) session.groupNameCache.set(gid, g.name);
        }
      } catch (err) {
        console.warn(`[zca-groups:${session.accountId}] getGroupInfo chunk failed:`, err.message);
      }
    }
    console.log(`[zca-groups:${session.accountId}] cached ${session.groupNameCache.size} group name(s) from ${groupIds.length} group id(s)`);
  } catch (err) {
    console.warn(`[zca-groups:${session.accountId}] getAllGroups failed:`, err.message);
  }
  try {
    const friends = await zaloApi.getAllFriends();
    for (const f of friends || []) {
      const id = f?.userId;
      const name = f?.zaloName || f?.displayName;
      if (id && name) session.friendNameCache.set(id, name);
    }
    console.log(`[zca-groups:${session.accountId}] cached ${session.friendNameCache.size} friend name(s)`);
  } catch (err) {
    console.warn(`[zca-groups:${session.accountId}] getAllFriends failed:`, err.message);
  }
}

async function resolveConversationName(session, zaloApi, threadId, isGroup, fallbackSenderName) {
  const cache = isGroup ? session.groupNameCache : session.friendNameCache;
  if (cache.has(threadId)) return cache.get(threadId);

  if (!isGroup) {
    // DM: not a cached friend (e.g. a stranger) — the sender IS the other
    // party, so their display name from the message itself is the name.
    if (fallbackSenderName) {
      session.friendNameCache.set(threadId, fallbackSenderName);
      return fallbackSenderName;
    }
    return `Người dùng ${threadId}`;
  }

  // Group not seen yet (e.g. first message arrived before refreshGroupNames
  // finished, or the group was joined after login) — fetch just this one.
  try {
    const info = await zaloApi.getGroupInfo([threadId]);
    const g = info?.gridInfoMap?.[threadId];
    if (g?.name) {
      session.groupNameCache.set(threadId, g.name);
      return g.name;
    }
  } catch (err) {
    console.warn(`[zca-groups:${session.accountId}] lazy getGroupInfo(${threadId}) failed:`, err.message);
  }
  return `Nhóm ${threadId}`;
}

// ── Listener wiring ──────────────────────────────────────────────
// Backfill request — safe to call repeatedly (backend dedupes on
// conversation_id+source_message_id): asks Zalo (over the live WebSocket,
// NOT the broken HTTP getGroupChatHistory endpoint) for the most recent
// batch of group messages. Used both right after a fresh connect AND on an
// ongoing timer below, because keepAlive() mostly keeping the session from
// going stale means reconnects (and the on-connect backfill) now happen
// rarely — a message can still slip through a brief unnoticed gap even
// while `listener_connected` stays true throughout.
// requestOldMessages() has no per-group filter (confirmed in zca-js's own
// source — its 2nd arg is a pagination cursor, not a thread id) — it always
// returns the most recent batch across EVERY group the account is in. For
// an account in 100+ groups, a message in a quiet project-linked group can
// get crowded out of that batch by higher-traffic unrelated groups before
// the next poll. Polling more often narrows the window; walking backward
// (below) closes gaps a single shallow poll can't reach at all.
const BACKFILL_INTERVAL_MS = 5000;

// requestOldMessages's lastMsgId IS a real backward-pagination cursor (its
// payload literally carries { lastId, preIds } — see zca-js's listen.js) —
// passing the oldest message id from one batch as the next call's lastMsgId
// walks further back in time instead of re-fetching the same "most recent
// across all groups" batch every tick. Ported from the escalating-retry
// idea in a reference backfill implementation, adapted to this event-driven
// (not promise-returning) API: no "more available" flag comes back here, so
// "keep walking" is judged by whether the batch's oldest message is still
// newer than the last point we know we've already fully covered
// (session.backfillWatermarkTs) — once a walk's oldest message is at or
// older than that, there's nothing further back worth fetching this time.
const MAX_BACKFILL_WALK_PAGES = 5;

function requestGroupBackfill(session) {
  // A walk already in flight owns the next "old_messages" event (see the
  // handler below) — starting a second one here would reset its cursor
  // back to "most recent" mid-walk and race with whichever response lands
  // first. Simply skip; the in-flight walk finishes on its own within a
  // few seconds either way.
  if (session.backfillWalkPagesLeft > 0) return;
  session.backfillWalkPagesLeft = MAX_BACKFILL_WALK_PAGES;
  try {
    session.api?.listener.requestOldMessages(ThreadType.Group, null);
  } catch (err) {
    session.backfillWalkPagesLeft = 0;
    console.warn(`[listener:${session.accountId}] requestOldMessages failed:`, err.message);
  }
}

// Bounds one listener callback's runtime — a hung zca-js API call inside it
// (getGroupInfo/getAllGroups etc. go over the network with no timeout of
// their own) would otherwise leave that invocation dangling forever. Ported
// from a reference zca-js multi-account bridge that hit and fixed exactly
// this ("Problem C"). Logs and drops on timeout instead of crashing the
// process or blocking anything else — each event's handler call is already
// independent, this just stops one from leaking indefinitely.
function withTimeout(fn, timeoutMs = 20000) {
  return (...args) => {
    Promise.race([
      fn(...args),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Event handler timeout")), timeoutMs)),
    ]).catch((err) => {
      console.error(`[listener] handler error/timeout: ${err.message}`);
    });
  };
}

function attachListener(session, zaloApi) {
  // Every handler below closes over `myListenerId` and bails out if this
  // session has since moved on to a newer listener (reconnect happened,
  // or a stray socket from a previous login is still emitting) — see the
  // comment on SessionState.listenerId for why this is necessary.
  const myListenerId = ++listenerIdCounter;
  session.listenerId = myListenerId;
  function isActiveListener() {
    return session.listenerId === myListenerId;
  }

  zaloApi.listener.on("connected", () => {
    if (!isActiveListener()) return;
    session.listenerConnected = true;
    console.log(`[listener:${session.accountId}] connected`);
    // 2s delay gives the cipher key exchange (needed to decode the
    // response) time to land right after a fresh connect. Any message this
    // pulls in from before a fresh manual reconnect gets filtered out in
    // forwardMessage() (session.freshReconnectAtMs), not here.
    setTimeout(() => requestGroupBackfill(session), 2000);
  });

  zaloApi.listener.on("old_messages", withTimeout(async (messages, threadType) => {
    if (!isActiveListener()) return;
    console.log(`[listener:${session.accountId}] old_messages backfill — ${messages?.length ?? 0} message(s), type=${threadType}, pagesLeft=${session.backfillWalkPagesLeft}`);
    const batch = messages || [];
    for (const message of batch) {
      if (!isActiveListener()) return;
      await forwardMessage(session, message);
    }

    if (session.backfillWalkPagesLeft <= 0) return; // not part of a walk (e.g. an unrelated old_reactions-style event, or already finished)

    const timestamps = batch.map((m) => Number(m.data?.ts)).filter(Number.isFinite);
    const oldestTsInBatch = timestamps.length ? Math.min(...timestamps) : null;
    const oldestIdInBatch = batch.length
      ? batch.reduce((oldest, m) => (Number(m.data?.ts) < Number(oldest.data?.ts) ? m : oldest)).data?.msgId
      : null;

    const reachedKnownGround = batch.length === 0 || (oldestTsInBatch !== null && oldestTsInBatch <= session.backfillWatermarkTs);
    session.backfillWalkPagesLeft -= 1;
    if (reachedKnownGround || session.backfillWalkPagesLeft <= 0 || !oldestIdInBatch) {
      session.backfillWalkPagesLeft = 0;
      if (timestamps.length) {
        session.backfillWatermarkTs = Math.max(session.backfillWatermarkTs, ...timestamps);
      }
      return;
    }
    try {
      session.api?.listener.requestOldMessages(ThreadType.Group, oldestIdInBatch);
    } catch (err) {
      session.backfillWalkPagesLeft = 0;
      console.warn(`[listener:${session.accountId}] requestOldMessages (walk) failed:`, err.message);
    }
  }, 45000)); // a backfill batch can have many messages — give it more room than a single "message" event

  // zca-js fires "disconnected" on EVERY raw WebSocket close, before deciding
  // whether to retry — for many close codes it silently reopens the socket
  // itself (internal backoff, no "closed" event, no visibility for us at
  // all) and only escalates to "closed" once it gives up retrying that code.
  // We don't force our own reconnect here (zca-js is already handling it),
  // but log it — a message arriving during one of these internal gaps is
  // silently lost, and this is the only trace we'd have of that happening.
  zaloApi.listener.on("disconnected", (code, reason) => {
    if (!isActiveListener()) return;
    console.warn(`[listener:${session.accountId}] disconnected (zca-js internal retry, may self-heal)`, code, reason);
  });

  zaloApi.listener.on("closed", (code, reason) => {
    if (!isActiveListener()) return;
    session.listenerConnected = false;
    console.warn(`[listener:${session.accountId}] closed`, code, reason, "— zca-js gave up its own retry, scheduling full re-login in 5s");
    scheduleReconnect(session);
  });

  zaloApi.listener.on("error", (err) => {
    if (!isActiveListener()) return;
    console.error(`[listener:${session.accountId}] error`, err);
    // "error" doesn't guarantee a subsequent "closed" fires in every case —
    // scheduleReconnect() is idempotent (the `reconnecting` guard), so it's
    // safe to also arm it here as a belt-and-suspenders measure.
    scheduleReconnect(session);
  });

  zaloApi.listener.on("message", withTimeout(async (message) => {
    if (!isActiveListener()) {
      console.warn(`[listener:${session.accountId}] dropped message from a stale listener (threadId=${message?.threadId}) — a newer session is already active`);
      return;
    }
    console.log(
      `[listener:${session.accountId}] raw message event — threadId=${message?.threadId} type=${message?.type} isSelf=${message?.isSelf} contentType=${typeof message?.data?.content}`
    );
    await forwardMessage(session, message);
  }));

  zaloApi.listener.start({ retryOnClose: true });
}

// Shared by the real-time listener AND the poll-fallback below — both
// produce the same {threadId, type, isSelf, data} shape (zca-js's
// GroupMessage/UserMessage classes, whether delivered via WebSocket push or
// fetched via getGroupChatHistory, wrap the identical raw `data` fields).
// Safe to call for a message we've already forwarded: the backend dedupes
// on (conversation_id, source_message_id) and no-ops the repeat.
async function forwardMessage(session, message) {
  try {
    // NOTE: `message.isSelf` means "sent by the currently-logged-in
    // account", from ANY client — not just this app. A message we send
    // via our own /conversations/:id/send is already recorded
    // synchronously with the real msgId; when the listener echoes it back
    // here, the backend's unique-constraint dedupe (conversation_id,
    // source_message_id) turns this into a harmless no-op insert. But a
    // message the account owner sends from their *phone* (same account,
    // different client) is genuinely new and must NOT be dropped — that
    // was silently happening here before (`if (message.isSelf) return`),
    // which is why messages sent directly from a phone never showed up.
    const isPlainText = typeof message.data?.content === "string";
    if (!isPlainText) return; // phase 1: text only, matches existing services/zalo-crawler precedent

    // A fresh reconnect after an explicit manual disconnect wants a clean
    // slate — drop anything from before that moment (both the on-connect
    // backfill AND the ongoing 5s safety-net poll pull the SAME
    // most-recent-across-all-groups batch, so this is the one place that
    // reliably distinguishes "genuinely new" from "old, just resurfaced").
    // message.data.ts is Zalo's own send time (epoch ms, as a string).
    if (session.freshReconnectAtMs) {
      const sentAtMs = Number(message.data?.ts);
      if (Number.isFinite(sentAtMs) && sentAtMs < session.freshReconnectAtMs) return;
    }

    const isGroup = message.type === ThreadType.Group;
    const senderName = message.data.dName || "Người dùng Zalo";
    const name = await resolveConversationName(session, session.api, message.threadId, isGroup, isGroup ? null : senderName);

    // Real Zalo @mentions carry {uid, pos, len} — pos/len point at the
    // exact tagged substring inside content, which is far more reliable
    // than regex-guessing where a Vietnamese multi-word name ends
    // (especially with trailing text after the mention, e.g.
    // "@Nguyễn Minh Hoàng, nhớ làm gấp" — no second "@" to stop at).
    const rawMentions = Array.isArray(message.data?.mentions) ? message.data.mentions : [];
    const mentions = rawMentions
      .map((m) => ({
        uid: m.uid,
        text: String(message.data.content || "").substring(m.pos, m.pos + m.len).replace(/^@/, "").trim(),
      }))
      .filter((m) => m.text);

    await axios.post(
      `${FASTAPI_URL}/api/zalo/internal/messages`,
      {
        account_id: session.accountId,
        thread_id: message.threadId,
        is_group: isGroup,
        name,
        source_message_id: String(message.data.msgId),
        sender_zalo_id: message.data.uidFrom,
        sender_name: senderName,
        content: message.data.content,
        is_outgoing: !!message.isSelf,
        mentions,
      },
      {
        headers: { "X-Zalo-Worker-Token": INTERNAL_TOKEN },
        timeout: 10000,
      }
    );
  } catch (err) {
    console.error(`[${session.accountId}] Failed to forward Zalo message to backend:`, err.response?.data || err.message);
  }
}

// ── Poll-fallback (currently disabled, see startPolling() call site) ────
// zca-js's real-time listener has been observed going silently stale:
// `listener_connected` stays true, no "closed"/"error"/"disconnected" event
// ever fires, yet the "message" event stops arriving for real incoming
// messages (confirmed by the absence of even the raw-event log above).
// This periodically pulls each tracked group's recent history directly —
// a completely different code path in zca-js (a plain HTTP request, not the
// WebSocket push) — so it keeps working even while the listener is stuck.
const POLL_INTERVAL_MS = Number(process.env.ZALO_POLL_INTERVAL_MS || 20000);
const POLL_HISTORY_COUNT = 20;

async function pollGroupHistory(session) {
  if (!session.api) return;
  let groups;
  try {
    const resp = await axios.get(`${FASTAPI_URL}/api/zalo/internal/tracked-groups`, {
      params: { account_id: session.accountId },
      headers: { "X-Zalo-Worker-Token": INTERNAL_TOKEN },
      timeout: 10000,
    });
    groups = resp.data || [];
  } catch (err) {
    console.error(`[poll:${session.accountId}] failed to fetch tracked groups:`, err.response?.data || err.message);
    return;
  }

  for (const { thread_id } of groups) {
    try {
      const history = await session.api.getGroupChatHistory(thread_id, POLL_HISTORY_COUNT);
      for (const msg of history.groupMsgs || []) {
        await forwardMessage(session, msg);
      }
    } catch (err) {
      console.error(`[poll:${session.accountId}] getGroupChatHistory failed for ${thread_id}:`, err.message, err.response?.data || "");
    }
  }
}

function startPolling() {
  setInterval(() => {
    for (const session of sessions.values()) {
      pollGroupHistory(session).catch((err) => console.error(`[poll:${session.accountId}] unexpected error:`, err.message));
    }
  }, POLL_INTERVAL_MS);
  console.log(`[poll] fallback polling started — every ${POLL_INTERVAL_MS}ms, all sessions`);
}

// zca-js swallows the real reason for a login failure: `getLoginInfo()`
// decrypts Zalo's response and, if it comes back as a plain string instead
// of an object (Zalo's way of returning an error message), silently
// discards it and returns null — the caller only ever sees the generic
// "Đăng nhập thất bại" with zero context. `polyfill` is zca-js's documented
// fetch override point (defaults to `global.fetch`, see context.js) — wrap
// it to log every request/response zca-js makes, BEFORE any decryption, so
// we can see Zalo's actual raw response body instead of guessing.
async function loggingFetch(url, options) {
  const urlStr = typeof url === "string" ? url : url.toString();
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    console.error(`[zca-http] network error calling ${urlStr}:`, err.message);
    throw err;
  }
  const ms = Date.now() - startedAt;
  const isLoginCall = urlStr.includes("/api/login/");
  if (isLoginCall || !response.ok) {
    try {
      const bodyText = await response.clone().text();
      console.log(
        `[zca-http] ${options?.method || "GET"} ${urlStr} -> ${response.status} (${ms}ms)\n` +
          `[zca-http] response body (first 2000 chars): ${bodyText.slice(0, 2000)}`
      );
    } catch (logErr) {
      console.warn("[zca-http] could not read response body for logging:", logErr.message);
    }
  }
  return response;
}

// Reimplements zca-js's internal `apis/login.js::login()` call, but logs
// the FULLY DECRYPTED response instead of discarding it. zca-js's own
// login() only checks `!loginInfo` (== `!decryptedData?.data`) and throws
// the generic "Đăng nhập thất bại" — it never looks at (or logs)
// `decryptedData.error_message`, which is where Zalo actually explains a
// rejection (e.g. "session expired", "cookie invalid for this endpoint").
// This duplicates ~30 lines of zca-js internals because none of them are
// part of its public API surface (only the `Zalo` class is exported).
// Purely diagnostic/stateless — not tied to any session.
function buildZcaCookieJar(zcaCookies) {
  const jar = new CookieJar();
  for (const raw of zcaCookies) {
    try {
      const domain = raw.domain.startsWith(".") ? raw.domain.slice(1) : raw.domain;
      const cookie = Cookie.fromJSON({ ...raw, domain, key: raw.name });
      if (cookie) jar.setCookieSync(cookie, `https://${domain}`);
    } catch (err) {
      console.warn(`[zca-probe] failed to add cookie ${raw.name}:`, err.message);
    }
  }
  return jar;
}

async function probeLoginInfo({ zcaCookies, imei, userAgent }) {
  const { ParamsEncryptor, getSignKey, makeURL, request, decryptResp } = zcaUtils;
  const ctx = zcaContext.createContext(30, 671);
  ctx.cookie = buildZcaCookieJar(zcaCookies);
  ctx.imei = imei;
  ctx.userAgent = userAgent || "Mozilla/5.0";
  ctx.language = "vi";
  ctx.options.polyfill = loggingFetch;

  const data = { computer_name: "Web", imei, language: ctx.language, ts: Date.now() };
  const encryptor = new ParamsEncryptor({ type: ctx.API_TYPE, imei, firstLaunchTime: Date.now() });
  const enk = encryptor.getEncryptKey();
  const encodedData = ParamsEncryptor.encodeAES(enk, JSON.stringify(data), "base64", false);
  const params = { ...encryptor.getParams(), params: encodedData, type: ctx.API_TYPE, client_version: ctx.API_VERSION };
  params.signkey = getSignKey("getlogininfo", params);

  try {
    const response = await request(ctx, makeURL(ctx, "https://wpa.chat.zalo.me/api/login/getLoginInfo", { ...params, nretry: 0 }));
    const rawJson = await response.json();
    const decrypted = decryptResp(enk, rawJson.data);
    console.log("[zca-probe] decrypted getLoginInfo payload:", JSON.stringify(decrypted));
    if (decrypted && typeof decrypted === "object" && decrypted.error_message) {
      console.log(`[zca-probe] >>> Zalo's real reason: [${decrypted.error_code}] ${decrypted.error_message}`);
    }
  } catch (err) {
    console.warn("[zca-probe] probe itself failed (this is just diagnostics, real login attempt follows):", err.message);
  }
}

async function loginWithAuth(session, { cookies, imei, userAgent }) {
  const zcaCookies = toZcaCookies(cookies);
  const cookieSummary = zcaCookies.map((c) => `${c.name}@${c.domain}`).join(", ");
  console.log(
    `[zca-login:${session.accountId}] attempting login — ${zcaCookies.length} cookie(s): [${cookieSummary}], imei=${imei ? imei.slice(0, 8) + "…" : "(empty)"}, userAgent=${userAgent || "(empty)"}`
  );
  if (zcaCookies.length === 0) {
    throw new Error("Không có cookie Zalo nào để đăng nhập.");
  }

  await probeLoginInfo({ zcaCookies, imei, userAgent });

  const zalo = new Zalo({ logging: true, polyfill: loggingFetch });
  let newApi;
  try {
    newApi = await zalo.login({
      cookie: zcaCookies,
      imei,
      userAgent: userAgent || "Mozilla/5.0",
    });
  } catch (err) {
    // err.message alone is often just "Đăng nhập thất bại" — the [zca-http]
    // lines logged above (via loggingFetch) carry the actual reason. Log the
    // full stack too, in case this is a different failure than a rejected
    // login (e.g. a code bug in cookie parsing).
    console.error(`[zca-login:${session.accountId}] login() threw:`, err.stack || err.message || err);
    throw err;
  }
  console.log(`[zca-login:${session.accountId}] login succeeded`);
  session.api = newApi;
  session.lastLoginAt = new Date().toISOString();
  session.lastError = null;
  session.consecutiveReconnectFailures = 0;
  session.freshReconnectAtMs = session.manualDisconnect ? Date.now() : null;
  session.manualDisconnect = false;
  session.groupNameCache = new Map();
  session.friendNameCache = new Map();
  attachListener(session, newApi);
  // Fire-and-forget — don't make the caller wait on this to know login
  // succeeded; group/friend names populate a few seconds later and any
  // message that arrives before that resolves lazily anyway (see
  // resolveConversationName).
  refreshGroupNames(session, newApi).catch((err) => console.warn(`[zca-groups:${session.accountId}] initial refresh failed:`, err.message));
  return newApi;
}

// Restore every saved session on container start, so a restart doesn't
// require every connected Leader to reconnect via the extension. Each
// account's auth file is named `<accountId>.json` under AUTH_STORE_DIR.
(async function restoreOnStartup() {
  ensureAuthDir();
  let files = [];
  try {
    files = fs.readdirSync(AUTH_STORE_DIR).filter((f) => f.endsWith(".json"));
  } catch (err) {
    console.warn("Could not read auth store dir:", err.message);
  }
  if (files.length === 0) {
    console.log("No saved Zalo sessions — waiting for /sessions/:accountId/import.");
    return;
  }
  for (const file of files) {
    const accountId = file.replace(/\.json$/, "");
    const session = getOrCreateSession(accountId);
    const saved = loadSavedAuth(session);
    if (!saved) continue;
    try {
      await loginWithAuth(session, saved);
      console.log(`[${accountId}] Restored Zalo session from saved auth file.`);
    } catch (err) {
      session.lastError = err.message || String(err);
      console.warn(`[${accountId}] Could not restore saved Zalo session (will need a fresh import):`, session.lastError);
    }
  }
})();

// ── HTTP API ───────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (INTERNAL_TOKEN && req.header("X-Internal-Token") !== INTERNAL_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

app.get("/sessions/:accountId/groups", (req, res) => {
  const session = getOrCreateSession(req.params.accountId);
  res.json({
    groups: Object.fromEntries(session.groupNameCache),
    friends: Object.fromEntries(session.friendNameCache),
  });
});

app.get("/sessions/:accountId/status", (req, res) => {
  const session = getOrCreateSession(req.params.accountId);
  res.json({
    logged_in: !!session.api,
    listener_connected: session.listenerConnected,
    last_login_at: session.lastLoginAt,
    last_error: session.lastError,
  });
});

app.post("/sessions/:accountId/import", async (req, res) => {
  const session = getOrCreateSession(req.params.accountId);
  const { cookies, imei, user_agent } = req.body || {};
  try {
    // Stable imei: reuse the previously saved one if this request didn't
    // send one — Zalo binds session keys to the imei used at issuance, a
    // fresh random imei on every call gets the session rejected.
    const saved = loadSavedAuth(session);
    const finalImei = imei || saved?.imei || `worker-${session.accountId}-${Date.now()}`;

    await loginWithAuth(session, { cookies, imei: finalImei, userAgent: user_agent });
    saveAuth(session, { cookies, imei: finalImei, userAgent: user_agent });

    res.json({ ok: true });
  } catch (err) {
    session.lastError = err.message || String(err);
    console.error(`[session/import:${session.accountId}] failed:`, err.stack || session.lastError);
    res.status(502).json({ error: session.lastError });
  }
});

app.post("/sessions/:accountId/disconnect", (req, res) => {
  const session = getOrCreateSession(req.params.accountId);
  // Set BEFORE stopping the listener — stop() can itself fire a "closed"
  // event, which would otherwise arm scheduleReconnect() and silently log
  // the user back in ~5s later using the same cookies.
  session.manualDisconnect = true;
  session.reconnecting = false;
  session.consecutiveReconnectFailures = 0;
  try {
    session.api?.listener?.stop();
  } catch (_err) {
    // ignore
  }
  session.api = null;
  session.listenerConnected = false;
  // Forget the saved cookies on disk too — otherwise a worker restart
  // (container rebuild/redeploy/crash) would find this account's auth file
  // via restoreOnStartup() and silently reconnect it regardless of the
  // user having disconnected. This is the actual root cause of "disconnect
  // then it comes back": intent to disconnect only lived in memory before.
  try {
    if (fs.existsSync(session.authFilePath)) {
      fs.unlinkSync(session.authFilePath);
      console.log(`[${session.accountId}] Deleted saved auth file — will not auto-restore on next restart.`);
    }
  } catch (err) {
    console.warn(`[${session.accountId}] Failed to delete saved auth file:`, err.message);
  }
  res.json({ ok: true });
});

app.get("/sessions/:accountId/debug/group/:threadId", async (req, res) => {
  const session = getOrCreateSession(req.params.accountId);
  if (!session.api) return res.status(409).json({ error: "Zalo chưa đăng nhập." });
  try {
    const info = await session.api.getGroupInfo([req.params.threadId]);
    res.json(info?.gridInfoMap?.[req.params.threadId] || null);
  } catch (err) {
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.get("/sessions/:accountId/conversations/:threadId/members", async (req, res) => {
  const session = getOrCreateSession(req.params.accountId);
  if (!session.api) return res.status(409).json({ error: "Zalo chưa đăng nhập." });
  const { threadId } = req.params;
  try {
    const info = await session.api.getGroupInfo([threadId]);
    const g = info?.gridInfoMap?.[threadId];
    if (!g) return res.json({ members: [], total_member: 0 });

    let members = (g.currentMems || [])
      .map((m) => ({ uid: m.id, name: m.dName || m.zaloName || m.id }))
      .filter((m) => m.uid);

    // `currentMems`/`memberIds` come back empty for most groups in practice
    // (despite what the zca-js .d.ts implies) — the real per-member UID
    // list lives in `memVerList`, entries shaped "<uid>_<version>". Extract
    // the UIDs from there and resolve display names with a second call.
    if (members.length === 0) {
      const memVerIds = (g.memVerList || [])
        .map((entry) => String(entry).split("_")[0])
        .filter(Boolean);
      const ids = g.memberIds && g.memberIds.length > 0 ? g.memberIds : memVerIds;
      if (ids.length > 0) {
        const profilesResp = await session.api.getGroupMembersInfo(ids);
        const profiles = profilesResp?.profiles || {};
        members = Object.entries(profiles).map(([uid, p]) => ({
          uid,
          name: p.displayName || p.zaloName || uid,
        }));
      }
    }

    res.json({ members, total_member: g.totalMember || g.memberIds?.length || members.length });
  } catch (err) {
    console.error(`[${session.accountId}] get group members failed:`, err.message || err);
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.post("/sessions/:accountId/conversations/:threadId/send", async (req, res) => {
  const session = getOrCreateSession(req.params.accountId);
  if (!session.api) return res.status(409).json({ error: "Zalo chưa đăng nhập." });
  const { threadId } = req.params;
  const { text, is_group, mentions } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "Thiếu nội dung tin nhắn." });
  }
  try {
    // A plain string send has no way to carry real @mentions — switch to
    // the MessageContent object form (msg + mentions) whenever any were
    // provided, so the tag actually notifies/highlights on Zalo's side
    // instead of just being "@Name" as inert text.
    const hasMentions = Array.isArray(mentions) && mentions.length > 0;
    const messagePayload = hasMentions
      ? { msg: String(text), mentions: mentions.map((m) => ({ uid: String(m.uid), pos: Number(m.pos), len: Number(m.len) })) }
      : String(text);
    const result = await session.api.sendMessage(
      messagePayload,
      threadId,
      is_group ? ThreadType.Group : ThreadType.User
    );
    const name = await resolveConversationName(session, session.api, threadId, !!is_group, null).catch(() => null);
    res.json({ ok: true, source_message_id: String(result.message?.msgId || ""), name });
  } catch (err) {
    console.error(`[${session.accountId}] send failed:`, err.message || err);
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`zalo-worker listening on :${PORT}`);
});

// Final safety net: a WebSocket can go silently dead (e.g. a dropped TCP
// connection with no proper close handshake) without "closed" or "error"
// ever firing. Poll every 2 minutes and reconnect any session that's
// supposed to be logged in but whose listener isn't marked connected.
setInterval(() => {
  for (const session of sessions.values()) {
    if (session.api && !session.listenerConnected && !session.reconnecting) {
      console.warn(`[watchdog:${session.accountId}] logged in but listener not connected — triggering reconnect.`);
      scheduleReconnect(session);
    }
  }
}, 120000);

// Suspected root cause of the listener going silently stale (connected, no
// errors, but stops delivering real messages after roughly 15-20 minutes):
// zca-js's WS-level ping (every ctx.settings...ping_interval, ~3 min) keeps
// the raw socket alive, but Zalo's server appears to separately require
// this explicit app-level "I'm actively using this session" call — without
// it, it seems to quietly stop pushing real-time events to this session
// while the socket itself stays technically open. 90s keeps us comfortably
// under that ~180s idle_time seen in the login response. Runs once for
// every currently-logged-in session.
const KEEPALIVE_INTERVAL_MS = 90000;
setInterval(() => {
  for (const session of sessions.values()) {
    if (!session.api) continue;
    session.api.keepAlive().catch((err) => {
      // A failing keepAlive() is a much stronger signal than the watchdog
      // below gets: that one only checks session.listenerConnected, which
      // stays true throughout the exact "silently stale" failure mode this
      // interval exists to catch (see the block comment above) — so it
      // never fires here. Treat a keepAlive failure as proof the session is
      // actually dead and force a full reconnect: scheduleReconnect() logs
      // back in from the saved cookies, re-attaches the listener, and its
      // "connected" handler re-runs the on-connect backfill — recovering
      // any message that arrived during the stale window, same as a
      // genuine disconnect/reconnect already does.
      console.warn(`[keepalive:${session.accountId}] failed — forcing reconnect:`, err.message);
      scheduleReconnect(session);
    });
  }
}, KEEPALIVE_INTERVAL_MS);

// Ongoing safety net, not just on-connect (see requestGroupBackfill above):
// a real message ("lên ngon rồi" sent from a second device) was confirmed
// lost even while listener_connected stayed true throughout and no
// reconnect happened — keepAlive alone doesn't guarantee zero gaps. Runs
// once for every currently-connected session.
setInterval(() => {
  for (const session of sessions.values()) {
    if (!session.api || !session.listenerConnected) continue;
    requestGroupBackfill(session);
  }
}, BACKFILL_INTERVAL_MS);

// Disabled — re-verified 2026-09-18 against a real connected session: Zalo's
// server still 404s api/group/history outright (nginx 404, not a zca-js/app
// error) — confirmed via live logs:
//   [zca-http] GET https://tt-group-wpa.chat.zalo.me/api/group/history... -> 404
// C:\Markeeai\SMB_Deployment\zalo-bridge calls this exact same
// api.getGroupChatHistory() (same zca-js 2.1.2) for its own missed-message
// sync — its failure path just logs and continues, so it would fail the
// exact same way there too; it isn't a working alternative, just untested.
// Re-enable only if a future zca-js version (or Zalo) restores this endpoint.
// startPolling();
