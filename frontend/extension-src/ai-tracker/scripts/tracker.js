// ==========================================
// BƯỚC 0: Inject interceptor.js & Kích hoạt AutoScrape 24/7
// ==========================================
console.log("[Markee AutoScrape] 🚀 Content Script tracker.js đã được Inject và kích hoạt 24/7!");

(function () {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("scripts/interceptor.js");
  script.onload = function () {
    console.log("[Markee] ✅ Interceptor injected thành công");
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();

// ==========================================
// NHIỆM VỤ: Quét hạn mức, tính Token và Auto Log
// ==========================================
var AI_SITES = { "claude.ai": "Claude", "chatgpt.com": "ChatGPT", "gemini.google.com": "Gemini" };
let stagedFiles = [];
let sessionFilesMap = {}; // TASK 1: Session-Based Map lưu trữ file theo từng chat session { [pathname]: [fileObj1, ...] }
let geminiActiveDOMFile = null;

function getCurrentSessionKey() {
  return window.location.pathname || "default_session";
}

function getCapturedAIFilesForCurrentSession() {
  const key = getCurrentSessionKey();
  if (!sessionFilesMap[key]) {
    sessionFilesMap[key] = [];
  }
  return sessionFilesMap[key];
}

window.sessionFilesMap = sessionFilesMap;
window.getCurrentSessionKey = getCurrentSessionKey;
window.getCapturedAIFilesForCurrentSession = getCapturedAIFilesForCurrentSession;
window.geminiActiveDOMFile = geminiActiveDOMFile;

// Getter động cho window.capturedAIFiles để đảm bảo tương thích ngược 100%
try {
  Object.defineProperty(window, "capturedAIFiles", {
    get: function () {
      return getCapturedAIFilesForCurrentSession();
    },
    configurable: true,
  });
} catch (_) {
  window.capturedAIFiles = [];
}

// ========== TASK 1: HELPER CHUẨN HÓA TÊN FILE & TRÍCH XUẤT VERSION (VD: nau_ca_kho(1).html -> 1) ==========
function sanitizeFileName(fileName) {
  if (!fileName || typeof fileName !== "string") return fileName || "";
  return fileName.replace(/\s*\(\d+\)(?=\.[a-zA-Z0-9]+$|$)/gi, "").trim();
}
window.sanitizeFileName = sanitizeFileName;

function extractVersionNumber(fileName) {
  if (!fileName || typeof fileName !== "string") return 0;
  const match = fileName.match(/\((\d+)\)(?=\.[a-zA-Z0-9]+$|$)/i);
  return match && match[1] ? parseInt(match[1], 10) : 0;
}
window.extractVersionNumber = extractVersionNumber;

// ========== TASK 2 & 3: SMART OVERWRITE HELPER - GHI ĐÈ FILE TRÙNG TÊN VÀ TỰ ĐỘNG NÂNG VERSION ==========
function saveOrUpdateSessionFile(fileObj, rawFileName) {
  const raw = rawFileName || fileObj.rawFileName || fileObj.fileName || fileObj.name || "";
  const cleanName = sanitizeFileName(raw);
  let incomingVersion = extractVersionNumber(raw);
  const now = Date.now();

  const currentFiles = getCapturedAIFilesForCurrentSession();
  const existingIdx = currentFiles.findIndex((f) => sanitizeFileName(f.fileName || f.name) === cleanName);

  fileObj.lastUpdated = now;

  if (existingIdx !== -1) {
    const existingVersion = currentFiles[existingIdx].version || 0;
    // Nếu tên raw không chứa explicit (1), (2)... mà là file trùng tên từ chat mới, tự động tăng version
    if (incomingVersion === 0 || incomingVersion <= existingVersion) {
      incomingVersion = existingVersion + 1;
    }

    fileObj.fileName = cleanName;
    fileObj.name = cleanName;
    fileObj.rawFileName = raw;
    fileObj.version = incomingVersion;

    currentFiles[existingIdx] = fileObj;
    console.log(`[Markee SmartOverwrite] 🔄 [Session: ${getCurrentSessionKey()}] Ghi đè file "${cleanName}" (Version mới v${incomingVersion} >= v${existingVersion})`);
  } else {
    fileObj.fileName = cleanName;
    fileObj.name = cleanName;
    fileObj.rawFileName = raw;
    fileObj.version = incomingVersion;

    currentFiles.push(fileObj);
    console.log(`[Markee SmartOverwrite] ✅ [Session: ${getCurrentSessionKey()}] Đã thêm file mới "${cleanName}" (v${incomingVersion})`);
  }
}

// ========== HELPER: An toàn Append Element vào Body (Tránh crash document.body null) ==========
function appendToBodySafe(element) {
  if (!element) return;
  if (document.body) {
    document.body.appendChild(element);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.body) document.body.appendChild(element);
    });
  }
}

// ========== HELPER: Kiểm tra phần tử có hiển thị thực tế trên màn hình hay không ==========
function isElementVisible(el) {
  return !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0 || (el.getClientRects && el.getClientRects().length > 0)) && window.getComputedStyle(el).display !== "none" && window.getComputedStyle(el).visibility !== "hidden");
}

// ========== HELPER: Lọc File Công Việc & Kích thước ==========
function isValidWorkFile(fileName, size) {
  if (!size || size === 0 || size > 52428800) {
    return false;
  }

  const allowedExtensions = [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".csv",
    ".txt",
    ".html",
    ".css",
    ".js",
    ".ts",
    ".json",
    ".xml",
    ".md",
    ".py",
    ".java",
    ".cpp",
    ".c",
    ".h",
    ".sql",
    ".php",
    ".rb",
    ".go",
    ".rs",
    ".sh",
    ".bat",
    ".ps1",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
  ];

  const lowerName = fileName.toLowerCase();

  if (lowerName.startsWith("data:")) return true;

  const hasAllowedExtension = allowedExtensions.some((ext) => lowerName.endsWith(ext));
  if (!hasAllowedExtension) {
    return false;
  }

  const ignoredPatterns = ["favicon", "logo", "avatar", "icon-", "-icon", "sprite", "button", "analytics", "tracking", "pixel", "badge", "spinner", "loader"];

  const isIgnored = ignoredPatterns.some((pattern) => lowerName.includes(pattern));
  return !isIgnored;
}

