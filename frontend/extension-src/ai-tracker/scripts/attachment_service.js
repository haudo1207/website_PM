// ==========================================
// ATTACHMENT SERVICE — Feature 1 (BẢN FIX TỐI THƯỢNG)
// Tương thích đa nền tảng: ChatGPT, Claude, Gemini
// ==========================================

// ─────────────────────────────────────────
// STEP 1: AttachmentParser
// Bắt đường dẫn từ Text (ChatGPT) VÀ soi DOM (Claude/Gemini)
// ─────────────────────────────────────────
const AttachmentParser = (() => {
  const SANDBOX_REGEX = /(?:sandbox:)?\/mnt\/[a-zA-Z0-9\-_/]+\/([\w\-. ]+\.[a-zA-Z0-9]{2,6})/g;

  // Hàm phụ trợ lọc tên file từ text rác
  const extractName = (text) => {
    if (!text) return null;
    const clean = text.trim();
    // Bắt trường hợp nút bấm có chữ "Download script.js"
    if (clean.includes(" ")) {
      const words = clean.split(" ");
      const lastWord = words[words.length - 1];
      if (lastWord.match(/^[a-zA-Z0-9\-_]+\.[a-zA-Z0-9]{2,6}$/)) return lastWord;
      return null;
    }
    // Bắt trường hợp text chỉ chứa đúng tên file
    if (clean.match(/^[a-zA-Z0-9\-_]+\.[a-zA-Z0-9]{2,6}$/)) return clean;
    return null;
  };

  function parse(markdownText, context = null, platform = "ChatGPT") {
    const found = new Map(); // Lọc trùng lặp file

    // 1. Quét theo Regex (Chuẩn của ChatGPT Sandbox)
    if (markdownText) {
      let match;
      SANDBOX_REGEX.lastIndex = 0;
      while ((match = SANDBOX_REGEX.exec(markdownText)) !== null) {
        const fileName = match[1].trim();
        const fullPath = match[0].replace("sandbox:", "");
        if (!found.has(fileName)) {
          found.set(fileName, { fullPath, fileName });
        }
      }
    }

    if (!context) return Array.from(found.values());

    const p = (platform || "").toLowerCase();

    // 2. Claude: Soi DOM tìm Artifacts hoặc nút Download
    if (p === "claude") {
      const els = context.querySelectorAll('a[download], button, .text-text-500, .font-claude-message a, .artifact-title, [data-testid="artifact-title"]');
      els.forEach((el) => {
        const name = el.getAttribute("download") || extractName(el.textContent);
        if (name && name.match(/\.[a-zA-Z0-9]{2,6}$/)) {
          if (!found.has(name)) found.set(name, { fullPath: `claude://${name}`, fileName: name });
        }
      });
    }

    // 3. ChatGPT: Soi thêm thẻ link ẩn phòng hụt Sandbox, và cả file cards
    if (p === "chatgpt") {
      const els = context.querySelectorAll('a[href*="blob:"], a[href*="oaiusercontent"], button, div, span');
      els.forEach((el) => {
        const txt = el.getAttribute("download") || el.textContent || "";
        if (txt.length > 3 && txt.length < 50) {
          const name = extractName(txt);
          if (name && name.match(/\.[a-zA-Z0-9]{2,6}$/)) {
            if (!found.has(name)) {
              found.set(name, { fullPath: `chatgpt://${name}`, fileName: name });
            }
          }
        }
      });
    }

    // 4. Gemini: Bắt tiêu đề của Code Block
    if (p === "gemini") {
      const els = context.querySelectorAll(".code-block-header, pre code, span");
      els.forEach((el) => {
        const txt = el.textContent || "";
        // Giới hạn độ dài để không bắt nhầm câu văn dài
        if (txt.length > 3 && txt.length < 35) {
          const name = extractName(txt);
          if (name && !found.has(name)) {
            found.set(name, { fullPath: `gemini://${name}`, fileName: name });
          }
        }
      });
    }

    return Array.from(found.values());
  }

  return { parse };
})();

