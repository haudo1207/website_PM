// ==========================================
// HỆ THỐNG LƯU TRỮ BỘ LỌC CẢI TIẾN (MarkeeStorage Global)
// ==========================================
var MarkeeStorage = {
  get: function (key, defaultVal) {
    try {
      var val = localStorage.getItem(key);
      if (val === null || val === undefined) return defaultVal || null;
      try { return JSON.parse(val); } catch (e) { return val; }
    } catch (e) {
      return defaultVal || null;
    }
  },
  set: function (key, val) {
    try {
      if (typeof val === "object") localStorage.setItem(key, JSON.stringify(val));
      else localStorage.setItem(key, String(val));
    } catch (e) {}
  },
  remove: function (key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  },
};

// ==========================================
// NHIỆM VỤ: Vẽ giao diện Widget, Prompts, Logic Click Lưu
// ==========================================
const EXTRACTION_PROMPT = `Hãy đọc lại toàn bộ phiên hội thoại phía trên và đúc kết cốt lõi của cuộc trò chuyện thành MỘT kỹ năng AI duy nhất dưới dạng file Markdown (.md).

MỤC ĐÍCH: File này sẽ được dùng như một SYSTEM INSTRUCTION cho phiên chat AI mới. Skill phải có tính tái sử dụng cao, thực chiến và hoạt động như một năng lực chuyên môn độc lập.

NGUYÊN TẮC ĐÚC KẾT:
- Tập trung vào MỘT chủ đề/chuyên môn chính của cuộc trò chuyện.
- Trích xuất cả kiến thức rõ ràng (explicit) lẫn hành vi ngầm (implicit behavior).
- Ưu tiên workflow, heuristics, decision logic và execution pattern.
- Biến nội dung thành operational instruction có thể dùng ngay.

⚠️ LUẬT FORMATTING TỐI THƯỢNG (CHỐNG VỠ GIAO DIỆN):
- BẠN BẮT BUỘC PHẢI BỌC TOÀN BỘ CÂU TRẢ LỜI TRONG MỘT CODE BLOCK MARKDOWN DUY NHẤT.
- TUYỆT ĐỐO KHÔNG SỬ DỤNG 3 dấu ngoặc ngược (như \`\`\`txt hay \`\`\`json) ở bên trong nội dung. 
- Nếu cần làm nổi bật từ khóa, prompt hoặc code, CHỈ ĐƯỢC DÙNG 1 dấu ngoặc ngược (VD: \`từ khóa\`) hoặc dùng gạch đầu dòng.

🛡️ CHỐNG TRÔI DẠT KỸ NĂNG (ANTI-DRIFT PROTOCOL):
- Chống "Văn Mẫu": TUYỆT ĐỐI KHÔNG dùng từ ngữ sáo rỗng. Mọi hướng dẫn phải gắn liền với CÔNG CỤ, LỖI, hoặc TỪ KHÓA ĐẶC THÙ trong phiên chat.
- Bảo toàn Heuristic: Giữ lại bằng được các "mẹo ngách" hoặc cách xử lý dị biệt của tác giả.
- Hy sinh Cấu trúc để Bảo vệ Nội dung: Nếu phiên chat không có dữ liệu cho một mục (VD: DECISION LOGIC), HÃY XÓA MỤC ĐÓ. Không tự bịa logic chung chung.

LƯU Ý NGÔN NGỮ: Tiêu đề kỹ năng (dòng # SKILL) BẮT BUỘC bằng Tiếng Việt. Nội dung bên dưới dùng English/Vietnamese tùy ngữ cảnh.

CHỈ TRẢ VỀ DUY NHẤT MỘT MARKDOWN CODE BLOCK THEO ĐÚNG FORMAT NÀY:
\`\`\`markdown
# SKILL: [Tên kỹ năng bằng Tiếng Việt]

## 1. ROLE & OBJECTIVE
Act as an expert in [domain].
Primary objective: ...

## 2. CORE EXECUTION WORKFLOW
When user provides input, follow this operational workflow:
1. Intent Detection
- ...
2. Context Analysis
- ...
3. Execution Strategy
- ...

## 3. DECISION LOGIC
- IF ... THEN ...
- IF ... THEN ...

## 4. STRICT RULES & IP
### MUST DO
- ...
### NEVER DO
- ...
### EDGE CASE HANDLING
- If user input is incomplete...

## 5. PRIORITY HIERARCHY
1. Accuracy
2. Practical execution
3. ...

## 6. OUTPUT STYLE
- High signal, low fluff
- Operational and actionable

## 7. USER INPUT PROTOCOL
Wait for the user input. Start with: "Skill đã sẵn sàng. Vui lòng cung cấp dữ liệu."
\`\`\`
`;

const SUMMARY_PROMPT = `Bạn là trợ lý hệ thống. Hãy đọc lại toàn bộ phiên hội thoại phía trên và tạo một bản WIP (Work In Progress Handover) dưới dạng Markdown.

MỤC ĐÍCH: Lưu trạng thái công việc đang làm dở để có thể mở một phiên chat mới và tiếp tục làm việc ngay mà không cần giải thích lại.

YÊU CẦU:
- Chỉ ghi thông tin thực sự xuất hiện trong cuộc hội thoại.
- Không suy đoán.
- Ưu tiên các quyết định, kết quả, lỗi đang gặp và bước tiếp theo.
- Nếu thiếu dữ liệu thì ghi "Chưa xác định".

CHỈ TRẢ VỀ DUY NHẤT MỘT MARKDOWN CODE BLOCK:
\`\`\`markdown
# WIP: [Tên công việc]

## 1. MỤC TIÊU CHÍNH
- ...

## 2. TRẠNG THÁI HIỆN TẠI
- ...

## 3. NHỮNG GÌ ĐÃ HOÀN THÀNH
- ...

## 4. CÁC QUYẾT ĐỊNH ĐÃ CHỐT
- ...

## 5. DỮ LIỆU / TÀI NGUYÊN LIÊN QUAN
- ...

## 6. VẤN ĐỀ ĐANG TỒN TẠI (OPEN ISSUES)
- ...

## 7. NEXT STEPS
- ...

## 8. PROMPT TIẾP TỤC CÔNG VIỆC
[Một câu lệnh cụ thể để gửi cho AI trong phiên chat mới]
\`\`\`
`;

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

function getOrCreateContainer() {
  let container = document.getElementById("markee-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "markee-container";
    Object.assign(container.style, {
      position: "fixed",
      zIndex: "999998",
      width: "30px",
      height: "30px",
      left: "0px",
      top: "0px",
      transform: "translate(0px, 0px)",
      pointerEvents: "none",
      touchAction: "none",
    });
    appendToBodySafe(container);
  }
  return container;
}

function getStoredPosition() {
  try {
    let x = localStorage.getItem("markee_ui_x");
    let y = localStorage.getItem("markee_ui_y");
    if (x !== null && y !== null) {
      let parsedX = parseInt(x, 10);
      let parsedY = parseInt(y, 10);
      if (!isNaN(parsedX) && !isNaN(parsedY)) {
        parsedX = Math.max(10, Math.min(parsedX, window.innerWidth - 50));
        parsedY = Math.max(10, Math.min(parsedY, window.innerHeight - 50));
        return { x: parsedX, y: parsedY };
      }
    }
  } catch (e) {}

  // Mặc định ở góc dưới bên phải
  const defaultX = Math.max(10, window.innerWidth - 38 - 20);
  const defaultY = Math.max(10, window.innerHeight - 38 - 20);
  return { x: defaultX, y: defaultY };
}

function setStoredPosition(x, y) {
  try {
    localStorage.setItem("markee_ui_x", String(Math.round(x)));
    localStorage.setItem("markee_ui_y", String(Math.round(y)));
  } catch (e) {}
}

function applyPositions() {
  const container = getOrCreateContainer();
  const widget = document.getElementById("markee-widget");
  const { x, y } = getStoredPosition();

  const isOpen = widget && widget.style && (widget.style.display === "flex" || widget.style.display === "block");

  let minX = 0;
  let maxX = window.innerWidth - 38;
  let minY = 0;
  let maxY = window.innerHeight - 38;

  if (isOpen) {
    minX = 320;
    minY = 570;
    if (minX > maxX) minX = 0;
    if (minY > maxY) minY = 0;
  }

  const clampedX = Math.max(minX, Math.min(x, maxX));
  const clampedY = Math.max(minY, Math.min(y, maxY));

  if (container && container.style) {
    container.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
  }
}

function toggleMarkeeWidget() {
  let widget = document.getElementById("markee-widget");

  if (!widget) {
    const host = window.location.hostname;
    const currentTool = (typeof isPopupUi !== "undefined" && !isPopupUi) && typeof AI_SITES !== "undefined" ? (AI_SITES[host] || AI_SITES[host.replace("www.", "")]) : null;
    if (typeof injectWidget === "function") {
      injectWidget(currentTool);
    }
    if (typeof injectFloatingToggleButton === "function") {
      injectFloatingToggleButton();
    }
    widget = document.getElementById("markee-widget");
  }

  if (!widget) return;

  const currentDisplay = widget.style ? widget.style.display : null;
  const isVisible = currentDisplay === "flex" || currentDisplay === "block";

  widget.style.display = isVisible ? "none" : "flex";
  applyPositions();
}

function injectFloatingToggleButton() {
  if (document.getElementById("markee-floating-toggle")) return;

  const button = document.createElement("button");
  button.id = "markee-floating-toggle";
  button.type = "button";
  button.textContent = "🧠";
  button.title = "Mở KPI Prototype Workspace";
  button.setAttribute("aria-label", "Toggle KPI Prototype Workspace");
  button.style.cssText = [
    "position: absolute",
    "left: 0px",
    "top: 0px",
    "width: 38px",
    "height: 38px",
    "border-radius: 50%",
    "border: 2px solid #ffffff",
    "background: linear-gradient(135deg, #e3000f, #c40009)",
    "color: #fff",
    "font-size: 20px",
    "line-height: 1",
    "text-align: center",
    "box-shadow: 0 6px 20px rgba(227, 0, 15, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3)",
    "cursor: grab",
    "z-index: 999998",
    "padding: 0",
    "display: flex",
    "align-items: center",
    "justify-content: center",
    "user-select: none",
    "touch-action: none",
    "pointer-events: auto",
    "transition: transform 0.15s, box-shadow 0.15s",
  ].join("; ");

  button.addEventListener("mouseenter", () => {
    button.style.transform = "scale(1.1)";
    button.style.boxShadow = "0 8px 25px rgba(236, 72, 153, 0.7), 0 4px 12px rgba(0, 0, 0, 0.4)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.transform = "scale(1.0)";
    button.style.boxShadow = "0 6px 20px rgba(236, 72, 153, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3)";
  });

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startXPos = 0;
  let startYPos = 0;
  let hasMoved = false;

  const onMouseDown = (e) => {
    if (e.button !== 0) return; // Chỉ chuột trái
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    const pos = getStoredPosition();
    startXPos = pos.x;
    startYPos = pos.y;
    button.style.cursor = "grabbing";

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      hasMoved = true;
    }
    const newX = startXPos + dx;
    const newY = startYPos + dy;

    // Xem trước vị trí kéo của Container (dùng clamp cho Icon)
    const widget = document.getElementById("markee-widget");
    const isOpen = widget && widget.style.display === "flex";

    let minX = 0;
    let maxX = window.innerWidth - 30;
    let minY = 0;
    let maxY = window.innerHeight - 30;

    if (isOpen) {
      minX = 320;
      minY = 570;
      if (minX > maxX) minX = 0;
      if (minY > maxY) minY = 0;
    }

    const clampedX = Math.max(minX, Math.min(newX, maxX));
    const clampedY = Math.max(minY, Math.min(newY, maxY));

    const container = getOrCreateContainer();
    container.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
  };

  const onMouseUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    button.style.cursor = "grab";
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    if (hasMoved) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const finalX = startXPos + dx;
      const finalY = startYPos + dy;
      setStoredPosition(finalX, finalY);
      applyPositions();
    }
  };

  button.addEventListener("mousedown", onMouseDown);

  button.addEventListener("click", (e) => {
    if (hasMoved) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    toggleMarkeeWidget();
  });

  const container = getOrCreateContainer();
  container.appendChild(button);
}

