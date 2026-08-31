// ==========================================
// KPI PROTOTYPE — baked-in config, injected once at download time by
// frontend/src/app/api/extension/ai-tracker/route.ts (placeholders below are
// literal string-replaced before the zip is built — do not rename them).
//
// ONE zip works for every project. SUGGESTED_PROJECT_ID/NAME are only a
// one-time default (set the FIRST time the extension starts, when the user
// hasn't picked a project yet) — set when the download happened to
// originate from a specific project's Prototype tab; blank otherwise. The
// real, changeable choice lives in chrome.storage.local
// (selected_project_id/name), picked from the popup/widget.
// ==========================================
const AI_TRACKER_CONFIG = {
  API_BASE: "%%API_BASE%%",
  SUGGESTED_PROJECT_ID: %%SUGGESTED_PROJECT_ID%%,
  SUGGESTED_PROJECT_NAME: "%%SUGGESTED_PROJECT_NAME%%",
};

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(["selected_project_id"], (r) => {
      if (!r.selected_project_id && AI_TRACKER_CONFIG.SUGGESTED_PROJECT_ID) {
        chrome.storage.local.set({
          selected_project_id: AI_TRACKER_CONFIG.SUGGESTED_PROJECT_ID,
          selected_project_name: AI_TRACKER_CONFIG.SUGGESTED_PROJECT_NAME,
        });
      }
    });
  });
}
