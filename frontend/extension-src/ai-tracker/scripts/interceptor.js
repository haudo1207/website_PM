// ==========================================
// NHIỆM VỤ: Bắt các request chứa FormData và Blob
// Chuyển thành Base64, gửi qua postMessage
// Tích hợp: Xử lý an toàn lỗi CSP & Lọc request rác
// ==========================================

(function () {
  console.log("[Markee Interceptor] 🔍 Khởi tạo interceptor.js");

  // Danh sách các domain tracking/quảng cáo cần bỏ qua để tránh lỗi CSP
  const IGNORED_DOMAINS = ["googleadservices.com", "googletagmanager.com", "google-analytics.com", "play.google.com"];

  function isIgnoredUrl(url) {
    if (!url) return false;
    const urlString = typeof url === "string" ? url : url.url || "";
    return IGNORED_DOMAINS.some((domain) => urlString.includes(domain));
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ========== Monkey-patch window.fetch ==========
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const [resource, config] = args;
    const body = config?.body;

    // Ép kiểu để lấy URL an toàn (vì resource có thể là chuỗi hoặc object Request)
    const urlString = typeof resource === "string" ? resource : resource?.url || "";

    // 1. LỚP PHÒNG NGỰ CHỦ ĐỘNG: Bóp chết request rác từ trong trứng nước
    if (IGNORED_DOMAINS.some((domain) => urlString.includes(domain))) {
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          statusText: "OK",
          headers: new Headers({ "Content-Type": "application/json" }),
        }),
      );
    }

    // 2. Logic chính của bạn: Bắt FormData cho các request hợp pháp
    if (body instanceof FormData) {
      console.log("[Markee Interceptor] 📋 Phát hiện FormData request");
      processFormData(body);
    }

    // 3. Cho qua bình thường với các request hợp lệ
    const fetchPromise = originalFetch.apply(this, args);

    // Bắt link tải file ẩn của ChatGPT và Claude (Chuyển thành Base64, gửi qua postMessage và sessionStorage)
    if (urlString.includes("/interpreter/download") || urlString.includes("/wiggle/download-file")) {
      fetchPromise.then(async (response) => {
        try {
          const clone = response.clone();
          if (urlString.includes("/interpreter/download")) {
            // 1. Trích xuất tên file từ tham số sandbox_path trên URL nếu có
            let extractedFileName = null;
            try {
              const urlObj = new URL(urlString, window.location.origin);
              const sandboxPath = urlObj.searchParams.get("sandbox_path");
              if (sandboxPath) {
                const decodedPath = decodeURIComponent(sandboxPath);
                extractedFileName = decodedPath.split("/").pop();
              }
            } catch (err) {
              const match = urlString.match(/sandbox_path=([^&]+)/);
              if (match && match[1]) {
                const decodedPath = decodeURIComponent(match[1]);
                extractedFileName = decodedPath.split("/").pop();
              }
            }

            let targetFileName = extractedFileName;
            let base64Data = null;
            let mimeType = "application/octet-stream";
            let blobSize = 0;

            const contentType = (response.headers.get("content-type") || "").toLowerCase();

            // KỊCH BẢN A: Response trả về dạng JSON redirect (cấu trúc API cũ)
            if (contentType.includes("application/json")) {
              try {
                const data = await clone.json();
                if (data && data.status === "success" && data.download_url) {
                  if (data.file_name) targetFileName = data.file_name;
                  console.log(`[Markee Interceptor] 🎯 ChatGPT phát hiện download_url cho: ${targetFileName}. Tiến hành tải ngầm...`);
                  const fileRes = await originalFetch(data.download_url, { credentials: "include" });
                  if (fileRes.ok) {
                    const blob = await fileRes.blob();
                    base64Data = await blobToBase64(blob);
                    mimeType = blob.type || "application/octet-stream";
                    blobSize = blob.size;
                  } else {
                    console.log(`[Markee Interceptor] ⚠️ ChatGPT tải ngầm thất bại với HTTP status: ${fileRes.status}`);
                  }
                }
              } catch (e) {
                // Bỏ qua lỗi parse JSON nếu response không phải JSON chuẩn
              }
            }

            // KỊCH BẢN B: Response trả về trực tiếp File Blob / Binary (cấu trúc API mới của ChatGPT Sandbox)
            if (!base64Data && response.ok) {
              try {
                const blob = await clone.blob();
                if (blob && blob.size > 0) {
                  base64Data = await blobToBase64(blob);
                  mimeType = blob.type || contentType || "application/octet-stream";
                  blobSize = blob.size;
                }
              } catch (err) {
                console.log("[Markee Interceptor] ⚠️ Không thể đọc Blob từ response:", err.message);
              }
            }

            // Fallback lấy tên file từ Header Content-Disposition nếu chưa có
            if (!targetFileName) {
              const cd = response.headers.get("content-disposition") || "";
              const match = cd.match(/filename\*?=['"]?(?:UTF-8'')?([^;'"\n]+)['"]?/i);
              if (match && match[1]) {
                targetFileName = decodeURIComponent(match[1]);
              }
            }

            if (base64Data && targetFileName) {
              console.log(`[Markee Interceptor] 🎯 ChatGPT phát hiện download_url cho: ${targetFileName}`);
              const key = `markee_file_blob_${targetFileName}`;
              sessionStorage.setItem(key, base64Data);
              console.log(`[Markee Interceptor] ✅ ChatGPT File Captured as Base64: ${targetFileName}`);

              window.postMessage(
                {
                  type: "MARKEE_FILE_INTERCEPTED",
                  file: {
                    fileName: targetFileName,
                    name: targetFileName,
                    base64: base64Data,
                    data: base64Data,
                    mimeType: mimeType,
                    type: mimeType,
                    size: blobSize,
                  },
                },
                "*"
              );
            }
          } else if (urlString.includes("/wiggle/download-file")) {
            const urlObj = new URL(urlString, window.location.origin);
            const pathVal = urlObj.searchParams.get("path");
            if (pathVal) {
              const filename = decodeURIComponent(pathVal).split("/").pop();
              console.log(`[Markee Interceptor] 🎯 Claude phát hiện download_url cho: ${filename}. Đang trích xuất Blob...`);
              const blob = await clone.blob();
              const base64Data = await blobToBase64(blob);
              const key = `markee_file_blob_${filename}`;
              sessionStorage.setItem(key, base64Data);
              console.log(`[Markee Interceptor] ✅ Claude File Captured as Base64: ${filename}`);

              window.postMessage({
                type: "MARKEE_FILE_INTERCEPTED",
                file: {
                  fileName: filename,
                  name: filename,
                  base64: base64Data,
                  data: base64Data,
                  mimeType: blob.type || "application/octet-stream",
                  type: blob.type || "application/octet-stream",
                  size: blob.size,
                }
              }, "*");
            }
          }
        } catch (e) {
          console.log("[Markee Interceptor] Lỗi phân tích phản hồi tải file:", e.message);
        }
      }).catch((err) => {
        console.log("[Markee Interceptor] Bỏ qua lỗi kết nối / adblock tải file:", err.message);
      });
    }

    return fetchPromise;
  };

  // ========== Monkey-patch XMLHttpRequest.send ==========
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const url = this._url || ""; // Lưu ý: Cần track URL của XHR lúc open nếu muốn lọc chuẩn, nhưng tạm thời bắt lỗi send là đủ an toàn.

    // Kiểm tra nếu là FormData
    if (!isIgnoredUrl(url) && body instanceof FormData) {
      console.log("[Markee Interceptor] 📋 Phát hiện XMLHttpRequest FormData");
      processFormData(body);
    }

    // Tiếp tục gọi send bình thường an toàn
    try {
      return originalXHRSend.apply(this, arguments);
    } catch (error) {
      console.log('🔴 [ERROR]', "[Markee Interceptor] ❌ Lỗi gọi gốc XHR send:", error);
      throw error;
    }
  };

  // Track url cho XHR (Hỗ trợ cho bộ lọc ở trên)
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._url = url;
    return originalXHROpen.apply(this, arguments);
  };

  // ========== Xử lý FormData: Trích xuất File/Blob thành Base64 ==========
  async function processFormData(formData) {
    const entries = formData.entries();
    const files = [];

    for (const [key, value] of entries) {
      // Kiểm tra nếu là File hoặc Blob
      if (value instanceof File || value instanceof Blob) {
        console.log(`[Markee Interceptor] 📦 Phát hiện File/Blob: ${value instanceof File ? value.name : "blob"} (${value.type}, ${(value.size / 1024).toFixed(2)}KB)`);

        try {
          const base64 = await blobToBase64(value);
          files.push({
            fileName: value instanceof File ? value.name : "attachment",
            base64: base64,
            mimeType: value.type || "application/octet-stream",
            size: value.size,
          });
        } catch (err) {
          console.log('🔴 [ERROR]', "[Markee Interceptor] ❌ Lỗi chuyển Blob thành Base64:", err);
        }
      }
    }

    // Nếu có file, gửi qua postMessage
    if (files.length > 0) {
      files.forEach((file) => {
        console.log(`[Markee Interceptor] 📤 Gửi file qua postMessage: ${file.fileName}`);
        window.postMessage(
          {
            type: "MARKEE_FILE_INTERCEPTED",
            file: file,
          },
          "*",
        );
      });
    }
  }

  // ========== Chuyển Blob thành Base64 ==========
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result); // Data URL format
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  console.log("[Markee Interceptor] ✅ Interceptor sẵn sàng! Đã bật khiên chống lỗi CSP.");
})();