// ─────────────────────────────────────────
// STEP 2: AI Adapters
// ─────────────────────────────────────────
class BaseAIAdapter {
  async resolveAndDownload(sandboxPath, context) {
    throw new Error("Not implemented");
  }
}

function _getBaseName(fileName) {
  if (!fileName) return "";
  return fileName.replace(/\.[a-zA-Z0-9]{2,6}$/, "").toLowerCase();
}

async function _retrieveStoredBlob(fileName) {
  const targetBase = _getBaseName(fileName);
  let objectUrl = null;
  let matchedKey = null;
  let actualFileName = fileName;

  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("markee_file_blob_")) {
        const storedFileName = key.replace("markee_file_blob_", "");
        const storedBase = _getBaseName(storedFileName);
        // So khớp linh hoạt theo base name (bỏ qua phần mở rộng)
        if (storedBase === targetBase) {
          objectUrl = sessionStorage.getItem(key);
          matchedKey = key;
          actualFileName = storedFileName; // Giữ lại tên file thực tế kèm extension
          break;
        }
      }
    }

    if (objectUrl && matchedKey) {
      console.log(`[Markee Attachment] 🎯 Khớp file trong sessionStorage theo base name: ${matchedKey} -> ${objectUrl}`);
      sessionStorage.removeItem(matchedKey);

      const res = await fetch(objectUrl);
      if (res.ok) {
        const blob = await res.blob();
        URL.revokeObjectURL(objectUrl); // Giải phóng bộ nhớ ngay lập tức
        return { blob, fileName: actualFileName };
      }
    }
  } catch (err) {
    console.log("[Markee Attachment] Lỗi truy xuất Blob từ sessionStorage:", err.message);
  }
  return null;
}

