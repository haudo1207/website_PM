// ==========================================
// KPI PROTOTYPE — background service worker.
// Talks to pm-new's own FastAPI backend (AI_TRACKER_CONFIG.API_BASE, baked in
// once at download time by the zip-builder route) instead of markee-dashboard's
// Supabase. host_permissions in manifest.json includes that origin, so these
// fetches bypass CORS entirely (Chrome exempts host-permission-covered
// extension-context requests) — no server-side CORS change was needed.
//
// ONE zip works for every project — there is no per-project download anymore
// (users found re-downloading per project annoying). The active project is
// just a value in chrome.storage.local (`selected_project_id/name`), picked
// from a real dropdown in the popup/widget and changeable anytime. Only an
// optional "suggested" default survives from the zip-builder (set when the
// download happened to originate from a specific project's Prototype tab).
// ==========================================
importScripts("config.js");

const API_BASE = AI_TRACKER_CONFIG.API_BASE;

function getSelectedProject() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["selected_project_id", "selected_project_name"], (r) => {
      if (r.selected_project_id) {
        resolve({ id: r.selected_project_id, name: r.selected_project_name || "" });
      } else {
        resolve({ id: AI_TRACKER_CONFIG.SUGGESTED_PROJECT_ID || null, name: AI_TRACKER_CONFIG.SUGGESTED_PROJECT_NAME || "" });
      }
    });
  });
}

function setSelectedProject(id, name) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ selected_project_id: id, selected_project_name: name }, resolve),
  );
}

const HEARTBEAT_ALARM_NAME = "kpi-prototype-heartbeat";
const HEARTBEAT_PERIOD_MINUTES = 3;
const VERSION_CHECK_ALARM_NAME = "checkKpiPrototypeVersion";
const VERSION_CHECK_PERIOD_MINUTES = 30;

// ==========================================
// AUTH — email+password login against pm-new, refresh-token kept instead of
// the password itself. See backend/app/routers/auth.py's X-Client:extension
// handling and the JSON-body fallback on /api/auth/refresh.
// ==========================================
function getAuthState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["kpi_prototype_access_token", "kpi_prototype_refresh_token", "kpi_prototype_token_expires_at", "kpi_prototype_email", "kpi_prototype_full_name"],
      (r) => resolve(r),
    );
  });
}