function injectWidget(toolName) {
  if (document.getElementById("markee-widget")) return;
  const widget = document.createElement("div");
  widget.id = "markee-widget";
  let allProjects = [];
  let currentMode = "wip";
  var WIP_PAGE_SIZE = 15;
  var wipCurrentPage = 0;

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    const bgColor = type === "success" ? "#10b981" : "#ef4444";
    Object.assign(toast.style, {
      position: "fixed",
      top: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      backgroundColor: bgColor,
      color: "#fff",
      padding: "12px 24px",
      borderRadius: "8px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      zIndex: "999999",
      fontSize: "14px",
      fontWeight: "bold",
    });
    toast.innerText = message;
    appendToBodySafe(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // Dán text vào ô chat AI — dùng ClipboardEvent để tránh treo trình duyệt khi text 40k+ tokens
  async function insertSkillToChat(skillContent) {
    try {
      await navigator.clipboard.writeText(skillContent);
      showToast("📋 Đã kéo nội dung! Đang xử lý dán...");

      const chatBox = document.querySelector(".ql-editor") || document.querySelector("rich-textarea") || document.querySelector("#prompt-textarea") || document.querySelector(".ProseMirror") || document.querySelector('[contenteditable="true"]') || document.querySelector("textarea");

      if (!chatBox) {
        showToast("⚠️ Vui lòng gõ Ctrl+V vào ô chat để dán!", "warning");
        return;
      }

      chatBox.focus();

      // Phương pháp 1: ClipboardEvent paste — không gán value trực tiếp, tránh treo UI
      const clipDt = new DataTransfer();
      clipDt.setData("text/plain", skillContent);
      const pasteEvt = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipDt,
      });
      chatBox.dispatchEvent(pasteEvt);

      // Phương pháp 2: Fallback nếu paste không có tác dụng
      const isEmpty = (!chatBox.value || chatBox.value.trim() === "") && (!chatBox.innerText || chatBox.innerText.trim() === "");
      if (isEmpty) {
        const inserted = document.execCommand("insertText", false, skillContent);
        if (!inserted) {
          // Fallback cuối: gán thủ công + trigger input
          chatBox.innerText = (chatBox.innerText || "") + "\n\n" + skillContent;
          chatBox.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }

      showToast("✅ Đã dán thành công! Vui lòng ấn Gửi.");
    } catch (err) {
      showToast("⚠️ Gặp lỗi! Vui lòng gõ Ctrl+V để dán tay.", "warning");
    }
  }

  // Hàm tiêm file vào ô chat AI — thử <input type="file"> trước, fallback sang DragEvent combo
  // Dual-Injection (nâng cấp): Tiêm file vào AI chat bằng 2 phương pháp song song
  // + Nánh Gemini riêng biệt (ClipboardEvent do Shadow DOM khác kiến trúc)
  function injectFilesToChat(fileObjects) {
    if (!fileObjects || fileObjects.length === 0) return false;

    // Tự đổi tên file: thêm timestamp để tránh lỗi "trùng tên" trên ChatGPT khi inject liên tiếp
    const ts = Date.now();
    const renamedFiles = fileObjects.map((f) => {
      const nameParts = f.name.match(/^(.+?)(\.[^.]+)?$/) || [f.name, f.name, ""];
      const newName = `${nameParts[1]}_${ts}${nameParts[2] || ""}`;
      return new File([f], newName, { type: f.type });
    });

    const dt = new DataTransfer();
    renamedFiles.forEach((f) => dt.items.add(f));
    let anySuccess = false;
    const hostname = window.location.hostname;

    // =====================================================================
    // GEMINI: dùng ClipboardEvent vào rich-textarea (Shadow DOM / Lit)
    // =====================================================================
    if (hostname.includes("gemini.google.com")) {
      const richTextarea = document.querySelector("rich-textarea .ql-editor") || document.querySelector("rich-textarea") || document.querySelector(".chat-input-container") || document.querySelector(".input-area-container");

      if (richTextarea) {
        try {
          richTextarea.focus();
          const clipDt = new DataTransfer();
          renamedFiles.forEach((f) => clipDt.items.add(f));
          const pasteEvent = new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: clipDt,
          });
          richTextarea.dispatchEvent(pasteEvent);
          console.log("[Markee] 🎯 Gemini: tiêm file qua ClipboardEvent");
          anySuccess = true;
        } catch (err) {
          console.log("[Markee] ⚠️ Gemini ClipboardEvent thất bại:", err.message);
        }
      }

      // Fallback Gemini: Drop đầu vào container
      try {
        const dropTarget = document.querySelector(".chat-input-container") || document.querySelector("rich-textarea") || document.body;
        const makeEvt = (t) => new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt });
        dropTarget.dispatchEvent(makeEvt("dragenter"));
        dropTarget.dispatchEvent(makeEvt("dragover"));
        dropTarget.dispatchEvent(makeEvt("drop"));
        console.log("[Markee] 🎯 Gemini: fallback Drop combo");
        anySuccess = true;
      } catch (err) {
        console.log("[Markee] ⚠️ Gemini Drop fallback thất bại:", err.message);
      }

      return anySuccess;
    }

    // =====================================================================
    // CHATGPT & CLAUDE: Phương pháp 1 — React Native Input Hack
    // =====================================================================
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "files").set;
        nativeSetter.call(fileInput, dt.files);
        fileInput.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        fileInput.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
        console.log("[Markee] 🎯 Dual-Inject: Phương pháp 1 (React input hack) thành công");
        anySuccess = true;
      } catch (err) {
        console.log("[Markee] ⚠️ Phương pháp 1 thất bại:", err.message);
      }
    }

    // =====================================================================
    // Phương pháp 2 — Drag & Drop combo (luôn chạy song song, quan trọng cho ChatGPT)
    // =====================================================================
    const dropZone = document.querySelector("#prompt-textarea") || document.querySelector(".ProseMirror") || document.querySelector("rich-textarea") || document.querySelector(".ql-editor") || document.body;

    try {
      const makeEvent = (type) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      dropZone.dispatchEvent(makeEvent("dragenter"));
      dropZone.dispatchEvent(makeEvent("dragover"));
      dropZone.dispatchEvent(makeEvent("drop"));
      console.log("[Markee] 🎯 Dual-Inject: Phương pháp 2 (Drag & Drop) thành công");
      anySuccess = true;
    } catch (err) {
      console.log("[Markee] ⚠️ Phương pháp 2 thất bại:", err.message);
    }

    return anySuccess;
  }

  // Hàm xử lý nút Dùng cho thẻ WIP: tải file, drop vào chat, rồi dán text
  async function reuseWipWithAttachment(skill) {
    const chatBox = document.querySelector(".ql-editor") || document.querySelector("rich-textarea") || document.querySelector("#prompt-textarea") || document.querySelector(".ProseMirror") || document.querySelector("textarea");

    // Chuẩn hoá attached_file: hỗ trợ cả định dạng Array (Dashboard) và Object (Extension)
    const rawAttached = skill.attached_file;
    const fileInfo = Array.isArray(rawAttached) ? rawAttached[0] : rawAttached;
    if (fileInfo) fileInfo.file_name = fileInfo.file_name || fileInfo.name;
    const hasFile = !!(fileInfo && fileInfo.storage_path);

    if (!hasFile) {
      insertSkillToChat(skill.markdown_content);
      return;
    }

    if (!chatBox) {
      showToast("⚠️ Không tìm thấy ô chat. Vui lòng Ctrl+V để dán tay.", "warning");
      return;
    }

    showToast("⏳ Đang tải file đính kèm...");

    chrome.runtime.sendMessage(
      {
        action: "FETCH_ATTACHMENT",
        storagePath: fileInfo.storage_path,
        mimeType: fileInfo.mime_type || fileInfo.mimeType || "application/octet-stream",
        fileName: fileInfo.file_name || fileInfo.storage_path.split("/").pop(),
      },
      (res) => {
        if (!res || !res.ok) {
          showToast("⚠️ Không tải được file đính kèm. Sẽ chỉ dán text.", "warning");
          insertSkillToChat(skill.markdown_content);
          return;
        }

        try {
          // Convert base64 → Blob → File
          const byteChars = atob(res.base64);
          const byteNums = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteNums[i] = byteChars.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNums);
          const blob = new Blob([byteArray], { type: res.mimeType });
          const file = new File([blob], res.fileName, { type: res.mimeType });

          // Tiêm file vào ô chat (thử input[type=file] → fallback DragEvent combo)
          const injected = injectFilesToChat([file]);
          if (injected) {
            showToast("📎 Đã tiêm file vào chat! Đang chờ web AI xử lý...");
          }
        } catch (err) {
          console.log("🔴 [Markee] Lỗi convert base64 → File:", err.message);
          showToast("⚠️ Lỗi xử lý file. Sẽ chỉ dán text.", "warning");
        }

        // Delay thích ứng: tối thiểu 1500ms, scale 0.1ms/ký tự, tối đa 5000ms
        const adaptiveDelay = Math.min(Math.max(1500, skill.markdown_content.length * 0.1), 5000);
        setTimeout(() => {
          insertSkillToChat(skill.markdown_content);
        }, adaptiveDelay);
      },
    );
  }

  function renderPullOptions(data) {
    const dropdown = document.getElementById("dropdown-options-pull");
    dropdown.innerHTML = "";
    if (data.length === 0) {
      dropdown.innerHTML = `<div style="padding: 8px; color: #64748b; font-size: 11px; text-align: center;">Không tìm thấy</div>`;
      return;
    }
    data.forEach((p, index) => {
      const div = document.createElement("div");
      const displayText = `${index + 1} - ${p.name}`;
      div.innerText = displayText;
      div.style.cssText = "padding: 8px; cursor: pointer; color: #fff; background: #1a1a2e; border-bottom: 1px solid #232340; font-size: 12px;";
      div.onmouseover = () => (div.style.backgroundColor = "#450a0a");
      div.onmouseout = () => (div.style.backgroundColor = "#1a1a2e");
      div.onclick = (e) => {
        e.stopPropagation();
        prjInputPull.value = displayText;
        prjInputPull.dataset.projectId = String(p.id);
        chrome.storage.local.set({
          markee_pull_project_id: p.id,
          markee_pull_project_display: displayText,
        });
        dropdown.style.display = "none";
        onPullFilterChange();
      };
      dropdown.appendChild(div);
    });
  }

  function renderPushOptions(data) {
    const dropdown = document.getElementById("dropdown-options-push");
    dropdown.innerHTML = "";
    if (data.length === 0) {
      dropdown.innerHTML = `<div style="padding: 8px; color: #64748b; font-size: 11px; text-align: center;">Không tìm thấy</div>`;
      return;
    }
    data.forEach((p, index) => {
      const div = document.createElement("div");
      const displayText = `${index + 1} - ${p.name}`;
      div.innerText = displayText;
      div.style.cssText = "padding: 8px; cursor: pointer; color: #fff; background: #1a1a2e; border-bottom: 1px solid #232340; font-size: 12px;";
      div.onmouseover = () => (div.style.backgroundColor = "#450a0a");
      div.onmouseout = () => (div.style.backgroundColor = "#1a1a2e");
      div.onclick = (e) => {
        e.stopPropagation();
        prjInputPush.value = displayText;
        prjInputPush.dataset.projectId = String(p.id);
        chrome.storage.local.set({
          markee_project_id: p.id,
          markee_project_display: displayText,
        });
        dropdown.style.display = "none";
      };
      dropdown.appendChild(div);
    });
  }

  Object.assign(widget.style, {
    position: "absolute",
    left: "-285px",
    top: "-570px",
    margin: "0px",
    pointerEvents: "auto",
    backgroundColor: "#1e1e2f",
    color: "#e5e5e5",
    padding: "12px",
    borderRadius: "12px",
    boxShadow: "0 10px 25px rgba(0,0,0,0.8)",
    zIndex: "999999",
    fontFamily: "sans-serif",
    fontSize: "13px",
    border: "1px solid #e3000f",
    display: "none",
    flexDirection: "column",
    gap: "8px",
    width: "280px",
    height: "560px",
    boxSizing: "border-box",
    overflow: "hidden",
    touchAction: "none",
  });

  widget.innerHTML = `
    <div id="markee-widget-header" style="font-weight: 500; color: #fff; border-bottom: 1px solid #c40009; padding-bottom: 6px; position: relative; flex-shrink: 0; cursor: grab; user-select: none;">
  <span>🧠 KPI Prototype Workspace</span>
  
  <!-- Nút Hướng dẫn sử dụng (Nằm cạnh nút Đóng) -->
  <a href="https://www.youtube.com/playlist?list=PLUIGHawyvZNE&si=b-uLWNhKkDPMAv_2" target="_blank" title="Xem video hướng dẫn sử dụng" style="position: absolute; right: 28px; top: 0; cursor: pointer; color: #64748b; padding: 2px; text-decoration: none; display: flex; align-items: center; justify-content: center;">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  </a>

  <!-- Nút Đóng (Gốc) -->
  <span id="markee-close-btn" style="position: absolute; right: 0; top: 0; cursor: pointer; color: #64748b; font-size: 14px; padding: 2px;">✕</span>
</div>
    
    <!-- Tab 1: UPLOAD / DOWNLOAD -->
    <div id="markee-tab-nav" style="display: flex; gap: 4px; flex-shrink: 0;">
      <button id="markee-tab-push" type="button" style="flex: 1; background: #e3000f; color: #fff; border: none; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 500;">📤 UPLOAD</button>
      <button id="markee-tab-pull" type="button" style="flex: 1; background: #1a1a2e; color: #ff3344; border: 1px solid #c40009; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 500;">📥 DOWNLOAD</button>
    </div>

    <!-- Sub-tabs: Mode Toggle (📝 Tóm Tắt TRÁI / ⚡ Kỹ Năng PHẢI) -->
    <div id="markee-mode-nav" style="display: flex; gap: 4px; flex-shrink: 0; margin-top: 4px; background: #1a1a2e; padding: 2px; border-radius: 6px; border: 1px solid #c40009;">
      <button id="markee-mode-wip" type="button" style="flex: 1; background: #e3000f; color: #fff; border: none; padding: 4px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 500;">📝 Tóm Tắt</button>
      <button id="markee-mode-skill" type="button" style="flex: 1; background: transparent; color: #ff3344; border: none; padding: 4px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 500;">⚡ Kỹ Năng</button>
    </div>

    <!-- PANEL UPLOAD -->
    <div id="markee-tab-push-panel" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
      <div style="flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 8px;">
        
        <!-- View 1: UPLOAD KỸ NĂNG (Thiết kế mới Step-by-Step 2 Bước) -->
        <div id="markee-push-skill-view" style="display: none; flex-direction: column; gap: 8px; margin-top: 2px; padding: 8px; background: rgba(227, 0, 15, 0.08); border-radius: 8px; border: 1px dashed #e3000f; position: relative;">
          <!-- Header Tiêu đề Tab -->
          <div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 2px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div id="skill-push-header-title" style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
                <span title="Chọn một hoặc cả hai nơi lưu, sau đó đưa nội dung cho AI kiểm tra." style="font-size: 12px; font-weight: 500; color: #fff; cursor: pointer;">⚡ Thêm kỹ năng mới</span>
                <span id="skill-push-toggle-arrow" style="font-size: 10px; color: #ff3344; transition: transform 0.25s ease;">▼</span>
              </div>
              <button class="markee-sync-all-btn" type="button" title="Đồng bộ tất cả dữ liệu" style="background: transparent; border: 1px solid #e3000f; color: #ff3344; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s;">
                <span class="sync-icon">🔄</span> Đồng bộ tất cả
              </button>
            </div>
          </div>

          <!-- COLLAPSIBLE GROUP A: Gom CẢ Bước 1 VÀ Bước 2 (Mặc định THU GỌN - max-height: 0px, opacity: 0) -->
          <div id="skill-push-collapsible-area" style="display: flex; flex-direction: column; gap: 8px; transition: all 0.25s ease-in-out; overflow: hidden; max-height: 0px; opacity: 0;">
            <!-- BƯỚC 1: LƯU KỸ NĂNG VÀO ĐÂU? -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; font-weight: 500; color: #ff3344;">1. Lưu kỹ năng vào đâu?</span>
                <span style="font-size: 9px; color: #ef4444; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); padding: 1px 5px; border-radius: 4px; font-weight: 500;">Bắt buộc</span>
              </div>

              <!-- 2 Cards Lớn (Flex 50-50) -->
              <div style="display: flex; gap: 6px;">
                <!-- Card 1: Dự án -->
                <div id="push-dest-card-project" style="flex: 1; background: rgba(227, 0, 15, 0.2); border: 1px solid #e3000f; border-radius: 6px; padding: 6px 8px; cursor: pointer; user-select: none; transition: all 0.2s;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 11px; font-weight: 500; color: #fff;">📁 Dự án</span>
                    <span class="check-icon" style="font-size: 11px; color: #ff3344; font-weight: 500;">✓</span>
                  </div>
                </div>

                <!-- Card 2: Bộ kỹ năng phòng ban -->
                <div id="push-dest-card-dept" style="flex: 1; background: rgba(227, 0, 15, 0.2); border: 1px solid #e3000f; border-radius: 6px; padding: 6px 8px; cursor: pointer; user-select: none; transition: all 0.2s;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 11px; font-weight: 500; color: #fff;">🏢 Bộ kỹ năng</span>
                    <span class="check-icon" style="font-size: 11px; color: #ff3344; font-weight: 500;">✓</span>
                  </div>
                </div>
              </div>

              <!-- Text Cảnh báo lỗi nội bộ Extension (Local Warning) -->
              <div id="push-dest-local-warning" class="local-warning" style="display: none; font-size: 11px; color: #ef4444; font-weight: 500; margin-top: 2px;">⚠️ Phải chọn ít nhất 1 nơi lưu!</div>
            </div>

            <!-- BƯỚC 2: CHỌN PHẠM VI SỬ DỤNG (HIỂN THỊ ĐỘNG) -->
            <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 2px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; font-weight: bold; color: #ff3344;">2. Chọn phạm vi sử dụng</span>
                <span id="push-step2-badge" style="font-size: 9px; color: #ff3344; background: rgba(227, 0, 15, 0.15); border: 1px solid #e3000f; padding: 1px 6px; border-radius: 4px; font-weight: 500;">Cả 2 nơi lưu</span>
              </div>

              <!-- Dynamic Scope Boxes Container -->
              <div id="push-step2-boxes-container" style="display: flex; flex-direction: column; gap: 6px;"></div>
            </div>
          </div>

          <!-- KPI Prototype: mỗi lần tải extension đã gắn cố định với 1 dự án
               pm-new — không còn danh sách dự án công ty để chọn. Skill vẫn
               dùng chung toàn công ty, nên đây chỉ là 1 checkbox gắn thẻ tuỳ
               chọn với dự án đang khoá, thay cho bộ chọn dự án cũ. -->
          <label style="display: flex; align-items: center; gap: 6px; margin-top: 4px; padding: 8px; background: #12121f; border: 1px solid #27273a; border-radius: 8px; cursor: pointer; user-select: none;">
            <input type="checkbox" id="skill-attach-project-checkbox" checked style="accent-color: #e3000f; cursor: pointer; width: 14px; height: 14px;">
            <span style="font-size: 11px; color: #ff3344;">📁 Gắn với dự án đang chọn: <strong id="skill-attach-project-name" style="color: #fff;">…</strong></span>
          </label>

          <!-- Hidden Form Elements for scanAndSave compatibility -->
          <div style="display: none;">
            <select id="markee-department-select"><option value="">-- Tất cả Phòng ban --</option></select>
            <select id="markee-team-select" disabled><option value="">-- Tất cả Team --</option></select>
            <input type="text" id="markee-project-input-push" placeholder="-- Chat tự do --">
            <select id="markee-asset-type-select">
              <option value="Skill" selected>Skill (Mặc định)</option>
              <option value="Prompt">Prompt</option>
              <option value="SOP">SOP</option>
              <option value="Context Pack">Context Pack</option>
              <option value="Workflow">Workflow</option>
              <option value="Checklist">Checklist</option>
            </select>
            <!-- Legacy quick-project-selector removed — company-wide project cascade no longer exists (see config.js) -->
            <div id="skill-push-quick-list"></div>
          </div>
        </div>

        <!-- View 2: UPLOAD TÓM TẮT (Flow mới) - shown by default -->
        <div id="markee-push-wip-view" style="display: flex; flex-direction: column; gap: 8px; margin-top: 2px; padding: 8px; background: rgba(227, 0, 15, 0.08); border-radius: 8px; border: 1px dashed #e3000f; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <div id="wip-push-header-title" style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
              <label style="font-size: 11px; color: #ff3344; font-weight: bold; margin: 0; cursor: pointer;">📝 Thiết lập Tóm tắt</label>
              <span id="wip-push-toggle-arrow" style="font-size: 10px; color: #ff3344; transition: transform 0.25s ease;">▼</span>
            </div>
            <button class="markee-sync-all-btn" type="button" title="Đồng bộ tất cả dữ liệu" style="background: transparent; border: 1px solid #e3000f; color: #ff3344; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s;">
              <span class="sync-icon">🔄</span> Đồng bộ tất cả
            </button>
          </div>

          <!-- HÀNG 1: Gom Khách hàng & Dự án (50% - 50%) - COLLAPSIBLE GROUP A (Mặc định THU GỌN - max-height: 0px, opacity: 0) -->
          <div id="wip-push-collapsible-area" style="display: flex; gap: 8px; transition: all 0.25s ease-in-out; overflow: hidden; max-height: 0px; opacity: 0; margin-top: -4px; margin-bottom: -4px;">
            <!-- Box 1: Khách hàng -->
            <div id="wip-push-card-customer" onmouseover="this.style.borderColor='#e3000f'; this.style.background='#1e1e32';" onmouseout="this.style.borderColor='#27273a'; this.style.background='#161625';" style="flex: 1; background: #161625; border: 1px solid #27273a; border-radius: 8px; padding: 10px 12px; min-height: 56px; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; transition: all 0.2s;">
              <span style="font-size: 9px; font-weight: bold; color: #ff3344; letter-spacing: 0.5px;">🏢 KHÁCH HÀNG</span>
              <span id="wip-push-customer-text" style="font-size: 11px; font-weight: 400 !important; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-- Chọn Khách hàng --</span>
            </div>

            <!-- Box 2: Dự án -->
            <div id="wip-push-card-project" onmouseover="this.style.borderColor='#e3000f'; this.style.background='#1e1e32';" onmouseout="this.style.borderColor='#27273a'; this.style.background='#161625';" style="flex: 1; background: #161625; border: 1px solid #27273a; border-radius: 8px; padding: 10px 12px; min-height: 56px; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; transition: all 0.2s;">
              <span style="font-size: 9px; font-weight: bold; color: #ff3344; letter-spacing: 0.5px;">📁 DỰ ÁN</span>
              <span id="wip-push-project-text" style="font-size: 11px; font-weight: 400 !important; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-- Chọn Dự án --</span>
            </div>
          </div>

          <!-- HÀNG 2: Tính năng (100% width) -->
          <div style="display: flex; flex-direction: column; gap: 4px; position: relative;">
            <label style="font-size: 10px; color: #ff3344; font-weight: bold; margin: 0;">🛠️ TÍNH NĂNG:</label>
            <input type="text" id="markee-feature-input-push" placeholder="Nhập tên tính năng mới hoặc chọn từ danh sách..." autocomplete="off" style="width: 100%; background: #161625; color: #fff; border: 1px solid #c40009; border-radius: 6px; padding: 6px 8px; font-size: 11px; outline: none; box-sizing: border-box;">
            <div id="custom-feature-dropdown-push" style="display: none; position: absolute; left: 0; right: 0; top: 100%; margin-top: 4px; background: #161625; border: 1px solid #c40009; border-radius: 8px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6); max-height: 200px; overflow-y: auto; z-index: 999999; padding: 4px 0;"></div>
            <datalist id="feature-suggestions-push"></datalist>
          </div>

          <!-- KPI Prototype: chọn dự án bằng cách gõ tên (giống UI markee-dashboard's
               "Chọn Dự án" — search input lọc theo tên, click 1 dòng để chọn). -->
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding: 8px; background: #12121f; border: 1px solid #27273a; border-radius: 8px; position: relative;">
            <span style="font-size: 10px; color: #ff3344; font-weight: bold;">📁 DỰ ÁN: <span id="wip-project-current-name" style="color: #fff;">—</span></span>
            <input type="text" id="wip-project-search-input" placeholder="Tìm kiếm dự án..." autocomplete="off" style="width: 100%; background: #161625; color: #fff; border: 1px solid #c40009; border-radius: 6px; padding: 6px 8px; font-size: 11px; outline: none; box-sizing: border-box;">
            <div id="wip-project-search-results" style="display: flex; flex-direction: column; gap: 2px; max-height: 140px; overflow-y: auto;"></div>
          </div>

          <!-- Hidden Form Controls for saveWipSummary compatibility -->
          <div style="display: none;">
            <select id="markee-customer-select-push"><option value="">-- Chọn Khách hàng --</option></select>
            <select id="markee-project-select-push" disabled><option value="">-- Chọn Dự án --</option></select>
            <div id="wip-push-quick-list"></div>
          </div>
        </div>

        <hr style="border: 0; border-top: 1px solid #c40009; margin: 4px 0;">

        <!-- ACTIONS CHO KỸ NĂNG - hidden by default -->
        <div id="markee-push-skill-actions" style="display: none; flex-direction: column; gap: 6px;">
          <div style="display: flex; gap: 6px;">
            <button id="btn-copy-prompt" style="flex: 1; background: #e3000f; color: white; border: none; padding: 7px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: bold;">➕ Lệnh Kỹ Năng</button>
            <button id="btn-save-skill" style="flex: 1; background: #10b981; color: white; border: none; padding: 7px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: bold;">💾 Lưu Kỹ Năng</button>
          </div>
        </div>

        <!-- ACTIONS CHO TÓM TẮT - shown by default -->
        <div id="markee-push-wip-actions" style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; gap: 6px;">
            <button id="btn-wip-prompt" style="flex: 1; background: #d97706; color: white; border: none; padding: 7px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: bold;">⏸️ Lệnh Tóm Tắt</button>
            <button id="btn-save-wip" style="flex: 1; background: #b45309; color: white; border: none; padding: 7px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: bold;">💾 Lưu Tóm Tắt</button>
          </div>
        </div>

      </div>
    </div>

    <!-- PANEL DOWNLOAD -->
    <div id="markee-tab-pull-panel" style="flex: 1; min-height: 0; display: none; flex-direction: column;">
      <div style="flex: 1; overflow-y: auto; overflow-x: hidden;">
        
        <!-- View 1: DOWNLOAD KỸ NĂNG -->
        <div id="markee-pull-skill-view" style="display: none; flex-direction: column; gap: 6px; margin-top: 2px; padding: 6px; background: rgba(16, 185, 129, 0.08); border-radius: 8px; border: 1px dashed #10b981; position: relative;">
          <!-- Header Bộ Lọc (Clickable Collapsible Header) -->
          <div id="markee-pull-skill-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <label style="font-size: 11px; color: #6ee7b7; font-weight: 500; margin: 0; cursor: pointer;">📥 Bộ lọc ngữ cảnh</label>
              <span id="markee-pull-skill-arrow" style="font-size: 10px; color: #6ee7b7; font-weight: normal;">▼</span>
            </div>
            <button class="markee-sync-all-btn" type="button" title="Đồng bộ tất cả dữ liệu" style="background: transparent; border: 1px solid #10b981; color: #6ee7b7; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s;">
              <span class="sync-icon">🔄</span> Đồng bộ tất cả
            </button>
          </div>

          <!-- NHÓM A: VÙNG CÓ THỂ THU GỌN (CHỈ CHỨA CÁC BOX CHỌN NÂNG CAO - MẶC ĐỊNH ẨN) -->
          <div id="markee-pull-skill-body" style="display: none; flex-direction: column; gap: 6px; margin-top: 4px;">
            <!-- Hàng 1: Nút Phòng ban & Nút Team phụ trách (Flex 50-50) -->
            <div style="display: flex; gap: 6px;">
              <div id="markee-filter-btn-dept" title="Chọn Phòng ban" style="flex: 1; display: flex; align-items: center; justify-content: space-between; background: #1a1a2e; border: 1px solid #c40009; border-radius: 6px; padding: 6px 8px; cursor: pointer; user-select: none; transition: all 0.2s;">
                <span style="font-size: 11px; color: #94a3b8; font-weight: 500;">🏢 Phòng ban</span>
                <span id="markee-badge-dept" style="background: #c40009; color: #ff3344; border-radius: 50%; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 500;">0</span>
              </div>
              <div id="markee-filter-btn-team" title="Chọn Team phụ trách" style="flex: 1; display: flex; align-items: center; justify-content: space-between; background: #1a1a2e; border: 1px solid #c40009; border-radius: 6px; padding: 6px 8px; cursor: pointer; user-select: none; transition: all 0.2s;">
                <span style="font-size: 11px; color: #94a3b8; font-weight: 500;">👥 Team phụ trách</span>
                <span id="markee-badge-team" style="background: #c40009; color: #ff3344; border-radius: 50%; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 500;">0</span>
              </div>
            </div>

            <!-- Hàng 2: Nút Dự án (100% width) -->
            <div id="markee-filter-btn-project" title="Chọn Dự án" style="width: 100%; display: flex; align-items: center; justify-content: space-between; background: #1a1a2e; border: 1px solid #c40009; border-radius: 6px; padding: 6px 8px; cursor: pointer; user-select: none; transition: all 0.2s; box-sizing: border-box;">
              <span style="font-size: 11px; color: #94a3b8; font-weight: 500;">📁 Dự án</span>
              <span id="markee-badge-project" style="background: #c40009; color: #ff3344; border-radius: 50%; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 500;">0</span>
            </div>
          </div>

          <!-- NHÓM B: VÙNG LUÔN HIỂN THỊ (TÌM KIẾM & CHIPS BỘ LỌC NHANH - LUÔN HIỆN) -->
          <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
            <!-- Search Input Bar -->
            <div style="position: relative; width: 100%;">
              <span style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 11px; color: #64748b; pointer-events: none;">🔍</span>
              <input type="text" id="markee-skill-search-input" placeholder="Tìm kỹ năng..." style="width: 100%; padding: 6px 10px 6px 26px; background: #1a1a2e; color: #fff; border: 1px solid #c40009; border-radius: 6px; font-size: 11px; outline: none; box-sizing: border-box; transition: all 0.2s;">
            </div>

            <!-- Quick Filter Chips -->
            <div id="markee-skill-chips-container" style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; -ms-overflow-style: none;">
              <button type="button" class="markee-chip-btn markee-chip-fav" data-filter="favorite" style="flex-shrink: 0; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s;">⭐ Ưu thích</button>
              <button type="button" class="markee-chip-btn active" data-filter="all" style="flex-shrink: 0; background: #e3000f; border: 1px solid #e3000f; color: #fff; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s;">Tất cả</button>
              <button type="button" class="markee-chip-btn" data-filter="recent" style="flex-shrink: 0; background: #1a1a2e; border: 1px solid #c40009; color: #ff3344; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s;">Gần đây</button>
            </div>
          </div>

          <!-- Legacy hidden elements for script compatibility -->
          <div style="display: none;">
            <select id="markee-pull-department"><option value="">-- Tất cả --</option></select>
            <select id="markee-pull-team" disabled><option value="">-- Tất cả --</option></select>
            <input type="text" id="markee-pull-project">
            <div id="dropdown-options-pull"></div>
          </div>
        </div>

        <!-- View 2: DOWNLOAD TÓM TẮT -->
        <div id="markee-pull-wip-view" style="display: flex; flex-direction: column; gap: 6px; margin-top: 2px; padding: 6px; background: rgba(16, 185, 129, 0.08); border-radius: 6px; border: 1px dashed #10b981; position: relative;">
          <!-- Header Bộ Lọc (Clickable Collapsible Header) -->
          <div id="markee-pull-wip-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <label style="font-size: 11px; color: #6ee7b7; font-weight: 500; margin: 0; cursor: pointer;">📥 Bộ lọc Tóm tắt</label>
              <span id="markee-pull-wip-arrow" style="font-size: 10px; color: #6ee7b7; font-weight: normal;">▼</span>
            </div>
            <button class="markee-sync-all-btn" type="button" title="Đồng bộ tất cả dữ liệu" style="background: transparent; border: 1px solid #10b981; color: #6ee7b7; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s;">
              <span class="sync-icon">🔄</span> Đồng bộ tất cả
            </button>
          </div>

          <!-- NHÓM A: VÙNG CÓ THỂ THU GỌN (CHỈ CHỨA CÁC BOX CHỌN NÂNG CAO - MẶC ĐỊNH ẨN) -->
          <div id="markee-pull-wip-body" style="display: none; flex-direction: column; gap: 6px; margin-top: 4px;">
            <!-- HÀNG 1: Gom Khách hàng & Dự án (50% - 50%) -->
            <div style="display: flex; gap: 6px;">
              <!-- Box 1: Khách hàng -->
              <div id="wip-pull-card-customer" onmouseover="this.style.borderColor='#10b981'; this.style.background='#1e1e32';" onmouseout="this.style.borderColor='#27273a'; this.style.background='#161625';" style="flex: 1; background: #161625; border: 1px solid #27273a; border-radius: 8px; padding: 8px 10px; min-height: 50px; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; transition: all 0.2s;">
                <span style="font-size: 9px; font-weight: 500; color: #6ee7b7; letter-spacing: 0.5px;">🏢 KHÁCH HÀNG</span>
                <span id="wip-pull-customer-text" style="font-size: 11px; font-weight: 400 !important; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-- Chọn Khách hàng --</span>
              </div>

              <!-- Box 2: Dự án -->
              <div id="wip-pull-card-project" onmouseover="this.style.borderColor='#10b981'; this.style.background='#1e1e32';" onmouseout="this.style.borderColor='#27273a'; this.style.background='#161625';" style="flex: 1; background: #161625; border: 1px solid #27273a; border-radius: 8px; padding: 8px 10px; min-height: 50px; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; transition: all 0.2s;">
                <span style="font-size: 9px; font-weight: 500; color: #6ee7b7; letter-spacing: 0.5px;">📁 DỰ ÁN</span>
                <span id="wip-pull-project-text" style="font-size: 11px; font-weight: 400 !important; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-- Chọn Dự án --</span>
              </div>
            </div>
          </div>

          <!-- NHÓM B: VÙNG LUÔN HIỂN THỊ (TÌM KIẾM & CHIPS BỘ LỌC NHANH - LUÔN HIỆN) -->
          <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
            <!-- HÀNG 2: Tìm kiếm Tính năng (100% width) -->
            <div style="position: relative;">
              <label style="font-size: 10px; color: #6ee7b7; font-weight: 500; margin: 0 0 2px 0; display: block;">🛠️ TÍNH NĂNG:</label>
              <input type="text" id="markee-feature-input-pull" placeholder="Lọc theo tính năng..." autocomplete="off" style="width: 100%; background: #161625; color: #fff; border: 1px solid #c40009; border-radius: 6px; padding: 6px 8px; font-size: 11px; outline: none; box-sizing: border-box;">
              <div id="custom-feature-dropdown-pull" style="display: none; position: absolute; left: 0; right: 0; top: 100%; margin-top: 4px; background: #161625; border: 1px solid #c40009; border-radius: 8px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6); max-height: 200px; overflow-y: auto; z-index: 999999; padding: 4px 0;"></div>
            </div>

            <!-- HÀNG 3: Quick Filter Chips cho WIP -->
            <div id="markee-wip-chips-container" style="display: flex; gap: 6px; overflow-x: auto; padding-top: 2px; padding-bottom: 2px; scrollbar-width: none; -ms-overflow-style: none;">
              <button type="button" class="markee-wip-chip-btn markee-chip-fav" data-filter="favorite" style="flex-shrink: 0; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s;">⭐ Ưu thích</button>
              <button type="button" class="markee-wip-chip-btn active" data-filter="all" style="flex-shrink: 0; background: #10b981; border: 1px solid #10b981; color: #fff; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s;">Tất cả</button>
              <button type="button" class="markee-wip-chip-btn" data-filter="recent" style="flex-shrink: 0; background: #1a1a2e; border: 1px solid #c40009; color: #ff3344; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s;">Gần đây</button>
            </div>
          </div>

          <!-- Hidden Form Controls for compatibility -->
          <div style="display: none;">
            <select id="markee-customer-select-pull"><option value="">-- Chọn Khách hàng --</option></select>
            <select id="markee-project-select-pull" disabled><option value="">-- Chọn Dự án --</option></select>
            <datalist id="feature-suggestions-pull"></datalist>
          </div>
        </div>

        <!-- LIST HIỂN THỊ KẾT QUẢ -->
        <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #c40009;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <div id="markee-skill-list-header" style="font-size: 11px; color: #10b981; font-weight: bold;">⚡ Skills</div>
            <button id="markee-wip-refresh-btn" title="Làm mới danh sách" style="background: none; border: none; color: #e3000f; font-size: 13px; cursor: pointer; padding: 0 2px; line-height: 1; display: none; align-items: center; gap: 4px;">
              <span class="spin-icon" style="display: inline-block; transition: transform 1s ease;">🔄</span>
              <span class="refresh-text" style="font-size: 9px; color: #64748b;"></span>
            </button>
          </div>
          <input type="text" id="wip-search-input" placeholder="🔍 Tìm kiếm WIP..." style="width: 100%; margin-bottom: 6px; display: none; background: #1a1a2e; color: #fff; border: 1px solid #c40009; border-radius: 4px; padding: 5px; font-size: 11px; outline: none; box-sizing: border-box;">
          <div id="markee-skill-list" style="display: flex; flex-direction: column; gap: 5px;"></div>
        </div>

        <!-- "Kho Tri Thức" (master project summary) removed — no equivalent
             field on pm-new's Project model; GET_SUMMARIES is not implemented
             by background.js anymore. -->
      </div>
    </div>

    <!-- Banner Cập nhật Phiên bản (Version Update Banner) - DƯỚI CÙNG -->
    <div id="markee-version-banner" style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px; padding: 6px 8px; background: #181825; border: 1px solid #c40009; border-radius: 6px; flex-shrink: 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px;">
        <span id="markee-version-current-text" style="color: #cbd5e1; font-weight: bold;">Phiên bản hiện tại: v...</span>
        <span id="markee-version-status-badge" style="font-size: 9px; color: #10b981; font-weight: bold; background: rgba(16, 185, 129, 0.15); padding: 1px 5px; border-radius: 4px;">Mới nhất</span>
      </div>
      <div id="markee-version-update-msg" style="font-size: 10px; color: #fbbf24; display: none; line-height: 1.3;">
        🚀 Có bản mới <strong id="markee-remote-version-tag">v1.3.2</strong> để tải và cập nhật.
      </div>
      <div style="display: flex; gap: 6px; margin-top: 2px;">
        <button id="markee-btn-check-version" type="button" style="flex: 1; padding: 4px 6px; background: transparent; border: 1px solid #e3000f; color: #ff3344; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer; transition: all 0.2s;">
          🔍 Kiểm tra
        </button>
        <button id="markee-btn-update-version" type="button" style="flex: 1; padding: 4px 6px; background: #f59e0b; border: none; color: #0f172a; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer; display: none; transition: all 0.2s;">
          ⚡ Cập nhật
        </button>
      </div>
    </div>
  `;
  const container = getOrCreateContainer();
  container.appendChild(widget);

  // KPI Prototype: dự án hiện tại là 1 lựa chọn thật, đổi được bất cứ lúc
  // nào — không còn bị khoá cứng theo lần tải extension nữa.
  const skillAttachLabel = document.getElementById("skill-attach-project-name");
  function syncSkillAttachLabel(name) {
    if (skillAttachLabel) skillAttachLabel.textContent = name || "(chưa chọn)";
  }
  wireProjectSearch(
    document.getElementById("wip-project-search-input"),
    document.getElementById("wip-project-search-results"),
    document.getElementById("wip-project-current-name"),
    (id, name) => syncSkillAttachLabel(name),
    "dark",
  );
  chrome.runtime.sendMessage({ action: "GET_SELECTED_PROJECT" }, (state) => {
    syncSkillAttachLabel(state && state.projectName);
  });

  const departmentSelect = document.getElementById("markee-department-select");
  const teamSelect = document.getElementById("markee-team-select");
  const assetTypeSelect = document.getElementById("markee-asset-type-select");
  const prjInputPush = document.getElementById("markee-project-input-push");
  const prjDropdownPush = document.getElementById("dropdown-options-push");
  const pullDepartmentSelect = document.getElementById("markee-pull-department");
  const pullTeamSelect = document.getElementById("markee-pull-team");
  const prjInputPull = document.getElementById("markee-pull-project");
  const prjDropdownPull = document.getElementById("dropdown-options-pull");
  const tabPush = document.getElementById("markee-tab-push");
  const tabPull = document.getElementById("markee-tab-pull");
  const panelPush = document.getElementById("markee-tab-push-panel");
  const panelPull = document.getElementById("markee-tab-pull-panel");

  function getSelectNumber(selectEl) {
    if (!selectEl) return null;
    const value = Number(selectEl.value);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function getPushProjectId() {
    if (!prjInputPush || !prjInputPush.value.trim()) {
      if (prjInputPush) prjInputPush.dataset.projectId = "";
      return null;
    }
    const projectId = Number(prjInputPush.dataset.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      prjInputPush.dataset.projectId = "";
      return null;
    }
    return projectId;
  }

  function getPullProjectId() {
    if (!prjInputPull || !prjInputPull.value.trim()) {
      if (prjInputPull) prjInputPull.dataset.projectId = "";
      return null;
    }
    const projectId = Number(prjInputPull.dataset.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      prjInputPull.dataset.projectId = "";
      return null;
    }
    return projectId;
  }

  function onPullFilterChange() {
    if (currentMode === "skill") {
      fetchAndRenderSkills();
      fetchAndRenderSummaries();
    } else {
      fetchAndRenderWipSummaries();
    }
  }

  function switchTab(tab) {
    const isPush = tab === "push";
    panelPush.style.display = isPush ? "flex" : "none";
    panelPull.style.display = isPush ? "none" : "flex";
    tabPush.style.background = isPush ? "#e3000f" : "#1a1a2e";
    tabPush.style.color = isPush ? "#fff" : "#ff3344";
    tabPush.style.border = isPush ? "none" : "1px solid #c40009";
    tabPull.style.background = isPush ? "#1a1a2e" : "#10b981";
    tabPull.style.color = isPush ? "#ff3344" : "#fff";
    tabPull.style.border = isPush ? "1px solid #c40009" : "none";

    // Auto-refresh khi chuyển Tab
    loadProjects();
    loadCustomers();
    if (!isPush) onPullFilterChange();
  }

  tabPush.onclick = () => switchTab("push");
  tabPull.onclick = () => switchTab("pull");

  function renderSelectOptions(selectEl, items, placeholder) {
    selectEl.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      selectEl.appendChild(option);
    });
  }

  function loadPushDepartments(selectedDepartmentId = null, selectedTeamId = null) {
    chrome.runtime.sendMessage({ action: "GET_DEPARTMENTS" }, (res) => {
      const departments = res && Array.isArray(res.departments) ? res.departments : [];
      renderSelectOptions(departmentSelect, departments, "-- Tất cả Phòng ban --");
      if (selectedDepartmentId) {
        departmentSelect.value = String(selectedDepartmentId);
        loadPushTeams(selectedDepartmentId, selectedTeamId);
      }
      renderPushSkillStepUI();
    });
  }

  function loadPushTeams(departmentId, selectedTeamId = null) {
    renderSelectOptions(teamSelect, [], "-- Tất cả Team --");
    teamSelect.disabled = !departmentId;
    if (!departmentId) {
      renderPushSkillStepUI();
      return;
    }
    chrome.runtime.sendMessage({ action: "GET_TEAMS", departmentId }, (res) => {
      const teams = res && Array.isArray(res.teams) ? res.teams : [];
      renderSelectOptions(teamSelect, teams, "-- Tất cả Team --");
      teamSelect.disabled = false;
      if (selectedTeamId) teamSelect.value = String(selectedTeamId);
      renderPushSkillStepUI();
    });
  }

  function loadPullDepartments(selectedDepartmentId = null, selectedTeamId = null) {
    chrome.runtime.sendMessage({ action: "GET_DEPARTMENTS" }, (res) => {
      const departments = res && Array.isArray(res.departments) ? res.departments : [];
      renderSelectOptions(pullDepartmentSelect, departments, "-- Tất cả Phòng ban --");
      if (selectedDepartmentId) {
        pullDepartmentSelect.value = String(selectedDepartmentId);
        loadPullTeams(selectedDepartmentId, selectedTeamId);
      }
    });
  }

  function loadPullTeams(departmentId, selectedTeamId = null) {
    renderSelectOptions(pullTeamSelect, [], "-- Tất cả Team --");
    pullTeamSelect.disabled = !departmentId;
    if (!departmentId) {
      onPullFilterChange();
      return;
    }
    chrome.runtime.sendMessage({ action: "GET_TEAMS", departmentId }, (res) => {
      const teams = res && Array.isArray(res.teams) ? res.teams : [];
      renderSelectOptions(pullTeamSelect, teams, "-- Tất cả Team --");
      pullTeamSelect.disabled = false;
      if (selectedTeamId) pullTeamSelect.value = String(selectedTeamId);
      onPullFilterChange();
    });
  }

  chrome.storage.local.get(["markee_department_id", "markee_team_id", "markee_asset_type", "markee_project_id", "markee_project_display", "markee_pull_department_id", "markee_pull_team_id", "markee_pull_project_id", "markee_pull_project_display"], (res) => {
    loadPushDepartments(res.markee_department_id || null, res.markee_team_id || null);
    loadPullDepartments(res.markee_pull_department_id || null, res.markee_pull_team_id || null);

    if (assetTypeSelect && res.markee_asset_type) assetTypeSelect.value = res.markee_asset_type;

    if (prjInputPush && res.markee_project_id && res.markee_project_display) {
      prjInputPush.value = res.markee_project_display;
      prjInputPush.dataset.projectId = String(res.markee_project_id);
    }

    if (prjInputPull && res.markee_pull_project_id && res.markee_pull_project_display) {
      prjInputPull.value = res.markee_pull_project_display;
      prjInputPull.dataset.projectId = String(res.markee_pull_project_id);
    }

    onPullFilterChange();
    renderPushSkillStepUI();
  });

  if (departmentSelect) {
    departmentSelect.addEventListener("change", (e) => {
      const departmentId = getSelectNumber(e.target);
      if (teamSelect) teamSelect.value = "";
      chrome.storage.local.set({ markee_department_id: departmentId, markee_team_id: null });
      loadPushTeams(departmentId, null);
    });
  }

  if (teamSelect) {
    teamSelect.addEventListener("change", (e) => {
      chrome.storage.local.set({ markee_team_id: getSelectNumber(e.target) });
    });
  }

  if (pullDepartmentSelect) {
    pullDepartmentSelect.addEventListener("change", (e) => {
      const departmentId = getSelectNumber(e.target);
      if (pullTeamSelect) pullTeamSelect.value = "";
      chrome.storage.local.set({ markee_pull_department_id: departmentId, markee_pull_team_id: null });
      loadPullTeams(departmentId, null);
    });
  }

  if (pullTeamSelect) {
    pullTeamSelect.addEventListener("change", (e) => {
      chrome.storage.local.set({ markee_pull_team_id: getSelectNumber(e.target) });
      onPullFilterChange();
    });
  }

  if (assetTypeSelect) {
    assetTypeSelect.addEventListener("change", (e) => {
      chrome.storage.local.set({ markee_asset_type: e.target.value });
    });
  }

  if (prjInputPush && prjDropdownPush) {
    prjInputPush.onclick = () => {
      renderPushOptions(allProjects);
      prjDropdownPush.style.display = "block";
      prjInputPush.select();
    };
    prjInputPush.oninput = (e) => {
      const key = e.target.value.toLowerCase().trim();
      prjInputPush.dataset.projectId = "";
      chrome.storage.local.set({ markee_project_id: null, markee_project_display: "" });
      renderPushOptions(allProjects.filter((p) => p.name.toLowerCase().includes(key)));
      prjDropdownPush.style.display = "block";
    };
  }

  if (prjInputPull && prjDropdownPull) {
    prjInputPull.onclick = () => {
      renderPullOptions(allProjects);
      prjDropdownPull.style.display = "block";
      prjInputPull.select();
    };
    prjInputPull.oninput = (e) => {
      const key = e.target.value.toLowerCase().trim();
      prjInputPull.dataset.projectId = "";
      chrome.storage.local.set({ markee_pull_project_id: null, markee_pull_project_display: "" });
      onPullFilterChange();
      renderPullOptions(allProjects.filter((p) => p.name.toLowerCase().includes(key)));
      prjDropdownPull.style.display = "block";
    };
  }

  document.addEventListener("click", (e) => {
    if (prjDropdownPull && prjDropdownPull.style && !e.target.closest("#markee-pull-project") && !e.target.closest("#dropdown-options-pull")) {
      prjDropdownPull.style.display = "none";
    }
    if (prjDropdownPush && prjDropdownPush.style && !e.target.closest("#markee-project-input-push") && !e.target.closest("#dropdown-options-push")) {
      prjDropdownPush.style.display = "none";
    }
  });

  function loadProjects() {
    chrome.runtime.sendMessage({ action: "GET_PROJECTS" }, (res) => {
      if (res && res.projects) {
        allProjects = res.projects.filter((p) => p.type === "WIP_GLOBAL").sort((a, b) => b.id - a.id);
      }
    });
  }
  loadProjects();

  function fetchAndRenderSummaries() {
    const list = document.getElementById("markee-summary-list");
    if (!list) return;
    const projectId = getPullProjectId();
    if (!projectId) {
      list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center;">Chọn dự án để xem Kho Tri Thức</div>`;
      return;
    }
    list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center;">Đang tải...</div>`;
    chrome.runtime.sendMessage({ action: "GET_SUMMARIES", projectId }, (res) => {
      list.innerHTML = "";
      const summaries = res && Array.isArray(res.summaries) ? res.summaries : [];
      if (summaries.length > 0) {
        summaries.forEach((s) => {
          const row = document.createElement("div");
          row.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: #1a1a2e; padding: 6px; border-radius: 4px; border: 1px solid #232340;";
          row.innerHTML = `<span style="font-size: 11px; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">🧠 ${s.title || "Không tiêu đề"}</span>`;

          const btn = document.createElement("button");
          btn.innerText = "Dùng";
          btn.style.cssText = "background: #e3000f; color: #fff; border: none; border-radius: 4px; font-size: 9px; padding: 4px 8px; cursor: pointer;";

          // ĐÃ SỬA LOGIC ONCLICK Ở ĐÂY
          btn.onclick = () => {
            let contentToInsert = "";

            // Nếu dữ liệu có mảng insights, tự động map và nối chuỗi
            if (s.insights && Array.isArray(s.insights)) {
              contentToInsert = s.insights.map((item) => "• " + item).join("\n\n");
            } else {
              // Dự phòng cho các key khác nếu có
              contentToInsert = s.content || s.markdown_content || s.summary || s.text;
            }

            if (!contentToInsert) {
              console.log("🔴 [ERROR]", "[Markee] Không tìm thấy nội dung hợp lệ trong item:", s);
              insertSkillToChat("LỖI DỮ LIỆU: " + JSON.stringify(s));
            } else {
              insertSkillToChat(contentToInsert);
            }
          };

          row.appendChild(btn);
          list.appendChild(row);
        });
      } else {
        list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center;">Chưa có dữ liệu</div>`;
      }
    });
  }

  let selectedDeptIds = [];
  let selectedTeamIds = [];
  let selectedProjectIds = [];
  let selectedDeptItems = [];
  let selectedTeamItems = [];
  let selectedProjectItems = [];
  let currentChipFilter = "all"; // "favorite" | "all" | "recent"
  let userFavoriteSkillIds = new Set();

  function updateFilterBadge(badgeId, count) {
    const badge = document.getElementById(badgeId);
    if (!badge) return;
    badge.innerText = String(count);
    if (count > 0) {
      badge.style.background = "#10b981";
      badge.style.color = "#0f172a";
    } else {
      badge.style.background = "#c40009";
      badge.style.color = "#ff3344";
    }
  }

  function updateSkillPullFilterButtonUI(btnId, badgeId, selectedItems, defaultText, iconEmoji) {
    const btn = document.getElementById(btnId);
    const badge = document.getElementById(badgeId);
    if (!btn) return;

    const count = Array.isArray(selectedItems) ? selectedItems.length : 0;

    let textSpan = btn.querySelector(".markee-filter-btn-text");
    if (!textSpan) {
      textSpan = btn.querySelector("span:not(#" + badgeId + ")");
      if (textSpan) textSpan.classList.add("markee-filter-btn-text");
    }

    let labelText = `${iconEmoji} ${defaultText}`;
    if (count === 1 && selectedItems[0] && selectedItems[0].name) {
      labelText = `${iconEmoji} ${selectedItems[0].name}`;
    } else if (count > 1 && selectedItems[0] && selectedItems[0].name) {
      labelText = `${iconEmoji} ${selectedItems[0].name} +${count - 1}`;
    }

    if (textSpan) {
      textSpan.innerText = labelText;
      textSpan.title = count > 0 ? selectedItems.map((i) => i.name).filter(Boolean).join(", ") : defaultText;
      if (count > 0) {
        textSpan.style.color = "#f8fafc";
        textSpan.style.fontWeight = "400";
      } else {
        textSpan.style.color = "#94a3b8";
        textSpan.style.fontWeight = "400";
      }
    }

    if (badge) {
      badge.innerText = String(count);
      if (count > 0) {
        badge.style.background = "#10b981";
        badge.style.color = "#0f172a";
      } else {
        badge.style.background = "#c40009";
        badge.style.color = "#ff3344";
      }
    }
  }

  function openMultiSelectModal({ title, items, selectedIds, onConfirm }) {
    let modalContainer = document.getElementById("markee-multiselect-container");
    if (!modalContainer) {
      modalContainer = document.createElement("div");
      modalContainer.id = "markee-multiselect-container";
      Object.assign(modalContainer.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        right: "0px",
        bottom: "0px",
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(2px)",
        borderRadius: "12px",
        zIndex: "1000001",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px",
        boxSizing: "border-box",
      });
      const widget = document.getElementById("markee-widget");
      if (widget) widget.appendChild(modalContainer);
    }

    let tempSelected = new Set((selectedIds || []).map((id) => String(id)));
    let currentFilteredItems = [];
    const isProjectModal = Boolean(title && title.includes("Dự án"));
    let activeModalTab = "all"; // 'all' or 'favorite'
    let favoriteProjectIdsSet = new Set();
    let favoriteProjectsList = [];

    // 1. Tạo Khung HTML Cố Định MỘT LẦN DUY NHẤT khi mở Modal
    modalContainer.innerHTML = `
      <div style="width: 92%; max-height: 380px; background: #161625; border: 1px solid #c40009; border-radius: 12px; display: flex; flex-direction: column; padding: 12px; box-sizing: border-box; box-shadow: 0 10px 30px rgba(0,0,0,0.8);">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #27273a;">
          <span style="font-weight: bold; font-size: 13px; color: #fff;">${title}</span>
          <span id="markee-modal-close" style="cursor: pointer; color: #94a3b8; font-size: 16px; padding: 2px; line-height: 1;">✕</span>
        </div>

        ${
          isProjectModal
            ? `
        <!-- Chips Bộ Lọc Cho Modal Chọn Dự Án (Đồng bộ Tab Download) -->
        <div id="markee-modal-chips-container" style="display: flex; gap: 6px; margin-bottom: 8px;">
          <button type="button" class="markee-chip-btn active" id="markee-modal-tab-all" style="flex: 1; background: #e3000f; border: 1px solid #e3000f; color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: center;">📁 Tất cả</button>
          <button type="button" class="markee-chip-btn markee-chip-fav" id="markee-modal-tab-fav" style="flex: 1; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: center;">⭐ Ưu thích</button>
        </div>
        `
            : ""
        }

        <!-- Search Bar -->
        <div style="position: relative; margin-bottom: 8px;">
          <input type="text" id="markee-modal-search" placeholder="Tìm nhanh theo tên hoặc mã..." style="width: 100%; padding: 6px 10px; background: #1a1a2e; color: #fff; border: 1px solid #c40009; border-radius: 6px; font-size: 11px; outline: none; box-sizing: border-box;">
        </div>

        <!-- Sub-header Row: Result Count & Select All -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 0 2px;">
          <span id="markee-modal-count-text" style="font-size: 10px; color: #94a3b8;">0 kết quả</span>
          <span id="markee-modal-select-all" style="font-size: 10px; color: #ff3344; font-weight: 500; cursor: pointer; user-select: none;">Chọn tất cả</span>
        </div>

        <!-- Item List Container -->
        <div id="markee-modal-list" style="flex: 1; min-height: 90px; max-height: 210px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 2px;">
        </div>

        <!-- Footer Action Buttons -->
        <div style="display: flex; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #27273a;">
          <button id="markee-modal-cancel" style="flex: 1; background: transparent; border: 1px solid #475569; color: #94a3b8; padding: 8px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; transition: all 0.2s;">Hủy</button>
          <button id="markee-modal-apply" style="flex: 1.5; background: #e3000f; border: none; color: #fff; padding: 8px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; transition: all 0.2s;">Áp dụng lựa chọn</button>
        </div>
      </div>
    `;

    modalContainer.style.display = "flex";

    const listContainer = modalContainer.querySelector("#markee-modal-list");
    const countTextEl = modalContainer.querySelector("#markee-modal-count-text");
    const applyBtn = modalContainer.querySelector("#markee-modal-apply");
    const searchInput = modalContainer.querySelector("#markee-modal-search");

    const updateApplyBtnText = () => {
      if (applyBtn) {
        applyBtn.innerText = `Áp dụng lựa chọn ${tempSelected.size > 0 ? `(${tempSelected.size})` : ""}`;
      }
    };

    const updateListOnly = (filterText = "") => {
      const sourceItems = isProjectModal && activeModalTab === "favorite" ? favoriteProjectsList : items;
      currentFilteredItems = sourceItems.filter((item) => {
        if (!filterText) return true;
        const searchKw = filterText.toLowerCase();
        const custName = item.customer_name || item.customerName || (item.customer && item.customer.name) || (item.customers && (item.customers.name || (Array.isArray(item.customers) && item.customers[0] && item.customers[0].name))) || "";
        return String(item.name || "").toLowerCase().includes(searchKw) || String(custName).toLowerCase().includes(searchKw);
      });

      if (countTextEl) {
        countTextEl.innerText = `${currentFilteredItems.length} kết quả`;
      }

      if (listContainer) {
        if (currentFilteredItems.length > 0) {
          listContainer.innerHTML = currentFilteredItems
            .map((item) => {
              const itemStrId = String(item.id);
              const isChecked = tempSelected.has(itemStrId);
              const custName = item.customer_name || item.customerName || (item.customer && item.customer.name) || (item.customers && (item.customers.name || (Array.isArray(item.customers) && item.customers[0] && item.customers[0].name))) || "";
              const subText = custName ? `Khách hàng: ${custName}` : (item.status || item.code || "");
              const isFav = favoriteProjectIdsSet.has(itemStrId);
              return `
                <label style="display: flex; align-items: center; gap: 8px; background: #1a1a2e; padding: 6px 10px; border-radius: 6px; border: 1px solid ${isChecked ? "#e3000f" : "#27273a"}; cursor: pointer; user-select: none; transition: border-color 0.15s;">
                  <input type="checkbox" class="markee-modal-checkbox" value="${item.id}" ${isChecked ? "checked" : ""} style="accent-color: #e3000f; cursor: pointer; width: 14px; height: 14px;">
                  <div style="display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 2px;">
                    <span style="font-size: 11px; color: ${isChecked ? "#fff" : "#e2e8f0"}; font-weight: 400 !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</span>
                    ${subText ? `<span style="font-size: 10px; color: #94a3b8; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${subText}</span>` : ""}
                  </div>
                  ${
                    isProjectModal
                      ? `<button type="button" class="markee-project-fav-btn" data-project-id="${item.id}" title="${isFav ? "Bỏ ưu thích" : "Thêm vào Ưu thích"}" style="background: none; border: none; font-size: 14px; color: ${isFav ? "#f59e0b" : "#64748b"}; cursor: pointer; padding: 2px; line-height: 1; transition: transform 0.15s; flex-shrink: 0;">${isFav ? "⭐" : "☆"}</button>`
                      : ""
                  }
                </label>
              `;
            })
            .join("");

          const checkboxes = listContainer.querySelectorAll(".markee-modal-checkbox");
          checkboxes.forEach((cb) => {
            cb.onchange = (e) => {
              const idStr = String(e.target.value);
              const label = cb.closest("label");
              if (e.target.checked) {
                tempSelected.add(idStr);
                if (label) label.style.borderColor = "#e3000f";
              } else {
                tempSelected.delete(idStr);
                if (label) label.style.borderColor = "#27273a";
              }
              updateApplyBtnText();
            };
          });

          if (isProjectModal) {
            const favBtns = listContainer.querySelectorAll(".markee-project-fav-btn");
            favBtns.forEach((btn) => {
              btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const prjId = Number(btn.dataset.projectId);
                const currentFav = favoriteProjectIdsSet.has(String(prjId));
                chrome.runtime.sendMessage(
                  { action: "TOGGLE_FAVORITE_PROJECT", projectId: prjId, isFavorite: currentFav },
                  (res) => {
                    if (res && res.success) {
                      if (res.isFavorite) {
                        favoriteProjectIdsSet.add(String(prjId));
                        showToast("⭐ Đã thêm vào Ưu thích!", "success");
                      } else {
                        favoriteProjectIdsSet.delete(String(prjId));
                        showToast("Đã bỏ khỏi Ưu thích", "info");
                      }
                      refreshQuickFavoriteProjectsUI();
                      if (activeModalTab === "favorite") {
                        chrome.runtime.sendMessage({ action: "GET_FAVORITE_PROJECTS" }, (resFav) => {
                          favoriteProjectsList = resFav && Array.isArray(resFav.projects) ? resFav.projects : [];
                          updateListOnly(searchInput ? searchInput.value : "");
                        });
                      } else {
                        updateListOnly(searchInput ? searchInput.value : "");
                      }
                    }
                  }
                );
              };
            });
          }
        } else {
          listContainer.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center; padding: 16px;">Không tìm thấy dữ liệu</div>`;
        }
      }

      updateApplyBtnText();
    };

    if (isProjectModal) {
      chrome.runtime.sendMessage({ action: "GET_FAVORITE_PROJECT_IDS" }, (res) => {
        if (res && Array.isArray(res.favoriteProjectIds)) {
          favoriteProjectIdsSet = new Set(res.favoriteProjectIds.map((id) => String(id)));
        }
        updateListOnly(searchInput ? searchInput.value : "");
      });

      const tabAll = modalContainer.querySelector("#markee-modal-tab-all");
      const tabFav = modalContainer.querySelector("#markee-modal-tab-fav");

      if (tabAll && tabFav) {
        tabAll.onclick = () => {
          activeModalTab = "all";
          tabAll.className = "markee-chip-btn active";
          tabAll.style.background = "#e3000f";
          tabAll.style.borderColor = "#e3000f";
          tabAll.style.color = "#fff";

          tabFav.className = "markee-chip-btn markee-chip-fav";
          tabFav.style.background = "rgba(245, 158, 11, 0.08)";
          tabFav.style.borderColor = "rgba(245, 158, 11, 0.3)";
          tabFav.style.color = "#f59e0b";
          updateListOnly(searchInput ? searchInput.value : "");
        };

        tabFav.onclick = () => {
          activeModalTab = "favorite";
          tabFav.className = "markee-chip-btn markee-chip-fav active";
          tabFav.style.background = "#f59e0b";
          tabFav.style.borderColor = "#f59e0b";
          tabFav.style.color = "#fff";

          tabAll.className = "markee-chip-btn";
          tabAll.style.background = "#1a1a2e";
          tabAll.style.borderColor = "#c40009";
          tabAll.style.color = "#ff3344";
          chrome.runtime.sendMessage({ action: "GET_FAVORITE_PROJECTS" }, (resFav) => {
            favoriteProjectsList = resFav && Array.isArray(resFav.projects) ? resFav.projects : [];
            updateListOnly(searchInput ? searchInput.value : "");
          });
        };
      }
    }

    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
      searchInput.oninput = (e) => {
        updateListOnly(e.target.value);
      };
    }

    const selectAllBtn = modalContainer.querySelector("#markee-modal-select-all");
    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        currentFilteredItems.forEach((item) => tempSelected.add(String(item.id)));
        updateListOnly(searchInput ? searchInput.value : "");
      };
    }

    const closeBtn = modalContainer.querySelector("#markee-modal-close");
    if (closeBtn) closeBtn.onclick = () => (modalContainer.style.display = "none");

    const cancelBtn = modalContainer.querySelector("#markee-modal-cancel");
    if (cancelBtn) cancelBtn.onclick = () => (modalContainer.style.display = "none");

    if (applyBtn) {
      applyBtn.onclick = () => {
        modalContainer.style.display = "none";
        if (typeof onConfirm === "function") {
          const sourceItems = isProjectModal && activeModalTab === "favorite" ? favoriteProjectsList : items;
          const selectedItems = sourceItems.filter((i) => tempSelected.has(String(i.id)));
          const selectedOriginalIds = selectedItems.map((i) => i.id);
          onConfirm(selectedOriginalIds, selectedItems);
        }
      };
    }

    updateListOnly("");
  }

  function openSingleSelectModal({ title, items, selectedId, onConfirm }) {
    let modalContainer = document.getElementById("markee-multiselect-container");
    if (!modalContainer) {
      modalContainer = document.createElement("div");
      modalContainer.id = "markee-multiselect-container";
      Object.assign(modalContainer.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        right: "0px",
        bottom: "0px",
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(2px)",
        borderRadius: "12px",
        zIndex: "1000001",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px",
        boxSizing: "border-box",
      });
      const widget = document.getElementById("markee-widget");
      if (widget) widget.appendChild(modalContainer);
    }

    let tempSelectedId = selectedId !== undefined && selectedId !== null ? String(selectedId) : null;
    let currentFilteredItems = [];
    const isProjectModal = Boolean(title && title.includes("Dự án"));
    let activeModalTab = "all"; // 'all' or 'favorite'
    let favoriteProjectIdsSet = new Set();
    let favoriteProjectsList = [];

    // 1. Tạo Khung HTML Cố Định MỘT LẦN DUY NHẤT khi mở Modal
    modalContainer.innerHTML = `
      <div style="width: 92%; max-height: 380px; background: #161625; border: 1px solid #c40009; border-radius: 12px; display: flex; flex-direction: column; padding: 12px; box-sizing: border-box; box-shadow: 0 10px 30px rgba(0,0,0,0.8);">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #27273a;">
          <span style="font-weight: bold; font-size: 13px; color: #fff;">${title}</span>
          <span id="markee-modal-close" style="cursor: pointer; color: #94a3b8; font-size: 16px; padding: 2px; line-height: 1;">✕</span>
        </div>

        ${
          isProjectModal
            ? `
        <!-- Chips Bộ Lọc Cho Modal Chọn Dự Án (Đồng bộ Tab Download) -->
        <div id="markee-modal-chips-container" style="display: flex; gap: 6px; margin-bottom: 8px;">
          <button type="button" class="markee-chip-btn active" id="markee-modal-tab-all" style="flex: 1; background: #e3000f; border: 1px solid #e3000f; color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: center;">📁 Tất cả</button>
          <button type="button" class="markee-chip-btn markee-chip-fav" id="markee-modal-tab-fav" style="flex: 1; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 500; cursor: pointer; transition: all 0.2s; text-align: center;">⭐ Ưu thích</button>
        </div>
        `
            : ""
        }

        <!-- Search Bar -->
        <div style="position: relative; margin-bottom: 8px;">
          <input type="text" id="markee-modal-search" placeholder="Tìm nhanh theo tên hoặc mã..." style="width: 100%; padding: 6px 10px; background: #1a1a2e; color: #fff; border: 1px solid #c40009; border-radius: 6px; font-size: 11px; outline: none; box-sizing: border-box;">
        </div>

        <!-- Sub-header Row: Result Count -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 0 2px;">
          <span id="markee-modal-count-text" style="font-size: 10px; color: #94a3b8;">0 kết quả</span>
        </div>

        <!-- Item List Container -->
        <div id="markee-modal-list" style="flex: 1; min-height: 90px; max-height: 210px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 2px;">
        </div>

        <!-- Footer Action Buttons -->
        <div style="display: flex; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #27273a;">
          <button id="markee-modal-cancel" style="flex: 1; background: transparent; border: 1px solid #475569; color: #94a3b8; padding: 8px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; transition: all 0.2s;">Hủy</button>
          <button id="markee-modal-apply" style="flex: 1.5; background: #e3000f; border: none; color: #fff; padding: 8px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; transition: all 0.2s;">Áp dụng lựa chọn</button>
        </div>
      </div>
    `;

    modalContainer.style.display = "flex";

    const listContainer = modalContainer.querySelector("#markee-modal-list");
    const countTextEl = modalContainer.querySelector("#markee-modal-count-text");
    const applyBtn = modalContainer.querySelector("#markee-modal-apply");
    const searchInput = modalContainer.querySelector("#markee-modal-search");

    const updateListOnly = (filterText = "") => {
      const sourceItems = isProjectModal && activeModalTab === "favorite" ? favoriteProjectsList : items;
      currentFilteredItems = sourceItems.filter((item) => {
        if (!filterText) return true;
        const searchKw = filterText.toLowerCase();
        const custName = item.customer_name || item.customerName || (item.customer && item.customer.name) || (item.customers && (item.customers.name || (Array.isArray(item.customers) && item.customers[0] && item.customers[0].name))) || "";
        return String(item.name || "").toLowerCase().includes(searchKw) || String(custName).toLowerCase().includes(searchKw);
      });

      if (countTextEl) {
        countTextEl.innerText = `${currentFilteredItems.length} kết quả`;
      }

      if (listContainer) {
        if (currentFilteredItems.length > 0) {
          listContainer.innerHTML = currentFilteredItems
            .map((item) => {
              const itemStrId = String(item.id);
              const isChecked = tempSelectedId !== null && itemStrId === String(tempSelectedId);
              const custName = item.customer_name || item.customerName || (item.customer && item.customer.name) || (item.customers && (item.customers.name || (Array.isArray(item.customers) && item.customers[0] && item.customers[0].name))) || "";
              const subText = custName ? `Khách hàng: ${custName}` : (item.status || item.code || "");
              const isFav = favoriteProjectIdsSet.has(itemStrId);
              return `
                <label style="display: flex; align-items: center; gap: 8px; background: #1a1a2e; padding: 6px 10px; border-radius: 6px; border: 1px solid ${isChecked ? "#e3000f" : "#27273a"}; cursor: pointer; user-select: none; transition: border-color 0.15s;">
                  <input type="radio" name="markee-single-radio" class="markee-modal-radio" value="${item.id}" ${isChecked ? "checked" : ""} style="accent-color: #e3000f; cursor: pointer; width: 14px; height: 14px;">
                  <div style="display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 2px;">
                    <span style="font-size: 11px; color: ${isChecked ? "#fff" : "#e2e8f0"}; font-weight: 400 !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</span>
                    ${subText ? `<span style="font-size: 10px; color: #94a3b8; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${subText}</span>` : ""}
                  </div>
                  ${
                    isProjectModal
                      ? `<button type="button" class="markee-project-fav-btn" data-project-id="${item.id}" title="${isFav ? "Bỏ ưu thích" : "Thêm vào Ưu thích"}" style="background: none; border: none; font-size: 14px; color: ${isFav ? "#f59e0b" : "#64748b"}; cursor: pointer; padding: 2px; line-height: 1; transition: transform 0.15s; flex-shrink: 0;">${isFav ? "⭐" : "☆"}</button>`
                      : ""
                  }
                </label>
              `;
            })
            .join("");

          const radios = listContainer.querySelectorAll(".markee-modal-radio");
          radios.forEach((r) => {
            r.onchange = (e) => {
              tempSelectedId = String(e.target.value);
              const labels = listContainer.querySelectorAll("label");
              labels.forEach((lbl) => (lbl.style.borderColor = "#27273a"));
              const activeLabel = r.closest("label");
              if (activeLabel) activeLabel.style.borderColor = "#e3000f";
            };
          });

          if (isProjectModal) {
            const favBtns = listContainer.querySelectorAll(".markee-project-fav-btn");
            favBtns.forEach((btn) => {
              btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const prjId = Number(btn.dataset.projectId);
                const currentFav = favoriteProjectIdsSet.has(String(prjId));
                chrome.runtime.sendMessage(
                  { action: "TOGGLE_FAVORITE_PROJECT", projectId: prjId, isFavorite: currentFav },
                  (res) => {
                    if (res && res.success) {
                      if (res.isFavorite) {
                        favoriteProjectIdsSet.add(String(prjId));
                        showToast("⭐ Đã thêm vào Ưu thích!", "success");
                      } else {
                        favoriteProjectIdsSet.delete(String(prjId));
                        showToast("Đã bỏ khỏi Ưu thích", "info");
                      }
                      refreshQuickFavoriteProjectsUI();
                      if (activeModalTab === "favorite") {
                        chrome.runtime.sendMessage({ action: "GET_FAVORITE_PROJECTS" }, (resFav) => {
                          favoriteProjectsList = resFav && Array.isArray(resFav.projects) ? resFav.projects : [];
                          updateListOnly(searchInput ? searchInput.value : "");
                        });
                      } else {
                        updateListOnly(searchInput ? searchInput.value : "");
                      }
                    }
                  }
                );
              };
            });
          }
        } else {
          listContainer.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center; padding: 16px;">Không tìm thấy dữ liệu</div>`;
        }
      }
    };

    if (isProjectModal) {
      chrome.runtime.sendMessage({ action: "GET_FAVORITE_PROJECT_IDS" }, (res) => {
        if (res && Array.isArray(res.favoriteProjectIds)) {
          favoriteProjectIdsSet = new Set(res.favoriteProjectIds.map((id) => String(id)));
        }
        updateListOnly(searchInput ? searchInput.value : "");
      });

      const tabAll = modalContainer.querySelector("#markee-modal-tab-all");
      const tabFav = modalContainer.querySelector("#markee-modal-tab-fav");

      if (tabAll && tabFav) {
        tabAll.onclick = () => {
          activeModalTab = "all";
          tabAll.className = "markee-chip-btn active";
          tabAll.style.background = "#e3000f";
          tabAll.style.borderColor = "#e3000f";
          tabAll.style.color = "#fff";

          tabFav.className = "markee-chip-btn markee-chip-fav";
          tabFav.style.background = "rgba(245, 158, 11, 0.08)";
          tabFav.style.borderColor = "rgba(245, 158, 11, 0.3)";
          tabFav.style.color = "#f59e0b";
          updateListOnly(searchInput ? searchInput.value : "");
        };

        tabFav.onclick = () => {
          activeModalTab = "favorite";
          tabFav.className = "markee-chip-btn markee-chip-fav active";
          tabFav.style.background = "#f59e0b";
          tabFav.style.borderColor = "#f59e0b";
          tabFav.style.color = "#fff";

          tabAll.className = "markee-chip-btn";
          tabAll.style.background = "#1a1a2e";
          tabAll.style.borderColor = "#c40009";
          tabAll.style.color = "#ff3344";
          chrome.runtime.sendMessage({ action: "GET_FAVORITE_PROJECTS" }, (resFav) => {
            favoriteProjectsList = resFav && Array.isArray(resFav.projects) ? resFav.projects : [];
            updateListOnly(searchInput ? searchInput.value : "");
          });
        };
      }
    }

    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
      searchInput.oninput = (e) => {
        updateListOnly(e.target.value);
      };
    }

    const closeBtn = modalContainer.querySelector("#markee-modal-close");
    if (closeBtn) closeBtn.onclick = () => (modalContainer.style.display = "none");

    const cancelBtn = modalContainer.querySelector("#markee-modal-cancel");
    if (cancelBtn) cancelBtn.onclick = () => (modalContainer.style.display = "none");

    if (applyBtn) {
      applyBtn.onclick = () => {
        modalContainer.style.display = "none";
        if (typeof onConfirm === "function") {
          const sourceItems = isProjectModal && activeModalTab === "favorite" ? favoriteProjectsList : items;
          const selectedItem = sourceItems.find((i) => String(i.id) === String(tempSelectedId));
          const confirmedId = selectedItem ? selectedItem.id : tempSelectedId;
          onConfirm(confirmedId, selectedItem);
        }
      };
    }

    updateListOnly("");
  }

  function fetchAndRenderSkills() {
    const list = document.getElementById("markee-skill-list");
    if (!list) return;

    list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center;">Đang tải...</div>`;

    const searchInput = document.getElementById("markee-skill-search-input");
    const keyword = searchInput ? searchInput.value.trim() : "";

    const payload = {
      action: "GET_SKILLS",
      skillType: "skill",
      departmentIds: selectedDeptIds,
      teamIds: selectedTeamIds,
      projectIds: selectedProjectIds,
      keyword: keyword,
      filterType: currentChipFilter,
      userId: currentUser,
    };

    if (currentChipFilter === "favorite") {
      payload.skillIds = Array.from(userFavoriteSkillIds);
    }

    chrome.runtime.sendMessage(payload, (res) => {
      list.innerHTML = "";
      if (res && Array.isArray(res.favoriteSkillIds)) {
        userFavoriteSkillIds = new Set(res.favoriteSkillIds);
      }

      const skills = res && Array.isArray(res.skills) ? res.skills : [];

      if (skills.length > 0) {
        skills.forEach((s) => {
          const item = document.createElement("div");
          item.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: #1a1a2e; padding: 8px 10px; border-radius: 6px; border: 1px solid #27273a; margin-bottom: 6px; transition: border-color 0.2s;";
          item.onmouseover = () => (item.style.borderColor = "#e3000f");
          item.onmouseout = () => (item.style.borderColor = "#27273a");

          const titleText = s.title || "Kỹ năng";
          const icon = titleText.startsWith("WIP") ? "⏳" : "⚡";
          const isFav = s.is_favorite || userFavoriteSkillIds.has(s.id);

          item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
              <span style="font-size: 13px; flex-shrink: 0;">${icon}</span>
              <span style="font-size: 11px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${titleText}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
              <button class="markee-use-skill-btn" style="background: #e3000f; color: #fff; border: none; border-radius: 4px; font-size: 9px; font-weight: bold; padding: 4px 10px; cursor: pointer; transition: background 0.2s;">Dùng</button>
              <span class="markee-skill-fav-btn" title="${isFav ? "Bỏ yêu thích" : "Đánh dấu yêu thích"}" style="cursor: pointer; font-size: 14px; color: ${isFav ? "#fbbf24" : "#64748b"}; transition: transform 0.15s, color 0.15s; user-select: none;">${isFav ? "⭐" : "☆"}</span>
            </div>
          `;

          const useBtn = item.querySelector(".markee-use-skill-btn");
          if (useBtn) {
            useBtn.onclick = () => {
              insertSkillToChat(s.markdown_content);
              chrome.runtime.sendMessage({ action: "SAVE_RECENT_SKILL", skillId: s.id, userId: currentUser });
            };
          }

          const favBtn = item.querySelector(".markee-skill-fav-btn");
          if (favBtn) {
            favBtn.onclick = (e) => {
              e.stopPropagation();

              // Chờ phản hồi API mới đổi UI
              favBtn.style.pointerEvents = "none";
              favBtn.style.opacity = "0.5";

              chrome.runtime.sendMessage({ action: "TOGGLE_FAVORITE_SKILL", skillId: s.id, userId: currentUser }, (response) => {
                favBtn.style.pointerEvents = "auto";
                favBtn.style.opacity = "1";

                if (response && response.success) {
                  if (response.isFavorite) {
                    userFavoriteSkillIds.add(s.id);
                    s.is_favorite = true;
                    favBtn.innerText = "⭐";
                    favBtn.style.color = "#fbbf24";
                    favBtn.title = "Bỏ yêu thích";
                    showToast("⭐ Đã thêm vào kỹ năng yêu thích!");
                  } else {
                    userFavoriteSkillIds.delete(s.id);
                    s.is_favorite = false;
                    favBtn.innerText = "☆";
                    favBtn.style.color = "#64748b";
                    favBtn.title = "Đánh dấu yêu thích";
                    showToast("❌ Đã xóa khỏi kỹ năng yêu thích");

                    if (currentChipFilter === "favorite") {
                      item.remove();
                      if (list.children.length === 0) {
                        list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center; padding: 12px;">Chưa có kỹ năng yêu thích nào</div>`;
                      }
                    }
                  }
                } else {
                  showToast("⚠️ Lỗi kết nối máy chủ, chưa cập nhật được trạng thái!");
                }
              });
            };
          }

          list.appendChild(item);
        });
      } else {
        if (currentChipFilter === "favorite") {
          list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center; padding: 12px;">Chưa có kỹ năng yêu thích nào</div>`;
        } else {
          list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center; padding: 12px;">Chưa có dữ liệu</div>`;
        }
      }
    });
  }
  document.getElementById("markee-close-btn").onclick = () => {
    widget.style.display = "none";
    applyPositions();
  };

  // Thiết lập tính năng kéo thả trên thanh tiêu đề của Widget
  const header = widget.querySelector("#markee-widget-header");
  if (header) {
    let isDraggingWidget = false;
    let startWidgetX = 0;
    let startWidgetY = 0;
    let startWidgetXPos = 0;
    let startWidgetYPos = 0;

    const onWidgetMouseDown = (e) => {
      if (e.target.closest("#markee-close-btn")) return;
      if (e.button !== 0) return; // Chỉ chuột trái

      isDraggingWidget = true;
      startWidgetX = e.clientX;
      startWidgetY = e.clientY;
      const pos = getStoredPosition();
      startWidgetXPos = pos.x;
      startWidgetYPos = pos.y;

      header.style.cursor = "grabbing";
      document.addEventListener("mousemove", onWidgetMouseMove);
      document.addEventListener("mouseup", onWidgetMouseUp);
      e.preventDefault();
    };

    const onWidgetMouseMove = (e) => {
      if (!isDraggingWidget) return;
      const dx = e.clientX - startWidgetX;
      const dy = e.clientY - startWidgetY;
      const newX = startWidgetXPos + dx;
      const newY = startWidgetYPos + dy;

      // Khi Panel mở, Panel rộng 450px, dịch sang trái 420px, lên trên 570px
      let minX = 420;
      const maxX = window.innerWidth - 30;
      let minY = 570;
      const maxY = window.innerHeight - 30;

      if (minX > maxX) minX = 0;
      if (minY > maxY) minY = 0;

      const clampedX = Math.max(minX, Math.min(newX, maxX));
      const clampedY = Math.max(minY, Math.min(newY, maxY));

      const container = getOrCreateContainer();
      container.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
    };

    const onWidgetMouseUp = (e) => {
      if (!isDraggingWidget) return;
      isDraggingWidget = false;
      header.style.cursor = "grab";
      document.removeEventListener("mousemove", onWidgetMouseMove);
      document.removeEventListener("mouseup", onWidgetMouseUp);

      const dx = e.clientX - startWidgetX;
      const dy = e.clientY - startWidgetY;
      const finalX = startWidgetXPos + dx;
      const finalY = startWidgetYPos + dy;
      setStoredPosition(finalX, finalY);
      applyPositions();
    };

    header.addEventListener("mousedown", onWidgetMouseDown);
  }

  // --- CHẾ ĐỘ HOẠT ĐỘNG (MODES) & DỮ LIỆU ĐỘNG ---
  let allCustomers = [];

  function updateModeVisibility() {
    const isSkill = currentMode === "skill";

    // Cập nhật giao diện nút tab Mode
    const btnSkill = document.getElementById("markee-mode-skill");
    const btnWip = document.getElementById("markee-mode-wip");
    if (btnSkill && btnWip) {
      if (isSkill) {
        btnSkill.style.background = "#e3000f";
        btnSkill.style.color = "#fff";
        btnWip.style.background = "transparent";
        btnWip.style.color = "#ff3344";
      } else {
        btnWip.style.background = "#e3000f";
        btnWip.style.color = "#fff";
        btnSkill.style.background = "transparent";
        btnSkill.style.color = "#ff3344";
      }
    }

    // Toggle hiển thị phần Upload
    const pushSkillView = document.getElementById("markee-push-skill-view");
    const pushWipView = document.getElementById("markee-push-wip-view");
    const pushSkillActions = document.getElementById("markee-push-skill-actions");
    const pushWipActions = document.getElementById("markee-push-wip-actions");

    if (pushSkillView) pushSkillView.style.display = isSkill ? "flex" : "none";
    if (pushWipView) pushWipView.style.display = isSkill ? "none" : "flex";
    if (pushSkillActions) pushSkillActions.style.display = isSkill ? "flex" : "none";
    if (pushWipActions) pushWipActions.style.display = isSkill ? "none" : "flex";

    // Toggle hiển thị phần Download
    const pullSkillView = document.getElementById("markee-pull-skill-view");
    const pullWipView = document.getElementById("markee-pull-wip-view");

    if (pullSkillView) pullSkillView.style.display = isSkill ? "flex" : "none";
    if (pullWipView) pullWipView.style.display = isSkill ? "none" : "flex";

    // Cập nhật tiêu đề bảng kết quả
    const skillListHeader = document.getElementById("markee-skill-list-header");
    const summarySection = document.getElementById("markee-summary-section");
    if (skillListHeader) {
      skillListHeader.innerText = isSkill ? "⚡ Skills" : "📝 Bản Tóm Tắt (WIP)";
    }
    if (summarySection) {
      summarySection.style.display = isSkill ? "block" : "none";
    }

    const refreshBtn = document.getElementById("markee-wip-refresh-btn");
    if (refreshBtn) {
      refreshBtn.style.display = isSkill ? "none" : "flex";
    }

    const searchInput = document.getElementById("wip-search-input");
    if (searchInput) {
      searchInput.style.display = isSkill ? "none" : "block";
    }

    // Auto-refresh: Tải lại dữ liệu mới nhất
    loadProjects();
    loadCustomers();
    onPullFilterChange();
  }

  // --- NÂNG CẤP VERSION UPDATE BANNER & ĐỒNG BỘ TẤT CẢ ---
  function updateVersionBanner(remoteVersion = null, downloadUrl = null) {
    const currentVer = chrome.runtime.getManifest().version;
    const currentTextEl = document.getElementById("markee-version-current-text");
    const statusBadgeEl = document.getElementById("markee-version-status-badge");
    const updateMsgEl = document.getElementById("markee-version-update-msg");
    const remoteTagEl = document.getElementById("markee-remote-version-tag");
    const btnUpdate = document.getElementById("markee-btn-update-version");

    if (currentTextEl) {
      currentTextEl.innerText = `Phiên bản hiện tại: v${currentVer}`;
    }

    if (remoteVersion && downloadUrl) {
      if (statusBadgeEl) {
        statusBadgeEl.innerText = "Có bản mới!";
        statusBadgeEl.style.color = "#f59e0b";
        statusBadgeEl.style.background = "rgba(245, 158, 11, 0.2)";
      }
      if (remoteTagEl) remoteTagEl.innerText = `v${remoteVersion}`;
      if (updateMsgEl) updateMsgEl.style.display = "block";
      if (btnUpdate) {
        btnUpdate.style.display = "inline-block";
        btnUpdate.onclick = (e) => {
          e.preventDefault();
          chrome.runtime.sendMessage({ action: "OPEN_DASHBOARD_URL", url: downloadUrl });
          window.open(downloadUrl, "_blank");
        };
      }
    } else {
      chrome.storage.local.get(["markee_update_cache"], (result) => {
        if (result && result.markee_update_cache) {
          const { remoteVersion: rv, downloadUrl: du } = result.markee_update_cache;
          if (rv && du) {
            updateVersionBanner(rv, du);
          }
        }
      });
    }
  }

  // --- RESET GIAO DIỆN KHI KHÔNG CÓ BẢN MỚI ---
  function resetVersionUI() {
    // 1. Reset banner bên trong Widget
    const updateMsgEl = document.getElementById("markee-version-update-msg");
    const statusBadgeEl = document.getElementById("markee-version-status-badge");
    const btnUpdate = document.getElementById("markee-btn-update-version");

    if (updateMsgEl) updateMsgEl.style.display = "none";
    if (btnUpdate) btnUpdate.style.display = "none";
    if (statusBadgeEl) {
      statusBadgeEl.innerText = "Mới nhất";
      statusBadgeEl.style.color = "#10b981";
      statusBadgeEl.style.background = "rgba(16, 185, 129, 0.15)";
    }

    // 2. Xóa chấm đỏ (Red Dot Badge) trên icon não
    const badge = document.getElementById("markee-update-badge");
    if (badge) badge.remove();

    // 3. Xóa tooltip đen cạnh icon não
    const tooltip = document.getElementById("markee-update-tooltip");
    if (tooltip) tooltip.remove();

    // 4. Xóa cache trong chrome.storage.local
    chrome.storage.local.remove("markee_update_cache");
  }

  const btnCheckVersion = document.getElementById("markee-btn-check-version");
  if (btnCheckVersion) {
    btnCheckVersion.onclick = () => {
      btnCheckVersion.disabled = true;
      btnCheckVersion.innerText = "🔄 Đang kiểm tra...";
      showToast("🔍 Đang kiểm tra phiên bản mới...");

      chrome.runtime.sendMessage({ action: "CHECK_VERSION_MANUAL" }, (res) => {
        btnCheckVersion.disabled = false;

        if (res && res.success && res.update) {
          // Có bản mới
          updateVersionBanner(res.update.remoteVersion, res.update.downloadUrl);
          showToast(`🚀 Có bản mới v${res.update.remoteVersion}!`, "success");
          btnCheckVersion.innerText = "🔍 Kiểm tra";
        } else {
          // Không có bản mới — reset toàn bộ UI thông báo
          resetVersionUI();
          const currentVer = chrome.runtime.getManifest().version;
          showToast(`✅ Bạn đang dùng phiên bản mới nhất (v${currentVer}).`, "success");

          // Hiển thị "Đã là mới nhất" trong 2 giây rồi reset lại label
          btnCheckVersion.innerText = "✅ Đã mới nhất";
          setTimeout(() => {
            btnCheckVersion.innerText = "🔍 Kiểm tra";
          }, 2000);
        }
      });
    };
  }

  // Khởi tạo banner ngay khi inject widget
  updateVersionBanner();

  // Đăng ký sự kiện nút "Đồng bộ tất cả"
  function performSyncAll() {
    showToast("⏳ Đang đồng bộ tất cả dữ liệu...");
    const syncBtns = document.querySelectorAll(".markee-sync-all-btn");
    syncBtns.forEach((btn) => {
      const icon = btn.querySelector(".sync-icon");
      if (icon) {
        icon.style.transform = "rotate(360deg)";
        icon.style.transition = "transform 1s ease";
        setTimeout(() => {
          icon.style.transform = "rotate(0deg)";
          icon.style.transition = "none";
        }, 1000);
      }
    });

    loadCustomers();
    loadProjects();
    loadPushDepartments();
    loadPullDepartments();

    const pushProjId = getPushProjectId();
    if (pushProjId) {
      chrome.runtime.sendMessage({ action: "GET_PROJECT_FEATURES", projectId: pushProjId }, (res) => {
        const features = res && Array.isArray(res.features) ? res.features : [];
        populateFeatureDatalist("feature-suggestions-push", features);
      });
    }

    const pullProjId = getPullProjectId();
    if (pullProjId) {
      chrome.runtime.sendMessage({ action: "GET_PROJECT_FEATURES", projectId: pullProjId }, (res) => {
        const features = res && Array.isArray(res.features) ? res.features : [];
        populateFeatureDatalist("feature-suggestions-pull", features);
      });
    }

    onPullFilterChange();
    setTimeout(() => showToast("✅ Đã đồng bộ tất cả dữ liệu!"), 600);
  }

  const syncBtns = document.querySelectorAll(".markee-sync-all-btn");
  syncBtns.forEach((btn) => {
    btn.onclick = performSyncAll;
  });

  // Đăng ký sự kiện chuyển tab Mode
  document.getElementById("markee-mode-skill").onclick = () => {
    currentMode = "skill";
    updateModeVisibility();
  };
  document.getElementById("markee-mode-wip").onclick = () => {
    currentMode = "wip";
    updateModeVisibility();
  };

  // Đăng ký sự kiện Click nút Refresh UI (Chỉ xoay icon, không xoay chữ)
  const wipRefreshBtn = document.getElementById("markee-wip-refresh-btn");
  if (wipRefreshBtn) {
    wipRefreshBtn.onclick = () => {
      const spinIcon = wipRefreshBtn.querySelector(".spin-icon");
      const refreshText = wipRefreshBtn.querySelector(".refresh-text");

      if (spinIcon) {
        spinIcon.style.transform = "rotate(360deg)";
        spinIcon.style.transition = "transform 1s ease";
      }
      if (refreshText) {
        refreshText.innerText = "Đang làm mới...";
      }

      // Clear input tìm kiếm và lọc tính năng
      const featurePullInput = document.getElementById("markee-feature-input-pull");
      if (featurePullInput) featurePullInput.value = "";

      const wipSearchInput = document.getElementById("wip-search-input");
      if (wipSearchInput) wipSearchInput.value = "";

      // Reset phân trang và fetch fresh data
      resetWipPagination();
      fetchAndRenderWipSummaries(false);

      setTimeout(() => {
        if (spinIcon) {
          spinIcon.style.transform = "none";
          spinIcon.style.transition = "none";
        }
        if (refreshText) {
          refreshText.innerText = "";
        }
      }, 1000);
    };
  }

  // Lắng nghe sự kiện ô tìm kiếm WIP với Debounce 400ms
  let wipSearchTimeout = null;
  const wipSearchInput = document.getElementById("wip-search-input");
  if (wipSearchInput) {
    wipSearchInput.addEventListener("input", () => {
      clearTimeout(wipSearchTimeout);
      wipSearchTimeout = setTimeout(() => {
        resetWipPagination();
        fetchAndRenderWipSummaries(false);
      }, 400);
    });
  }
  // Lắng nghe sự kiện Collapsible cho 2 Bộ Lọc (Download Skill & Download WIP)
  const pullSkillHeader = document.getElementById("markee-pull-skill-header");
  const pullSkillBody = document.getElementById("markee-pull-skill-body");
  const pullSkillArrow = document.getElementById("markee-pull-skill-arrow");
  if (pullSkillHeader && pullSkillBody && pullSkillArrow) {
    pullSkillHeader.onclick = (e) => {
      if (e.target.closest(".markee-sync-all-btn")) return;
      const isHidden = pullSkillBody.style.display === "none";
      pullSkillBody.style.display = isHidden ? "flex" : "none";
      pullSkillArrow.innerText = isHidden ? "▲" : "▼";
    };
  }

  const pullWipHeader = document.getElementById("markee-pull-wip-header");
  const pullWipBody = document.getElementById("markee-pull-wip-body");
  const pullWipArrow = document.getElementById("markee-pull-wip-arrow");
  if (pullWipHeader && pullWipBody && pullWipArrow) {
    pullWipHeader.onclick = (e) => {
      if (e.target.closest(".markee-sync-all-btn")) return;
      const isHidden = pullWipBody.style.display === "none";
      pullWipBody.style.display = isHidden ? "flex" : "none";
      pullWipArrow.innerText = isHidden ? "▲" : "▼";
    };
  }

  function initSkillTabListeners() {
    // 0. Khôi phục các bộ lọc đã lưu từ LocalStorage (Persistence)
    const savedDept = MarkeeStorage.get("markee_download_skill_dept", []);
    if (Array.isArray(savedDept)) {
      selectedDeptItems = savedDept;
      selectedDeptIds = savedDept.map((i) => (typeof i === "object" && i !== null ? i.id : i)).filter((id) => id !== undefined && id !== null);
    }

    const savedTeam = MarkeeStorage.get("markee_download_skill_team", []);
    if (Array.isArray(savedTeam)) {
      selectedTeamItems = savedTeam;
      selectedTeamIds = savedTeam.map((i) => (typeof i === "object" && i !== null ? i.id : i)).filter((id) => id !== undefined && id !== null);
    }

    const savedProj = MarkeeStorage.get("markee_download_skill_project", []);
    if (Array.isArray(savedProj)) {
      selectedProjectItems = savedProj;
      selectedProjectIds = savedProj.map((i) => (typeof i === "object" && i !== null ? i.id : i)).filter((id) => id !== undefined && id !== null);
    }

    const savedChip = MarkeeStorage.get("markee_download_skill_chip_filter", "all");
    currentChipFilter = savedChip || "all";

    // Đồng bộ State -> UI ngay khi khởi tạo (Hiển thị TÊN item lên nút bấm)
    updateSkillPullFilterButtonUI("markee-filter-btn-dept", "markee-badge-dept", selectedDeptItems, "Phòng ban", "🏢");
    updateSkillPullFilterButtonUI("markee-filter-btn-team", "markee-badge-team", selectedTeamItems, "Team phụ trách", "👥");
    updateSkillPullFilterButtonUI("markee-filter-btn-project", "markee-badge-project", selectedProjectItems, "Dự án", "📁");

    // Khôi phục trạng thái active cho Chip bộ lọc
    const chipContainer = document.getElementById("markee-skill-chips-container");
    if (chipContainer) {
      const chips = chipContainer.querySelectorAll(".markee-chip-btn");
      chips.forEach((c) => {
        if (c.dataset.filter === currentChipFilter) {
          c.classList.add("active");
          c.style.background = "#e3000f";
          c.style.color = "#fff";
          c.style.border = "1px solid #e3000f";
          c.style.fontWeight = "bold";
        } else {
          c.classList.remove("active");
          if (c.dataset.filter === "favorite") {
            c.style.background = "rgba(245, 158, 11, 0.08)";
            c.style.color = "#f59e0b";
            c.style.border = "1px solid rgba(245, 158, 11, 0.3)";
            c.style.fontWeight = "500";
          } else {
            c.style.background = "#1a1a2e";
            c.style.color = "#ff3344";
            c.style.border = "1px solid #c40009";
            c.style.fontWeight = "500";
          }
        }
      });
    }

    // 1. Tải danh sách kỹ năng yêu thích từ Supabase
    chrome.runtime.sendMessage({ action: "GET_USER_FAVORITES", userId: currentUser }, (res) => {
      if (res && Array.isArray(res.favoriteSkillIds)) {
        userFavoriteSkillIds = new Set(res.favoriteSkillIds);
      }
      if (currentMode === "skill") {
        fetchAndRenderSkills();
      }
    });

    // 2. Bộ lọc Nút Phòng ban (Multi-Select Modal)
    const btnDept = document.getElementById("markee-filter-btn-dept");
    if (btnDept) {
      btnDept.onclick = () => {
        chrome.runtime.sendMessage({ action: "GET_DEPARTMENTS" }, (res) => {
          const depts = res && Array.isArray(res.departments) ? res.departments : [];
          openMultiSelectModal({
            title: "🏢 Chọn Phòng ban",
            items: depts,
            selectedIds: selectedDeptIds,
            onConfirm: (newIds, selectedItems) => {
              selectedDeptIds = newIds;
              selectedDeptItems = selectedItems || [];
              MarkeeStorage.set("markee_download_skill_dept", selectedDeptItems);
              updateSkillPullFilterButtonUI("markee-filter-btn-dept", "markee-badge-dept", selectedDeptItems, "Phòng ban", "🏢");
              fetchAndRenderSkills();
            },
          });
        });
      };
    }

    // 3. Bộ lọc Nút Team phụ trách (Multi-Select Modal)
    const btnTeam = document.getElementById("markee-filter-btn-team");
    if (btnTeam) {
      btnTeam.onclick = () => {
        chrome.runtime.sendMessage({ action: "GET_TEAMS", departmentIds: selectedDeptIds }, (res) => {
          const teams = res && Array.isArray(res.teams) ? res.teams : [];
          openMultiSelectModal({
            title: "👥 Chọn Team phụ trách",
            items: teams,
            selectedIds: selectedTeamIds,
            onConfirm: (newIds, selectedItems) => {
              selectedTeamIds = newIds;
              selectedTeamItems = selectedItems || [];
              MarkeeStorage.set("markee_download_skill_team", selectedTeamItems);
              updateSkillPullFilterButtonUI("markee-filter-btn-team", "markee-badge-team", selectedTeamItems, "Team phụ trách", "👥");
              fetchAndRenderSkills();
            },
          });
        });
      };
    }

    // 4. Bộ lọc Nút Dự án (Multi-Select Modal)
    const btnProject = document.getElementById("markee-filter-btn-project");
    if (btnProject) {
      btnProject.onclick = () => {
        chrome.runtime.sendMessage({ action: "GET_PROJECTS" }, (res) => {
          const projects = res && Array.isArray(res.projects) ? res.projects : [];
          openMultiSelectModal({
            title: "📁 Chọn Dự án",
            items: projects,
            selectedIds: selectedProjectIds,
            onConfirm: (newIds, selectedItems) => {
              selectedProjectIds = newIds;
              selectedProjectItems = selectedItems || [];
              MarkeeStorage.set("markee_download_skill_project", selectedProjectItems);
              updateSkillPullFilterButtonUI("markee-filter-btn-project", "markee-badge-project", selectedProjectItems, "Dự án", "📁");
              fetchAndRenderSkills();
            },
          });
        });
      };
    }

    // 5. Sự kiện Click cho 3 Chips bộ lọc ([⭐ Ưu thích], [Tất cả], [Gần đây])
    if (chipContainer) {
      const chips = chipContainer.querySelectorAll(".markee-chip-btn");
      chips.forEach((chip) => {
        chip.onclick = () => {
          // 1. Reset style của TẤT CẢ các Chips về trạng thái chưa active
          chips.forEach((c) => {
            c.classList.remove("active");
            if (c.dataset.filter === "favorite") {
              c.style.background = "rgba(245, 158, 11, 0.08)";
              c.style.color = "#f59e0b";
              c.style.border = "1px solid rgba(245, 158, 11, 0.3)";
              c.style.fontWeight = "500";
            } else {
              c.style.background = "#1a1a2e";
              c.style.color = "#ff3344";
              c.style.border = "1px solid #c40009";
              c.style.fontWeight = "500";
            }
          });

          // 2. Chỉ active DUY NHẤT chip vừa bấm
          chip.classList.add("active");
          chip.style.background = "#e3000f";
          chip.style.color = "#fff";
          chip.style.border = "1px solid #e3000f";
          chip.style.fontWeight = "bold";

          currentChipFilter = chip.dataset.filter || "all";
          MarkeeStorage.set("markee_download_skill_chip_filter", currentChipFilter);
          fetchAndRenderSkills();
        };
      });
    }

    // 6. Lắng nghe ô Tìm kiếm Kỹ năng với Debounce 300ms
    let skillSearchTimeout = null;
    const skillSearchInput = document.getElementById("markee-skill-search-input");
    if (skillSearchInput) {
      skillSearchInput.addEventListener("input", () => {
        clearTimeout(skillSearchTimeout);
        skillSearchTimeout = setTimeout(() => {
          if (currentMode === "skill") {
            fetchAndRenderSkills();
          }
        }, 300);
      });
    }
  }

  // --- UPLOAD KỸ NĂNG: LOGIC GIAO DIỆN STEP-BY-STEP (2 BƯỚC) ---
  let pushDestProjectSelected = true;
  let pushDestDeptSelected = true;

  function renderPushSkillStepUI() {
    const cardProj = document.getElementById("push-dest-card-project");
    const cardDept = document.getElementById("push-dest-card-dept");
    const badge = document.getElementById("push-step2-badge");
    const boxesContainer = document.getElementById("push-step2-boxes-container");

    if (!cardProj || !cardDept || !badge || !boxesContainer) return;

    // 1. Cập nhật Card Project UI
    if (pushDestProjectSelected) {
      cardProj.style.background = "rgba(227, 0, 15, 0.2)";
      cardProj.style.border = "1px solid #e3000f";
      const icon = cardProj.querySelector(".check-icon");
      if (icon) icon.style.display = "inline";
    } else {
      cardProj.style.background = "#1a1a2e";
      cardProj.style.border = "1px solid #27273a";
      const icon = cardProj.querySelector(".check-icon");
      if (icon) icon.style.display = "none";
    }

    // 2. Cập nhật Card Dept UI
    if (pushDestDeptSelected) {
      cardDept.style.background = "rgba(227, 0, 15, 0.2)";
      cardDept.style.border = "1px solid #e3000f";
      const icon = cardDept.querySelector(".check-icon");
      if (icon) icon.style.display = "inline";
    } else {
      cardDept.style.background = "#1a1a2e";
      cardDept.style.border = "1px solid #27273a";
      const icon = cardDept.querySelector(".check-icon");
      if (icon) icon.style.display = "none";
    }

    // 3. Cập nhật Badge text ở Bước 2
    if (pushDestProjectSelected && pushDestDeptSelected) {
      badge.innerText = "Cả 2 nơi lưu";
    } else if (pushDestProjectSelected) {
      badge.innerText = "1 dự án";
    } else {
      badge.innerText = "1 phòng ban";
    }

    // 4. Lấy giá trị tên hiển thị hiện tại cho Project, Dept, Team
    const projInput = document.getElementById("markee-project-input-push");
    const deptSelect = document.getElementById("markee-department-select");
    const teamSelect = document.getElementById("markee-team-select");

    const projText = projInput && projInput.value && projInput.value.trim() ? projInput.value.trim() : "-- Chưa chọn dự án --";
    const deptText = deptSelect && deptSelect.selectedIndex >= 0 && deptSelect.options[deptSelect.selectedIndex] ? deptSelect.options[deptSelect.selectedIndex].text : "-- Chưa chọn phòng ban --";
    const teamText = teamSelect && teamSelect.selectedIndex >= 0 && teamSelect.options[teamSelect.selectedIndex] ? teamSelect.options[teamSelect.selectedIndex].text : "-- Tất cả Team --";

    let html = "";

    // NẾU Card 1 (Dự án) được chọn -> Hiển thị Box Dự án (Clickable outer box)
    if (pushDestProjectSelected) {
      html += `
        <div id="btn-change-push-project" onmouseover="this.style.borderColor='#e3000f'; this.style.background='#1e1e32';" onmouseout="this.style.borderColor='#27273a'; this.style.background='#161625';" style="background: #161625; border: 1px solid #27273a; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; cursor: pointer; user-select: none; transition: all 0.2s;">
          <span style="font-size: 9px; font-weight: 500; color: #ff3344; letter-spacing: 0.5px;">📁 DỰ ÁN ĐƯỢC ÁP DỤNG</span>
          <span style="font-size: 11px; font-weight: 500; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${projText}</span>
        </div>
      `;
    }

    // NẾU Card 2 (Phòng ban) được chọn -> Hiển thị Box Phòng ban & Box Team (Clickable outer boxes)
    if (pushDestDeptSelected) {
      html += `
        <div id="btn-change-push-dept" onmouseover="this.style.borderColor='#e3000f'; this.style.background='#1e1e32';" onmouseout="this.style.borderColor='#27273a'; this.style.background='#161625';" style="background: #161625; border: 1px solid #27273a; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; cursor: pointer; user-select: none; transition: all 0.2s;">
          <span style="font-size: 9px; font-weight: 500; color: #ff3344; letter-spacing: 0.5px;">🏢 PHÒNG BAN ÁP DỤNG</span>
          <span style="font-size: 11px; font-weight: 500; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${deptText}</span>
        </div>

        <div id="btn-change-push-team" onmouseover="this.style.borderColor='#e3000f'; this.style.background='#1e1e32';" onmouseout="this.style.borderColor='#27273a'; this.style.background='#161625';" style="background: #161625; border: 1px solid #27273a; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; cursor: pointer; user-select: none; transition: all 0.2s;">
          <span style="font-size: 9px; font-weight: 500; color: #ff3344; letter-spacing: 0.5px;">👥 TEAM ÁP DỤNG</span>
          <span style="font-size: 11px; font-weight: 500; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${teamText}</span>
        </div>
      `;
    }

    boxesContainer.innerHTML = html;

    // Gán sự kiện click cho các nút "Thay đổi"
    const btnChangeProj = document.getElementById("btn-change-push-project");
    if (btnChangeProj) {
      btnChangeProj.onclick = () => {
        chrome.runtime.sendMessage({ action: "GET_PROJECTS" }, (res) => {
          const projects = res && Array.isArray(res.projects) ? res.projects : [];
          const curProjId = getPushProjectId();
          openSingleSelectModal({
            title: "📁 Chọn Dự án áp dụng",
            items: projects,
            selectedId: curProjId,
            onConfirm: (selectedId, selectedItem) => {
              if (selectedItem) {
                const displayText = `${selectedItem.id} - ${selectedItem.name}`;
                if (projInput) {
                  projInput.value = displayText;
                  projInput.dataset.projectId = String(selectedItem.id);
                }
                chrome.storage.local.set({
                  markee_project_id: selectedItem.id,
                  markee_project_display: displayText,
                });
              } else {
                if (projInput) {
                  projInput.value = "";
                  projInput.dataset.projectId = "";
                }
              }
              renderPushSkillStepUI();
            },
          });
        });
      };
    }

    const btnChangeDept = document.getElementById("btn-change-push-dept");
    if (btnChangeDept) {
      btnChangeDept.onclick = () => {
        chrome.runtime.sendMessage({ action: "GET_DEPARTMENTS" }, (res) => {
          const depts = res && Array.isArray(res.departments) ? res.departments : [];
          const curDeptId = getSelectNumber(deptSelect);
          openSingleSelectModal({
            title: "🏢 Chọn Phòng ban áp dụng",
            items: depts,
            selectedId: curDeptId,
            onConfirm: (selectedId, selectedItem) => {
              if (deptSelect) {
                const newVal = selectedId ? String(selectedId) : "";
                if (newVal && selectedItem && Array.from(deptSelect.options).every((opt) => opt.value !== newVal)) {
                  const opt = document.createElement("option");
                  opt.value = newVal;
                  opt.textContent = selectedItem.name;
                  deptSelect.appendChild(opt);
                }
                deptSelect.value = newVal;
                chrome.storage.local.set({ markee_department_id: selectedId ? Number(selectedId) : null, markee_team_id: null });
                deptSelect.dispatchEvent(new Event("change"));
              }
              renderPushSkillStepUI();
            },
          });
        });
      };
    }

    const btnChangeTeam = document.getElementById("btn-change-push-team");
    if (btnChangeTeam) {
      btnChangeTeam.onclick = () => {
        const curDeptId = getSelectNumber(deptSelect);
        chrome.runtime.sendMessage({ action: "GET_TEAMS", departmentIds: curDeptId ? [curDeptId] : [] }, (res) => {
          const teams = res && Array.isArray(res.teams) ? res.teams : [];
          const curTeamId = getSelectNumber(teamSelect);
          openSingleSelectModal({
            title: "👥 Chọn Team áp dụng",
            items: teams,
            selectedId: curTeamId,
            onConfirm: (selectedId, selectedItem) => {
              if (teamSelect) {
                const newVal = selectedId ? String(selectedId) : "";
                if (newVal && selectedItem && Array.from(teamSelect.options).every((opt) => opt.value !== newVal)) {
                  const opt = document.createElement("option");
                  opt.value = newVal;
                  opt.textContent = selectedItem.name;
                  teamSelect.appendChild(opt);
                }
                teamSelect.value = newVal;
                chrome.storage.local.set({ markee_team_id: selectedId ? Number(selectedId) : null });
                teamSelect.dispatchEvent(new Event("change"));
              }
              renderPushSkillStepUI();
            },
          });
        });
      };
    }
  }

  let pushDestWarningTimeout = null;

  function showPushDestWarning(cardEl) {
    if (cardEl) {
      cardEl.style.border = "1px solid #ef4444";
      cardEl.style.background = "rgba(239, 68, 68, 0.2)";
      setTimeout(() => {
        if (typeof renderPushSkillStepUI === "function") {
          renderPushSkillStepUI();
        }
      }, 1000);
    }

    const warnEl = document.getElementById("push-dest-local-warning");
    if (warnEl) {
      warnEl.innerText = "⚠️ Phải chọn ít nhất 1 nơi lưu!";
      warnEl.style.display = "block";
      clearTimeout(pushDestWarningTimeout);
      pushDestWarningTimeout = setTimeout(() => {
        warnEl.style.display = "none";
      }, 3000);
    }
  }

  let activeQuickProjectTabWip = "fav";
  let activeQuickProjectTabSkill = "fav";
  let recentSelectedProjectIds = [];

  function refreshQuickProjectsSelectorUI() {
    chrome.runtime.sendMessage({ action: "GET_FAVORITE_PROJECTS" }, (resFav) => {
      const favoriteProjects = resFav && Array.isArray(resFav.projects) ? resFav.projects : [];
      const favoriteIdsSet = new Set(favoriteProjects.map((p) => Number(p.id)));

      chrome.runtime.sendMessage({ action: "GET_PROJECTS" }, (resAll) => {
        const allProjects = resAll && Array.isArray(resAll.projects) ? resAll.projects : [];

        chrome.storage.local.get(["markee_recent_project_ids"], (stored) => {
          if (stored && Array.isArray(stored.markee_recent_project_ids)) {
            recentSelectedProjectIds = stored.markee_recent_project_ids;
          }

          renderSelectorForContainer("wip", allProjects, favoriteProjects, favoriteIdsSet);
          renderSelectorForContainer("skill", allProjects, favoriteProjects, favoriteIdsSet);
        });
      });
    });
  }

  function renderSelectorForContainer(type, allProjects, favoriteProjects, favoriteIdsSet) {
    const isWip = type === "wip";
    const containerId = isWip ? "wip-push-quick-project-selector" : "skill-push-quick-project-selector";
    const container = document.getElementById(containerId);
    if (!container) return;

    const listEl = container.querySelector(".quick-projects-list-container");
    const searchEl = container.querySelector('input[type="text"]');
    const countEl = document.getElementById(type + "-push-quick-count");
    const tabsContainer = document.getElementById(type + "-push-quick-tabs");

    if (!listEl) return;

    let activeTab = isWip ? activeQuickProjectTabWip : activeQuickProjectTabSkill;
    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : "";

    let currentSelectedId = null;
    if (isWip) {
      const projSelectPush = document.getElementById("markee-project-select-push");
      currentSelectedId = projSelectPush ? String(projSelectPush.value) : null;
    } else {
      const projInput = document.getElementById("markee-project-input-push");
      currentSelectedId = projInput && projInput.dataset.projectId ? String(projInput.dataset.projectId) : null;
    }

    let baseList = [];
    if (activeTab === "fav") {
      baseList = favoriteProjects;
    } else if (activeTab === "recent") {
      const recentSet = new Set(recentSelectedProjectIds.map(Number));
      baseList = allProjects.filter((p) => recentSet.has(Number(p.id)));
    } else {
      baseList = allProjects;
    }

    let filtered = baseList.filter((p) => {
      const prjName = (p.name || "").toLowerCase();
      const custName = (p.customer_name || (p.customer && p.customer.name) || (p.customers && (p.customers.name || (Array.isArray(p.customers) && p.customers[0]?.name))) || "").toLowerCase();
      return !keyword || prjName.includes(keyword) || custName.includes(keyword);
    });

    if (countEl) {
      countEl.innerText = `${filtered.length} dự án`;
    }

    if (tabsContainer && !tabsContainer.dataset.initListeners) {
      tabsContainer.dataset.initListeners = "true";
      const buttons = tabsContainer.querySelectorAll("button");
      buttons.forEach((btn) => {
        btn.onclick = (e) => {
          e.preventDefault();
          const tab = btn.dataset.tab;
          if (isWip) activeQuickProjectTabWip = tab;
          else activeQuickProjectTabSkill = tab;

          buttons.forEach((b) => {
            if (b.dataset.tab === tab) {
              b.classList.add("active");
              b.style.background = tab === "fav" ? "#f59e0b" : "#e3000f";
              b.style.borderColor = tab === "fav" ? "#f59e0b" : "#e3000f";
              b.style.color = "#fff";
            } else {
              b.classList.remove("active");
              b.style.background = "rgba(227, 0, 15, 0.15)";
              b.style.borderColor = "#e3000f";
              b.style.color = "#ff3344";
            }
          });

          renderSelectorForContainer(type, allProjects, favoriteProjects, favoriteIdsSet);
        };
      });
    }

    if (searchEl && !searchEl.dataset.initListeners) {
      searchEl.dataset.initListeners = "true";
      searchEl.oninput = () => {
        renderSelectorForContainer(type, allProjects, favoriteProjects, favoriteIdsSet);
      };
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center; padding: 12px 0;">Không có dự án nào</div>`;
      return;
    }

    listEl.innerHTML = "";
    filtered.forEach((p) => {
      const custName = p.customer_name || (p.customer && p.customer.name) || (p.customers && (p.customers.name || (Array.isArray(p.customers) && p.customers[0]?.name))) || "";
      const prjIdStr = String(p.id);
      const isSelected = currentSelectedId === prjIdStr;
      const isFav = favoriteIdsSet.has(Number(p.id));

      const row = document.createElement("div");
      row.className = "markee-quick-project-row";
      row.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        background: ${isSelected ? "rgba(227, 0, 15, 0.25)" : "#161625"};
        border: 1px solid ${isSelected ? "#e3000f" : "#27273a"};
        border-radius: 6px;
        cursor: pointer;
        user-select: none;
        transition: all 0.2s;
      `;

      row.onmouseover = () => {
        if (currentSelectedId !== prjIdStr) {
          row.style.borderColor = "#e3000f";
          row.style.background = "#1e1e32";
        }
      };
      row.onmouseout = () => {
        if (currentSelectedId !== prjIdStr) {
          row.style.borderColor = "#27273a";
          row.style.background = "#161625";
        }
      };

      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
          <span style="font-size: 12px; flex-shrink: 0; color: #ff3344;">📁</span>
          <div style="display: flex; flex-direction: column; gap: 1px; min-width: 0;">
            <span style="font-size: 11px; font-weight: 400 !important; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name}</span>
            <span style="font-size: 10px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Khách hàng: ${custName || "--"}</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 6px;">
          <span class="markee-project-fav-star" title="${isFav ? "Bỏ yêu thích" : "Đánh dấu yêu thích"}" style="cursor: pointer; font-size: 13px; color: ${isFav ? "#fbbf24" : "#64748b"}; transition: transform 0.15s, color 0.15s; user-select: none; padding: 2px;">${isFav ? "⭐" : "☆"}</span>
        </div>
      `;

      const starEl = row.querySelector(".markee-project-fav-star");
      if (starEl) {
        starEl.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          starEl.style.pointerEvents = "none";
          starEl.style.opacity = "0.5";
          chrome.runtime.sendMessage(
            { action: "TOGGLE_FAVORITE_PROJECT", projectId: p.id, userEmail: currentUser },
            (response) => {
              starEl.style.pointerEvents = "auto";
              starEl.style.opacity = "1";
              if (response && response.success) {
                showToast(response.isFavorite ? "⭐ Đã thêm dự án yêu thích!" : "Đã bỏ dự án yêu thích");
                refreshQuickProjectsSelectorUI();
              }
            }
          );
        };
      }

      row.onclick = (e) => {
        e.preventDefault();

        const newRecent = [p.id, ...recentSelectedProjectIds.filter((id) => Number(id) !== Number(p.id))].slice(0, 10);
        recentSelectedProjectIds = newRecent;
        chrome.storage.local.set({ markee_recent_project_ids: newRecent });

        if (isWip) {
          const custSelectPush = document.getElementById("markee-customer-select-push");
          const projSelectPush = document.getElementById("markee-project-select-push");
          if (custSelectPush && projSelectPush) {
            const custIdStr = String(p.customer_id || (p.customer && p.customer.id) || "");
            if (custIdStr) {
              if (Array.from(custSelectPush.options).every((opt) => opt.value !== custIdStr)) {
                const opt = document.createElement("option");
                opt.value = custIdStr;
                opt.textContent = custName || "Khách hàng";
                custSelectPush.appendChild(opt);
              }
              custSelectPush.value = custIdStr;
              custSelectPush.dispatchEvent(new Event("change"));
            }

            if (Array.from(projSelectPush.options).every((opt) => opt.value !== prjIdStr)) {
              const opt = document.createElement("option");
              opt.value = prjIdStr;
              opt.textContent = p.name || "Dự án";
              projSelectPush.appendChild(opt);
            }
            projSelectPush.value = prjIdStr;
            projSelectPush.dispatchEvent(new Event("change"));

            if (typeof updateWipPushCardLabels === "function") {
              updateWipPushCardLabels();
            }
          }
          showToast(`⚡ [Tóm tắt] Đã chọn dự án: ${p.name}`, "success");
        } else {
          const projInput = document.getElementById("markee-project-input-push");
          const displayText = `${p.id} - ${p.name}`;
          if (projInput) {
            projInput.value = displayText;
            projInput.dataset.projectId = String(p.id);
          }
          chrome.storage.local.set({
            markee_project_id: p.id,
            markee_project_display: displayText,
          });

          if (typeof renderPushSkillStepUI === "function") {
            renderPushSkillStepUI();
          }
          showToast(`⚡ [Kỹ năng] Đã chọn dự án: ${p.name}`, "success");
        }

        renderSelectorForContainer(type, allProjects, favoriteProjects, favoriteIdsSet);
      };

      listEl.appendChild(row);
    });
  }

  function refreshQuickFavoriteProjectsUI() {
    refreshQuickProjectsSelectorUI();
  }

  let isWipPushExpanded = false;
  let isSkillPushExpanded = false;

  function initUploadCollapsibleListeners() {
    const wipTitle = document.getElementById("wip-push-header-title");
    const wipArrow = document.getElementById("wip-push-toggle-arrow");
    const wipArea = document.getElementById("wip-push-collapsible-area");

    const syncWipUI = () => {
      if (!wipArea) return;
      if (isWipPushExpanded) {
        wipArea.style.maxHeight = "500px";
        wipArea.style.opacity = "1";
        wipArea.style.margin = "0 0 0 0";
        if (wipArrow) wipArrow.innerText = "▲";
      } else {
        wipArea.style.maxHeight = "0px";
        wipArea.style.opacity = "0";
        wipArea.style.margin = "-4px 0 -4px 0";
        if (wipArrow) wipArrow.innerText = "▼";
      }
    };

    const toggleWip = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      isWipPushExpanded = !isWipPushExpanded;
      syncWipUI();
    };

    if (wipTitle) wipTitle.onclick = toggleWip;
    if (wipArrow) wipArrow.onclick = toggleWip;
    syncWipUI();

    const skillTitle = document.getElementById("skill-push-header-title");
    const skillArrow = document.getElementById("skill-push-toggle-arrow");
    const skillArea = document.getElementById("skill-push-collapsible-area");

    const syncSkillUI = () => {
      if (!skillArea) return;
      if (isSkillPushExpanded) {
        skillArea.style.maxHeight = "800px";
        skillArea.style.opacity = "1";
        skillArea.style.margin = "2px 0 0 0";
        if (skillArrow) skillArrow.innerText = "▲";
      } else {
        skillArea.style.maxHeight = "0px";
        skillArea.style.opacity = "0";
        skillArea.style.margin = "0 0 0 0";
        if (skillArrow) skillArrow.innerText = "▼";
      }
    };

    const toggleSkill = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      isSkillPushExpanded = !isSkillPushExpanded;
      syncSkillUI();
    };

    if (skillTitle) skillTitle.onclick = toggleSkill;
    if (skillArrow) skillArrow.onclick = toggleSkill;
    syncSkillUI();
  }

  function initPushSkillStepListeners() {
    initUploadCollapsibleListeners();
    refreshQuickFavoriteProjectsUI();
    const cardProj = document.getElementById("push-dest-card-project");
    const cardDept = document.getElementById("push-dest-card-dept");

    if (cardProj) {
      cardProj.onclick = (e) => {
        if (pushDestProjectSelected && !pushDestDeptSelected) {
          if (e && e.preventDefault) e.preventDefault();
          showPushDestWarning(cardProj);
          return;
        }
        pushDestProjectSelected = !pushDestProjectSelected;
        renderPushSkillStepUI();
      };
    }

    if (cardDept) {
      cardDept.onclick = (e) => {
        if (pushDestDeptSelected && !pushDestProjectSelected) {
          if (e && e.preventDefault) e.preventDefault();
          showPushDestWarning(cardDept);
          return;
        }
        pushDestDeptSelected = !pushDestDeptSelected;
        renderPushSkillStepUI();
      };
    }

    renderPushSkillStepUI();
  }

  // --- UPLOAD TÓM TẮT: LOGIC THẺ BẢNG & MODAL DỰ ÁN/KHÁCH HÀNG ---
  function updateWipPushCardLabels() {
    const custSelect = document.getElementById("markee-customer-select-push");
    const projSelect = document.getElementById("markee-project-select-push");

    const custTextEl = document.getElementById("wip-push-customer-text");
    const projTextEl = document.getElementById("wip-push-project-text");

    if (custTextEl) {
      if (custSelect && custSelect.selectedIndex >= 0 && custSelect.options[custSelect.selectedIndex] && custSelect.value) {
        custTextEl.innerText = custSelect.options[custSelect.selectedIndex].text;
      } else {
        custTextEl.innerText = "-- Chọn Khách hàng --";
      }
    }

    if (projTextEl) {
      if (projSelect && projSelect.selectedIndex >= 0 && projSelect.options[projSelect.selectedIndex] && projSelect.value) {
        projTextEl.innerText = projSelect.options[projSelect.selectedIndex].text;
      } else {
        projTextEl.innerText = "-- Chọn Dự án --";
      }
    }
  }

  function updateWipPullCardLabels() {
    const custSelect = document.getElementById("markee-customer-select-pull");
    const projSelect = document.getElementById("markee-project-select-pull");

    const custTextEl = document.getElementById("wip-pull-customer-text");
    const projTextEl = document.getElementById("wip-pull-project-text");

    if (custTextEl) {
      if (custSelect && custSelect.selectedIndex >= 0 && custSelect.options[custSelect.selectedIndex] && custSelect.value) {
        custTextEl.innerText = custSelect.options[custSelect.selectedIndex].text;
      } else {
        custTextEl.innerText = "-- Chọn Khách hàng --";
      }
    }

    if (projTextEl) {
      if (projSelect && projSelect.selectedIndex >= 0 && projSelect.options[projSelect.selectedIndex] && projSelect.value) {
        projTextEl.innerText = projSelect.options[projSelect.selectedIndex].text;
      } else {
        projTextEl.innerText = "-- Chọn Dự án --";
      }
    }
  }

  function initWipPushStepListeners() {
    initUploadCollapsibleListeners();
    refreshQuickFavoriteProjectsUI();
    const cardCustomer = document.getElementById("wip-push-card-customer");
    const cardProject = document.getElementById("wip-push-card-project");
    const custSelect = document.getElementById("markee-customer-select-push");
    const projSelect = document.getElementById("markee-project-select-push");

    if (cardCustomer) {
      cardCustomer.onclick = () => {
        chrome.runtime.sendMessage({ action: "GET_CUSTOMERS" }, (res) => {
          const customers = res && Array.isArray(res.customers) ? res.customers : [];
          const curCustId = custSelect ? custSelect.value : null;
          openSingleSelectModal({
            title: "🏢 Chọn Khách hàng",
            items: customers,
            selectedId: curCustId,
            onConfirm: (selectedId, selectedItem) => {
              if (custSelect) {
                const oldVal = custSelect.value;
                const newVal = selectedId !== undefined && selectedId !== null ? String(selectedId) : "";

                if (newVal && selectedItem && Array.from(custSelect.options).every((opt) => opt.value !== newVal)) {
                  const opt = document.createElement("option");
                  opt.value = newVal;
                  opt.textContent = selectedItem.name;
                  custSelect.appendChild(opt);
                }

                custSelect.value = newVal;
                // TASK 2: Nếu đổi Khách hàng mới, tự động reset Dự án hiện tại
                if (oldVal !== newVal && projSelect) {
                  projSelect.value = "";
                  renderSelectOptions(projSelect, [], "-- Chọn Dự án --");
                }
                custSelect.dispatchEvent(new Event("change"));
              }
              updateWipPushCardLabels();
            },
          });
        });
      };
    }

    if (cardProject) {
      cardProject.onclick = () => {
        const curCustId = custSelect ? custSelect.value : "";
        const getProjectsAction = curCustId
          ? { action: "GET_PROJECTS_BY_CUSTOMER", customerId: curCustId }
          : { action: "GET_PROJECTS" };

        chrome.runtime.sendMessage(getProjectsAction, (res) => {
          const projects = res && Array.isArray(res.projects) ? res.projects : [];
          const curProjId = projSelect ? projSelect.value : null;
          openSingleSelectModal({
            title: "📁 Chọn Dự án",
            items: projects,
            selectedId: curProjId,
            onConfirm: (selectedId, selectedItem) => {
              if (selectedItem) {
                const targetCustId = selectedItem.customer_id || selectedItem.customerId;
                if (targetCustId && custSelect) {
                  const custIdStr = String(targetCustId);
                  const custName = selectedItem.customer_name || (selectedItem.customer && selectedItem.customer.name) || (selectedItem.customers && (selectedItem.customers.name || (Array.isArray(selectedItem.customers) && selectedItem.customers[0]?.name))) || "Khách hàng";
                  if (Array.from(custSelect.options).every((opt) => opt.value !== custIdStr)) {
                    const opt = document.createElement("option");
                    opt.value = custIdStr;
                    opt.textContent = custName;
                    custSelect.appendChild(opt);
                  }
                  custSelect.value = custIdStr;
                  custSelect.dispatchEvent(new Event("change"));
                }

                if (projSelect) {
                  const newVal = selectedId !== undefined && selectedId !== null ? String(selectedId) : "";
                  if (newVal && Array.from(projSelect.options).every((opt) => opt.value !== newVal)) {
                    const opt = document.createElement("option");
                    opt.value = newVal;
                    opt.textContent = selectedItem.name;
                    projSelect.appendChild(opt);
                  }
                  projSelect.value = newVal;
                  projSelect.dispatchEvent(new Event("change"));
                }
              }
              updateWipPushCardLabels();
            },
          });
        });
      };
    }

    updateWipPushCardLabels();
  }

  function initWipPullStepListeners() {
    const cardCustomer = document.getElementById("wip-pull-card-customer");
    const cardProject = document.getElementById("wip-pull-card-project");
    const custSelect = document.getElementById("markee-customer-select-pull");
    const projSelect = document.getElementById("markee-project-select-pull");
    const featureInput = document.getElementById("markee-feature-input-pull");

    if (cardCustomer) {
      cardCustomer.onclick = () => {
        chrome.runtime.sendMessage({ action: "GET_CUSTOMERS" }, (res) => {
          const customers = res && Array.isArray(res.customers) ? res.customers : [];
          const curCustId = custSelect ? custSelect.value : null;
          openSingleSelectModal({
            title: "🏢 Chọn Khách hàng",
            items: customers,
            selectedId: curCustId,
            onConfirm: (selectedId, selectedItem) => {
              if (custSelect) {
                const oldVal = custSelect.value;
                const newVal = selectedId !== undefined && selectedId !== null ? String(selectedId) : "";

                if (newVal && selectedItem && Array.from(custSelect.options).every((opt) => opt.value !== newVal)) {
                  const opt = document.createElement("option");
                  opt.value = newVal;
                  opt.textContent = selectedItem.name;
                  custSelect.appendChild(opt);
                }

                custSelect.value = newVal;
                MarkeeStorage.set("markee_wip_pull_customer", newVal);

                if (oldVal !== newVal && projSelect) {
                  projSelect.value = "";
                  MarkeeStorage.remove("markee_wip_pull_project");
                  renderSelectOptions(projSelect, [], "-- Chọn Dự án --");
                }
                custSelect.dispatchEvent(new Event("change"));
              }
              updateWipPullCardLabels();
            },
          });
        });
      };
    }

    if (cardProject) {
      cardProject.onclick = () => {
        const curCustId = custSelect ? custSelect.value : "";
        const getProjectsAction = curCustId
          ? { action: "GET_PROJECTS_BY_CUSTOMER", customerId: curCustId }
          : { action: "GET_PROJECTS" };

        chrome.runtime.sendMessage(getProjectsAction, (res) => {
          const projects = res && Array.isArray(res.projects) ? res.projects : [];
          const curProjId = projSelect ? projSelect.value : null;
          openSingleSelectModal({
            title: "📁 Chọn Dự án",
            items: projects,
            selectedId: curProjId,
            onConfirm: (selectedId, selectedItem) => {
              if (selectedItem) {
                const targetCustId = selectedItem.customer_id || selectedItem.customerId;
                if (targetCustId && custSelect) {
                  const custIdStr = String(targetCustId);
                  const custName = selectedItem.customer_name || (selectedItem.customer && selectedItem.customer.name) || (selectedItem.customers && (selectedItem.customers.name || (Array.isArray(selectedItem.customers) && selectedItem.customers[0]?.name))) || "Khách hàng";
                  if (Array.from(custSelect.options).every((opt) => opt.value !== custIdStr)) {
                    const opt = document.createElement("option");
                    opt.value = custIdStr;
                    opt.textContent = custName;
                    custSelect.appendChild(opt);
                  }
                  custSelect.value = custIdStr;
                  MarkeeStorage.set("markee_wip_pull_customer", custIdStr);
                  custSelect.dispatchEvent(new Event("change"));
                }

                if (projSelect) {
                  const newVal = selectedId !== undefined && selectedId !== null ? String(selectedId) : "";
                  if (newVal && Array.from(projSelect.options).every((opt) => opt.value !== newVal)) {
                    const opt = document.createElement("option");
                    opt.value = newVal;
                    opt.textContent = selectedItem.name;
                    projSelect.appendChild(opt);
                  }
                  projSelect.value = newVal;
                  MarkeeStorage.set("markee_wip_pull_project", newVal);
                  projSelect.dispatchEvent(new Event("change"));
                }
              }
              updateWipPullCardLabels();
            },
          });
        });
      };
    }

    if (featureInput) {
      featureInput.addEventListener("input", (e) => {
        MarkeeStorage.set("markee_wip_pull_feature", e.target.value.trim());
      });
    }

    // Gắn sự kiện cho 3 Chips của WIP (⭐ Ưu thích, Tất cả, Gần đây)
    const chipsContainer = document.getElementById("markee-wip-chips-container");
    if (chipsContainer) {
      const chipBtns = chipsContainer.querySelectorAll(".markee-wip-chip-btn");
      chipBtns.forEach((btn) => {
        btn.onclick = (e) => {
          const filter = e.target.dataset.filter || "all";
          currentWipPullChipFilter = filter;
          MarkeeStorage.set("markee_wip_pull_chip_filter", filter);

          // Cập nhật trạng thái active cho Chips (Duy nhất 1 chip sáng màu)
          chipBtns.forEach((b) => {
            b.classList.remove("active");
            if (b.dataset.filter === "favorite") {
              b.style.background = "rgba(245, 158, 11, 0.08)";
              b.style.borderColor = "rgba(245, 158, 11, 0.3)";
              b.style.color = "#f59e0b";
              b.style.fontWeight = "500";
            } else {
              b.style.background = "#1a1a2e";
              b.style.borderColor = "#c40009";
              b.style.color = "#ff3344";
              b.style.fontWeight = "500";
            }
          });

          e.target.classList.add("active");
          if (filter === "favorite") {
            e.target.style.background = "#f59e0b";
            e.target.style.borderColor = "#f59e0b";
            e.target.style.color = "#0f172a";
            e.target.style.fontWeight = "bold";
          } else {
            e.target.style.background = "#10b981";
            e.target.style.borderColor = "#10b981";
            e.target.style.color = "#fff";
            e.target.style.fontWeight = "bold";
          }

          fetchAndRenderWipSummaries(false);
        };
      });

      // Khôi phục trạng thái Chip active từ Local Storage
      const savedChip = MarkeeStorage.get("markee_wip_pull_chip_filter", "all");
      const activeBtn = Array.from(chipBtns).find((b) => b.dataset.filter === savedChip);
      if (activeBtn) {
        activeBtn.click();
      }
    }

    updateWipPullCardLabels();
  }

  const featureLists = {
    "markee-feature-input-push": [],
    "markee-feature-input-pull": [],
  };

  function renderCustomFeatureDropdown(inputId, filterVal = "") {
    const input = document.getElementById(inputId);
    if (!input) return;

    const isPull = inputId.includes("pull");
    const targetDropdownId = isPull ? "custom-feature-dropdown-pull" : "custom-feature-dropdown-push";
    const dropdown = document.getElementById(targetDropdownId);
    if (!dropdown) return;

    const listKey = isPull ? "markee-feature-input-pull" : "markee-feature-input-push";
    const features = featureLists[listKey] || [];

    const key = (filterVal || "").trim().toLowerCase();
    const filtered = features.filter((f) => !key || String(f).toLowerCase().includes(key));

    if (filtered.length === 0) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      return;
    }

    dropdown.innerHTML = filtered
      .map(
        (f) => `
      <div class="custom-feature-item" data-val="${f}" style="padding: 8px 12px; font-size: 11px; color: #f8fafc; font-weight: 400 !important; cursor: pointer; border-bottom: 1px solid #232338; transition: background 0.15s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        🛠️ ${f}
      </div>
    `
      )
      .join("");

    dropdown.style.display = "block";

    const items = dropdown.querySelectorAll(".custom-feature-item");
    items.forEach((item) => {
      item.onmouseover = () => {
        item.style.background = "#450a0a";
        item.style.color = "#ffffff";
      };
      item.onmouseout = () => {
        item.style.background = "transparent";
        item.style.color = "#f8fafc";
      };
      item.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const val = item.dataset.val;
        input.value = val;
        dropdown.style.display = "none";
        if (isPull) {
          MarkeeStorage.set("markee_wip_pull_feature", val);
        } else {
          MarkeeStorage.set("markee_wip_push_feature", val);
        }
        if (isPull && typeof fetchAndRenderWipSummaries === "function") {
          fetchAndRenderWipSummaries(false);
        }
      };
    });
  }

  function populateFeatureDatalist(datalistId, features) {
    const isPull = datalistId.includes("pull");
    const listKey = isPull ? "markee-feature-input-pull" : "markee-feature-input-push";
    featureLists[listKey] = Array.isArray(features) ? features.filter(Boolean) : [];

    // Tắt hoàn toàn HTML5 native datalist thô kệch
    const datalist = document.getElementById(datalistId);
    if (datalist) datalist.innerHTML = "";

    const targetInputId = isPull ? "markee-feature-input-pull" : "markee-feature-input-push";
    const input = document.getElementById(targetInputId);
    if (input) input.removeAttribute("list");
  }

  function initCustomFeatureDropdownListeners() {
    ["markee-feature-input-push", "markee-feature-input-pull"].forEach((inputId) => {
      const input = document.getElementById(inputId);
      if (!input) return;

      input.removeAttribute("list"); // Ngăn trình duyệt hiện popup trắng native

      input.onfocus = () => {
        renderCustomFeatureDropdown(inputId, input.value);
      };

      input.onclick = () => {
        renderCustomFeatureDropdown(inputId, input.value);
      };

      input.oninput = (e) => {
        renderCustomFeatureDropdown(inputId, e.target.value);
      };
    });

    document.addEventListener("click", (e) => {
      const dropPush = document.getElementById("custom-feature-dropdown-push");
      const dropPull = document.getElementById("custom-feature-dropdown-pull");
      const inputPush = document.getElementById("markee-feature-input-push");
      const inputPull = document.getElementById("markee-feature-input-pull");

      if (dropPush && inputPush && !inputPush.contains(e.target) && !dropPush.contains(e.target)) {
        dropPush.style.display = "none";
      }
      if (dropPull && inputPull && !inputPull.contains(e.target) && !dropPull.contains(e.target)) {
        dropPull.style.display = "none";
      }
    });
  }

  // Khởi tạo các sự kiện cho Tab Download & Upload (Kỹ năng + Tóm tắt)
  initSkillTabListeners();
  initPushSkillStepListeners();
  initWipPushStepListeners();
  initWipPullStepListeners();
  initCustomFeatureDropdownListeners();

  // Load danh sách Khách hàng + Khôi phục bộ lọc lưu trữ F5 (Persistence)
  function loadCustomers() {
    chrome.runtime.sendMessage({ action: "GET_CUSTOMERS" }, (res) => {
      allCustomers = res && Array.isArray(res.customers) ? res.customers : [];
      const customerPush = document.getElementById("markee-customer-select-push");
      const customerPull = document.getElementById("markee-customer-select-pull");
      renderSelectOptions(customerPush, allCustomers, "-- Chọn Khách hàng --");
      renderSelectOptions(customerPull, allCustomers, "-- Chọn Khách hàng --");

      // Restore WIP Push customer
      const savedPushCust = MarkeeStorage.get("markee_wip_push_customer");
      if (savedPushCust && customerPush) {
        customerPush.value = String(savedPushCust);
        customerPush.dispatchEvent(new Event("change"));
      }

      // Restore WIP Pull customer
      const savedPullCust = MarkeeStorage.get("markee_wip_pull_customer");
      if (savedPullCust && customerPull) {
        customerPull.value = String(savedPullCust);
        customerPull.dispatchEvent(new Event("change"));
      }

      updateWipPushCardLabels();
      updateWipPullCardLabels();
    });
  }

  // Liên kết Dropdown Khách hàng -> Dự án (Upload)
  const customerPushSelect = document.getElementById("markee-customer-select-push");
  const projectPushSelect = document.getElementById("markee-project-select-push");
  if (customerPushSelect && projectPushSelect) {
    customerPushSelect.addEventListener("change", (e) => {
      const customerId = e.target.value;
      if (customerId) MarkeeStorage.set("markee_wip_push_customer", customerId);
      else MarkeeStorage.remove("markee_wip_push_customer");

      renderSelectOptions(projectPushSelect, [], "-- Chọn Dự án --");
      projectPushSelect.disabled = !customerId;
      populateFeatureDatalist("feature-suggestions-push", []);
      updateWipPushCardLabels();
      if (!customerId) return;

      chrome.runtime.sendMessage({ action: "GET_PROJECTS_BY_CUSTOMER", customerId }, (res) => {
        const projects = res && Array.isArray(res.projects) ? res.projects : [];
        renderSelectOptions(projectPushSelect, projects, "-- Chọn Dự án --");
        projectPushSelect.disabled = false;

        const savedPushProj = MarkeeStorage.get("markee_wip_push_project");
        if (savedPushProj && Array.from(projectPushSelect.options).some((o) => o.value === String(savedPushProj))) {
          projectPushSelect.value = String(savedPushProj);
          projectPushSelect.dispatchEvent(new Event("change"));
        }

        updateWipPushCardLabels();
      });
    });

    projectPushSelect.addEventListener("change", (e) => {
      const pId = e.target.value ? Number(e.target.value) : null;
      if (e.target.value) MarkeeStorage.set("markee_wip_push_project", e.target.value);
      else MarkeeStorage.remove("markee_wip_push_project");

      populateFeatureDatalist("feature-suggestions-push", []);
      updateWipPushCardLabels();
      if (!pId) return;

      chrome.runtime.sendMessage({ action: "GET_PROJECT_FEATURES", projectId: pId }, (res) => {
        const features = res && Array.isArray(res.features) ? res.features : [];
        populateFeatureDatalist("feature-suggestions-push", features);
      });
    });
  }

  // Liên kết Dropdown Khách hàng -> Dự án (Download)
  const customerPullSelect = document.getElementById("markee-customer-select-pull");
  const projectPullSelect = document.getElementById("markee-project-select-pull");
  if (customerPullSelect && projectPullSelect) {
    customerPullSelect.addEventListener("change", (e) => {
      const customerId = e.target.value;
      if (customerId) MarkeeStorage.set("markee_wip_pull_customer", customerId);
      else MarkeeStorage.remove("markee_wip_pull_customer");

      renderSelectOptions(projectPullSelect, [], "-- Chọn Dự án --");
      projectPullSelect.disabled = !customerId;
      populateFeatureDatalist("feature-suggestions-pull", []);
      updateWipPullCardLabels();
      fetchAndRenderWipSummaries(false);
      if (!customerId) return;

      chrome.runtime.sendMessage({ action: "GET_PROJECTS_BY_CUSTOMER", customerId }, (res) => {
        const projects = res && Array.isArray(res.projects) ? res.projects : [];
        renderSelectOptions(projectPullSelect, projects, "-- Chọn Dự án --");
        projectPullSelect.disabled = false;

        const savedPullProj = MarkeeStorage.get("markee_wip_pull_project");
        if (savedPullProj && Array.from(projectPullSelect.options).some((o) => o.value === String(savedPullProj))) {
          projectPullSelect.value = String(savedPullProj);
          projectPullSelect.dispatchEvent(new Event("change"));
        }

        updateWipPullCardLabels();
        fetchAndRenderWipSummaries(false);
      });
    });

    projectPullSelect.addEventListener("change", (e) => {
      const pId = e.target.value ? Number(e.target.value) : null;
      if (e.target.value) MarkeeStorage.set("markee_wip_pull_project", e.target.value);
      else MarkeeStorage.remove("markee_wip_pull_project");

      populateFeatureDatalist("feature-suggestions-pull", []);
      updateWipPullCardLabels();
      fetchAndRenderWipSummaries(false);

      if (!pId) return;

      chrome.runtime.sendMessage({ action: "GET_PROJECT_FEATURES", projectId: pId }, (res) => {
        const features = res && Array.isArray(res.features) ? res.features : [];
        populateFeatureDatalist("feature-suggestions-pull", features);
      });
    });
  }

  const featurePullInput = document.getElementById("markee-feature-input-pull");
  if (featurePullInput) {
    // Restore saved feature filter on init
    const savedFeature = MarkeeStorage.get("markee_wip_pull_feature");
    if (savedFeature) featurePullInput.value = savedFeature;

    featurePullInput.addEventListener("input", (e) => {
      MarkeeStorage.set("markee_wip_pull_feature", e.target.value.trim());
      fetchAndRenderWipSummaries(false);
    });
  }

  // Fetch danh sách WIP tóm tắt

  // Reset về trang đầu (gọi khi đổi filter)
  function resetWipPagination() {
    wipCurrentPage = 0;
    const list = document.getElementById("markee-skill-list");
    if (list) list.innerHTML = "";
    const loadMoreBtn = document.getElementById("markee-wip-load-more");
    if (loadMoreBtn) loadMoreBtn.remove();
  }

  function fetchAndRenderWipSummaries(appendMode = false) {
    const list = document.getElementById("markee-skill-list");
    if (!list) return;

    if (!appendMode) {
      // Fresh load: xóa list cũ, reset trang
      wipCurrentPage = 0;
      list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center;">Đang tải...</div>`;
      const oldBtn = document.getElementById("markee-wip-load-more");
      if (oldBtn) oldBtn.remove();
    } else {
      // Append mode: chỉ xóa nút cũ để append vào sau
      const oldBtn = document.getElementById("markee-wip-load-more");
      if (oldBtn) oldBtn.remove();
    }

    const customerSelect = document.getElementById("markee-customer-select-pull");
    const projectSelect = document.getElementById("markee-project-select-pull");
    const featureInput = document.getElementById("markee-feature-input-pull");

    const projectId = projectSelect ? getSelectNumber(projectSelect) : null;
    const customerId = customerSelect ? customerSelect.value : "";
    const featureName = featureInput ? featureInput.value.trim() : "";

    let projectIds = null;
    if (!projectId && customerId && projectSelect) {
      projectIds = [];
      for (let option of projectSelect.options) {
        if (option.value) projectIds.push(Number(option.value));
      }
      if (projectIds.length === 0) {
        list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center;">Chưa có dữ liệu</div>`;
        return;
      }
    }

    // Tính offset cho trang hiện tại
    const offset = wipCurrentPage * WIP_PAGE_SIZE;

    const wipSearchInput = document.getElementById("wip-search-input");
    const keyword = wipSearchInput ? wipSearchInput.value.trim() : "";

    chrome.runtime.sendMessage(
      {
        action: "GET_SKILLS",
        skillType: "wip",
        filterType: currentWipPullChipFilter || "all",
        userId: currentUser,
        projectId: projectId,
        projectIds: projectIds,
        featureName: featureName,
        limit: WIP_PAGE_SIZE,
        offset: offset,
        keyword: keyword,
      },
      (res) => {
        // Nếu đồng bộ fresh load: xóa "Đang tải..."
        if (!appendMode) list.innerHTML = "";

        const skills = res && Array.isArray(res.skills) ? res.skills : [];

        if (skills.length > 0) {
          skills.forEach((s) => {
            const item = document.createElement("div");
            item.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: #1a1a2e; padding: 6px; border-radius: 4px; border: 1px solid #232340; margin-bottom: 4px;";

            let displayTitle = s.title || "Tóm tắt";
            if (s.feature_name) displayTitle += ` [${s.feature_name}]`;
            const rawAf = s.attached_file;
            const fileInfoRender = Array.isArray(rawAf) ? rawAf[0] : rawAf;
            const hasAttachment = !!(fileInfoRender && fileInfoRender.storage_path);
            const fileIcon = hasAttachment ? " 📎" : "";

            // Nút Favorite Star (Ưu thích)
            const starBtn = document.createElement("button");
            const isFav = !!s.is_favorite;
            starBtn.innerHTML = isFav ? "⭐" : "☆";
            starBtn.title = isFav ? "Bỏ ưu thích" : "Thêm vào ưu thích";
            starBtn.style.cssText = `background: transparent; border: none; font-size: 13px; cursor: pointer; padding: 0 4px; color: ${isFav ? "#f59e0b" : "#64748b"};`;
            starBtn.onclick = (e) => {
              e.stopPropagation();
              chrome.runtime.sendMessage(
                {
                  action: "TOGGLE_FAVORITE_SKILL",
                  skillId: s.id,
                  userId: currentUser,
                },
                (favRes) => {
                  if (favRes && favRes.success) {
                    s.is_favorite = favRes.isFavorite;
                    starBtn.innerHTML = favRes.isFavorite ? "⭐" : "☆";
                    starBtn.style.color = favRes.isFavorite ? "#f59e0b" : "#64748b";
                    showToast(favRes.isFavorite ? "⭐ Đã thêm vào Ưu thích!" : "Đã bỏ khỏi Ưu thích", "success");
                    if (currentWipPullChipFilter === "favorite" && !favRes.isFavorite) {
                      item.remove();
                    }
                  }
                }
              );
            };

            const titleSpan = document.createElement("span");
            titleSpan.style.cssText = "font-size: 11px; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; max-width: 170px;";
            titleSpan.innerText = `📝 ${displayTitle}${fileIcon}`;

            const leftDiv = document.createElement("div");
            leftDiv.style.cssText = "display: flex; align-items: center; gap: 4px; overflow: hidden;";
            leftDiv.appendChild(starBtn);
            leftDiv.appendChild(titleSpan);

            const btn = document.createElement("button");
            btn.innerText = hasAttachment ? "Dùng + File" : "Dùng";
            btn.title = hasAttachment ? `Kèm file: ${fileInfoRender.file_name || fileInfoRender.name || fileInfoRender.storage_path}` : "";
            btn.style.cssText = `background: ${hasAttachment ? "#0d9488" : "#10b981"}; color: #fff; border: none; border-radius: 4px; font-size: 9px; padding: 4px 8px; cursor: pointer; white-space: nowrap;`;
            btn.onclick = () => {
              // Ghi nhận lịch sử "Dùng" ngầm vào user_recent_skills
              chrome.runtime.sendMessage({
                action: "SAVE_RECENT_SKILL",
                skillId: s.id,
                userId: currentUser,
              });
              reuseWipWithAttachment(s);
            };

            item.appendChild(leftDiv);
            item.appendChild(btn);
            list.appendChild(item);
          });

          // Hiển thị nút "Xem thêm" nếu số bản ghi trả về đóng WIP_PAGE_SIZE (có thể còn trang tiếp)
          if (skills.length === WIP_PAGE_SIZE) {
            const loadMoreBtn = document.createElement("button");
            loadMoreBtn.id = "markee-wip-load-more";
            loadMoreBtn.innerText = "⬇ Xem thêm";
            loadMoreBtn.style.cssText = ["width: 100%", "margin-top: 6px", "padding: 5px 0", "background: #2a1013", "color: #ff3344", "border: 1px solid #e3000f", "border-radius: 4px", "font-size: 10px", "cursor: pointer", "transition: background 0.2s"].join(";");
            loadMoreBtn.onmouseover = () => (loadMoreBtn.style.background = "#450a0a");
            loadMoreBtn.onmouseout = () => (loadMoreBtn.style.background = "#2a1013");
            loadMoreBtn.onclick = () => {
              wipCurrentPage += 1;
              fetchAndRenderWipSummaries(true); // append mode
            };
            list.appendChild(loadMoreBtn);
          }
        } else if (!appendMode) {
          // Chỉ hiển "Chưa có dữ liệu" nếu đây là fresh load và rỗng
          list.innerHTML = `<div style="font-size: 10px; color: #64748b; text-align: center;">Chưa có dữ liệu</div>`;
        }
        // Nếu appendMode và rỗng: không append gì — "Xem thêm" đã bị remove ở trên
      },
    );
  }

  // Hàm Lưu Tóm Tắt
  async function saveWipSummary() {
    const allBlocks = document.querySelectorAll("pre code, div.cm-content");
    const codeBlocks = Array.from(allBlocks).filter((el) => !el.closest("#prompt-textarea"));

    if (codeBlocks.length === 0) return showToast("⚠️ Không tìm thấy code block Markdown!", "warning");

    let validContent = null,
      docTitle = "";

    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      const block = codeBlocks[i];
      let md = "";

      // FIX: Nối dòng cho CodeMirror của ChatGPT để không bị dính chữ (mất dấu Enter)
      if (block.classList.contains("cm-content") || block.querySelector(".cm-line")) {
        const lines = Array.from(block.querySelectorAll(".cm-line")).map((l) => l.innerText || l.textContent);
        md = lines.join("\n");
      } else {
        md = block.innerText || block.textContent || "";
      }

      md = md.trim().replace(/^markdown\n/i, "");
      const match = md.match(new RegExp(`# WIP:\\s*(.*)`, "i"));
      if (match && !match[1].includes("[Tên")) {
        validContent = md;
        docTitle = match[1].trim();
        break;
      }
    }
    if (!validContent) return showToast(`⛔ Không tìm thấy nội dung "WIP" hợp lệ!`, "error");

    const featureInput = document.getElementById("markee-feature-input-push");

    // KPI Prototype: dự án là lựa chọn hiện tại (chọn qua ô tìm kiếm #wip-project-search-input).
    const selectedProject = await getSelectedProjectAsync();
    const pId = selectedProject.projectId || null;
    const fName = featureInput ? featureInput.value.trim() : "";

    if (!pId) {
      return showToast("⚠️ Vui lòng chọn Dự án trước khi lưu!", "warning");
    }

    // --- Bước 1: DOM-scrape (hút file trực tiếp từ DOM của tin nhắn AI cuối) ---
    showToast("⏳ Đang quét file AI...");
    let autoFiles = [];
    const isClaude = window.location.href.includes("claude.ai");
    try {
      const scraper = window.markeeAutoScrapeAIFiles;
      if (typeof scraper === "function") {
        autoFiles = await scraper();
      }

      if (isClaude) {
        if (autoFiles.length > 0) {
          const sorted = [...autoFiles].sort((a, b) => {
            const timeDiff = (b.lastUpdated || 0) - (a.lastUpdated || 0);
            if (timeDiff !== 0) return timeDiff;
            return (b.version || 0) - (a.version || 0);
          });
          autoFiles = [sorted[0]];
          console.log(`[Markee AutoScrape] 🎯 Claude Mode: Chỉ trích xuất 1 file cập nhật gần nhất: ${autoFiles[0].fileName || autoFiles[0].name}`);
        }
      } else {
        // CHATGPT / GEMINI: Giữ nguyên 100% logic cũ
        if (window.geminiActiveDOMFile) {
          const gf = window.geminiActiveDOMFile;
          const gfName = gf.fileName || gf.name || "";
          if (gfName && !autoFiles.some((af) => (af.fileName || af.name) === gfName)) {
            autoFiles.push(gf);
          }
        }
        if (Array.isArray(window.capturedAIFiles)) {
          const cleanNameFn = (n) =>
            typeof window.sanitizeFileName === "function"
              ? window.sanitizeFileName(n)
              : String(n || "")
                  .replace(/\s*\(\d+\)(?=\.[a-zA-Z0-9]+$|$)/gi, "")
                  .trim();
          for (const f of window.capturedAIFiles.slice().reverse()) {
            const rawName = f.fileName || f.name || "";
            const fName = cleanNameFn(rawName);
            if (fName && !autoFiles.some((af) => cleanNameFn(af.fileName || af.name) === fName)) {
              const cleanF = Object.assign({}, f, { fileName: fName, name: fName });
              autoFiles.push(cleanF);
            }
          }
        }
      }
    } catch (err) {
      console.log("🟡 [Markee] autoScrapeAIFiles gặp lỗi:", err.message);
    }

    // --- Bước 2: Parse sandbox paths từ AI markdown, resolve qua AI adapters ---
    // (attachment_service.js cần được load trước ui.js)
    try {
      const service = window.markeeAttachmentService;
      if (service && typeof service.finalizePayload === "function") {
        // Lấy text của tin nhắn AI cuối cùng để parse sandbox paths
        const hostname = window.location.hostname;
        let lastAIEl = null;
        if (hostname.includes("chatgpt.com")) {
          const els = document.querySelectorAll('[data-message-author-role="assistant"]');
          lastAIEl = els.length > 0 ? els[els.length - 1] : null;
        } else if (hostname.includes("claude.ai")) {
          const els = document.querySelectorAll('[data-is-streaming="false"], .font-claude-message');
          lastAIEl = els.length > 0 ? els[els.length - 1] : null;
        } else if (hostname.includes("gemini.google.com")) {
          const els = document.querySelectorAll("model-response, .model-response-text");
          lastAIEl = els.length > 0 ? els[els.length - 1] : null;
        }

        const aiText = lastAIEl ? lastAIEl.innerText || lastAIEl.textContent || "" : "";
        const platform = hostname.includes("chatgpt") ? "ChatGPT" : hostname.includes("claude") ? "Claude" : hostname.includes("gemini") ? "Gemini" : "ChatGPT";

        const enriched = await service.finalizePayload({ autoScrapedFiles: autoFiles }, aiText, platform, lastAIEl);

        // Merge sandbox-resolved files into autoFiles (deduplicate by fileName)
        const existingNames = new Set(autoFiles.map((f) => f.fileName || f.name || ""));
        for (const f of enriched.autoScrapedFiles || []) {
          const fName = f.fileName || f.name || "";
          if (fName && !existingNames.has(fName)) {
            autoFiles.push(f);
            existingNames.add(fName);
          }
        }
      }
    } catch (err) {
      console.log("🟡 [Markee] finalizePayload gặp lỗi, tiếp tục lưu text:", err.message);
    }

    if (autoFiles.length > 0) {
      showToast(`✅ Đã tự hút ${autoFiles.length} file từ AI! Đang lưu...`);
    } else {
      showToast("⏳ Đang lưu...");
    }

    chrome.runtime.sendMessage({
      action: "SAVE_SCRAPED_MARKDOWN",
      isWipMode: true,
      autoScrapedFiles: autoFiles,
      data: {
        title: "WIP: " + docTitle,
        markdown_content: validContent,
        author_id: currentUser,
        category: "General",
        skill_type: "wip",
        status: "approved",
        project_id: pId,
        feature_name: fName,
        session_tokens: estimateTokens(document.body.innerText),
      },
    }, (res) => {
      if (res && res.success === false) {
        showToast(`⚠️ ${res.error || "Lưu Tóm Tắt thất bại."}`, "warning");
      }
    });
  }

  // --- CẬP NHẬT LOGIC NÚT LỆNH (MỤC TIÊU 2) ---
  document.getElementById("btn-copy-prompt").onclick = async () => {
    const selectedProject = await getSelectedProjectAsync();
    const customPrompt = selectedProject.projectName
      ? `DỰ ÁN ĐANG CHỌN: ${selectedProject.projectName}\n\n${EXTRACTION_PROMPT}`
      : EXTRACTION_PROMPT;
    insertSkillToChat(customPrompt);
  };

  document.getElementById("btn-wip-prompt").onclick = () => {
    insertSkillToChat(SUMMARY_PROMPT);
  };

  document.getElementById("btn-save-wip").onclick = saveWipSummary;

  // Gọi khởi tạo Khách hàng
  loadCustomers();

  async function scanAndSave(docTypePrefix, skillTypeVal) {
    const allBlocks = document.querySelectorAll("pre code, div.cm-content");
    const codeBlocks = Array.from(allBlocks).filter((el) => !el.closest("#prompt-textarea"));

    if (codeBlocks.length === 0) return showToast("⚠️ Không tìm thấy code block Markdown!", "warning");

    let validContent = null,
      docTitle = "";

    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      const block = codeBlocks[i];
      let md = "";

      // FIX: Nối dòng cho CodeMirror của ChatGPT
      if (block.classList.contains("cm-content") || block.querySelector(".cm-line")) {
        const lines = Array.from(block.querySelectorAll(".cm-line")).map((l) => l.innerText || l.textContent);
        md = lines.join("\n");
      } else {
        md = block.innerText || block.textContent || "";
      }

      md = md.trim().replace(/^markdown\n/i, "");
      const match = md.match(new RegExp(`# ${docTypePrefix}:\\s*(.*)`, "i"));
      if (match && !match[1].includes("[Tên")) {
        validContent = md;
        docTitle = match[1].trim();
        break;
      }
    }
    if (!validContent) return showToast(`⛔ Không tìm thấy nội dung "${docTypePrefix}" hợp lệ!`, "error");

    const attachProjectCb = document.getElementById("skill-attach-project-checkbox");
    let pId = null;
    if (!attachProjectCb || attachProjectCb.checked) {
      const selectedProject = await getSelectedProjectAsync();
      pId = selectedProject.projectId || null;
    }
    let finalSkillType = docTypePrefix === "SKILL" ? document.getElementById("markee-asset-type-select").value : skillTypeVal;

    showToast("⏳ Đang lưu...");
    chrome.runtime.sendMessage({
      action: "SAVE_SCRAPED_MARKDOWN",
      data: {
        title: (docTypePrefix === "WIP" ? "WIP: " : "") + docTitle,
        markdown_content: validContent,
        author_id: currentUser,
        category: "General",
        skill_type: finalSkillType,
        status: skillTypeVal === "wip" ? "approved" : "pending",
        project_id: pId,
        department_id: getSelectNumber(departmentSelect),
        team_id: getSelectNumber(teamSelect),
        session_tokens: estimateTokens(document.body.innerText),
      },
    }, (res) => {
      if (res && res.success === false) {
        showToast(`⚠️ ${res.error || "Lưu Kỹ Năng thất bại."}`, "warning");
      }
    });
  }
  document.getElementById("btn-save-skill").onclick = () => scanAndSave("SKILL", "dynamic");
}

