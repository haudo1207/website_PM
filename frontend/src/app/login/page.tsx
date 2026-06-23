'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';
import { saveToken } from '@/lib/auth';

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
      setErr('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4 text-[#e2e8f0]">
      <div className="bg-[#1a1d27] border border-[#2e3250] rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl shadow-lg">
            ⚡
          </div>
          <h1 className="text-xl font-bold text-slate-200 uppercase tracking-wider">Task Compliance Portal</h1>
          <p className="text-[#64748b] text-xs mt-1">Sign in to continue to SecurityZone</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@company.com"
              className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2.5 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Password</label>
            <input
              type="password"
              required
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2.5 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
            />
          </div>
          {err && (
            <div className="bg-red-950/40 border border-red-800/40 text-[#f87171] text-xs rounded-lg px-3.5 py-2.5 font-medium">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#6366f1] hover:bg-[#818cf8] text-white rounded-lg py-2.5 text-xs font-semibold transition-all shadow-md disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className="text-center text-[10px] text-[#64748b] mt-6 uppercase tracking-wider font-bold">
          Internal accounts only
        </p>
      </div>
    </div>
  );
}