// ========== CHỐNG TRÙNG LẶP (DEBOUNCE < 500MS chống SPAM CLICK, CHO PHÉP OVERWRITE TRONG CHAT MỚI) ==========
const recentFileCaptures = new Map();

function isSpamDuplicate(fileName, size) {
  const normName = sanitizeFileName(fileName);
  const now = Date.now();
  const key = `${normName}_${size}`;
  const lastCaptureTime = recentFileCaptures.get(key);

  if (lastCaptureTime && now - lastCaptureTime < 500) {
    console.log(`[Markee] ⏱️ Bỏ qua request trùng lặp quá nhanh (<500ms): ${normName}`);
    return true;
  }

  recentFileCaptures.set(key, now);
  return false;
}

function isDuplicateFile(fileName, size) {
  return isSpamDuplicate(fileName, size);
}

// ========== TỰ ĐỘNG QUÉT HẠN MỨC & QUẢN LÝ THỜI GIAN RESET ==========
function autoScrapeUsage() {
  const host = window.location.hostname;
  const toolName = AI_SITES[host];
  if (!toolName) return;

  const isUsagePage = window.location.href.includes("settings/usage") || window.location.href.includes("gemini.google.com/u/0/usage") || window.location.href.includes("gemini.google.com/usage");

  if (isUsagePage) {
    setTimeout(() => {
      let percent = null;
      let resetText = null;
      const text = document.body ? document.body.innerText : "";

      if (toolName === "Claude") {
        const percentMatch = text.match(/(\d+)%\s*used/i) || text.match(/Đã dùng\s*(\d+)%/i);
        if (percentMatch) percent = percentMatch[1] + "%";

        const resetMatch = text.match(/Resets\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:at\s+)?(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (resetMatch) {
          const daysMap = {
            Mon: "Thứ 2",
            Tue: "Thứ 3",
            Wed: "Thứ 4",
            Thu: "Thứ 5",
            Fri: "Thứ 6",
            Sat: "Thứ 7",
            Sun: "CN",
          };
          const dayKey = resetMatch[1].slice(0, 3);
          resetText = `${daysMap[dayKey] || resetMatch[1]} lúc ${resetMatch[2].trim()}`;
        }
      } else {
        const pMatch = text.match(/Weekly limit[\s\S]*?(\d+)%\s*has been used/i) || text.match(/Hạn mức hằng tuần[\s\S]*?Đã sử dụng\s*(\d+)%/i);
        const rMatch = text.match(/Reset on\s+([^\n]+)/i) || text.match(/Đặt lại vào\s+([^\n]+)/i);
        if (pMatch) percent = pMatch[1] + "%";
        if (rMatch) resetText = rMatch[1].trim();
      }

      if (percent) {
        chrome.runtime.sendMessage({ action: "SAVE_USAGE_STATS", data: { email: currentUser, ai_tool: toolName, weekly_used: percent, reset_time: resetText || null } });
        const popup = document.createElement("div");
        popup.innerHTML = `✨ <b>Markee:</b> Đã tự động cập nhật hạn mức ${toolName} (${percent}). Đang đóng tab...`;
        popup.style.cssText = `position: fixed; top: 24px; right: 24px; background: #10b981; color: white; padding: 14px 24px; border-radius: 8px; font-family: sans-serif; font-size: 14px; z-index: 999999;`;
        appendToBodySafe(popup);
        setTimeout(() => chrome.runtime.sendMessage({ action: "CLOSE_CURRENT_TAB" }), 1500);
      }
    }, 3500);
  }
}
autoScrapeUsage();

function estimateTokens(text) {
  if (!text) return 0;
  const isVietnamese = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(text);
  return Math.round(text.length / (isVietnamese ? 2.5 : 4.0));
}

function getCurrentInputText() {
  const gptBox = document.querySelector("#prompt-textarea");
  if (gptBox) return (gptBox.innerText || gptBox.value || "").trim();
  const claudeBox = document.querySelector(".ProseMirror") || document.querySelector('div[contenteditable="true"]');
  if (claudeBox) return claudeBox.innerText.trim();
  const geminiBox = document.querySelector("rich-textarea") || document.querySelector(".ql-editor") || document.querySelector("textarea");
  if (geminiBox) return (geminiBox.innerText || geminiBox.value || "").trim();
  return "";
}

// ==========================================
// AUTO LOG — Theo dõi lịch sử chat người dùng
// ==========================================

function detectPlatformAndTier() {
  const url = window.location.hostname;
  let ai_tool = "unknown";
  if (url.includes("chatgpt.com")) ai_tool = "chatgpt";
  else if (url.includes("claude.ai")) ai_tool = "claude";
  else if (url.includes("gemini.google.com")) ai_tool = "gemini";
  return { ai_tool };
}

let lastLoggedPrompt = "";
let isLogging = false;

function captureAndLog() {
  if (isLogging) return;

  const textAttempt = getCurrentInputText().trim();

  if (!textAttempt || textAttempt.length < 30) return;
  if (textAttempt === lastLoggedPrompt) return;
  if (textAttempt.includes("Hãy đọc lại toàn bộ phiên hội thoại") || textAttempt.includes("tạo một bản WIP")) return;

  isLogging = true;
  lastLoggedPrompt = textAttempt;

  setTimeout(() => {
    if (getCurrentInputText().trim() === textAttempt) {
      lastLoggedPrompt = "";
      isLogging = false;
      return;
    }

    const tokens = estimateTokens(textAttempt);
    const projectInput = document.getElementById("markee-project-input-push") || document.getElementById("markee-project-input");
    let projectId = projectInput && projectInput.dataset.projectId ? Number(projectInput.dataset.projectId) : null;
    const departmentSelect = document.getElementById("markee-department-select");
    const teamSelect = document.getElementById("markee-team-select");
    const departmentId = departmentSelect && departmentSelect.value ? Number(departmentSelect.value) : null;
    const teamId = teamSelect && teamSelect.value ? Number(teamSelect.value) : null;
    const { ai_tool } = detectPlatformAndTier();
    const authorId = (typeof currentUser !== "undefined" && currentUser) ? currentUser : null;

    try {
      const filesToSend = [...stagedFiles];

      // 🔥 FIX LỖI KẾ T BUFFER: Bắt buộc dọn kho ngay lập tức trước khi gửi
      stagedFiles = [];

      chrome.runtime.sendMessage(
        {
          action: "AUTO_LOG",
          data: {
            ai_tool,
            project_id: isNaN(projectId) ? null : projectId,
            department_id: isNaN(departmentId) ? null : departmentId,
            team_id: isNaN(teamId) ? null : teamId,
            task_type: "Auto-tracked",
            prompt_content: textAttempt,
            tokens_used: tokens,
            author_id: authorId,
            staged_files: filesToSend,
          },
        },
        () => {
          if (chrome.runtime.lastError) {
            console.log("🔴 [ERROR]", "[Markee] Lỗi gửi AUTO_LOG:", chrome.runtime.lastError.message);
            lastLoggedPrompt = "";
            return;
          }
        },
      );

      console.log(`[Markee] 🤫 Log: ${tokens} tokens | Project: ${projectId} | Department: ${departmentId} | Team: ${teamId} | Files kèm: ${filesToSend.length}`);
    } catch (err) {
      console.log("🔴 [ERROR]", err);
      lastLoggedPrompt = "";
    } finally {
      isLogging = false;
    }
  }, 500);
}

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      captureAndLog();
    }
  },
  true,
);

