// Meeting Host Bot — polls GET /api/meeting-bot/queue for the Gmail account
// this Chrome profile is logged into, and opens a tab for each due meeting
// so content.js (running on meet.google.com) can Join + Admit. MVP scope
// only: no recording, no FFmpeg, does not touch meeting_sync.py/n8n/AI
// Summary. See design memory "meeting-host-bot-design".
const LOG_PREFIX = "[MeetingBot]";
const ALARM_NAME = "meeting-bot-poll";
const DEFAULT_POLL_SECONDS = 20;
// Prune dedupe entries after this long so storage doesn't grow forever across
// days of uptime — well past any realistic meeting length.
const OPENED_TTL_MS = 6 * 60 * 60 * 1000;

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}

async function getConfig() {
  const { apiBaseUrl, googleEmail, botToken, pollIntervalSeconds } = await chrome.storage.local.get([
    "apiBaseUrl",
    "googleEmail",
    "botToken",
    "pollIntervalSeconds",
  ]);
  return {
    apiBaseUrl: (apiBaseUrl || "").trim().replace(/\/+$/, ""),
    googleEmail: (googleEmail || "").trim(),
    botToken: (botToken || "").trim(),
    pollIntervalSeconds: Number(pollIntervalSeconds) || DEFAULT_POLL_SECONDS,
  };
}

async function getOpenedMap() {
  const { openedMeetings } = await chrome.storage.local.get(["openedMeetings"]);
  return openedMeetings || {};
}

async function markOpened(meetingId) {
  const opened = await getOpenedMap();
  opened[meetingId] = Date.now();
  const cutoff = Date.now() - OPENED_TTL_MS;
  for (const [id, ts] of Object.entries(opened)) {
    if (ts < cutoff) delete opened[id];
  }
  await chrome.storage.local.set({ openedMeetings: opened });
}

// Maps the tab a meeting was opened in back to its meeting_id, so a
// "HOST_DETECTED"/"CALL_ENDED" message (which only carries sender.tab.id,
// not the meeting) can be turned into the right recorder start/stop call.
// Kept in chrome.storage.local, not a module-level Map, for the same reason
// openedMeetings is: the service worker can be evicted between messages.
const RECORDER_BASE_URL = "http://127.0.0.1:8765";

async function getRecordingTabs() {
  const { recordingTabs } = await chrome.storage.local.get(["recordingTabs"]);
  return recordingTabs || {};
}

// `path` is the meeting URL's pathname at the time the tab was opened (e.g.
// "/zhh-nuue-adp") — kept alongside meetingId so chrome.tabs.onUpdated below
// can tell "still on this meeting" apart from "navigated away" without
// depending on content.js still being alive to report it.
async function setMeetingForTab(tabId, meetingId, path) {
  const map = await getRecordingTabs();
  map[tabId] = { meetingId, path };
  await chrome.storage.local.set({ recordingTabs: map });
}

async function getMeetingForTab(tabId) {
  const map = await getRecordingTabs();
  return map[tabId]?.meetingId ?? null;
}

async function popMeetingForTab(tabId) {
  const map = await getRecordingTabs();
  const entry = map[tabId];
  if (!entry) return null;
  delete map[tabId];
  await chrome.storage.local.set({ recordingTabs: map });
  return entry.meetingId;
}

