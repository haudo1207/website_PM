// Bridge to the "KPI Portal Zalo Login" Chrome extension (extensions/zalo-login/).
// Talks to it via window.postMessage <-> the extension's page-bridge.js content
// script, using the envelope { __zaloExt: true, type, requestId, data }.

export class ZaloExtensionError extends Error {}

export interface ZaloSessionCookies {
  cookies: unknown[];
  imei: string;
  user_agent: string;
}

function sendViaBridge<T>(type: string, data: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
  if (typeof window === 'undefined') {
    return Promise.reject(new ZaloExtensionError('Not running in a browser.'));
  }
  const requestId = `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new ZaloExtensionError('Extension không phản hồi (chưa cài hoặc đã bị vô hiệu hoá).'));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const payload = event.data;
      if (!payload || payload.__zaloExt !== true || payload.requestId !== requestId) return;
      if (payload.type !== 'RESPONSE' && payload.type !== 'PONG') return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (payload.success === false) {
        reject(new ZaloExtensionError(payload.error || 'Extension trả về lỗi không xác định.'));
      } else {
        resolve((payload.data ?? payload) as T);
      }
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ __zaloExt: true, type, requestId, data }, '*');
  });
}

export async function isZaloExtensionInstalled(): Promise<boolean> {
  try {
    await sendViaBridge('PING', {}, 2000);
    return true;
  } catch {
    return false;
  }
}

// Opens (or reuses) a chat.zalo.me tab, waits for the user to be logged in
// there, and returns the harvested cookies — it does NOT call the backend.
// The caller must POST this to /api/zalo/auth/import-session using the
// authenticated app API client (see lib/api.ts::importZaloSession).
export async function requestZaloSessionCookies(): Promise<ZaloSessionCookies> {
  return sendViaBridge<ZaloSessionCookies>('IMPORT_ZALO_SESSION', {}, 70000);
}