async function doLogin(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Client": "extension" },
    body: new URLSearchParams({ username: email, password }).toString(),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Đăng nhập thất bại (${res.status})`);
  }
  const data = await res.json();
  const expiresAt = Date.now() + 25 * 60 * 1000; // refresh a bit before the real 30-minute JWT expiry
  await new Promise((resolve) =>
    chrome.storage.local.set(
      {
        kpi_prototype_access_token: data.access_token,
        kpi_prototype_refresh_token: data.refresh_token,
        kpi_prototype_token_expires_at: expiresAt,
        kpi_prototype_email: email,
        kpi_prototype_full_name: data.full_name || "",
      },
      resolve,
    ),
  );
  return { email, fullName: data.full_name || "" };
}

// Passwordless path: if the user is already logged into the pm-new WEB APP
// in this same browser, its HttpOnly `portal_refresh` cookie is sitting in
// the cookie jar right now. chrome.cookies (unlike a page fetch) can read it
// directly — SameSite=Lax only blocks the cookie from being auto-attached to
// a cross-context fetch, it doesn't block the "cookies" permission from
// reading the value outright. We then hand that same raw value to
// /api/auth/refresh's JSON-body fallback exactly like a manually-logged-in
// session would. Falls back to the email/password form when there's no
// existing web session to borrow (different browser/profile, or the user
// has never logged into the pm-new site here).
async function tryAutoLoginFromCookie() {
  const cookie = await new Promise((resolve) => {
    try {
      chrome.cookies.get({ url: API_BASE, name: "portal_refresh" }, (c) => resolve(c || null));
    } catch (e) {
      resolve(null);
    }
  });
  if (!cookie || !cookie.value) return { success: false };

  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: cookie.value }),
  });
  if (!res.ok) return { success: false };

  const data = await res.json();
  const expiresAt = Date.now() + 25 * 60 * 1000;
  await new Promise((resolve) =>
    chrome.storage.local.set(
      {
        kpi_prototype_access_token: data.access_token,
        kpi_prototype_refresh_token: cookie.value,
        kpi_prototype_token_expires_at: expiresAt,
        kpi_prototype_email: data.email,
        kpi_prototype_full_name: data.full_name || "",
      },
      resolve,
    ),
  );
  return { success: true, email: data.email, fullName: data.full_name || "" };
}

async function doLogout() {
  await new Promise((resolve) =>
    chrome.storage.local.remove(
      ["kpi_prototype_access_token", "kpi_prototype_refresh_token", "kpi_prototype_token_expires_at", "kpi_prototype_email", "kpi_prototype_full_name"],
      resolve,
    ),
  );
}

async function refreshAccessToken() {
  const state = await getAuthState();
  if (!state.kpi_prototype_refresh_token) return null;
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: state.kpi_prototype_refresh_token }),
  });
  if (!res.ok) {
    // Refresh session expired/revoked (20 days) — require a fresh login.
    await doLogout();
    return null;
  }
  const data = await res.json();
  const expiresAt = Date.now() + 25 * 60 * 1000;
  await new Promise((resolve) =>
    chrome.storage.local.set({ kpi_prototype_access_token: data.access_token, kpi_prototype_token_expires_at: expiresAt }, resolve),
  );
  return data.access_token;
}

async function getValidAccessToken() {
  const state = await getAuthState();
  if (!state.kpi_prototype_access_token) return null;
  if (!state.kpi_prototype_token_expires_at || Date.now() >= state.kpi_prototype_token_expires_at) {
    return refreshAccessToken();
  }
  return state.kpi_prototype_access_token;
}

// Authenticated fetch to pm-new's API — retries once after a fresh refresh on 401.
async function apiFetch(path, options = {}) {
  let token = await getValidAccessToken();
  if (!token) throw new Error("Chưa đăng nhập KPI Portal — mở popup extension để đăng nhập.");

  const doFetch = (accessToken) =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
    });

  let res = await doFetch(token);
  if (res.status === 401) {
    token = await refreshAccessToken();
    if (!token) throw new Error("Phiên đăng nhập KPI Portal đã hết hạn — vui lòng đăng nhập lại.");
    res = await doFetch(token);
  }
  return res;
}

// ==========================================
// HÀM TIỆN ÍCH: Uint8Array → Base64 an toàn cho file lớn
// ==========================================
function uint8ArrayToBase64(u8Arr) {
  const CHUNK_SIZE = 0x8000;
  let index = 0;
  const length = u8Arr.length;
  let result = "";
  while (index < length) {
    const slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
    result += String.fromCharCode.apply(null, slice);
    index += CHUNK_SIZE;
  }
  return btoa(result);
}

// ==========================================
// CƠ CHẾ BẮT FILE TẢI VỀ TỪ TRANG AI (DOWNLOAD API) — unchanged mechanism,
// still purely client-side (Chrome downloads API + tab messaging).
// ==========================================
let lastAIFile = null;

chrome.downloads.onCreated.addListener((item) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const currentTab = tabs[0];
    const tabUrl = currentTab.url || "";

    if (tabUrl.includes("claude.ai") || tabUrl.includes("chatgpt.com") || tabUrl.includes("gemini.google.com")) {
      const downloadUrl = item.url || "";
      const isChatGPT = downloadUrl.includes("chatgpt.com") || downloadUrl.includes("oaiusercontent");
      const delay = isChatGPT ? 200 : 20;

      setTimeout(() => {
        chrome.tabs.sendMessage(
          currentTab.id,
          { action: "FETCH_AI_BLOB", downloadUrl: item.url, rawFilename: item.filename },
          (response) => {
            if (chrome.runtime.lastError) return;
            if (response && response.success) {
              lastAIFile = response.file;
            }
          },
        );
      }, delay);
    }
  });
});

// ==========================================
// AUTO_LOG (passive session capture) → POST /api/ai-sessions
// ==========================================
async function handleAutoLog(logData) {
  const stagedFiles = Array.isArray(logData.staged_files) ? logData.staged_files : [];
  const current = await getSelectedProject();
  const res = await apiFetch("/api/ai-sessions", {
    method: "POST",
    body: JSON.stringify({
      ai_tool: logData.ai_tool || "unknown",
      project_id: logData.project_id ?? current.id,
      department_id: logData.department_id || null,
      team_id: logData.team_id || null,
      task_type: logData.task_type || "Auto-tracked",
      prompt_content: logData.prompt_content || "",
      tokens_used: logData.tokens_used || 0,
      staged_files: stagedFiles,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ai-sessions rejected (${res.status}): ${detail}`);
  }
}

