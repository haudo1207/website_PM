const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.storage.local.get(["apiBaseUrl", "googleEmail", "botToken", "pollIntervalSeconds"]);
  $("apiBaseUrl").value = cfg.apiBaseUrl || "";
  $("googleEmail").value = cfg.googleEmail || "";
  $("botToken").value = cfg.botToken || "";
  $("pollIntervalSeconds").value = cfg.pollIntervalSeconds || 20;
}

function originPatternOf(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch (_err) {
    return null;
  }
}

$("save").addEventListener("click", async () => {
  let apiBaseUrl = $("apiBaseUrl").value.trim().replace(/\/+$/, "");
  // A bare domain (no "https://") makes `new URL()` throw, which used to
  // surface as a confusing "API Base URL không hợp lệ" with no indication
  // of why — assume https since every real deployment (dev/prod) uses it.
  if (apiBaseUrl && !/^https?:\/\//i.test(apiBaseUrl)) {
    apiBaseUrl = `https://${apiBaseUrl}`;
  }
  $("apiBaseUrl").value = apiBaseUrl;
  const googleEmail = $("googleEmail").value.trim();
  const botToken = $("botToken").value.trim();
  const pollIntervalSeconds = Math.max(Number($("pollIntervalSeconds").value) || 20, 5);

  // apiBaseUrl is user-configurable (each VPS profile may point at a
  // different backend), so the extension only declares meet.google.com as a
  // mandatory host permission and requests this one at runtime instead of
  // hardcoding every possible domain into the manifest.
  const origin = originPatternOf(apiBaseUrl);
  if (!origin) {
    $("status").textContent = "API Base URL không hợp lệ.";
    return;
  }
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    $("status").textContent = "Cần cấp quyền truy cập API Base URL để bot hoạt động.";
    return;
  }

  await chrome.storage.local.set({ apiBaseUrl, googleEmail, botToken, pollIntervalSeconds });
  await chrome.runtime.sendMessage({ action: "RECONFIGURE" });
  $("status").textContent = "Đã lưu cấu hình.";
});

$("pollNow").addEventListener("click", async () => {
  $("status").textContent = "Đang kiểm tra queue...";
  await chrome.runtime.sendMessage({ action: "POLL_NOW" });
  $("status").textContent =
    "Đã kiểm tra xong — mở chrome://extensions → bật Developer mode → \"Service worker\" của extension này → Inspect để xem log.";
});

load();