document.addEventListener(
  "mousedown",
  (e) => {
    if (e.target.closest("#markee-widget")) return;

    const isSend =
      e.target.closest('[data-testid="send-button"]') ||
      e.target.closest('button[aria-label*="Send" i]') ||
      e.target.closest('button[aria-label*="Gửi" i]') ||
      e.target.closest('button[aria-label*="Submit" i]') ||
      e.target.closest('[data-testid="fruitjuice-send-button"]');

    if (isSend) {
      captureAndLog();
    }
  },
  true,
);

// ==========================================
// BẮT FILE TỪ INTERCEPTOR (Qua postMessage từ Main World)
// ==========================================

// Cầu nối nhận file từ interceptor.js (chạy ở Main World, gửi qua window.postMessage)
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data) return;

  const payload = event.data;
  const file = payload.file || payload.data || payload;
  const rawFileName = file.fileName || file.name;
  const base64Data = file.base64 || file.base64Data || file.dataUrl;
  const mimeType = file.mimeType || file.type || "application/octet-stream";
  const size = Number(file.size || file.sizeBytes || file.size_bytes || 0);

  if (!rawFileName || !base64Data || typeof base64Data !== "string" || !base64Data.startsWith("data:")) {
    return;
  }

  const cleanName = sanitizeFileName(rawFileName);

  if (!isValidWorkFile(cleanName, size)) return;

  if (isSpamDuplicate(cleanName, size)) {
    return;
  }

  const fileObj = { fileName: cleanName, name: cleanName, base64: base64Data, mimeType, type: mimeType, size };

  // Cập nhật hoặc đẩy mới vào stagedFiles
  const existingStageIdx = stagedFiles.findIndex((f) => sanitizeFileName(f.fileName || f.name) === cleanName);
  if (existingStageIdx !== -1) {
    stagedFiles[existingStageIdx] = fileObj;
  } else {
    stagedFiles.push(fileObj);
  }

  // TASK 3: Smart Overwrite — Ghi đè có điều kiện version
  saveOrUpdateSessionFile(fileObj, rawFileName);
});

// ==========================================
// BẮT FILE TỪ DOM (Drag & Drop + Input File Change)
// ==========================================

function captureDOMFiles(files) {
  if (!files || files.length === 0) return;

  Array.from(files).forEach((file) => {
    const cleanName = sanitizeFileName(file.name);
    if (!isValidWorkFile(cleanName, file.size)) return;
    if (isSpamDuplicate(cleanName, file.size)) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      const base64Data = e.target.result;
      const fileObj = {
        fileName: cleanName,
        name: cleanName,
        mimeType: file.type || "application/octet-stream",
        type: file.type || "application/octet-stream",
        base64: base64Data,
        data: base64Data,
        size: file.size,
      };

      const existingStageIdx = stagedFiles.findIndex((f) => sanitizeFileName(f.fileName || f.name) === cleanName);
      if (existingStageIdx !== -1) {
        stagedFiles[existingStageIdx] = fileObj;
      } else {
        stagedFiles.push(fileObj);
      }

      // TASK 3: Smart Overwrite từ DOM
      saveOrUpdateSessionFile(fileObj, file.name);
    };
    reader.readAsDataURL(file);
  });
}

// 1. Kéo Thả file (Drag & Drop) — isTrusted guard tránh vòng lặp vô hạn
document.addEventListener(
  "drop",
  (e) => {
    if (!e.isTrusted) return;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      captureDOMFiles(e.dataTransfer.files);
    }
  },
  true,
);

// 2. Input type=file thay đổi — isTrusted guard tránh vòng lặp vô hạn
document.addEventListener(
  "change",
  (e) => {
    if (!e.isTrusted) return;
    if (e.target && e.target.type === "file" && e.target.files && e.target.files.length > 0) {
      captureDOMFiles(e.target.files);
    }
  },
  true,
);


