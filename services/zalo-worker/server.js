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
const AUTH_FILE = path.join(AUTH_STORE_DIR, "account.json");

console.log("===============================================");
console.log("Starting Zalo Worker (zca-js persistent sidecar)");
console.log(`Auth store: ${AUTH_FILE}`);
console.log(`Backend:    ${FASTAPI_URL}`);
console.log("===============================================");

/** @type {import("zca-js").API | null} */
let api = null;
let listenerConnected = false;
let lastLoginAt = null;
let lastError = null;
let reconnecting = false;
let consecutiveReconnectFailures = 0;

// zca-js's own retryOnClose only retries codes/counts the SERVER told it to
// (ctx.settings.features.socket.{close_and_retry_codes,retries}) — plenty of
// real disconnects (e.g. code 1006 seen in practice) aren't covered, and it
// just gives up silently, permanently, with the listener dead until someone
// notices. This is our own watchdog on top: any "closed" we didn't cause
// ourselves triggers a full re-login (fresh Zalo instance + listener) from
// the saved auth file, same as a container restart would do.
function scheduleReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  setTimeout(async () => {
    const saved = loadSavedAuth();
    if (!saved) {
      console.warn("[reconnect] no saved auth on disk — cannot auto-reconnect, needs a fresh /session/import.");
      reconnecting = false;
      return;
    }
    try {
      console.log("[reconnect] attempting full re-login after listener closed...");
      await loginWithAuth(saved);
      console.log("[reconnect] succeeded.");
      reconnecting = false;
    } catch (err) {
      consecutiveReconnectFailures += 1;
      lastError = err.message || String(err);
      console.error(`[reconnect] failed (attempt ${consecutiveReconnectFailures}), retrying in 5s:`, lastError);
      // After a few STRAIGHT failures re-logging in with the SAME saved
      // cookies, the session is provably dead (not a transient blip) —
      // stop reporting logged_in:true from /status, which was actively
      // misleading (every send/roster-fetch was silently failing
      // underneath while the UI showed "Đã kết nối"). Only a fresh
      // /session/import (re-login via the extension) can recover from
      // here; keep retrying in the background in case Zalo's side
      // self-heals, but don't claim to be connected while it doesn't.
      if (consecutiveReconnectFailures >= 3 && api) {
        console.error("[reconnect] giving up on the current session after repeated failures — marking disconnected until a fresh /session/import.");
        api = null;
        listenerConnected = false;
      }
      reconnecting = false;
      scheduleReconnect();
    }
  }, 5000);
}

// ── Auth file (cookie + stable imei) ────────────────────────────
function ensureAuthDir() {
  fs.mkdirSync(AUTH_STORE_DIR, { recursive: true });
}

function loadSavedAuth() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
  } catch (err) {
    console.error("Failed to read saved auth file:", err.message);
    return null;
  }
}

