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

async function pollOnce() {
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
    log(`Found meeting #${meeting.meeting_id}`, meeting.title || "");
    log("Opening Meet", meeting.join_url);
    await markOpened(meeting.meeting_id);
    chrome.tabs.create({ url: meeting.join_url, active: true });
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

chrome.runtime.onInstalled.addListener(ensureRecoveryAlarm);
chrome.runtime.onStartup.addListener(ensureRecoveryAlarm);

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

async function cdpClick(tabId, x, y) {
  const target = { tabId };
  await new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
  try {
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  } finally {
    await new Promise((resolve) => chrome.debugger.detach(target, () => resolve()));
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
  if (message?.action === "CDP_CLICK") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: "no sender tab id" });
      return true;
    }
    cdpClick(tabId, message.x, message.y)
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