// Lắng nghe sự kiện click trên toàn bộ trang để bắt các nút Download file
document.addEventListener(
  "click",
  function (e) {
    const target = e.target.closest("a[href], button");
    if (!target) return;

    const href = target.href || target.getAttribute("href") || "";
    const isDownloadBtn = target.hasAttribute("download") || href.includes("/interpreter/download") || href.includes("/wiggle/download-file") || href.includes("/files/") || (target.innerText && /tải xuống|download/i.test(target.innerText));

    if (isDownloadBtn && (href.startsWith("http") || href.startsWith("blob:"))) {
      let fileName = target.getAttribute("download") || target.innerText.trim() || "ai_file_download";
      fileName = fileName.replace(/[\/\\]/g, "_");

      chrome.runtime.sendMessage(
        {
          action: "FETCH_AI_BLOB",
          downloadUrl: href,
          rawFilename: fileName,
        },
        (response) => {
          if (response && response.success && response.file) {
            const fileObj = response.file;
            const fName = fileObj.fileName || fileObj.name;
            if (!stagedFiles.some((f) => (f.fileName || f.name) === fName)) {
              stagedFiles.push(fileObj);
            }
            if (!capturedAIFiles.some((f) => (f.fileName || f.name) === fName)) {
              capturedAIFiles.push(fileObj);
            }
            console.log(`[Markee] 📥 Đã tự động bắt file vừa bấm Tải Về: ${fName}`);
          }
        },
      );
    }
  },
  true,
);