// ==========================================
// get-or-create a ProjectFeature by name, under the currently selected project
// ==========================================
async function getOrCreateFeatureId(projectId, featureName) {
  const name = (featureName || "Chưa đặt tên").trim();
  const listRes = await apiFetch(`/api/projects/${projectId}/features`);
  if (listRes.ok) {
    const features = await listRes.json();
    const existing = features.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
  }
  const createRes = await apiFetch(`/api/projects/${projectId}/features`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (createRes.ok) {
    return (await createRes.json()).id;
  }
  // Duplicate-name race (400) — re-list and use the now-existing row.
  const retryRes = await apiFetch(`/api/projects/${projectId}/features`);
  const features = await retryRes.json();
  const found = features.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  throw new Error("Không thể tạo hoặc tìm thấy tính năng để lưu log");
}

// ==========================================
// FEATURE 2: VERSION CHECKER — now backed by a small config value, not a DB
// table (GET /api/extension/ai-tracker/version, public, no auth needed).
// ==========================================
function isNewerVersion(remoteVersion, localVersion) {
  const parse = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
  const remote = parse(remoteVersion);
  const local = parse(localVersion);
  const len = Math.max(remote.length, local.length);
  for (let i = 0; i < len; i++) {
    if ((remote[i] || 0) > (local[i] || 0)) return true;
    if ((remote[i] || 0) < (local[i] || 0)) return false;
  }
  return false;
}

async function checkExtensionVersion() {
  try {
    const res = await fetch(`${API_BASE}/api/extension/ai-tracker/version`);
    if (!res.ok) return;
    const { version_number: remoteVersion, download_url: downloadUrl } = await res.json();
    const localVersion = chrome.runtime.getManifest().version;

    if (!isNewerVersion(remoteVersion, localVersion)) {
      chrome.storage.local.remove("kpi_prototype_update_cache");
      return;
    }

    const updateData = { remoteVersion, downloadUrl: downloadUrl || API_BASE };
    chrome.storage.local.set({ kpi_prototype_update_cache: updateData });

    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        const url = tab.url || "";
        if (url.includes("chatgpt.com") || url.includes("claude.ai") || url.includes("gemini.google.com")) {
          chrome.tabs
            .sendMessage(tab.id, { action: "UPDATE_AVAILABLE", remoteVersion, localVersion, downloadUrl: updateData.downloadUrl })
            .catch(() => {});
        }
      }
    });
  } catch (err) {
    console.log("🔴 [ERROR] [VersionCheck]", err.message);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const url = tab.url || "";
  if (!url.includes("chatgpt.com") && !url.includes("claude.ai") && !url.includes("gemini.google.com")) return;

  chrome.storage.local.get(["kpi_prototype_update_cache"], (result) => {
    if (!result.kpi_prototype_update_cache) return;
    const { remoteVersion, downloadUrl } = result.kpi_prototype_update_cache;
    setTimeout(() => {
      chrome.tabs
        .sendMessage(tabId, { action: "UPDATE_AVAILABLE", remoteVersion, localVersion: chrome.runtime.getManifest().version, downloadUrl })
        .catch(() => {});
    }, 1500);
  });
});

