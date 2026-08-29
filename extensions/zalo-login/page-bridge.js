(() => {
  if (window.__kpiZaloBridgeLoaded) return;
  window.__kpiZaloBridgeLoaded = true;
  window.__zaloExtensionAvailable = true;

  const postResponse = (requestId, success, data, error) => {
    window.postMessage(
      { __zaloExt: true, type: "RESPONSE", requestId, success, data, error },
      "*"
    );
  };

  const postPong = (requestId) => {
    window.postMessage(
      { __zaloExt: true, type: "PONG", requestId, installed: true, success: true, data: { installed: true } },
      "*"
    );
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const payload = event.data;
    if (!payload || payload.__zaloExt !== true || !payload.type) return;

    // Ignore our own outbound echoes (avoid a postMessage loop).
    if (payload.type === "RESPONSE" || payload.type === "PONG") return;

    const requestId = payload.requestId || `zalo-${Date.now()}`;
    if (payload.type === "PING") {
      postPong(requestId);
      return;
    }

    // MV3 service workers can be unloaded after ~30s idle; a generous
    // timeout here covers a slow "wait for cookies" import without leaving
    // the page's promise hanging forever if the worker never wakes up.
    const SEND_TIMEOUT_MS = 70000;
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      postResponse(requestId, false, null, `Extension message timed out after ${SEND_TIMEOUT_MS}ms.`);
    }, SEND_TIMEOUT_MS);

    chrome.runtime.sendMessage(
      { action: payload.type, type: payload.type, data: payload.data || {} },
      (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        const runtimeError = chrome.runtime.lastError?.message;
        if (runtimeError) {
          postResponse(requestId, false, null, runtimeError);
          return;
        }
        postResponse(requestId, !!response?.success, response?.data ?? null, response?.error || null);
      }
    );
  });

  postPong("bridge-ready");
})();