async function startRecording(meetingId) {
  try {
    const resp = await fetch(`${RECORDER_BASE_URL}/record/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: String(meetingId) }),
    });
    const data = await resp.json().catch(() => ({}));
    log("Recording start:", resp.status, JSON.stringify(data));
  } catch (error) {
    // Recorder service not reachable (not running, or wrong machine) should
    // never block Join/Admit — recording is additive, not load-bearing.
    log("Recording start failed (recorder service unreachable?):", error?.message || error);
  }
}

// Short-lived Google Drive access token + target filename for this specific
// meeting_id, so recorder_service.py can upload straight to Drive itself —
// the video bytes never pass through this backend, it only ever hands out
// a Bearer token (see backend/app/routers/meeting_bot.py's /drive-token).
// Best-effort: a failure here just means the recording stays local instead
// of blocking the stop itself.
async function getDriveUploadInfo(meetingId) {
  try {
    const config = await getConfig();
    if (!config.apiBaseUrl || !config.botToken) return null;
    const url = `${config.apiBaseUrl}/api/meeting-bot/drive-token?meeting_id=${encodeURIComponent(meetingId)}`;
    const resp = await fetch(url, { headers: { "x-meeting-bot-token": config.botToken } });
    if (!resp.ok) {
      log("Drive token fetch failed:", resp.status);
      return null;
    }
    return await resp.json();
  } catch (error) {
    log("Drive token fetch failed:", error?.message || error);
    return null;
  }
}

async function stopRecording(meetingId) {
  const upload = await getDriveUploadInfo(meetingId);
  try {
    const resp = await fetch(`${RECORDER_BASE_URL}/record/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: String(meetingId), upload: upload || undefined }),
    });
    const data = await resp.json().catch(() => ({}));
    log("Recording stop:", resp.status, JSON.stringify(data));
  } catch (error) {
    log("Recording stop failed (recorder service unreachable?):", error?.message || error);
  }
}

// Bot-managed tabs get closed once their job is done. A profile is only ever
// supposed to hold one active Meet tab at a time (see pollOnce()'s guard and
// the startup cleanup below) — leaving a finished call's tab open serves no
// purpose and, at 4-workspace scale, adds up to real Chrome RAM/CPU plus a
// standing risk of the bot's tab-matching logic getting confused about which
// tab is "the" current meeting.
function closeTab(tabId) {
  chrome.tabs.remove(tabId, () => {
    // Swallow "no tab with id" — e.g. the onRemoved path below, where the
    // tab is already gone by the time this would run.
    void chrome.runtime.lastError;
  });
}

// Backup stop path #1: if the tab is closed (crash, manual close, VPS reboot
// script cleanup) before content.js ever gets to send CALL_ENDED, this is
// what actually stops ffmpeg instead of leaving it recording a dead tab.
// The tab is already gone here, so there's nothing to close.
chrome.tabs.onRemoved.addListener((tabId) => {
  popMeetingForTab(tabId).then((meetingId) => {
    if (meetingId) stopRecording(meetingId);
  });
});

// Backup stop path #2, the important one in practice: confirmed live
// 2026-09-11 that a solo host (no other participants) gets fully navigated
// to meet.google.com/home by Meet itself after ~20-25 minutes — a real page
// navigation, not just a DOM change. That destroys and re-injects content.js
// from scratch, resetting its in-memory hostDetected/callEndedNotified state,
// so its own CALL_ENDED message never fires for this case (it looks, from
// the fresh script's point of view, like a call it never saw). Watching the
// tab's URL at the background.js level instead survives that: it doesn't
// depend on the content script's state surviving the navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  getRecordingTabs().then((map) => {
    const entry = map[tabId];
    if (!entry) return;
    let stillOnMeeting = false;
    try {
      stillOnMeeting = new URL(changeInfo.url).pathname === entry.path;
    } catch (_err) {
      stillOnMeeting = false;
    }
    if (stillOnMeeting) return;
    // Don't pop the tracking entry until stopRecording() (incl. its Drive
    // upload) has actually finished — see the CALL_ENDED handler below for
    // why: this is what keeps pollOnce()'s "already has an active tab" guard
    // honest for a profile's ENTIRE stop→upload→close sequence, not just
    // the recording phase, which matters for back-to-back meetings on the
    // same Gmail account.
    (async () => {
      if (entry.meetingId) await stopRecording(entry.meetingId);
      await popMeetingForTab(tabId);
      closeTab(tabId);
    })();
  });
});

// The Fetch API only allows ISO-8859-1 (code point <= 255) bytes in a header
// value — a token copy-pasted from an editor with "smart punctuation" (e.g.
// "-" auto-replaced by an en/em dash) silently picks up a code point outside
// that range and fetch() throws a generic, unhelpful TypeError. Checking
// this ourselves first lets us point at the exact bad character instead.
function findInvalidHeaderChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.codePointAt(i);
    if (code > 255) {
      return { index: i, char: value[i], code };
    }
  }
  return null;
}