// Shared project-picker wiring — used by both the popup's search box and
// the WIP-push view's search box. There is no per-project download
// anymore: the active project is a value in chrome.storage.local managed by
// background.js's getSelectedProject()/setSelectedProject(), fetched/set only
// via messages (GET_PROJECTS / GET_SELECTED_PROJECT / SET_SELECTED_PROJECT)
// so the "fall back to suggested default" logic stays centralized there.
function getSelectedProjectAsync() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "GET_SELECTED_PROJECT" }, (r) => resolve(r || {}));
  });
}

// Type-to-search project picker — mirrors markee-dashboard's own "Chọn Dự án"
// combobox (app/components/AIChat/ChatInput.tsx): plain substring match over
// the project name as you type, click a row to select, no native <select>.
function wireProjectSearch(inputEl, resultsEl, currentNameEl, onChanged, theme) {
  if (!inputEl || !resultsEl) return;

  let allProjects = [];
  let selectedId = null;

  function rowHtml(p) {
    const isSelected = selectedId && String(selectedId) === String(p.id);
    if (theme === "dark") {
      const base = "width:100%;text-align:left;background:#161625;color:#fff;border:1px solid #c40009;border-radius:6px;padding:6px 8px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      const sel = isSelected ? "background:#2a1013;border-color:#ff3344;" : "";
      return `<button type="button" class="ktp-project-row" data-id="${p.id}" data-name="${p.name.replace(/"/g, "&quot;")}" style="${base}${sel}">
        <span style="overflow:hidden;text-overflow:ellipsis;">${p.name}</span>
        ${isSelected ? '<span style="font-size:9px;font-weight:800;color:#ff3344;flex-shrink:0;">Đang chọn</span>' : ""}
      </button>`;
    }
    return `<button type="button" class="project-result-item${isSelected ? " selected" : ""}" data-id="${p.id}" data-name="${p.name.replace(/"/g, "&quot;")}">
      <span>${p.name}</span>
      ${isSelected ? '<span class="badge">Đang chọn</span>' : ""}
    </button>`;
  }

  function emptyHtml(text) {
    return theme === "dark"
      ? `<div style="text-align:center;color:#ff3344;font-size:11px;padding:8px 0;">${text}</div>`
      : `<div class="project-empty">${text}</div>`;
  }

  function render(query) {
    const q = (query || "").toLowerCase();
    const filtered = q ? allProjects.filter((p) => p.name.toLowerCase().includes(q)) : allProjects;
    resultsEl.innerHTML = filtered.length ? filtered.map(rowHtml).join("") : emptyHtml("Không tìm thấy dự án nào");
    resultsEl.querySelectorAll(".ktp-project-row, .project-result-item").forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.dataset.id);
        const name = btn.dataset.name;
        chrome.runtime.sendMessage({ action: "SET_SELECTED_PROJECT", projectId: id, projectName: name }, () => {
          selectedId = id;
          if (currentNameEl) currentNameEl.textContent = name;
          inputEl.value = "";
          render("");
          if (typeof onChanged === "function") onChanged(id, name);
        });
      };
    });
  }

  chrome.runtime.sendMessage({ action: "GET_PROJECTS" }, (res) => {
    allProjects = res && Array.isArray(res.projects) ? res.projects : [];
    chrome.runtime.sendMessage({ action: "GET_SELECTED_PROJECT" }, (state) => {
      selectedId = state && state.projectId ? state.projectId : null;
      if (currentNameEl) currentNameEl.textContent = (state && state.projectName) || "—";
      render("");
    });
  });

  inputEl.oninput = () => render(inputEl.value);
}