function saveAuth(auth) {
  ensureAuthDir();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
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
// DMs, NEVER showing a bare "Conversation {id}". Mirrored here.
let groupNameCache = new Map(); // group_id -> name
let friendNameCache = new Map(); // user_id -> name

async function refreshGroupNames(zaloApi) {
  try {
    const allGroups = await zaloApi.getAllGroups();
    const groupIds = Object.keys(allGroups?.gridVerMap || {});
    for (let i = 0; i < groupIds.length; i += 50) {
      const chunk = groupIds.slice(i, i + 50);
      try {
        const info = await zaloApi.getGroupInfo(chunk);
        for (const [gid, g] of Object.entries(info?.gridInfoMap || {})) {
          if (g?.name) groupNameCache.set(gid, g.name);
        }
      } catch (err) {
        console.warn("[zca-groups] getGroupInfo chunk failed:", err.message);
      }
    }
    console.log(`[zca-groups] cached ${groupNameCache.size} group name(s) from ${groupIds.length} group id(s)`);
  } catch (err) {
    console.warn("[zca-groups] getAllGroups failed:", err.message);
  }
  try {
    const friends = await zaloApi.getAllFriends();
    for (const f of friends || []) {
      const id = f?.userId;
      const name = f?.zaloName || f?.displayName;
      if (id && name) friendNameCache.set(id, name);
    }
    console.log(`[zca-groups] cached ${friendNameCache.size} friend name(s)`);
  } catch (err) {
    console.warn("[zca-groups] getAllFriends failed:", err.message);
  }
}

async function resolveConversationName(zaloApi, threadId, isGroup, fallbackSenderName) {
  const cache = isGroup ? groupNameCache : friendNameCache;
  if (cache.has(threadId)) return cache.get(threadId);

  if (!isGroup) {
    // DM: not a cached friend (e.g. a stranger) — the sender IS the other
    // party, so their display name from the message itself is the name.
    if (fallbackSenderName) {
      friendNameCache.set(threadId, fallbackSenderName);
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
      groupNameCache.set(threadId, g.name);
      return g.name;
    }
  } catch (err) {
    console.warn(`[zca-groups] lazy getGroupInfo(${threadId}) failed:`, err.message);
  }
  return `Nhóm ${threadId}`;
}

// ── Listener wiring ──────────────────────────────────────────────
function attachListener(zaloApi) {
  zaloApi.listener.on("connected", () => {
    listenerConnected = true;
    console.log("[listener] connected");
  });

  zaloApi.listener.on("closed", (code, reason) => {
    listenerConnected = false;
    console.warn("[listener] closed", code, reason, "— zca-js gave up its own retry, scheduling full re-login in 5s");
    scheduleReconnect();
  });

  zaloApi.listener.on("error", (err) => {
    console.error("[listener] error", err);
    // "error" doesn't guarantee a subsequent "closed" fires in every case —
    // scheduleReconnect() is idempotent (the `reconnecting` guard), so it's
    // safe to also arm it here as a belt-and-suspenders measure.
    scheduleReconnect();
  });

  zaloApi.listener.on("message", async (message) => {
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

      const isGroup = message.type === ThreadType.Group;
      const senderName = message.data.dName || "Người dùng Zalo";
      const name = await resolveConversationName(api, message.threadId, isGroup, isGroup ? null : senderName);

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
      console.error("Failed to forward Zalo message to backend:", err.response?.data || err.message);
    }
  });

  zaloApi.listener.start({ retryOnClose: true });
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

async function loginWithAuth({ cookies, imei, userAgent }) {
  const zcaCookies = toZcaCookies(cookies);
  const cookieSummary = zcaCookies.map((c) => `${c.name}@${c.domain}`).join(", ");
  console.log(
    `[zca-login] attempting login — ${zcaCookies.length} cookie(s): [${cookieSummary}], imei=${imei ? imei.slice(0, 8) + "…" : "(empty)"}, userAgent=${userAgent || "(empty)"}`
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
    console.error("[zca-login] login() threw:", err.stack || err.message || err);
    throw err;
  }
  console.log("[zca-login] login succeeded");
  api = newApi;
  lastLoginAt = new Date().toISOString();
  lastError = null;
  consecutiveReconnectFailures = 0;
  groupNameCache = new Map();
  friendNameCache = new Map();
  attachListener(newApi);
  // Fire-and-forget — don't make the caller wait on this to know login
  // succeeded; group/friend names populate a few seconds later and any
  // message that arrives before that resolves lazily anyway (see
  // resolveConversationName).
  refreshGroupNames(newApi).catch((err) => console.warn("[zca-groups] initial refresh failed:", err.message));
  return newApi;
}

// Restore session on container start, so a restart doesn't require the
// admin to reconnect via the extension every time.
(async function restoreOnStartup() {
  const saved = loadSavedAuth();
  if (!saved) {
    console.log("No saved Zalo session — waiting for /session/import.");
    return;
  }
  try {
    await loginWithAuth(saved);
    console.log("Restored Zalo session from saved auth file.");
  } catch (err) {
    lastError = err.message || String(err);
    console.warn("Could not restore saved Zalo session (will need a fresh import):", lastError);
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

app.get("/groups", (_req, res) => {
  res.json({
    groups: Object.fromEntries(groupNameCache),
    friends: Object.fromEntries(friendNameCache),
  });
});

app.get("/status", (_req, res) => {
  res.json({
    logged_in: !!api,
    listener_connected: listenerConnected,
    last_login_at: lastLoginAt,
    last_error: lastError,
  });
});

app.post("/session/import", async (req, res) => {
  const { cookies, imei, user_agent } = req.body || {};
  try {
    // Stable imei: reuse the previously saved one if this request didn't
    // send one — Zalo binds session keys to the imei used at issuance, a
    // fresh random imei on every call gets the session rejected.
    const saved = loadSavedAuth();
    const finalImei = imei || saved?.imei || `worker-${Date.now()}`;

    await loginWithAuth({ cookies, imei: finalImei, userAgent: user_agent });
    saveAuth({ cookies, imei: finalImei, userAgent: user_agent });

    res.json({ ok: true });
  } catch (err) {
    lastError = err.message || String(err);
    console.error("[session/import] failed:", err.stack || lastError);
    res.status(502).json({ error: lastError });
  }
});

app.post("/session/disconnect", (_req, res) => {
  try {
    api?.listener?.stop();
  } catch (_err) {
    // ignore
  }
  api = null;
  listenerConnected = false;
  res.json({ ok: true });
});

app.get("/debug/group/:threadId", async (req, res) => {
  if (!api) return res.status(409).json({ error: "Zalo chưa đăng nhập." });
  try {
    const info = await api.getGroupInfo([req.params.threadId]);
    res.json(info?.gridInfoMap?.[req.params.threadId] || null);
  } catch (err) {
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.get("/conversations/:threadId/members", async (req, res) => {
  if (!api) return res.status(409).json({ error: "Zalo chưa đăng nhập." });
  const { threadId } = req.params;
  try {
    const info = await api.getGroupInfo([threadId]);
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
        const profilesResp = await api.getGroupMembersInfo(ids);
        const profiles = profilesResp?.profiles || {};
        members = Object.entries(profiles).map(([uid, p]) => ({
          uid,
          name: p.displayName || p.zaloName || uid,
        }));
      }
    }

    res.json({ members, total_member: g.totalMember || memberIds.length || members.length });
  } catch (err) {
    console.error("get group members failed:", err.message || err);
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.post("/conversations/:threadId/send", async (req, res) => {
  if (!api) return res.status(409).json({ error: "Zalo chưa đăng nhập." });
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
    const result = await api.sendMessage(
      messagePayload,
      threadId,
      is_group ? ThreadType.Group : ThreadType.User
    );
    const name = await resolveConversationName(api, threadId, !!is_group, null).catch(() => null);
    res.json({ ok: true, source_message_id: String(result.message?.msgId || ""), name });
  } catch (err) {
    console.error("send failed:", err.message || err);
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`zalo-worker listening on :${PORT}`);
});

// Final safety net: a WebSocket can go silently dead (e.g. a dropped TCP
// connection with no proper close handshake) without "closed" or "error"
// ever firing. Poll every 2 minutes and reconnect if we're supposed to be
// logged in but the listener isn't marked connected.
setInterval(() => {
  if (api && !listenerConnected && !reconnecting) {
    console.warn("[watchdog] logged in but listener not connected — triggering reconnect.");
    scheduleReconnect();
  }
}, 120000);