async function fetchQueue(config) {
  const badChar = findInvalidHeaderChar(config.botToken);
  if (badChar) {
    throw new Error(
      `Bot Token chứa ký tự không hợp lệ ở vị trí ${badChar.index}: "${badChar.char}" (U+${badChar.code
        .toString(16)
        .toUpperCase()}). Có thể do copy-paste bị tự động đổi dấu (vd "-" thành "–") — hãy xóa ô Bot Token và gõ/dán lại trực tiếp từ .env.`
    );
  }
  const url = `${config.apiBaseUrl}/api/meeting-bot/queue?google_email=${encodeURIComponent(config.googleEmail)}`;
  const resp = await fetch(url, { headers: { "x-meeting-bot-token": config.botToken } });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return Array.isArray(data?.due) ? data.due : [];
}

let pollChainTimer = null;

// Confirmed live 2026-09-12 on the VPS (2 due meetings, same Gmail): an
// in-memory `pollInFlight` boolean is NOT enough. MV3 service workers can be
// evicted and reloaded between polls — a bare setTimeout doesn't count as
// "work in progress" to Chrome's idle-eviction heuristic (same root cause
// already confirmed this session for the startup-cleanup delayed pass) — and
// every module-level variable, this one included, resets on that reload. A
// live repro showed markOpened() firing for two different meetings ~70ms
// apart with no "already has an active tab" log between them: two overlapping
// pollOnceLocked() calls, not one loop misbehaving. Fixed with two
// independent layers, since neither alone is airtight:
// 1. A chrome.storage.local-persisted lock (below) — survives a worker
//    reload, unlike a module variable. Still not truly atomic (storage has
//    no compare-and-swap), so it reduces the window rather than guaranteeing
//    it shut, hence a short staleness timeout so a genuinely dead holder
//    can't wedge future polls forever.
// 2. chrome.tabs.query() as the per-meeting "already active" ground truth
//    inside the loop below, instead of trusting the recordingTabs map alone
//    — a real tab, once chrome.tabs.create() actually resolves, is true
//    regardless of whether the JS that was going to record it in storage
//    ever got to run.
const POLL_LOCK_KEY = "pollLock";
const POLL_LOCK_STALE_MS = 90 * 1000; // well past one real poll cycle's worst case

async function acquirePollLock() {
  const now = Date.now();
  const { [POLL_LOCK_KEY]: existing } = await chrome.storage.local.get([POLL_LOCK_KEY]);
  if (existing && now - existing < POLL_LOCK_STALE_MS) {
    return false;
  }
  await chrome.storage.local.set({ [POLL_LOCK_KEY]: now });
  // Re-read to catch (not fully prevent — storage has no atomic
  // compare-and-swap) a competing acquirer that wrote in the same window.
  const { [POLL_LOCK_KEY]: after } = await chrome.storage.local.get([POLL_LOCK_KEY]);
  return after === now;
}

async function releasePollLock() {
  await chrome.storage.local.remove(POLL_LOCK_KEY);
}

let pollInFlight = false;

async function pollOnce() {
  // Layer 1 (in-memory): cheap, catches same-worker-instance overlap
  // (POLL_NOW racing the timer chain) with zero storage round-trips.
  if (pollInFlight) {
    log("pollOnce already running (triggered again before it finished) — skipping this call.");
    return;
  }
  pollInFlight = true;
  try {
    // Layer 2 (persisted): catches cross-worker-restart overlap that layer 1
    // structurally cannot.
    const gotLock = await acquirePollLock();
    if (!gotLock) {
      log("pollOnce lock already held (another instance is mid-poll) — skipping this call.");
      return;
    }
    try {
      await pollOnceLocked();
    } finally {
      await releasePollLock();
    }
  } finally {
    pollInFlight = false;
  }
}