function initLoginPopup() {
  const loginForm = document.getElementById("login-form");
  const emailInput = document.getElementById("login-email-input");
  const passwordInput = document.getElementById("login-password-input");
  const loginStatus = document.getElementById("login-status");
  const loggedInView = document.getElementById("logged-in-view");
  const loggedInEmail = document.getElementById("logged-in-email");
  const logoutBtn = document.getElementById("logout-btn");

  if (!loginForm || !emailInput || !passwordInput || !loginStatus) return false;

  function showLoggedOut() {
    if (loggedInView) loggedInView.hidden = true;
    loginForm.hidden = false;
  }

  function showLoggedIn(email) {
    if (loggedInView) {
      loggedInView.hidden = false;
      if (loggedInEmail) loggedInEmail.textContent = email || "";
    }
    loginForm.hidden = true;
  }

  function refreshAuthState() {
    chrome.runtime.sendMessage({ action: "GET_AUTH_STATE" }, (state) => {
      if (state && state.loggedIn) {
        showLoggedIn(state.email);
        return;
      }
      // Not logged into the extension yet — try borrowing the pm-new WEB
      // APP's own session cookie before falling back to the manual
      // email/password form (passwordless path — see background.js's
      // tryAutoLoginFromCookie()).
      loginStatus.textContent = "Đang kiểm tra đăng nhập...";
      chrome.runtime.sendMessage({ action: "TRY_AUTO_LOGIN" }, (res) => {
        loginStatus.textContent = "";
        if (res && res.success) {
          showLoggedIn(res.email);
          wireProjectSearch(
            document.getElementById("project-search-input"),
            document.getElementById("project-search-results"),
            document.getElementById("project-current-name"),
          );
        } else {
          showLoggedOut();
        }
      });
    });
  }
  refreshAuthState();
  wireProjectSearch(
    document.getElementById("project-search-input"),
    document.getElementById("project-search-results"),
    document.getElementById("project-current-name"),
  );

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      loginStatus.textContent = "Vui lòng nhập email và mật khẩu.";
      loginStatus.classList.add("error");
      return;
    }

    loginStatus.textContent = "Đang đăng nhập...";
    loginStatus.classList.remove("error");

    chrome.runtime.sendMessage({ action: "LOGIN", email, password }, (res) => {
      if (res && res.success) {
        loginStatus.textContent = "Đăng nhập thành công!";
        loginStatus.classList.remove("error");
        passwordInput.value = "";
        showLoggedIn(res.email);
        // The project list can only be fetched once authenticated — the
        // initial wireProjectSearch() call at popup-load time (before login)
        // always came back empty, so reload it now that we have a token.
        wireProjectSearch(
          document.getElementById("project-search-input"),
          document.getElementById("project-search-results"),
          document.getElementById("project-current-name"),
        );
      } else {
        loginStatus.textContent = (res && res.error) || "Đăng nhập thất bại.";
        loginStatus.classList.add("error");
      }
    });
  });

  if (logoutBtn) {
    logoutBtn.onclick = () => {
      chrome.runtime.sendMessage({ action: "LOGOUT" }, () => {
        loginStatus.textContent = "";
        showLoggedOut();
      });
    };
  }

  return true;
}

