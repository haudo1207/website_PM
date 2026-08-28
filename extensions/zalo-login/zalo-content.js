// Runs on chat.zalo.me. Only job: hand back the REAL imei Zalo Web itself
// is using for this browser session — critical, because Zalo binds a
// session cookie to the exact imei used when the browser logged in.
// Without this, a randomly-generated imei gets every login rejected with a
// generic "Đăng nhập thất bại" and no useful error.
(() => {
  function findImeiCandidate() {
    const candidates = [];
    try {
      for (const store of [window.localStorage, window.sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i) || "";
          const value = store.getItem(key) || "";
          if (/imei|device|z_uuid|uuid/i.test(key) || /[0-9a-f-]{16,}/i.test(value)) {
            candidates.push(value);
          }
        }
      }
    } catch (_err) {
      // storage can be blocked in some contexts — background falls back to a cached uuid
    }
    return candidates.find((v) => /^[0-9a-f-]{16,}$/i.test(String(v))) || "";
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const action = message?.action;
    if (action === "PING_ZALO_CONTENT") {
      sendResponse({ success: true, data: { ok: true } });
      return true;
    }
    if (action === "GET_ZALO_CONTEXT") {
      sendResponse({
        success: true,
        data: { user_agent: navigator.userAgent || "", imei: findImeiCandidate(), url: location.href },
      });
      return true;
    }
    sendResponse({ success: false, error: `Unknown Zalo content action: ${action}` });
    return true;
  });
})();