async function pollOnceLocked() {
  const config = await getConfig();
  if (!config.apiBaseUrl || !config.googleEmail || !config.botToken) {
    log("Chưa cấu hình đủ apiBaseUrl/googleEmail/botToken — mở Options để cấu hình.");
    return;
  }

  let queue;
  try {
    queue = await fetchQueue(config);
  } catch (error) {
    log("Queue check failed:", error?.message || error);
    return;
  }
  log("Queue checked", `(${queue.length} meeting${queue.length === 1 ? "" : "s"})`);

  const opened = await getOpenedMap();
  for (const meeting of queue) {
    if (opened[meeting.meeting_id]) continue;
    if (!meeting.join_url || !/meet\.google\.com/i.test(meeting.join_url)) {
      log(`Meeting #${meeting.meeting_id} không phải link Google Meet hợp lệ, bỏ qua.`);
      continue;
    }
    // One profile == one Gmail account == can only actually be in one Meet
    // call at a time. Checked two ways, since a live repro showed the
    // recordingTabs-only version isn't reliable on its own (see the
    // acquirePollLock block above for the full story): the storage map
    // (survives nothing dying mid-write) AND chrome.tabs.query() (ground
    // truth — true the instant a tab really exists, independent of whether
    // this or any other JS context is still around to record it). If either
    // says busy, leave the rest of the queue for a later poll — it'll be
    // picked up once CALL_ENDED/onUpdated/onRemoved closes the current one.
    const activeTabs = await getRecordingTabs();
    const realMeetTabs = await chrome.tabs.query({ url: "*://meet.google.com/*" });
    if (Object.keys(activeTabs).length > 0 || realMeetTabs.length > 0) {
      log(`Meeting #${meeting.meeting_id} due, but this profile already has an active Meet tab — will retry next poll.`);
      break;
    }
    log(`Found meeting #${meeting.meeting_id}`, meeting.title || "");
    log("Opening Meet", meeting.join_url);
    await markOpened(meeting.meeting_id);
    let path = "";
    try {
      path = new URL(meeting.join_url).pathname;
    } catch (_err) {
      // Already filtered to meet.google.com URLs above; a bad path just
      // means the onUpdated "left the meeting" check below never matches
      // (path stays ""), falling back to onRemoved/CALL_ENDED for stop.
    }
    const tab = await chrome.tabs.create({ url: meeting.join_url, active: true });
    if (tab?.id !== undefined) await setMeetingForTab(tab.id, meeting.meeting_id, path);
    break; // enforce max one active Meet tab per profile per cycle
  }
}

// chrome.alarms enforces a 1-minute floor on periodInMinutes — not fast
// enough for the 15-30s cadence the bot needs. The alarm below is only a
// recovery heartbeat for when the service worker gets evicted mid-chain;
// the actual cadence comes from this self-rescheduling setTimeout loop,
// which runs as fast as configured for as long as the worker stays alive.
async function scheduleNextPoll() {
  const config = await getConfig();
  clearTimeout(pollChainTimer);
  pollChainTimer = setTimeout(async () => {
    await pollOnce();
    scheduleNextPoll();
  }, config.pollIntervalSeconds * 1000);
}

// The alarm only re-arms the setTimeout chain — pollOnce() itself is not
// called here to avoid a duplicate concurrent chain on top of the
// unconditional one started at the bottom of this file on every worker load.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) scheduleNextPoll();
});

function ensureRecoveryAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

// A profile should never carry stale Meet tabs across a bot/Chrome restart —
// leftover test tabs, or a call that was live when the VPS rebooted, waste
// RAM/CPU and risk the tab-matching logic (recordingTabs) getting confused
// about which tab is the current meeting. Deliberately wired to
// onStartup/onInstalled only — NOT to the unconditional "runs on every
// worker load" block at the bottom of this file, which also fires on a
// normal idle-eviction wake in the middle of a live call and must never
// close that tab out from under an in-progress recording. Skips anything
// present in `recordingTabs`, so this never fights pollOnce() over a tab the
// bot has legitimately just opened for a real queued meeting.
async function cleanupStaleMeetTabs() {
  const tabs = await chrome.tabs.query({ url: "*://meet.google.com/*" });
  const tracked = await getRecordingTabs();
  let closed = 0;
  for (const tab of tabs) {
    if (tab.id !== undefined && !tracked[tab.id]) {
      closeTab(tab.id);
      closed++;
    }
  }
  if (closed) log(`Startup cleanup: closed ${closed} stale Meet tab(s)`);
}

