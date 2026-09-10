const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.storage.local.get(["apiBase", "botToken", "googleEmail"]);
  $("apiBase").value = cfg.apiBase || "";
  $("botToken").value = cfg.botToken || "";
  $("googleEmail").value = cfg.googleEmail || "";
}

$("save").addEventListener("click", async () => {
  const apiBase = $("apiBase").value.trim().replace(/\/+$/, "");
  const botToken = $("botToken").value.trim();
  const googleEmail = $("googleEmail").value.trim().toLowerCase();

  await chrome.storage.local.set({ apiBase, botToken, googleEmail });
  // Force the background worker's alarm loop to re-check immediately with
  // the new config, instead of waiting up to a minute for the next tick.
  chrome.runtime.sendMessage({ type: "config-updated" });

  const status = $("status");
  status.textContent = "Đã lưu.";
  setTimeout(() => (status.textContent = ""), 2000);
});

load();