class ChatGPTAdapter extends BaseAIAdapter {
  async resolveAndDownload(sandboxPath, context) {
    const fileName = sandboxPath.split("/").pop();
    console.log(`[ChatGPTAdapter] resolveAndDownload triggered for: ${fileName}`);

    try {
      // 1. Trigger API: Tìm cụ thể nút tải xuống tương ứng với file trong DOM và click nó
      if (context) {
        const downloadBtns = Array.from(context.querySelectorAll('button[aria-label*="Download"], button[aria-label*="download"], button svg path[d*="M12"], button'));
        const targetBtn = downloadBtns.find(btn => {
          const label = (btn.getAttribute("aria-label") || "").toLowerCase();
          const text = (btn.textContent || "").toLowerCase();
          return label.includes("download") || text.includes("download") || btn.querySelector('svg');
        });

        if (targetBtn) {
          console.log("[ChatGPTAdapter] Click button tải ẩn để kích hoạt API...");
          targetBtn.click();
          // 2. Chờ 2s để interceptor.js bắt được API call và tải ngầm xong
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // 3. Retrieve: Đọc trực tiếp Blob từ sessionStorage (vượt rào Context Isolation)
      const resBlob = await _retrieveStoredBlob(fileName);
      if (resBlob) {
        console.log(`[ChatGPTAdapter] ✅ Trực tiếp lấy Blob đã tải ngầm: ${resBlob.fileName} (${resBlob.blob.type})`);
        return { blob: resBlob.blob, mimeType: resBlob.blob.type || "application/octet-stream", fileName: resBlob.fileName };
      }

      // 4. Fallback: Nếu không tìm thấy, tìm thẻ link oaiusercontent / blob trực tiếp
      console.log("[ChatGPTAdapter] Fallback: Tìm thẻ link trực tiếp trong tin nhắn...");
      const anchors = context ? Array.from(context.querySelectorAll('a[href*="blob:"], a[href*="oaiusercontent"], a[download]')) : [];
      for (const anchor of anchors) {
        const linkText = (anchor.textContent || "").trim().toLowerCase();
        const hrefFileName = (anchor.href || "").split("/").pop().split("?")[0].toLowerCase();
        if (linkText.includes(fileName.toLowerCase()) || hrefFileName.includes(fileName.toLowerCase())) {
          const res = await fetch(anchor.href, { credentials: "include" });
          if (res.ok) {
            const blob = await res.blob();
            return { blob, mimeType: blob.type || "application/octet-stream", fileName };
          }
        }
      }

      // Fallback cuối cùng: Thử đọc text của code block nhưng STRICTLY tránh # WIP: hoặc # SKILL:
      console.log("[ChatGPTAdapter] Fallback cuối cùng: Đọc từ code block...");
      const codeBlock = context ? context.querySelector("pre code, pre") : null;
      if (codeBlock) {
        const text = codeBlock.innerText || codeBlock.textContent || "";
        if (text.trim() && !text.includes("# WIP:") && !text.includes("# SKILL:")) {
          const mime = _guessMimeFromName(fileName);
          const blob = new Blob([text], { type: mime });
          return { blob, mimeType: mime, fileName };
        }
      }

      return null;
    } catch (err) {
      console.log(`[ChatGPTAdapter] Lỗi: ${err.message}`);
      return null;
    }
  }
}

class ClaudeAdapter extends BaseAIAdapter {
  async resolveAndDownload(sandboxPath, context) {
    const fileName = sandboxPath.split("/").pop();
    console.log(`[ClaudeAdapter] resolveAndDownload triggered for: ${fileName}`);

    try {
      // 1. Trigger API: Click button download
      if (context) {
        const downloadBtns = Array.from(context.querySelectorAll('button[aria-label*="Download"], button[aria-label*="download"], a[download], button'));
        const targetBtn = downloadBtns.find(btn => {
          const label = (btn.getAttribute("aria-label") || "").toLowerCase();
          const text = (btn.textContent || "").toLowerCase();
          return label.includes("download") || text.includes("download") || label.includes("tải") || text.includes("tải");
        });

        if (targetBtn) {
          console.log("[ClaudeAdapter] Click button tải ẩn để kích hoạt API...");
          targetBtn.click();
          // 2. Chờ 2s để interceptor.js bắt được API call
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // 3. Retrieve: Đọc trực tiếp Blob từ sessionStorage (vượt rào Context Isolation)
      const resBlob = await _retrieveStoredBlob(fileName);
      if (resBlob) {
        console.log(`[ClaudeAdapter] ✅ Trực tiếp lấy Blob đã tải ngầm: ${resBlob.fileName} (${resBlob.blob.type})`);
        return { blob: resBlob.blob, mimeType: resBlob.blob.type || "application/octet-stream", fileName: resBlob.fileName };
      }

      // 4. Fallback: Nếu không tìm thấy, tìm thẻ link trực tiếp
      console.log("[ClaudeAdapter] Fallback: Tìm thẻ link trực tiếp...");
      const candidates = context ? Array.from(context.querySelectorAll('a[download], a[href*="download"], a[href*="blob:"]')) : [];
      for (const el of candidates) {
        const href = el.href || "";
        const label = (el.textContent || el.getAttribute("aria-label") || "").toLowerCase();
        if (!href && !label) continue;
        const matchesName = label.includes(fileName.toLowerCase()) || (href && href.split("/").pop().toLowerCase().includes(fileName.toLowerCase()));

        if ((matchesName || candidates.length === 1) && href) {
          const res = await fetch(href, { credentials: "include" });
          if (res.ok) {
            const blob = await res.blob();
            return { blob, mimeType: blob.type || "application/octet-stream", fileName };
          }
        }
      }

      // Fallback cuối cùng: Chế tạo Blob từ Code Block (Artifacts) - STRICTLY tránh # WIP: hoặc # SKILL:
      console.log("[ClaudeAdapter] Fallback cuối cùng: Đọc từ code block...");
      const codeBlock = context ? context.querySelector(".artifact-content pre, .artifact pre, pre code, div.code-block__code pre") : null;
      if (codeBlock) {
        const text = codeBlock.innerText || codeBlock.textContent || "";
        if (text.trim() && !text.includes("# WIP:") && !text.includes("# SKILL:")) {
          const mime = _guessMimeFromName(fileName);
          const blob = new Blob([text], { type: mime });
          return { blob, mimeType: mime, fileName };
        }
      }
      return null;
    } catch (err) {
      console.log(`[ClaudeAdapter] Lỗi: ${err.message}`);
      return null;
    }
  }
}

function unescapeHTML(str) {
  if (!str || typeof str !== "string") return str || "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

class GeminiAdapter extends BaseAIAdapter {
  async resolveAndDownload(sandboxPath, context) {
    const fileName = sandboxPath.split("/").pop();
    try {
      // 1. Kiểm tra Drive Viewer Modal đang mở
      const viewerModal = document.querySelector(
        ".drive-viewer, .drive-viewer-overlay, mat-dialog-container, [role='dialog'], .modal, .dialog, .code-viewer, .show-code-dialog"
      );

      if (viewerModal) {
        let realName = fileName;
        // Ưu tiên 1 & 2: .drive-viewer-toolstrip-name & .drive-viewer-toolstrip-metadata
        const nameEl = viewerModal.querySelector(".drive-viewer-toolstrip-name, .drive-viewer-toolstrip-metadata") || document.querySelector(".drive-viewer-toolstrip-name, .drive-viewer-toolstrip-metadata");
        if (nameEl) {
          let txt = nameEl.getAttribute("title") || nameEl.getAttribute("aria-label") || nameEl.innerText || nameEl.textContent || "";
          txt = txt.replace(/^(?:Đang hiển thị |Displaying\s+|hiển thị\s+)/i, "").trim();
          const extMatch = txt.match(/([\w\-. ]+\.[a-zA-Z0-9]{2,6})/);
          if (extMatch && extMatch[1]) realName = extMatch[1].trim();
        } else {
          const titleEl = viewerModal.querySelector(".drive-viewer-title, [role='dialog'] header, .modal-title, header");
          if (titleEl) {
            let txt = titleEl.getAttribute("aria-label") || titleEl.innerText || titleEl.textContent || "";
            txt = txt.replace(/^(?:Đang hiển thị |Displaying\s+|hiển thị\s+)/i, "").trim();
            const extMatch = txt.match(/([\w\-. ]+\.[a-zA-Z0-9]{2,6})/);
            if (extMatch && extMatch[1]) realName = extMatch[1].trim();
          }
        }

        const codeContainer = viewerModal.querySelector("pre, code, textarea, .drive-viewer-text-content, .drive-viewer-paginated-scrollable");
        let text = codeContainer ? (codeContainer.innerHTML || codeContainer.innerText || codeContainer.value || codeContainer.textContent || "") : (viewerModal.innerText || "");

        if (text.trim()) {
          let cleanContent = unescapeHTML(text.trim());
          if (/\.html?$/i.test(realName)) {
            cleanContent = cleanContent.replace(/^<pre[^>]*>/i, "").replace(/<\/pre>$/i, "").replace(/^<code[^>]*>/i, "").replace(/<\/code>$/i, "").trim();
            cleanContent = unescapeHTML(cleanContent);
          }
          const mime = _guessMimeFromName(realName);
          const blob = new Blob([cleanContent], { type: mime });
          return { blob, mimeType: mime, fileName: realName };
        }
      }

      // 2. Target Element: Google Drive Viewer main wrapper
      const container = document.querySelector(".drive-viewer-text-content");
      if (container) {
        let text = container.innerHTML || container.innerText || "";
        const ariaLabel = container.getAttribute("aria-label") || "";

        let extractedFileName = fileName || "gemini_scraped_file.txt";
        if (ariaLabel) {
          const prefixRegex = /^(?:Đang hiển thị |Displaying\s+|hiển thị\s+)/i;
          extractedFileName = ariaLabel.replace(prefixRegex, "").trim() || extractedFileName;
        }

        if (text.trim()) {
          let cleanContent = unescapeHTML(text.trim());
          if (/\.html?$/i.test(extractedFileName)) {
            cleanContent = cleanContent.replace(/^<pre[^>]*>/i, "").replace(/<\/pre>$/i, "").replace(/^<code[^>]*>/i, "").replace(/<\/code>$/i, "").trim();
            cleanContent = unescapeHTML(cleanContent);
          }
          const mime = _guessMimeFromName(extractedFileName);
          const blob = new Blob([cleanContent], { type: mime });
          return { blob, mimeType: mime, fileName: extractedFileName };
        }
      }

      // 3. Fallback: Cào từ Code Block cũ
      const codeBlock = context ? context.querySelector("pre code, code-block, .code-block, pre") : null;
      if (codeBlock) {
        let text = codeBlock.innerHTML || codeBlock.innerText || codeBlock.textContent || "";
        if (text.trim()) {
          let cleanContent = unescapeHTML(text.trim());
          if (/\.html?$/i.test(fileName)) {
            cleanContent = cleanContent.replace(/^<pre[^>]*>/i, "").replace(/<\/pre>$/i, "").replace(/^<code[^>]*>/i, "").replace(/<\/code>$/i, "").trim();
            cleanContent = unescapeHTML(cleanContent);
          }
          const mime = _guessMimeFromName(fileName);
          const blob = new Blob([text], { type: mime });
          return { blob, mimeType: mime, fileName };
        }
      }

      return null;
    } catch (err) {
      return null;
    }
  }
}

const AIPlatformAdapterFactory = {
  getAdapter(platform) {
    switch ((platform || "").toLowerCase()) {
      case "chatgpt":
        return new ChatGPTAdapter();
      case "claude":
        return new ClaudeAdapter();
      case "gemini":
        return new GeminiAdapter();
      default:
        return new ChatGPTAdapter();
    }
  },
};

function _guessMimeFromName(fileName) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const map = {
    html: "text/html",
    htm: "text/html",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    js: "application/javascript",
    ts: "application/typescript",
    py: "text/x-python",
    css: "text/css",
    xml: "application/xml",
    pdf: "application/pdf",
    sql: "application/sql",
    php: "application/x-php",
    java: "text/x-java-source",
    cpp: "text/x-c",
  };
  return map[ext] || "application/octet-stream";
}

// ─────────────────────────────────────────
// STEP 3: SupabaseStorageService
// ─────────────────────────────────────────
const SupabaseStorageService = {
  async encodeForUpload(blob, fileName) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        resolve({
          fileName,
          base64: ev.target.result,
          mimeType: blob.type || "application/octet-stream",
          size: blob.size,
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },
};

// ─────────────────────────────────────────
// STEP 4: finalizePayload — Orchestration
// ─────────────────────────────────────────
async function finalizePayload(wipData, aiMessageText, currentPlatform, messageContext) {
  const result = Object.assign({}, wipData);
  const rawAuto = Array.isArray(result.autoScrapedFiles) ? result.autoScrapedFiles : [];

  const validScrapedFiles = [];
  const existingNames = new Set();

  // 1. Kiểm tra & chuẩn hóa mảng autoScrapedFiles: Chấp nhận file nếu có (fileName HOẶC name) VÀ (base64 HOẶC data HOẶC content)
  for (const f of rawAuto) {
    if (!f) continue;
    const fName = f.fileName || f.name || f.filename || "";
    const fData = f.base64 || f.data || f.content || f.dataUrl || "";

    if (fName && fData) {
      const mime = f.mimeType || f.type || _guessMimeFromName(fName);
      const cleanObj = {
        fileName: fName,
        name: fName,
        mimeType: mime,
        type: mime,
        base64: fData,
        data: fData,
        size: f.size || (typeof fData === "string" ? fData.length : 0),
      };
      validScrapedFiles.push(cleanObj);
      existingNames.add(fName.toLowerCase());
    }
  }

  result.autoScrapedFiles = validScrapedFiles;

  // 2. BẮT BUỘC GIỮ NGUYÊN TÊN FILE GỐC (VD: ca-ruong-kho.html):
  // Nếu đã có file từ Interceptor / AutoScrape, KHÔNG tạo/đè file fallback ai_output.md
  if (result.autoScrapedFiles.length > 0) {
    // 3. SANITY CHECK: Nếu có ít nhất 1 file công việc thật (.html, .docx, .pdf...), LẬP TỨC LOẠI BỎ file ai_output.md dự phòng
    const hasRealFile = result.autoScrapedFiles.some((f) => {
      const fn = (f.fileName || f.name || "").toLowerCase();
      return fn !== "ai_output.md" && fn !== "ai_output.txt" && fn !== "ai_output";
    });

    if (hasRealFile) {
      result.autoScrapedFiles = result.autoScrapedFiles.filter((f) => {
        const fn = (f.fileName || f.name || "").toLowerCase();
        return fn !== "ai_output.md" && fn !== "ai_output.txt" && fn !== "ai_output";
      });
    }

    if ((currentPlatform || "").toLowerCase() === "claude" || window.location.href.includes("claude.ai")) {
      if (result.autoScrapedFiles.length > 1) {
        result.autoScrapedFiles.sort((a, b) => {
          const timeDiff = (b.lastUpdated || 0) - (a.lastUpdated || 0);
          if (timeDiff !== 0) return timeDiff;
          return (b.version || 0) - (a.version || 0);
        });
        result.autoScrapedFiles = [result.autoScrapedFiles[0]];
      }
    }

    console.log(`[finalizePayload] ✅ Giữ nguyên ${result.autoScrapedFiles.length} file đính kèm gốc (Bảo tồn tên file: ${result.autoScrapedFiles.map(f => f.fileName).join(", ")})`);
    return result;
  }

  let parsedPaths = [];
  try {
    parsedPaths = AttachmentParser.parse(aiMessageText, messageContext, currentPlatform);
    console.log(`[finalizePayload] 🔍 Tìm thấy ${parsedPaths.length} file đính kèm từ AI (${currentPlatform}).`);
  } catch (err) {
    console.log("[finalizePayload] ❌ Lỗi AttachmentParser:", err.message);
    return result;
  }

  if (parsedPaths.length === 0) return result;

  const adapter = AIPlatformAdapterFactory.getAdapter(currentPlatform);

  for (const { fullPath, fileName } of parsedPaths) {
    try {
      console.log(`[finalizePayload] 🚀 Đang tải/chế tạo: ${fileName}`);
      const resolved = await adapter.resolveAndDownload(fullPath, messageContext);

      if (!resolved || !resolved.blob) {
        console.log(`[finalizePayload] ⚠️ Không lấy được nội dung "${fileName}" — bỏ qua.`);
        continue;
      }

      const realName = resolved.fileName || fileName;
      if (existingNames.has(realName.toLowerCase())) {
        console.log(`[finalizePayload] ⚠️ File ${realName} đã có trong mảng gốc, giữ nguyên tên cũ.`);
        continue;
      }

      const encoded = await SupabaseStorageService.encodeForUpload(resolved.blob, realName);
      const cleanObj = {
        fileName: encoded.fileName,
        name: encoded.fileName,
        mimeType: encoded.mimeType,
        type: encoded.mimeType,
        base64: encoded.base64,
        data: encoded.base64,
        size: encoded.size,
      };
      result.autoScrapedFiles.push(cleanObj);
      existingNames.add(realName.toLowerCase());
      console.log(`[finalizePayload] ✅ Sẵn sàng Upload "${realName}" (${(resolved.blob.size / 1024).toFixed(1)}KB).`);
    } catch (err) {
      console.log(`[finalizePayload] ❌ Lỗi xử lý "${fileName}":`, err.message);
    }
  }

  return result;
}

window.markeeAttachmentService = { AttachmentParser, AIPlatformAdapterFactory, SupabaseStorageService, finalizePayload };
console.log("[Markee AttachmentService] ✅ BẢN FIX đã Load: Kích hoạt soi DOM đa nền tảng.");