async function onBotStartup() {
  // recordingTabs entries loaded from disk here refer to tab ids from the
  // PREVIOUS Chrome process — Chrome never reuses tab ids across a restart,
  // so none of them can possibly be a real tab anymore.
  await chrome.storage.local.set({ recordingTabs: {} });
  await cleanupStaleMeetTabs();
  // Deliberately NOT also doing a delayed re-check via setTimeout here:
  // confirmed live 2026-09-12 that it doesn't work — MV3 service workers can
  // go idle and get torn down well before a bare setTimeout fires (no
  // pending extension-API callback keeps it alive), silently dropping the
  // scheduled call. A tab appearing meet.google.com slightly AFTER this
  // first pass (Chrome's own session-restore, or a launch command that
  // passed a Meet URL as an argument) will NOT be caught by this extension —
  // this must be prevented at the launch/deployment level instead: the
  // production launch command (systemd unit or script) must not pass a
  // meet.google.com URL as an argument, and the profile's "Continue where
  // you left off" setting should stay off. See meeting-host-bot-design
  // memory for the confirmed reproduction.
}

chrome.runtime.onInstalled.addListener(ensureRecoveryAlarm);
chrome.runtime.onStartup.addListener(ensureRecoveryAlarm);
chrome.runtime.onInstalled.addListener(onBotStartup);
chrome.runtime.onStartup.addListener(onBotStartup);

// Confirmed live 2026-09-11 via a direct xdotool-vs-JS-click A/B test on the
// VPS: content.js's fireClick() (full pointerdown/mousedown/pointerup/
// mouseup/click, still JS-dispatched) does not trigger Meet's "Join now"
// button under Xvfb — only genuinely-trusted input does. content.js runs in
// the page's isolated world and has no access to CDP itself; only this
// privileged background context can use chrome.debugger to reach it.
// Attaching shows Chrome's own "<extension> started debugging this browser"
// banner on the tab — that's Chrome's standard debugger-attached UI, not a
// bug, and unavoidable when using this API.
function sendDebuggerCommand(target, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

// Must match content.js's JOIN_TEXT_RE — duplicated as a string (not
// imported) since this is a separate execution context (background service
// worker vs. content script isolated world) with no shared module.
const JOIN_TEXT_SOURCE = "(join now|ask to join|tham gia ngay|xin tham gia|yêu cầu tham gia|tham gia mà không)";

async function cdpClickJoin(tabId) {
  const target = { tabId };
  log("cdpClickJoin: attaching debugger to tab", tabId);
  await new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
  log("cdpClickJoin: attached");
  try {
    // Re-locate the button's coordinates AFTER attaching, not before:
    // chrome.debugger.attach() itself makes Chrome insert its "this tab is
    // being debugged" infobar, which shifts the whole page down — any
    // coordinates computed beforehand (e.g. by content.js, before this
    // round-trip) are stale by the time the click actually fires.
    // Confirmed live 2026-09-11: more than one element can match "join now"
    // at once (or in quick succession across reloads) — a transient
    // zero-size element mid-render, and separately a short-labeled "Join
    // now" element at a DIFFERENT position than the real, final
    // "Join now without microphone & camera" button. Text-only matching
    // (as content.js's own findClickableByText does) isn't enough here.
    // Picking the LARGEST non-zero-area match is a simple, resilient
    // heuristic: the real, prominent join button is a substantial clickable
    // area, while decorative/duplicate/transient matches are smaller or
    // zero-sized.
    const findExpr = `(() => {
      const re = new RegExp(${JSON.stringify(JOIN_TEXT_SOURCE)}, "i");
      const els = document.querySelectorAll('button, [role="button"]');
      let best = null;
      let bestArea = 0;
      for (const el of els) {
        const label = el.getAttribute("aria-label") || (el.innerText || el.textContent || "").trim();
        if (!label || !re.test(label)) continue;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area <= 0) continue;
        if (area > bestArea) {
          bestArea = area;
          best = { x: r.left + r.width / 2, y: r.top + r.height / 2, label };
        }
      }
      return best ? JSON.stringify({ found: true, ...best }) : JSON.stringify({ found: false });
    })()`;
    // Confirmed live 2026-09-11 (second round of VPS testing): attach()
    // resolving does not guarantee the renderer has finished the reflow it
    // triggers by inserting the "being debugged" banner — evaluating
    // immediately can see a not-yet-settled layout and miss a button that
    // IS in the DOM with a real non-zero rect a moment later. A separate,
    // plain non-debugger CDP eval run manually right after a "not found"
    // result found it instantly, which is what pointed at timing rather
    // than the matching logic itself. Retrying a couple of times inside
    // the SAME attach session (instead of attach/detach on every 1.5s
    // content.js tick) both gives layout time to settle and avoids
    // hammering chrome.debugger with rapid attach/detach churn.
    let info = { found: false };
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const evalResult = await sendDebuggerCommand(target, "Runtime.evaluate", {
        expression: findExpr,
        returnByValue: true,
      });
      info = JSON.parse(evalResult.result.value);
      if (info.found) break;
    }
    if (!info.found) {
      throw new Error("Join button not found at click time (page may have changed)");
    }
    log("cdpClickJoin: clicking", JSON.stringify(info.label), "at", info.x, info.y);
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: info.x, y: info.y, button: "none" });
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x: info.x, y: info.y, button: "left", clickCount: 1 });
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x: info.x, y: info.y, button: "left", clickCount: 1 });
    log("cdpClickJoin: click dispatched");
    // Confirmed live 2026-09-11 (second round): dispatching a click without
    // any error does NOT mean it landed on the real button — the retry loop
    // above can settle on a rect measured mid-transition (Meet's lobby
    // button visibly slides/animates into place), which is still a "found,
    // non-zero area" match but not the button's final resting position. A
    // click that misses just moves the mouse over empty lobby UI: no
    // exception, "success" as far as background.js can tell, yet the join
    // button is still sitting right there afterward. content.js treats any
    // success response as permanent (sets joinClicked=true and stops
    // retrying for good), so a false "success" here silently kills the
    // whole bot for that meeting. Re-checking whether the SAME button is
    // still present after the click is what actually distinguishes a real
    // click from a miss — only report success once it's gone.
    await new Promise((resolve) => setTimeout(resolve, 800));
    const verifyResult = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: findExpr,
      returnByValue: true,
    });
    const stillThere = JSON.parse(verifyResult.result.value);
    if (stillThere.found) {
      throw new Error(`click landed but "${info.label}" is still on screen — likely missed, will retry`);
    }
    log("cdpClickJoin: verified — join button gone");
  } finally {
    await new Promise((resolve) => chrome.debugger.detach(target, () => resolve()));
    log("cdpClickJoin: detached");
  }
}