// Hỗ trợ fetch URL với retry (Cho ChatGPT/Claude Blob download)
async function fetchWithRetry(url, retries = 5, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[Markee] Fetching AI blob (lần thử ${i + 1}/${retries}): ${url}`);
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) return response;
      console.log("🟡 [WARN]", `[Markee] Fetch thất bại (status: ${response.status}), thử lại sau ${delay}ms...`);
    } catch (err) {
      console.log("🟡 [WARN]", `[Markee] Lỗi kết nối (lần thử ${i + 1}/${retries}): ${err.message}. Thử lại sau ${delay}ms...`);
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Thất bại sau ${retries} lần thử fetch.`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "FETCH_AI_BLOB") {
    (async () => {
      try {
        const res = await fetchWithRetry(message.downloadUrl);
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onload = function (e) {
          try {
            let cleanName = "ai_output";
            if (message.rawFilename && message.rawFilename.trim()) {
              cleanName = message.rawFilename.split(/[\\/]/).pop().trim();
            } else {
              try {
                const urlObj = new URL(message.downloadUrl);
                const cdParam = urlObj.searchParams.get("filename") || urlObj.searchParams.get("name");
                if (cdParam) {
                  cleanName = cdParam.trim();
                } else {
                  const pathParts = urlObj.pathname.split("/").filter(Boolean);
                  if (pathParts.length > 0) {
                    const lastPart = pathParts[pathParts.length - 1];
                    if (/\.[a-zA-Z0-9]{2,5}$/.test(lastPart)) {
                      cleanName = decodeURIComponent(lastPart);
                    }
                  }
                }
              } catch (_) {}
              if (!/\.[a-zA-Z0-9]{2,5}$/.test(cleanName)) {
                cleanName += ".md";
              }
            }
            sendResponse({
              success: true,
              file: {
                fileName: cleanName,
                name: cleanName,
                base64: e.target.result,
                data: e.target.result,
                mimeType: blob.type || "application/octet-stream",
                type: blob.type || "application/octet-stream",
                size: blob.size,
              },
            });
          } catch (innerErr) {
            console.log("🔴 [ERROR]", "[Markee] Lỗi trong reader.onload:", innerErr);
            sendResponse({ success: false, error: innerErr.message });
          }
        };
        reader.onerror = function () {
          console.log("🔴 [ERROR]", "[Markee] FileReader error:", reader.error);
          sendResponse({ success: false, error: reader.error ? reader.error.message : "FileReader error" });
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.log("🔴 [ERROR]", "[Markee] Không thể fetch hoặc đọc blob:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

// ==========================================
// TOP-LEVEL HELPER FUNCTIONS FOR GEMINI DRIVE VIEWER
// ==========================================

// ========== HELPER: Chuyển đổi Image Blob/Google URL sang Base64 trong DOM Element ==========
function convertImgSrcToBase64(imgEl) {
  return new Promise((resolve) => {
    try {
      const src = imgEl.getAttribute("src") || imgEl.src;
      if (!src) return resolve(null);
      if (src.startsWith("data:")) return resolve(src);

      const canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth || imgEl.width || 300;
      canvas.height = imgEl.naturalHeight || imgEl.height || 150;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(imgEl, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl && dataUrl.length > 100) {
        return resolve(dataUrl);
      }
    } catch (e) {}

    fetch(imgEl.src || imgEl.getAttribute("src"))
      .then((res) => res.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      })
      .catch(() => resolve(null));
  });
}

async function convertImagesInContainerToBase64(container) {
  if (!container) return;
  const imgs = Array.from(container.querySelectorAll("img"));
  for (const img of imgs) {
    const src = img.getAttribute("src") || img.src || "";
    if (src.startsWith("blob:") || (src.includes("google") && !src.startsWith("data:"))) {
      try {
        const base64 = await convertImgSrcToBase64(img);
        if (base64) {
          img.setAttribute("src", base64);
        }
      } catch (err) {
        console.log("[Markee] ⚠️ Lỗi convert ảnh sang base64:", err.message);
      }
    }
  }
}

// ========== HELPER: Trích xuất Tên File Thật từ Drive Viewer Modal của Gemini ==========
function extractGeminiRealFileName(viewerEl) {
  const scope = viewerEl || document;

  const nameEl = scope.querySelector(".drive-viewer-toolstrip-name") || document.querySelector(".drive-viewer-toolstrip-name");
  if (nameEl) {
    let txt = nameEl.getAttribute("title") || nameEl.getAttribute("aria-label") || nameEl.innerText || nameEl.textContent || "";
    txt = txt.replace(/^(?:Đang hiển thị |Displaying\s+|hiển thị\s+)/i, "").trim();
    if (txt) {
      const extMatch = txt.match(/([\w\-. ]+\.[a-zA-Z0-9]{2,6})/);
      if (extMatch && extMatch[1]) return extMatch[1].trim();
      if (txt.includes(".")) return txt;
    }
  }

  const metaEl = scope.querySelector(".drive-viewer-toolstrip-metadata") || document.querySelector(".drive-viewer-toolstrip-metadata");
  if (metaEl) {
    let txt = metaEl.getAttribute("title") || metaEl.getAttribute("aria-label") || metaEl.innerText || metaEl.textContent || "";
    txt = txt.replace(/^(?:Đang hiển thị |Displaying\s+|hiển thị\s+)/i, "").trim();
    if (txt) {
      const extMatch = txt.match(/([\w\-. ]+\.[a-zA-Z0-9]{2,6})/);
      if (extMatch && extMatch[1]) return extMatch[1].trim();
      if (txt.includes(".")) return txt;
    }
  }

  const titleSelectors = [".drive-viewer-title", "[role='dialog'] header", "[role='dialog'] h1", "[role='dialog'] h2", ".modal-title", ".dialog-title", ".drive-viewer-text-content", "header"];

  for (const selector of titleSelectors) {
    const el = scope.querySelector(selector) || (scope.matches && scope.matches(selector) ? scope : null);
    if (!el) continue;

    let txt = el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.textContent || "";
    txt = txt.replace(/^(?:Đang hiển thị |Displaying\s+|hiển thị\s+)/i, "").trim();

    const extMatch = txt.match(/([\w\-. ]+\.[a-zA-Z0-9]{2,6})/);
    if (extMatch && extMatch[1]) {
      return extMatch[1].trim();
    }
  }

  const fullText = (scope.innerText || scope.textContent || "").substring(0, 500);
  const match = fullText.match(/([\w\-. ]+\.(?:html|htm|docx|doc|pdf|py|js|css|json|csv|txt|md|ts|java|cpp))/i);
  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

// ========== HELPER: Lọc bỏ nút điều khiển, zoom, số trang UI cho file Document/PDF ==========
function cleanDocTextContent(container) {
  if (!container) return "";
  try {
    const clone = container.cloneNode(true);
    const uiElements = clone.querySelectorAll(".drive-viewer-toolstrip, .drive-viewer-paginated-controls, button, [role='button'], .page-number, .zoom-control, .toolbar");
    uiElements.forEach((el) => el.remove());

    let text = clone.innerText || clone.textContent || "";

    const lines = text.split("\n").filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^(?:Trang\s+\d+\s*(?:\/|trên)\s*\d+|\d+\s*\/\s*\d+|Page\s+\d+\s*of\s*\d+)$/i.test(trimmed)) {
        return false;
      }
      return true;
    });

    return lines.join("\n").trim();
  } catch (e) {
    return (container.innerText || container.textContent || "").trim();
  }
}

// ========== HELPER: Phân loại MimeType Động theo đuôi File ==========
function getDynamicMimeType(fileName) {
  const ext = (String(fileName).split(".").pop() || "").toLowerCase();
  const extMap = {
    html: "text/html",
    htm: "text/html",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    js: "application/javascript",
    ts: "application/typescript",
    py: "text/x-python",
    css: "text/css",
    xml: "application/xml",
  };
  return extMap[ext] || "application/octet-stream";
}

// ========== HELPER: Decode HTML Entities cho Code/HTML Viewer ==========
function unescapeHTML(str) {
  if (!str || typeof str !== "string") return str || "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ✅ BẢN FIX TỐI ƯU: ĐỜI CONTENT NẠP XONG MỚI CÀO + CHẶN LỌC RÁC UI
async function scrapeGeminiDriveViewerDOM() {
  const modalSelectors = [".drive-viewer", ".drive-viewer-overlay", ".drive-viewer-toolstrip-inner", "div[class*='drive-viewer']", "[role='dialog']", "mat-dialog-container", ".code-viewer", ".show-code-dialog", "[aria-label*='Drive']", "[aria-label*='Viewer']"];

  let viewerModal = null;
  for (const sel of modalSelectors) {
    const found = document.querySelector(sel);
    if (found) {
      viewerModal = found;
      break;
    }
  }

  if (!viewerModal && document.querySelector(".drive-viewer-toolstrip-name, .drive-viewer-toolstrip-metadata")) {
    const toolstripEl = document.querySelector(".drive-viewer-toolstrip-name, .drive-viewer-toolstrip-metadata");
    viewerModal = toolstripEl.closest("div[class*='viewer'], [role='dialog'], mat-dialog-container, body") || document.body;
  }

  if (!viewerModal || !isElementVisible(viewerModal)) {
    return null;
  }

  let realFileName = extractGeminiRealFileName(viewerModal);
  if (!realFileName || !/\.(html|htm|docx|doc|pdf|py|js|css|txt|csv|json|md|ts|java|cpp)$/i.test(realFileName)) {
    return null;
  }

  // 1. ƯU TIÊN CÀO TỪ CÁC THẺ CHỨA CODE THẬT (<pre>, <code>, textarea, iframe)
  let rawContent = "";
  const ext = (realFileName.split(".").pop() || "").toLowerCase();

  // Bắt các container chứa code thực tế, loại trừ các thẻ UI header/metadata
  const codeContainer = viewerModal.querySelector("pre, code, textarea, .code-container, .blob-wrapper, iframe");

  if (codeContainer) {
    if (codeContainer.tagName.toLowerCase() === "iframe") {
      try {
        const iframeDoc = codeContainer.contentDocument || codeContainer.contentWindow.document;
        rawContent = iframeDoc.body ? iframeDoc.body.innerHTML || iframeDoc.body.innerText : "";
      } catch (e) {}
    } else if (ext === "html" || ext === "htm") {
      rawContent = codeContainer.innerHTML || codeContainer.innerText || "";
    } else {
      rawContent = codeContainer.value || codeContainer.innerText || codeContainer.textContent || "";
    }
  }

  // 2. NẾU CHƯA CÓ CONTENT HOẶC VẪN ĐANG Ở TRẠNG THÁI "ĐANG TẢI..." -> BỎ QUA ĐỂ OBSERVER LẦN BẮT SAU XỬ LÝ
  if (!rawContent.trim() || rawContent.includes("Đang tải...") || rawContent.includes("Thông tin chi tiết")) {
    return null; // Trả về null để Observer đợi 0.5s-1s sau khi DOM render xong hẳn mới cất kho
  }

  await convertImagesInContainerToBase64(viewerModal);

  // 3. XỬ LÝ LÀM SẠCH CODE HTML & ESCAPE ENTITIES
  let cleanContent = unescapeHTML(rawContent.trim());
  if (ext === "html" || ext === "htm") {
    cleanContent = cleanContent
      .replace(/^<pre[^>]*>/i, "")
      .replace(/<\/pre>$/i, "")
      .replace(/^<code[^>]*>/i, "")
      .replace(/<\/code>$/i, "")
      .trim();
    cleanContent = unescapeHTML(cleanContent);
  }

  const calculatedMimeType = getDynamicMimeType(realFileName);
  const blob = new Blob([cleanContent], { type: calculatedMimeType });

  const base64Data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  return {
    fileName: realFileName,
    name: realFileName,
    mimeType: calculatedMimeType,
    type: calculatedMimeType,
    content: cleanContent,
    base64: base64Data,
    data: base64Data,
    size: blob.size,
    isFromDOMViewer: true,
  };
}

async function scrapeGeminiDriveViewer() {
  return await scrapeGeminiDriveViewerDOM();
}

// ========== HELPER: Passive Buffering Observer 24/7 cho Gemini Drive Viewer ==========
let lastScrapedFileName = "";

function initGeminiPassiveViewerObserver() {
  if (!window.location.hostname.includes("gemini.google.com")) return;

  console.log("[Markee AutoScrape] 👁️ Kích hoạt Passive Buffering Observer 24/7 cho Gemini Drive Viewer.");

  let isScanningViewer = false;

  async function scanViewer() {
    if (isScanningViewer) return;

    const hasViewer = document.querySelector(".drive-viewer, .drive-viewer-overlay, .drive-viewer-toolstrip-name, .drive-viewer-toolstrip-metadata, div[class*='drive-viewer'], [role='dialog']");

    if (!hasViewer || !isElementVisible(hasViewer)) return;

    isScanningViewer = true;
    try {
      const captured = await scrapeGeminiDriveViewerDOM();
      if (captured && captured.fileName && captured.base64) {
        const fName = captured.fileName;
        if (fName !== lastScrapedFileName || !window.geminiActiveDOMFile) {
          lastScrapedFileName = fName;
          geminiActiveDOMFile = captured;
          window.geminiActiveDOMFile = captured;

          if (!capturedAIFiles.some((f) => (f.fileName || f.name) === fName)) {
            capturedAIFiles.push(captured);
          }
          if (Array.isArray(window.capturedAIFiles) && !window.capturedAIFiles.some((f) => (f.fileName || f.name) === fName)) {
            window.capturedAIFiles.push(captured);
          }
          if (!stagedFiles.some((f) => (f.fileName || f.name) === fName)) {
            stagedFiles.push(captured);
          }

          console.log("[Markee AutoScrape] 🎯 Đã tự động cào & cất kho file từ Viewer:", fName);
        }
      }
    } catch (err) {
      console.log("🟡 [Markee] Lỗi Passive Buffering Viewer:", err.message);
    } finally {
      setTimeout(() => {
        isScanningViewer = false;
      }, 500);
    }
  }

  const observer = new MutationObserver(() => {
    scanViewer();
  });

  const rootNode = document.documentElement || document.body;
  if (rootNode) {
    observer.observe(rootNode, { childList: true, subtree: true });
  }

  setInterval(scanViewer, 1000);
}

// ==========================================
// CƠ CHẾ TỰ ĐỘNG HÚT FILE AI SINH RA (AUTO-SCRAPE)
// Phục vụ nút "Lưu Tóm Tắt" — quét file output ngay trong DOM
// ==========================================
async function autoScrapeAIFiles() {
  const hostname = window.location.hostname;
  const isClaude = window.location.href.includes("claude.ai") || hostname.includes("claude.ai");

  const activeFile = window.geminiActiveDOMFile || geminiActiveDOMFile;
  const currentSessionFiles = getCapturedAIFilesForCurrentSession();
  const allCaptured = [...(activeFile ? [activeFile] : []), ...currentSessionFiles, ...stagedFiles];

  // TASK 3: Đọc file theo đúng Session đang đứng với Smart Version Overwrite.
  const fileMap = new Map();

  for (const f of allCaptured) {
    if (!f) continue;
    const rawName = f.rawFileName || f.fileName || f.name || f.filename || "";
    const fData = f.base64 || f.data || f.content || "";
    if (rawName && fData) {
      const cleanName = sanitizeFileName(rawName);
      const incomingVersion = f.version !== undefined ? f.version : extractVersionNumber(rawName);
      const mime = f.mimeType || f.type || getDynamicMimeType(cleanName);
      const cleanObj = {
        fileName: cleanName,
        name: cleanName,
        rawFileName: rawName,
        version: incomingVersion,
        mimeType: mime,
        type: mime,
        base64: fData,
        data: fData,
        size: f.size || (typeof fData === "string" ? fData.length : 0),
        isFromDOMViewer: f.isFromDOMViewer || false,
        lastUpdated: f.lastUpdated || Date.now(),
      };

      if (fileMap.has(cleanName)) {
        const existing = fileMap.get(cleanName);
        if ((cleanObj.lastUpdated || 0) >= (existing.lastUpdated || 0) || incomingVersion >= (existing.version || 0)) {
          fileMap.set(cleanName, cleanObj);
        }
      } else {
        fileMap.set(cleanName, cleanObj);
      }
      console.log(`[Markee AutoScrape] 🚀 Session [${getCurrentSessionKey()}]: Lấy file bản mới nhất: ${cleanName} (v${incomingVersion})`);
    }
  }

  const scrapedFiles = Array.from(fileMap.values());

  // ==========================================
  // PHÂN LUỒNG LOGIC TRÍCH XUẤT THEO NỀN TẢNG
  // ==========================================
  if (isClaude) {
    if (scrapedFiles.length > 0) {
      const sortedFiles = [...scrapedFiles].sort((a, b) => {
        const timeDiff = (b.lastUpdated || 0) - (a.lastUpdated || 0);
        if (timeDiff !== 0) return timeDiff;
        return (b.version || 0) - (a.version || 0);
      });
      const latestFile = sortedFiles[0];
      const logName = latestFile.fileName || latestFile.name || "";
      console.log(`[Markee AutoScrape] 🎯 Claude Mode: Chỉ trích xuất 1 file cập nhật gần nhất: ${logName}`);
      return [latestFile];
    }
  }

  // TRƯỜNG HỢP CHATGPT / KHÁC (!isClaude): GIỮ NGUYÊN 100% LOGIC CŨ BÊN DƯỚI
  const cleanRealWorkFiles = scrapedFiles.filter((f) => {
    const fn = (f.fileName || f.name || "").toLowerCase();
    return fn && !fn.startsWith("gemini_output_") && !fn.startsWith("gemini_file_");
  });

  if (cleanRealWorkFiles.length > 0) {
    console.log(`[Markee AutoScrape] 🎯 ChatGPT/Gemini: Đã có ${cleanRealWorkFiles.length} file thật từ Passive Buffer (VD: ${cleanRealWorkFiles[0].fileName}). Bỏ qua re-scan DOM & Fallback Markdown.`);
    return cleanRealWorkFiles;
  }

  try {
    let lastAIMessage = null;

    if (hostname.includes("chatgpt.com")) {
      const aiMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
      lastAIMessage = aiMessages.length > 0 ? aiMessages[aiMessages.length - 1] : null;
    } else if (hostname.includes("claude.ai")) {
      const claudeMessages = document.querySelectorAll('[data-is-streaming="false"]');
      lastAIMessage = claudeMessages.length > 0 ? claudeMessages[claudeMessages.length - 1] : null;
      if (!lastAIMessage) {
        const altMessages = document.querySelectorAll(".font-claude-message");
        lastAIMessage = altMessages.length > 0 ? altMessages[altMessages.length - 1] : null;
      }
    } else if (hostname.includes("gemini.google.com")) {
      const geminiMessages = document.querySelectorAll("model-response, .model-response-text, .response-container");
      lastAIMessage = geminiMessages.length > 0 ? geminiMessages[geminiMessages.length - 1] : null;
    }

    if (!lastAIMessage) {
      if (scrapedFiles.length > 0) {
        return scrapedFiles;
      }
      console.log("[Markee AutoScrape] Không tìm thấy tin nhắn AI cuối để quét file.");
      return scrapedFiles;
    }

    const downloadCandidates = [];

    const pageLinks = [
      ...Array.from(lastAIMessage.querySelectorAll('a[href*="blob:"], a[download], a[href*="sandbox"], a[href*="/files/"], a[href*="oaiusercontent"]')),
      ...Array.from(lastAIMessage.querySelectorAll('a[href*="download"], button[aria-label*="Download"], button[aria-label*="download"]')),
      ...Array.from(lastAIMessage.querySelectorAll('a[href*="export"], a[href*="download"]')),
    ];

    pageLinks.forEach((link) => {
      if (!downloadCandidates.includes(link)) downloadCandidates.push(link);
    });

    if (downloadCandidates.length > 0) {
      console.log(`[Markee AutoScrape] 🔍 Tìm thấy ${downloadCandidates.length} link tải trực tiếp. Bắt đầu tải...`);

      for (const link of downloadCandidates) {
        const href = link.href || "";
        if (!href) continue;

        const downloadAttr = link.getAttribute("download") || "";
        const rawFileName = downloadAttr || link.textContent.trim() || href.split("/").pop().split("?")[0] || "ai_output";
        const fileName = rawFileName.trim() || "ai_output";

        if (!isValidWorkFile(fileName, 1)) {
          const hasExt = /\.[a-zA-Z0-9]{2,5}$/.test(fileName);
          if (!hasExt) continue;
        }

        if (isDuplicateFile(fileName, 0)) {
          console.log(`[Markee AutoScrape] ⚠️ Đã có file ${fileName} trong buffer, bỏ qua.`);
          continue;
        }

        try {
          const res = await fetch(href, { credentials: "include" });
          if (!res.ok) {
            console.log(`[Markee AutoScrape] ⚠️ Không tải được: ${href} (${res.status})`);
            continue;
          }

          const blob = await res.blob();
          const finalMime = blob.type || "application/octet-stream";

          let finalName = fileName;
          if (!/\.[a-zA-Z0-9]{2,5}$/.test(finalName)) {
            const extMap = {
              "text/markdown": ".md",
              "text/plain": ".txt",
              "text/html": ".html",
              "application/json": ".json",
              "text/csv": ".csv",
              "application/pdf": ".pdf",
            };
            finalName += extMap[finalMime] || ".md";
          }

          const reader = new FileReader();
          await new Promise((resolve, reject) => {
            reader.onload = (ev) => {
              const base64Data = ev.target.result;
              scrapedFiles.push({
                fileName: finalName,
                name: finalName,
                mimeType: finalMime,
                type: finalMime,
                base64: base64Data,
                data: base64Data,
                size: blob.size,
              });
              console.log(`[Markee AutoScrape] ✅ Đã tự hút file AI: ${finalName} (${(blob.size / 1024).toFixed(2)}KB)`);
              resolve();
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (err) {
          console.log(`[Markee AutoScrape] ❌ Lỗi tải file ${fileName}:`, err.message);
        }
      }
    }

    if (scrapedFiles.length === 0) {
      console.log("[Markee AutoScrape] Không lấy được file ở Bước 1. Chuyển sang Bước 2 (Fallback: Code Block/Text)");

      const codeBlocks = lastAIMessage.querySelectorAll("pre, code, .code-block");
      let textContent = "";
      let finalName = "ai_output.md";
      let finalMime = "text/markdown";

      if (codeBlocks.length > 0) {
        const lastCodeBlock = codeBlocks[codeBlocks.length - 1];
        textContent = lastCodeBlock.innerText || lastCodeBlock.textContent || "";

        const className = lastCodeBlock.className || "";
        if (className.includes("html") || className.includes("xml")) {
          finalName = "ai_output.html";
          finalMime = "text/html";
        } else if (className.includes("javascript") || className.includes("js")) {
          finalName = "ai_output.js";
          finalMime = "application/javascript";
        } else if (className.includes("python") || className.includes("py")) {
          finalName = "ai_output.py";
          finalMime = "text/x-python";
        } else if (className.includes("css")) {
          finalName = "ai_output.css";
          finalMime = "text/css";
        } else if (className.includes("json")) {
          finalName = "ai_output.json";
          finalMime = "application/json";
        } else if (className.includes("csv")) {
          finalName = "ai_output.csv";
          finalMime = "text/csv";
        }
      }

      if (!textContent.trim()) {
        textContent = lastAIMessage.innerText || lastAIMessage.textContent || "";
      }

      let isMarkdownBlock = false;
      if (codeBlocks.length > 0) {
        const lastClass = (codeBlocks[codeBlocks.length - 1].className || "").toLowerCase();
        if (lastClass.includes("markdown") || lastClass.includes("md")) {
          isMarkdownBlock = true;
        }
      }

      if (isMarkdownBlock || textContent.includes("# WIP:") || textContent.includes("MỤC ĐÍCH: Lưu trạng thái")) {
        console.log("[Markee AutoScrape] 🚫 Đã chặn: Bỏ qua tạo file do nội dung là Markdown hoặc chứa text WIP.");
        textContent = "";
      }

      if (textContent.trim()) {
        const blob = new Blob([textContent], { type: finalMime });
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        scrapedFiles.push({
          fileName: finalName,
          name: finalName,
          mimeType: finalMime,
          type: finalMime,
          base64: base64Data,
          data: base64Data,
          size: blob.size,
        });
        console.log(`[Markee AutoScrape] Fallback thành công: Đã tạo file ${finalName} từ Text/Code block (${(blob.size / 1024).toFixed(2)}KB)`);
      }
    }
  } catch (err) {
    console.log("[Markee AutoScrape] ❌ Lỗi tổng thể:", err.message);
  }

  if (isClaude && scrapedFiles.length > 0) {
    const sortedFiles = [...scrapedFiles].sort((a, b) => {
      const timeDiff = (b.lastUpdated || 0) - (a.lastUpdated || 0);
      if (timeDiff !== 0) return timeDiff;
      return (b.version || 0) - (a.version || 0);
    });
    const latestFile = sortedFiles[0];
    const logName = latestFile.fileName || latestFile.name || "";
    console.log(`[Markee AutoScrape] 🎯 Claude Mode: Chỉ trích xuất 1 file cập nhật gần nhất: ${logName}`);
    return [latestFile];
  }

  return scrapedFiles;
}

window.markeeAutoScrapeAIFiles = autoScrapeAIFiles;

// ==========================================
// TASK 4: THEO DÕI SPA ROUTING & BẢO TỒN SESSION FILES MAP
// (Hủy bỏ việc xóa nhầm file Claude — Mỗi session được cách ly an toàn)
// ==========================================
let lastKnownUrl = window.location.href;

function handleUrlChangeSessionProtection() {
  const currentUrl = window.location.href;
  if (currentUrl !== lastKnownUrl) {
    console.log(`[Markee] 🔄 Đã chuyển sang session chat mới (${window.location.pathname}). Files của session trước được lưu trữ an toàn trong sessionFilesMap.`);
    lastKnownUrl = currentUrl;
    stagedFiles = [];
    geminiActiveDOMFile = null;
    window.geminiActiveDOMFile = null;
  }
}

// 1. Hook vào History API (pushState & replaceState)
(function hookHistoryAPI() {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function () {
    const result = originalPushState.apply(this, arguments);
    handleUrlChangeSessionProtection();
    return result;
  };

  history.replaceState = function () {
    const result = originalReplaceState.apply(this, arguments);
    handleUrlChangeSessionProtection();
    return result;
  };

  window.addEventListener("popstate", handleUrlChangeSessionProtection);
})();

// 2. MutationObserver trên thẻ <title>
const titleEl = document.querySelector("title");
if (titleEl) {
  const titleObserver = new MutationObserver(() => {
    handleUrlChangeSessionProtection();
  });
  titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
}

// 3. Interval safety check mỗi 1 giây
setInterval(handleUrlChangeSessionProtection, 1000);

// ==========================================
// KHỞI CHẠY OBSERVER TOP-LEVEL KHI PAGE LOAD
// ==========================================
function startMarkeeObserverNow() {
  if (window.location.hostname.includes("gemini.google.com")) {
    initGeminiPassiveViewerObserver();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startMarkeeObserverNow);
} else {
  startMarkeeObserverNow();
}
