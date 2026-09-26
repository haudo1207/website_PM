'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthConfig, googleLogin, outlookLogin, login, type AuthConfig } from '@/lib/api';
import { saveToken } from '@/lib/auth';
import { brand } from '@/lib/brand';
import { initMsal, microsoftLogin } from '@/lib/msal';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const router = useRouter();
  const googleButton = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const finishLogin = (data: { access_token: string; role: string; full_name: string; avatar_url?: string | null; email?: string | null; user_id?: number | null; member_id?: number | null }) => {
    saveToken(data.access_token, data.role, data.full_name, data.avatar_url, data.email, data.user_id, data.member_id);
    router.push('/dashboard/overview');
  };

  useEffect(() => {
    getAuthConfig()
      .then(setConfig)
      .catch(() => setErr('Không tải được cấu hình đăng nhập.'));
    initMsal().catch(() => {});
  }, []);

  useEffect(() => {
    if (!config?.google_login_enabled || !config.google_client_id) return;

    const renderGoogleButton = () => {
      if (!window.google || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: config.google_client_id,
        callback: async ({ credential }) => {
          setLoading(true);
          setErr('');
          try {
            finishLogin(await googleLogin(credential));
          } catch (error: any) {
            setErr(error.response?.data?.detail || 'Email Google này chưa được cấp quyền.');
          } finally {
            setLoading(false);
          }
        },
      });
      googleButton.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleButton.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        width: 320,
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) {
      if (window.google) renderGoogleButton();
      else existing.addEventListener('load', renderGoogleButton, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = renderGoogleButton;
    script.onerror = () => setErr('Không tải được Google Sign-In.');
    document.head.appendChild(script);
  }, [config]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr('');
    try {
      finishLogin(await login(email, pw));
    } catch (error: any) {
      setErr(error.response?.data?.detail || 'Email hoặc mật khẩu không chính xác.');
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    if (!config?.outlook_client_id) return;
    setLoading(true);
    setErr('');
    try {
      finishLogin(await outlookLogin(await microsoftLogin()));
    } catch (error: any) {
      if (error?.message?.includes('User cancelled') || error?.errorCode === 'user_cancelled') {
        setErr('');
      } else {
        setErr(error.response?.data?.detail || 'Đăng nhập Microsoft thất bại. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center p-4 text-[#0b1c30]" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <div className="bg-white border border-[#c2c6d6]/60 rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={brand.logo} alt={`${brand.name} logo`} className="w-14 h-14 rounded-2xl mx-auto mb-4 object-cover shadow-sm border border-slate-200" />
          <h1 className="text-lg font-bold text-[#0b1c30] tracking-tight">{brand.productName.toUpperCase()}</h1>
          <p className="text-[#565e74] text-xs mt-1">{brand.loginSubtitle}</p>
        </div>

        {config?.google_login_enabled && (
          <div className={loading ? 'pointer-events-none opacity-60' : ''}>
            <div ref={googleButton} className="flex min-h-11 justify-center" />
          </div>
        )}

        {config?.outlook_login_enabled && config.outlook_client_id && (
          <div className="mt-3">
            <button
              type="button"
              onClick={handleMicrosoftLogin}
              disabled={loading}
              className="w-full bg-white border border-[#8a8886] hover:bg-[#f5f5f5] text-[#0b1c30] rounded-lg py-2.5 px-3 text-xs font-semibold disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Đăng nhập bằng Microsoft
            </button>
          </div>
        )}

        {config?.password_login_enabled && (
          <form onSubmit={handlePasswordLogin} className="space-y-5 mt-5">
            {config.google_login_enabled && <div className="text-center text-[10px] font-bold uppercase text-slate-400">hoặc</div>}
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email"
              className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2.5 text-xs outline-none focus:border-[#0058be]" />
            <input required type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Mật khẩu"
              className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2.5 text-xs outline-none focus:border-[#0058be]" />
            <button type="submit" disabled={loading} className="w-full bg-[#0058be] text-white rounded-lg py-2.5 text-xs font-bold disabled:opacity-50">
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>
        )}

        {err && <div className="mt-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3.5 py-2.5 font-semibold">{err}</div>}
        <p className="text-center text-[10px] text-[#565e74] mt-6 uppercase tracking-wider font-bold">Chỉ dành cho nhân viên nội bộ</p>
      </div>
    </div>
  );
}