const isPopupUi = initLoginPopup();
function safeAutoInitWidget() {
  const host = window.location.hostname;
  const currentTool = !isPopupUi && typeof AI_SITES !== "undefined" ? AI_SITES[host] || AI_SITES[host.replace("www.", "")] : null;
  if (currentTool) {
    if (!document.getElementById("markee-widget")) {
      injectWidget(currentTool);
    }
    if (!document.getElementById("markee-floating-toggle")) {
      injectFloatingToggleButton();
    }
    applyPositions();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeAutoInitWidget);
} else {
  safeAutoInitWidget();
}

window.addEventListener("resize", () => {
  applyPositions();
});

chrome.runtime.onMessage.addListener((msg) => {
  // 1. Safe Message Handler Bật / Tắt Widget khi bấm Action Icon
  if (msg.action === "toggle_widget" || msg.action === "toggle-extension" || msg.action === "toggle_markee_widget") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        toggleMarkeeWidget();
      });
    } else {
      toggleMarkeeWidget();
    }
  }

  // Tín hiệu từ Background: Reload lại danh sách WIP sau khi lưu thành công
  // (hàm UI chỉ được gọi trong Content Script, KHÔNG bao giờ trong background.js)
  if (msg.action === "RELOAD_WIP_LIST" || msg.action === "refreshWipList") {
    if (typeof fetchAndRenderWipSummaries === "function") {
      fetchAndRenderWipSummaries(false);
    }
  }

  // Tín hiệu từ Background: Phiên bản đã cập nhật / không có bản mới → Reset toàn bộ UI thông báo
  if (msg.action === "VERSION_UP_TO_DATE") {
    if (typeof resetVersionUI === "function") {
      resetVersionUI();
    }
  }

  // Feature 2: UPDATE_AVAILABLE — Chấm đỏ & Tooltip đen định vị sát phía TRÊN cụm Icon
  if (msg.action === "UPDATE_AVAILABLE") {
    const { remoteVersion, downloadUrl } = msg;

    if (typeof updateVersionBanner === "function") {
      updateVersionBanner(remoteVersion, downloadUrl);
    }

    // Inject CSS định vị Tooltip phía TRÊN cụm Icon & hiệu ứng chấm đỏ
    if (!document.getElementById("markee-update-badge-style")) {
      const style = document.createElement("style");
      style.id = "markee-update-badge-style";
      style.textContent = `
        @keyframes markee-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.8); transform: scale(1); }
          70%  { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);  transform: scale(1.15); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);    transform: scale(1); }
        }
        #markee-update-badge {
          position: absolute;
          top: -3px;
          right: -3px;
          width: 11px;
          height: 11px;
          background: #ef4444;
          border: 2px solid #fff;
          border-radius: 50%;
          cursor: pointer;
          z-index: 999999;
          animation: markee-pulse 1.6s ease-out infinite;
        }
        #markee-update-tooltip {
          position: absolute;
          bottom: 38px;
          right: 0px;
          white-space: nowrap;
          background: #1e1e2f;
          color: #ffffff;
          padding: 8px 14px;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(239, 68, 68, 0.5);
          border: 1px solid #ef4444;
          font-size: 12px;
          font-weight: 600;
          pointer-events: none;
          z-index: 9999999 !important;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s ease, visibility 0.2s ease;
        }
        #markee-floating-toggle:hover #markee-update-tooltip {
          opacity: 1;
          visibility: visible;
        }
      `;
      document.head.appendChild(style);
    }

    const btn = document.getElementById("markee-floating-toggle");
    if (btn) {
      btn.style.position = "relative";
      btn.removeAttribute("title"); // Xóa tooltip trắng mặc định của trình duyệt trên icon Cái Não

      // Gắn chấm đỏ (Red Dot Badge) nếu chưa có
      if (!document.getElementById("markee-update-badge")) {
        const badge = document.createElement("span");
        badge.id = "markee-update-badge";
        badge.removeAttribute("title"); // Xóa thuộc tính title để tránh hiện tooltip trắng mặc định
        badge.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation(); // Phân tách Click: chỉ tải về, không mở/đóng Workspace
          chrome.runtime.sendMessage({ action: "OPEN_DASHBOARD_URL", url: downloadUrl });
          window.open(downloadUrl, "_blank");
        };
        btn.appendChild(badge);
      }

      // Gắn duy nhất 1 khung thông báo màu đen (Tooltip) định vị ngay SÁT PHÍA TRÊN cụm Icon
      if (!document.getElementById("markee-update-tooltip")) {
        const tooltip = document.createElement("div");
        tooltip.id = "markee-update-tooltip";
        tooltip.innerText = `🚀 Có phiên bản mới ${remoteVersion}! Click vào chấm đỏ để tải về.`;
        btn.appendChild(tooltip);
      }

      // Xóa mọi toast dư thừa cũ nếu có
      const oldToast = document.getElementById("markee-update-toast");
      if (oldToast) oldToast.remove();

      console.log(`[Markee UI] 🚀 Update UI phiên bản v${remoteVersion} sẵn sàng!`);
    }
  }

  // 2. ĐOẠN CODE HIỂN THỊ POPUP TẢI XUỐNG CỦA BẠN
  if (msg.action === "SHOW_SUCCESS") {
    // Refresh được xử lý bởi RELOAD_WIP_LIST signal (được background gửi đồng thời)
    const overlay = document.createElement("div");
    Object.assign(overlay.style, { position: "fixed", top: "0", left: "0", width: "100%", height: "100%", backgroundColor: "rgba(0, 0, 0, 0.6)", backdropFilter: "blur(4px)", zIndex: "999998", display: "flex", alignItems: "center", justifyContent: "center" });

    const modal = document.createElement("div");
    Object.assign(modal.style, { backgroundColor: "#1e1e2f", color: "#fff", padding: "24px", borderRadius: "16px", width: "400px", textAlign: "center", border: "1px solid #c40009" });

    let descriptionText = `Bản ghi <strong>"${msg.title}"</strong> đã đẩy lên Thư viện.`;
    let actionBtnHtml = `<button id="markee-btn-download" style="padding: 10px 20px; background: #10b981; border: none; color: white; border-radius: 8px; cursor: pointer; font-weight: bold;">📥 Tải xuống .md</button>`;

    // 1. CẬP NHẬT GIAO DIỆN NÚT (Thêm nút Mở Link)
    if (msg.isWipMode) {
      let displayFileName = msg.fileName || "";
      if (!displayFileName && Array.isArray(msg.files) && msg.files.length > 0) {
        displayFileName = msg.files
          .map((f) => f.fileName || f.name)
          .filter(Boolean)
          .join(", ");
      }
      const fileSuffix = displayFileName ? ` và file <strong>"${displayFileName}"</strong>` : "";
      descriptionText = `Đã lưu thành công bản tóm tắt <strong>"${msg.title}"</strong>${fileSuffix}.`;

      // Thêm nút Mở Link (Màu xanh dương) bên cạnh nút Copy Link (Màu xanh lá)
      actionBtnHtml = `
      <button id="markee-btn-open-link" style="padding: 10px 16px; background: #3b82f6; border: none; color: white; border-radius: 8px; cursor: pointer; font-weight: bold;">🌐 Mở Link</button>
      <button id="markee-btn-copy-link" style="padding: 10px 16px; background: #10b981; border: none; color: white; border-radius: 8px; cursor: pointer; font-weight: bold;">🔗 Copy</button>
    `;
    }

    modal.innerHTML = `
    <div style="font-size: 40px; margin-bottom: 10px;">🎉</div>
    <h2 style="margin: 0 0 10px 0; color: #10b981; font-size: 20px;">Lưu Thành Công!</h2>
    <p style="color: #cbd5e1; font-size: 14px; margin-bottom: 20px; text-align: center; line-height: 1.5;">${descriptionText}</p>
    <div style="display: flex; gap: 12px; justify-content: center;">
      ${actionBtnHtml}
      <button id="markee-btn-close" style="padding: 10px 20px; background: #e3000f; border: none; color: white; border-radius: 8px; cursor: pointer; font-weight: bold;">Đóng</button>
    </div>`;

    overlay.appendChild(modal);
    appendToBodySafe(overlay);

    // 2. CẬP NHẬT LOGIC XỬ LÝ SỰ KIỆN CLICK
    if (msg.isWipMode) {
      // Hàm dùng chung để gọi lấy link (Tránh duplicate code)
      const fetchShareLink = (callback) => {
        const pushFeatureInput = document.getElementById("markee-feature-input-push");
        const currentFeatureVal = (pushFeatureInput && pushFeatureInput.value.trim()) || msg.featureName || null;
        chrome.runtime.sendMessage(
          {
            action: "GET_PROJECT_SHARE_LINK",
            projectId: msg.projectId,
            featureName: currentFeatureVal,
          },
          callback,
        );
      };

      // Nút Mở Link
      document.getElementById("markee-btn-open-link").onclick = () => {
        const btnOpen = document.getElementById("markee-btn-open-link");
        btnOpen.innerText = "⏳ Đang mở...";
        btnOpen.disabled = true;

        fetchShareLink((res) => {
          btnOpen.disabled = false;
          btnOpen.innerText = "🌐 Mở Link";
          if (res && res.success && res.shareUrl) {
            window.open(res.shareUrl, "_blank"); // Mở sang tab mới
          } else {
            alert("⛔ Lỗi tạo link dự án!");
          }
        });
      };

      // Nút Copy Link
      document.getElementById("markee-btn-copy-link").onclick = () => {
        const btnCopy = document.getElementById("markee-btn-copy-link");
        btnCopy.innerText = "⏳ Đang copy...";
        btnCopy.disabled = true;

        fetchShareLink((res) => {
          btnCopy.disabled = false;
          btnCopy.innerText = "🔗 Copy";
          if (res && res.success && res.shareUrl) {
            navigator.clipboard
              .writeText(res.shareUrl)
              .then(() => {
                const toast = document.createElement("div");
                Object.assign(toast.style, {
                  position: "fixed",
                  top: "20px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "#10b981",
                  color: "#fff",
                  padding: "12px 24px",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  zIndex: "999999",
                  fontSize: "14px",
                  fontWeight: "bold",
                });
                toast.innerText = "Đã copy link!";
                appendToBodySafe(toast);
                setTimeout(() => toast.remove(), 4000);
              })
              .catch(() => {
                alert("⚠️ Không thể copy link vào Clipboard!");
              });
          } else {
            alert("⛔ Lỗi tạo link dự án!");
          }
        });
      };
    } else {
      // Logic Download cũ giữ nguyên
      document.getElementById("markee-btn-download").onclick = () => {
        const content = msg.markdown_content || msg.content || "";
        const blob = new Blob([content], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeTitle = msg.title ? msg.title.replace(/[^a-zA-Z0-9 \u00C0-\u024F\u1E00-\u1EFF]/g, "").trim() : "markee_doc";
        a.download = `${safeTitle}.md`;
        a.click();
        URL.revokeObjectURL(url);
      };
    }

    // Xử lý nút đóng
    document.getElementById("markee-btn-close").onclick = () => overlay.remove();
  }
});
