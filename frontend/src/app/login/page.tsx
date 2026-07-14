'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';
import { saveToken } from '@/lib/auth';
import { brand } from '@/lib/brand';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr('');
    try {
      const d = await login(email, pw);
      saveToken(d.access_token, d.role, d.full_name);
      router.push('/dashboard');
    } catch {
      setErr('Email hoặc mật khẩu không chính xác');
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
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-[#424754] uppercase tracking-wider">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@portal.so"
              className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2.5 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be]/20 placeholder-[#727785] transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-[#424754] uppercase tracking-wider">Mật khẩu</label>
            <input
              type="password"
              required
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2.5 text-xs text-[#0b1c30] outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be]/20 placeholder-[#727785] transition-all"
            />
          </div>
          {err && (
            <div className="bg-[#fee2e2] border border-[#fca5a5] text-[#dc2626] text-xs rounded-lg px-3.5 py-2.5 font-semibold">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#0058be] hover:bg-[#0058be]/90 text-white rounded-lg py-2.5 text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            {loading ? 'Đang đăng nhập...' : 'Đăng Nhập'}
          </button>
        </form>
        <p className="text-center text-[10px] text-[#565e74] mt-6 uppercase tracking-wider font-bold">
          Chỉ dành cho nhân viên nội bộ
        </p>
      </div>
    </div>
  );
}