// Options page calls this after Save/Poll-now so changes take effect
// immediately instead of waiting for the worker to restart.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === "RECONFIGURE") {
    scheduleNextPoll().then(() => sendResponse({ success: true }));
    return true;
  }
  if (message?.action === "POLL_NOW") {
    pollOnce().then(() => sendResponse({ success: true }));
    return true;
  }
  if (message?.action === "HOST_DETECTED") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    getMeetingForTab(tabId).then((meetingId) => {
      if (meetingId) startRecording(meetingId);
      sendResponse({ success: true });
    });
    return true;
  }
  if (message?.action === "CALL_ENDED") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    // Peek the meetingId without clearing it yet — the tracking entry stays
    // in recordingTabs (and so pollOnce()'s "already has an active tab"
    // guard stays true) for the WHOLE stop→upload→close sequence below, not
    // just while ffmpeg itself is running. Matters for back-to-back meetings
    // on the same Gmail account: without this, a slow Drive upload leaves a
    // window where the guard reads "free" while this tab is still open.
    getMeetingForTab(tabId).then(async (meetingId) => {
      if (meetingId) await stopRecording(meetingId);
      await popMeetingForTab(tabId);
      closeTab(tabId);
      sendResponse({ success: true });
    });
    return true;
  }
  if (message?.action === "CDP_CLICK_JOIN") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: "no sender tab id" });
      return true;
    }
    cdpClickJoin(tabId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
    return true;
  }
  return false;
});

// Runs on every worker load (fresh install, browser startup, or the worker
// being woken from eviction) — poll immediately rather than waiting a full
// interval, then hand off to the self-rescheduling chain.
ensureRecoveryAlarm();
pollOnce().then(scheduleNextPoll);
