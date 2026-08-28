// Harvests Zalo Web cookies from the user's already-logged-in chat.zalo.me
// tab and hands them back to the calling KPI Portal page — it does NOT call
// the backend itself. The Portal's access JWT lives only in that page's JS
// memory (frontend/src/lib/auth.ts), unreachable from this service worker,
// so the page must be the one to POST /api/zalo/auth/import-session (its
// axios client already attaches the Bearer token automatically).
const ZALO_URL = "https://chat.zalo.me/";

const ALLOWED_SENDER_ORIGINS = new Set([
  "http://localhost:3000",
  "https://dev.kpi.markeeai.com",
  "https://kpi.markeeai.com",
  "https://kpi.securityzone.vn",
]);

function isTrustedSender(sender) {
  if (!sender.tab) return true; // extension-internal context (popup, etc.)
  const tabUrl = sender.tab?.url || "";
  if (!tabUrl) return false;
  try {
    return ALLOWED_SENDER_ORIGINS.has(new URL(tabUrl).origin);
  } catch (_err) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedSender(sender)) {
    sendResponse({ success: false, error: "Sender origin not trusted" });
    return true;
  }
  const action = message?.action || message?.type;
  handleAction(action, message?.data || {})
    .then((result) => sendResponse({ success: true, data: result }))
    .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
  return true; // keep the message channel open for the async response
});

let importInProgress = false;

async function handleAction(action, data) {
  switch (action) {
    case "PING":
      return { installed: true };
    case "IMPORT_ZALO_SESSION": {
      if (importInProgress) throw new Error("Đang có 1 lượt đăng nhập khác đang xử lý, vui lòng đợi.");
      importInProgress = true;
      try {
        return await importZaloSession();
      } finally {
        importInProgress = false;
      }
    }
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromeLastError() {
  return chrome.runtime.lastError?.message || "";
}

function queryTabs(query) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(query, (tabs) => {
      const err = chromeLastError();
      if (err) reject(new Error(err));
      else resolve(tabs || []);
    });
  });
}

function createTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      const err = chromeLastError();
      if (err) reject(new Error(err));
      else resolve(tab);
    });
  });
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const err = chromeLastError();
      if (err) reject(new Error(err));
      else resolve(tab);
    });
  });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const cleanup = () => {
      clearInterval(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve(tab);
      }
    };
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > timeoutMs) {
        cleanup();
        reject(new Error("Timeout waiting for Zalo tab to load"));
        return;
      }
      try {
        const tab = await getTab(tabId);
        if (tab.status === "complete") {
          cleanup();
          resolve(tab);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    }, 500);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function findZaloTab() {
  const tabs = await queryTabs({});
  const zaloTabs = tabs.filter((tab) => String(tab.url || "").toLowerCase().includes("zalo.me"));
  return zaloTabs.find((tab) => tab.status === "complete") || zaloTabs[0] || null;
}

async function getOrOpenZaloTab() {
  const existing = await findZaloTab();
  if (existing?.id) {
    if (existing.status !== "complete") await waitForTabComplete(existing.id);
    return await getTab(existing.id);
  }
  const tab = await createTab(ZALO_URL);
  if (!tab?.id) throw new Error("Không mở được tab Zalo Web.");
  await waitForTabComplete(tab.id);
  return await getTab(tab.id);
}

function getAllCookies(details) {
  return new Promise((resolve) => {
    chrome.cookies.getAll(details, (cookies) => resolve(chromeLastError() ? [] : (cookies || [])));
  });
}

// No required cookie key names — Zalo has renamed its session cookies
// before, so "have at least one zalo.me cookie" is the only check.
// Query both by URL (what a real request to that URL would send) AND by
// domain (catches cookies that wouldn't match one of the specific URLs
// above but are still valid for a broader domain, e.g. `.zalo.me`) — a
// login failure with "not enough cookies" is easy to mistake for a
// server-side rejection, so cast a wide net here.
async function readZaloCookies() {
  const urls = ["https://chat.zalo.me/", "https://id.zalo.me/", "https://zalo.me/", "https://www.zalo.me/"];
  const domains = ["zalo.me", ".zalo.me", "chat.zalo.me", ".chat.zalo.me", "id.zalo.me", ".id.zalo.me"];
  const all = [];
  for (const url of urls) {
    all.push(...(await getAllCookies({ url })));
  }
  for (const domain of domains) {
    all.push(...(await getAllCookies({ domain })));
  }
  console.log(`[zalo-extension] raw cookies collected: ${all.length}`);
  const byKey = new Map();
  for (const cookie of all) {
    if (!cookie?.name || !String(cookie.domain || "").includes("zalo.me")) continue;
    byKey.set(`${cookie.name}|${cookie.domain}|${cookie.path || "/"}`, cookie);
  }
  const deduped = [...byKey.values()];
  console.log(
    `[zalo-extension] deduped cookies: ${deduped.length} — ${deduped.map((c) => `${c.name}@${c.domain}`).join(', ')}`
  );
  return deduped.map((c) => ({
    key: c.name,
    name: c.name,
    value: c.value,
    domain: c.domain || "chat.zalo.me",
    path: c.path || "/",
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    expirationDate: Number.isFinite(c.expirationDate) ? Math.floor(c.expirationDate) : undefined,
  }));
}

