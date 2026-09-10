// Service worker: polls the backend queue every ~1 min and opens a tab for
// any Google Meet meeting that just became due for this profile's mailbox.
// Idempotent across service-worker restarts by remembering already-opened
// meeting ids (with an expiry) in chrome.storage.local instead of memory.

const POLL_ALARM = "meeting-bot-poll";
const OPENED_TTL_MS = 3 * 60 * 60 * 1000; // forget an opened meeting after 3h

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) pollAndJoin();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "config-updated") pollAndJoin();
});

async function getOpened() {
  const { opened } = await chrome.storage.local.get(["opened"]);
  const now = Date.now();
  const fresh = {};
  for (const [id, ts] of Object.entries(opened || {})) {
    if (now - ts < OPENED_TTL_MS) fresh[id] = ts;
  }
  return fresh;
}

async function markOpened(meetingId) {
  const opened = await getOpened();
  opened[meetingId] = Date.now();
  await chrome.storage.local.set({ opened });
}

async function pollAndJoin() {
  const cfg = await chrome.storage.local.get(["apiBase", "botToken", "googleEmail"]);
  if (!cfg.apiBase || !cfg.googleEmail) return; // not configured yet

  let data;
  try {
    const res = await fetch(
      `${cfg.apiBase}/queue?google_email=${encodeURIComponent(cfg.googleEmail)}`,
      { headers: { "X-Meeting-Bot-Token": cfg.botToken || "" } }
    );
    if (!res.ok) {
      console.warn("[meeting-bot] queue fetch failed", res.status);
      return;
    }
    data = await res.json();
  } catch (e) {
    console.warn("[meeting-bot] queue fetch error", e);
    return;
  }

  const opened = await getOpened();
  for (const item of data.due || []) {
    const key = String(item.meeting_id);
    if (opened[key]) continue;
    await markOpened(key);
    chrome.tabs.create({ url: item.join_url, active: false });
    console.log("[meeting-bot] joining", item.title, item.join_url);
  }
}