function ensureHeartbeatAlarm() {
  chrome.alarms.create(HEARTBEAT_ALARM_NAME, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
}
function ensureVersionCheckAlarm() {
  chrome.alarms.create(VERSION_CHECK_ALARM_NAME, { periodInMinutes: VERSION_CHECK_PERIOD_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureHeartbeatAlarm();
  ensureVersionCheckAlarm();
  checkExtensionVersion();
  tryAutoLoginFromCookie().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  ensureHeartbeatAlarm();
  ensureVersionCheckAlarm();
  checkExtensionVersion();
  tryAutoLoginFromCookie().catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM_NAME) {
    // Proactively keep the access token fresh instead of the old license-heartbeat ping.
    getValidAccessToken()
      .then((token) => {
        // Not logged in yet (e.g. the extension was installed before the
        // user ever logged into pm-new in this browser) — keep retrying the
        // cookie-borrow every heartbeat so login "just happens" as soon as
        // a pm-new web session appears, no popup interaction needed.
        if (!token) return tryAutoLoginFromCookie();
      })
      .catch(() => {});
  }
  if (alarm.name === VERSION_CHECK_ALARM_NAME) {
    checkExtensionVersion();
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "toggle_widget" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "LOGIN") {
    doLogin(message.email, message.password)
      .then((r) => sendResponse({ success: true, email: r.email, fullName: r.fullName }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "TRY_AUTO_LOGIN") {
    tryAutoLoginFromCookie()
      .then((r) => sendResponse(r))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.action === "LOGOUT") {
    doLogout().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === "GET_AUTH_STATE") {
    Promise.all([getAuthState(), getSelectedProject()]).then(([s, project]) =>
      sendResponse({
        loggedIn: !!s.kpi_prototype_access_token,
        email: s.kpi_prototype_email || null,
        fullName: s.kpi_prototype_full_name || null,
        projectId: project.id,
        projectName: project.name,
      }),
    );
    return true;
  }

  if (message.action === "GET_SELECTED_PROJECT") {
    getSelectedProject().then((project) => sendResponse({ projectId: project.id, projectName: project.name }));
    return true;
  }

  if (message.action === "SET_SELECTED_PROJECT") {
    setSelectedProject(message.projectId, message.projectName).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === "GET_PROJECTS") {
    apiFetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.items || [];
        let projects = list.map((p) => ({
          id: p.id,
          name: p.name,
          customer_id: p.customer_id ?? null,
          customer_name: p.customer_name ?? null,
        }));
        // customer_id, when provided, narrows to that Customer — filtered
        // HERE (not via /api/projects?customer_id=) because only 1 project
        // in a real check of this DB actually had the relational
        // customer_id FK populated; customer_name (free text, ~6x more
        // populated) is the field real data actually carries, and that's
        // exactly the identity GET_CUSTOMERS below hands back as "id".
        if (message.customer_id) {
          const wanted = String(message.customer_id);
          projects = projects.filter((p) => String(p.customer_name || "") === wanted);
        }
        sendResponse({ projects });
      })
      .catch((err) => {
        console.log("🔴 [ERROR] GET_PROJECTS:", err.message);
        sendResponse({ projects: [] });
      });
    return true;
  }

  if (message.action === "GET_PROJECTS_BY_CUSTOMER") {
    // Same real handler as GET_PROJECTS above, keyed by the request shape
    // the customer->project cascade UI actually sends (customerId, not
    // customer_id) — was entirely unhandled before this fix (every
    // "Khách hàng" -> "Dự án" cascade in the widget silently returned
    // nothing once a customer was picked).
    apiFetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.items || [];
        let projects = list.map((p) => ({
          id: p.id,
          name: p.name,
          customer_id: p.customer_id ?? null,
          customer_name: p.customer_name ?? null,
        }));
        if (message.customerId) {
          const wanted = String(message.customerId);
          projects = projects.filter((p) => String(p.customer_name || "") === wanted);
        }
        sendResponse({ projects });
      })
      .catch((err) => {
        console.log("🔴 [ERROR] GET_PROJECTS_BY_CUSTOMER:", err.message);
        sendResponse({ projects: [] });
      });
    return true;
  }

  if (message.action === "GET_FAVORITE_PROJECTS") {
    // "⭐ Ưu thích" project list — no backend concept of a favorited project
    // exists in pm-new, and this action had no handler at all before this
    // fix (the widget's project quick-picker DEFAULTS to this filter tab,
    // so with an empty/undefined response it looked like the widget
    // couldn't see ANY real projects, even though "📁 Tất cả" worked fine).
    // Real per-browser favorite list, stored locally, same mechanism the
    // "🕒 Gần đây" tab already uses for markee_recent_project_ids.
    chrome.storage.local.get(["markee_favorite_project_ids"], (stored) => {
      const favIds = new Set((stored.markee_favorite_project_ids || []).map(Number));
      if (favIds.size === 0) {
        sendResponse({ projects: [] });
        return;
      }
      apiFetch("/api/projects")
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : data.items || [];
          sendResponse({
            projects: list
              .filter((p) => favIds.has(Number(p.id)))
              .map((p) => ({ id: p.id, name: p.name, customer_id: p.customer_id ?? null, customer_name: p.customer_name ?? null })),
          });
        })
        .catch((err) => {
          console.log("🔴 [ERROR] GET_FAVORITE_PROJECTS:", err.message);
          sendResponse({ projects: [] });
        });
    });
    return true;
  }

  if (message.action === "TOGGLE_FAVORITE_PROJECT") {
    chrome.storage.local.get(["markee_favorite_project_ids"], (stored) => {
      const ids = new Set((stored.markee_favorite_project_ids || []).map(Number));
      const id = Number(message.projectId);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      chrome.storage.local.set({ markee_favorite_project_ids: Array.from(ids) }, () => {
        sendResponse({ success: true, isFavorite: ids.has(id) });
      });
    });
    return true;
  }

  if (message.action === "GET_CUSTOMERS") {
    // Was previously not wired up at all (no handler existed for this
    // action), so every "Khách hàng" dropdown fed by it could never
    // populate. Deliberately NOT the relational Customer entity
    // (/api/system-categories/customers, backend/app/models/system_category.py)
    // — a real check of this DB found only 1 of 11 projects actually has
    // that FK (Project.customer_id) populated, so filtering by it would
    // leave almost every real Customer's "Dự án" step empty. Project's own
    // free-text customer_name is ~6x more populated and is what the rest of
    // pm-new's UI already treats as the real "customer" a project belongs
    // to — deriving the list from that (distinct values already on real
    // projects) guarantees every Customer shown here actually has ≥1
    // project behind it. The name doubles as its own "id" (GET_PROJECTS'
    // customer_id filter above matches on this same string).
    apiFetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.items || [];
        const names = Array.from(
          new Set(list.map((p) => (p.customer_name || "").trim()).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        sendResponse({ customers: names.map((n) => ({ id: n, name: n })) });
      })
      .catch((err) => {
        console.log("🔴 [ERROR] GET_CUSTOMERS:", err.message);
        sendResponse({ customers: [] });
      });
    return true;
  }

  if (message.action === "GET_USER_EMAIL") {
    getAuthState().then((s) => sendResponse({ email: s.kpi_prototype_email || null }));
    return true;
  }

  if (message.action === "CHECK_VERSION_MANUAL") {
    checkExtensionVersion()
      .then(() => {
        chrome.storage.local.get(["kpi_prototype_update_cache"], (res) => {
          const update = res.kpi_prototype_update_cache || null;
          sendResponse({ success: true, update });
        });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "AUTO_LOG") {
    handleAutoLog(message.data)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.log("🔴 [ERROR] AUTO_LOG:", err.message);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.action === "SAVE_SCRAPED_MARKDOWN") {
    (async () => {
      const payload = message.data || {};
      const autoScrapedFiles = Array.isArray(message.autoScrapedFiles) ? message.autoScrapedFiles : [];
      const attachedFiles = autoScrapedFiles
        .filter((f) => f && (f.base64 || f.data))
        .map((f) => ({
          file_name: f.fileName || f.name || "file",
          mime_type: f.mimeType || f.type,
          base64: f.base64 || f.data,
        }));

      try {
        if (message.isWipMode) {
          const current = await getSelectedProject();
          const projectId = payload.project_id ?? current.id;
          if (!projectId) throw new Error("Chưa chọn dự án — mở popup extension để chọn dự án.");
          const featureId = await getOrCreateFeatureId(projectId, payload.feature_name);
          const res = await apiFetch(`/api/projects/${projectId}/features/${featureId}/logs`, {
            method: "POST",
            body: JSON.stringify({
              content: `# ${payload.title || "WIP"}\n\n${payload.markdown_content || ""}`,
              attached_files: attachedFiles,
            }),
          });
          if (!res.ok) throw new Error(`Lưu WIP log thất bại (${res.status}): ${await res.text().catch(() => "")}`);
          lastAIFile = null;
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "SHOW_SUCCESS",
            title: payload.title,
            markdown_content: payload.markdown_content,
            isWipMode: true,
            projectId,
            featureName: payload.feature_name || null,
            files: autoScrapedFiles,
          });
          chrome.tabs.sendMessage(sender.tab.id, { action: "RELOAD_WIP_LIST" });
          sendResponse({ success: true, files: autoScrapedFiles });
        } else {
          const current = await getSelectedProject();
          const res = await apiFetch("/api/ai-skills", {
            method: "POST",
            body: JSON.stringify({
              title: payload.title,
              markdown_content: payload.markdown_content,
              asset_type: (payload.skill_type || "skill").toLowerCase(),
              category: payload.category,
              department_id: payload.department_id || null,
              team_id: payload.team_id || null,
              project_id: payload.project_id ?? current.id,
              attached_files: attachedFiles,
            }),
          });
          if (!res.ok) throw new Error(`Lưu skill thất bại (${res.status}): ${await res.text().catch(() => "")}`);
          const saved = await res.json();
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "SHOW_SUCCESS",
            title: payload.title,
            markdown_content: payload.markdown_content,
            isWipMode: false,
            files: autoScrapedFiles,
          });
          chrome.tabs.sendMessage(sender.tab.id, { action: "RELOAD_WIP_LIST" });
          sendResponse({ success: true, skillId: saved.id, files: autoScrapedFiles });
        }
      } catch (err) {
        console.log("🔴 [ERROR] SAVE_SCRAPED_MARKDOWN:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === "GET_PROJECT_FEATURES") {
    (async () => {
      const current = await getSelectedProject();
      if (!current.id) return sendResponse({ features: [] });
      try {
        const r = await apiFetch(`/api/projects/${current.id}/features`);
        const features = await r.json();
        sendResponse({ features: (features || []).map((f) => f.name) });
      } catch (err) {
        console.log("🔴 [ERROR] GET_PROJECT_FEATURES:", err.message);
        sendResponse({ features: [] });
      }
    })();
    return true;
  }

  if (message.action === "GET_DEPARTMENTS") {
    apiFetch("/api/system-categories/departments")
      .then((r) => r.json())
      .then((data) => sendResponse({ departments: Array.isArray(data) ? data : [] }))
      .catch(() => sendResponse({ departments: [] }));
    return true;
  }

  if (message.action === "GET_TEAMS") {
    apiFetch("/api/system-categories/teams")
      .then((r) => r.json())
      .then((data) => sendResponse({ teams: Array.isArray(data) ? data : [] }))
      .catch(() => sendResponse({ teams: [] }));
    return true;
  }

  if (message.action === "GET_SKILLS") {
    (async () => {
      try {
        const params = new URLSearchParams();
        if (message.filterType === "recent") params.set("recent", "true");
        else if (message.filterType === "favorite") params.set("favorite", "true");
        if (message.departmentId) params.set("department_id", String(message.departmentId));
        if (message.teamId) params.set("team_id", String(message.teamId));
        if (message.projectId) params.set("project_id", String(message.projectId));
        if (message.keyword) params.set("keyword", message.keyword);
        if (message.limit) params.set("limit", String(message.limit));
        if (message.offset) params.set("offset", String(message.offset));

        const res = await apiFetch(`/api/ai-skills?${params.toString()}`);
        const skills = await res.json();
        const favRes = await apiFetch("/api/ai-skills/favorites");
        const favData = await favRes.json().catch(() => ({ favorite_skill_ids: [] }));
        sendResponse({ skills: Array.isArray(skills) ? skills : [], favoriteSkillIds: favData.favorite_skill_ids || [] });
      } catch (err) {
        console.log("🔴 [ERROR] GET_SKILLS:", err.message);
        sendResponse({ skills: [] });
      }
    })();
    return true;
  }

  if (message.action === "SAVE_RECENT_SKILL" || message.action === "RECORD_SKILL_USAGE") {
    const skillId = Number(message.skillId);
    if (!skillId) {
      sendResponse({ success: false, error: "Thiếu skillId" });
      return true;
    }
    apiFetch(`/api/ai-skills/${skillId}/recent`, { method: "POST" })
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "GET_USER_FAVORITES") {
    apiFetch("/api/ai-skills/favorites")
      .then((r) => r.json())
      .then((data) => sendResponse({ favoriteSkillIds: data.favorite_skill_ids || [] }))
      .catch(() => sendResponse({ favoriteSkillIds: [] }));
    return true;
  }

  if (message.action === "TOGGLE_FAVORITE_SKILL") {
    const skillId = Number(message.skillId);
    if (!skillId) {
      sendResponse({ success: false, error: "Thiếu skillId" });
      return true;
    }
    apiFetch(`/api/ai-skills/${skillId}/favorite`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => sendResponse({ success: true, isFavorite: data.is_favorite }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "GET_PROJECT_SHARE_LINK") {
    // "Mở Link" after saving must land the (already logged-in) user straight
    // on THIS project's Prototype tab in the real app — not the public
    // /share/project/{token} page (that's for people without an account;
    // confirmed wrong for this flow via direct user feedback). Uses the
    // real next.config.js rewrite (/project/detail/:tab -> /project/detail
    // ?tab=:tab), same URL shape project/detail/page.tsx's own tab links
    // produce. Also passes projectId explicitly (message.projectId, set by
    // the SET_SELECTED_PROJECT fix) instead of re-reading
    // getSelectedProject() — the two could disagree mid-flow otherwise.
    (async () => {
      try {
        const current = await getSelectedProject();
        const projectId = message.projectId || current.id;
        if (!projectId) throw new Error("Chưa chọn dự án");
        let shareUrl = `${API_BASE}/project/detail/prototype?id=${encodeURIComponent(projectId)}`;
        if (message.featureName && String(message.featureName).trim()) {
          shareUrl += "&feature=" + encodeURIComponent(String(message.featureName).trim());
        }
        sendResponse({ success: true, shareUrl });
      } catch (err) {
        console.log("🔴 [ERROR] share-link:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === "DELETE_WIP") {
    (async () => {
      const wipId = message.wipId;
      if (!wipId) {
        sendResponse({ ok: false, error: "Thiếu wipId" });
        return;
      }
      try {
        const current = await getSelectedProject();
        const res = await apiFetch(`/api/projects/${current.id}/feature-logs/${wipId}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Xóa WIP thất bại (${res.status})`);
        sendResponse({ ok: true });
      } catch (err) {
        console.log("🔴 [ERROR] DELETE_WIP:", err.message);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === "CLOSE_CURRENT_TAB") {
    chrome.tabs.remove(sender.tab.id);
  }

  if (message.action === "SAVE_USAGE_STATS") {
    apiFetch("/api/ai-usage-stats", { method: "POST", body: JSON.stringify(message.data) }).catch((err) =>
      console.log("🔴 [ERROR] SAVE_USAGE_STATS:", err.message),
    );
  }

  if (message.action === "FETCH_ATTACHMENT") {
    (async () => {
      try {
        let skillId = message.skillId;
        let idx = message.attachmentIndex ?? 0;
        if (message.skill && Array.isArray(message.skill.attachments) && message.skill.attachments.length) {
          skillId = message.skill.id;
          idx = 0;
        }
        if (!skillId) {
          sendResponse({ ok: false, error: "Thiếu skillId" });
          return;
        }
        const res = await apiFetch(`/api/ai-skills/${skillId}/attachments/${idx}`);
        if (!res.ok) throw new Error(`Fetch attachment failed: ${res.status}`);
        const buffer = await res.arrayBuffer();
        const base64 = uint8ArrayToBase64(new Uint8Array(buffer));
        sendResponse({
          ok: true,
          base64,
          mimeType: res.headers.get("Content-Type") || "application/octet-stream",
          fileName: message.fileName || "file",
        });
      } catch (err) {
        console.log("🔴 [ERROR] FETCH_ATTACHMENT:", err.message);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});