const IMPORT_COOKIE_WAIT_MS = 50000;
const IMPORT_COOKIE_POLL_INTERVAL_MS = 2000;

async function waitForAnyZaloCookies() {
  const startedAt = Date.now();
  let cookies = await readZaloCookies();
  while (cookies.length === 0 && Date.now() - startedAt < IMPORT_COOKIE_WAIT_MS) {
    await wait(IMPORT_COOKIE_POLL_INTERVAL_MS);
    cookies = await readZaloCookies();
  }
  return cookies;
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chromeLastError();
      if (err) reject(new Error(err));
      else if (response && response.success === false) reject(new Error(response.error || "Content script error"));
      else resolve(response?.data ?? response);
    });
  });
}

function executeContentFile(tabId, file) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files: [file] }, (results) => {
      const err = chromeLastError();
      if (err) reject(new Error(err));
      else resolve(results || []);
    });
  });
}

// content_scripts auto-injects zalo-content.js on new navigations to
// chat.zalo.me, but a tab that was ALREADY open before this extension was
// (re)loaded never gets it — ping first, inject on demand if that fails.
async function ensureZaloContentScript(tabId) {
  try {
    await sendMessageToTab(tabId, { action: "PING_ZALO_CONTENT" });
    return;
  } catch (_pingError) {
    try {
      await executeContentFile(tabId, "zalo-content.js");
      await wait(200);
      await sendMessageToTab(tabId, { action: "PING_ZALO_CONTENT" });
    } catch (e) {
      console.warn("[zalo-extension] could not ensure zalo-content.js:", e?.message);
    }
  }
}

// The REAL imei Zalo Web is using for this browser session, read from its
// own localStorage — falls back to a cached (or freshly generated, then
// cached) UUID only if that lookup fails. Preferring the real one matters:
// Zalo binds the session cookie to the imei used when it was issued, so a
// mismatched imei gets every login rejected with a generic error.
async function getZaloPageContext(tabId) {
  try {
    await ensureZaloContentScript(tabId);
    const ctx = await sendMessageToTab(tabId, { action: "GET_ZALO_CONTEXT" });
    return ctx || {};
  } catch (error) {
    console.warn("[zalo-extension] cannot read Zalo page context, falling back to generated imei:", error?.message);
    return {};
  }
}

async function getStableImei(contentScriptImei) {
  if (contentScriptImei) {
    await chrome.storage.local.set({ cachedImei: contentScriptImei });
    return contentScriptImei;
  }
  const stored = await chrome.storage.local.get(["cachedImei"]);
  if (stored.cachedImei) return stored.cachedImei;
  const generated = crypto.randomUUID();
  await chrome.storage.local.set({ cachedImei: generated });
  return generated;
}

async function importZaloSession() {
  let tabIdToClose = null;
  try {
    const tab = await getOrOpenZaloTab();
    tabIdToClose = tab?.id || null;

    const cookies = await waitForAnyZaloCookies();
    if (cookies.length === 0) {
      throw new Error(
        "Hết thời gian chờ mà chưa đăng nhập Zalo Web. Hãy đăng nhập/quét QR trên tab vừa mở rồi bấm 'Kết nối' lại."
      );
    }

    const context = tabIdToClose ? await getZaloPageContext(tabIdToClose) : {};
    const imei = await getStableImei(context.imei);
    console.log(
      `[zalo-extension] using imei ${imei} (source: ${context.imei ? "chat.zalo.me localStorage" : "cached/generated fallback"})`
    );
    return {
      cookies,
      imei,
      user_agent: context.user_agent || navigator.userAgent,
    };
  } finally {
    // Always close the tab, success or failure — never leave it hanging.
    if (tabIdToClose) {
      try {
        await chrome.tabs.remove(tabIdToClose);
      } catch (_err) {
        // tab may already be closed by the user — ignore
      }
    }
  }
}
