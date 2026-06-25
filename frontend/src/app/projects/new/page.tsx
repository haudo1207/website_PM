'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { addSheet, getUsers } from '@/lib/api';

export default function NewProjectPage() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [currentPhase, setCurrentPhase] = useState('1.Sale/Admin');
  const [leaderEmail, setLeaderEmail] = useState('');
  const [pmEmail, setPmEmail] = useState('');
  const [memberEmails, setMemberEmails] = useState('');
  
  // Auto create Google Sheet settings
  const [autoCreate, setAutoCreate] = useState(true);
  const [url, setUrl] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successData, setSuccessData] = useState<{ id: number; url: string } | null>(null);

  useEffect(() => {
    getUsers()
      .then((data) => {
        setUsers(data || []);
      })
      .catch((err) => {
        console.error('Error fetching users:', err);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessData(null);

    if (!name.trim()) {
      setErrorMsg('Tên dự án là bắt buộc.');
      setLoading(false);
      return;
    }

    if (!autoCreate && !url.trim()) {
      setErrorMsg('Đường dẫn Google Sheet là bắt buộc nếu không tự động tạo.');
      setLoading(false);
      return;
    }

    try {
      const res = await addSheet({
        name,
        project_code: projectCode || undefined,
        customer_name: customerName || undefined,
        current_phase: currentPhase,
        leader_email: leaderEmail || undefined,
        pm_email: pmEmail || undefined,
        member_emails: memberEmails || undefined,
        auto_create: autoCreate,
        url: autoCreate ? undefined : url,
      });

      setSuccessData({
        id: res.id,
        url: res.spreadsheet_url,
      });
      
      // Clear form
      setName('');
      setProjectCode('');
      setCustomerName('');
      setLeaderEmail('');
      setPmEmail('');
      setMemberEmails('');
      setUrl('');
      
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.response?.data?.detail || 'Lỗi khi tạo dự án. Vui lòng kiểm tra lại.');
    } finally {
      setLoading(false);
    }
  };

  const phases = [
    '1.Sale/Admin',
    '2.Init',
    '2.1.Lab/PoC',
    '3.Implement',
    '4.MA'
  ];

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0] flex">
      {/* Sidebar Navigation */}
      <Navbar />

      {/* Main Content Area */}
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
        {/* Topbar */}
        <div className="h-[52px] bg-[#1a1d27] border-b border-[#2e3250] flex items-center justify-between px-6 sticky top-0 z-40">
          <h2 className="text-sm font-bold tracking-wider text-slate-200 uppercase">Tạo dự án mới</h2>
          <button
            onClick={() => router.push('/project')}
            className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] transition-colors"
          >
            ← Quay lại danh sách
          </button>
        </div>

        {/* Form Container */}
        <div className="p-6 max-w-3xl w-full mx-auto space-y-6">
          <div>
            <h1 className="text-xl font-bold text-slate-200">Tạo dự án & Google Sheet mới</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Hệ thống hỗ trợ tự động tạo Google Sheet mẫu gồm 6 Tab (master và 5 phase) và tự động cấp quyền chỉnh sửa cho PM/Leader.
            </p>
          </div>

          {/* Success Dialog */}
          {successData && (
            <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-xl p-5 space-y-3 shadow-lg">
              <div className="flex items-center gap-2">
                <span className="text-xl text-emerald-400">🎉</span>
                <h3 className="text-sm font-bold text-emerald-400">Tạo dự án thành công!</h3>
              </div>
              <p className="text-xs text-slate-300">
                Dự án đã được tạo trên hệ thống và đang tiến hành quét cấu trúc bảng.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <a
                  href={successData.url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-[#10b981] hover:bg-[#059669] text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  🟢 Mở Google Sheet vừa tạo
                </a>
                <button
                  onClick={() => router.push('/project')}
                  className="bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-[#cbd5e1] px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
                >
                  Xem danh sách dự án
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="bg-red-950/40 border border-red-800/40 rounded-xl p-4 text-xs text-red-400">
              ⚠️ {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="bg-[#1a1d27] border border-[#2e3250] rounded-xl p-6 space-y-5 shadow-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Tên dự án */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                  Tên dự án <span className="text-rose-500 font-bold ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ví dụ: Dự án GoDN Korea"
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3.5 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/20 placeholder-slate-500 transition-all"
                />
              </div>

              {/* Mã dự án */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Mã dự án</label>
                <input
                  type="text"
                  value={projectCode}
                  onChange={(e) => setProjectCode(e.target.value)}
                  placeholder="Ví dụ: GDN-2026"
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3.5 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/20 placeholder-slate-500 transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Tên khách hàng */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Tên khách hàng</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Ví dụ: Samsung SDS"
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3.5 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/20 placeholder-slate-500 transition-all"
                />
              </div>

              {/* Giai đoạn */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Giai đoạn hiện tại</label>
                <select
                  value={currentPhase}
                  onChange={(e) => setCurrentPhase(e.target.value)}
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3.5 py-2.5 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/20 transition-all cursor-pointer"
                >
                  {phases.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-[#2e3250]/40 pt-4">
              {/* PM selection */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Project Manager (PM)</label>
                <select
                  value={pmEmail}
                  onChange={(e) => setPmEmail(e.target.value)}
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3.5 py-2.5 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/20 transition-all cursor-pointer"
                >
                  <option value="">Chọn Project Manager</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.email}>
                      {u.full_name || u.email} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Leader selection */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Technical Leader</label>
                <select
                  value={leaderEmail}
                  onChange={(e) => setLeaderEmail(e.target.value)}
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3.5 py-2.5 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/20 transition-all cursor-pointer"
                >
                  <option value="">Chọn Technical Leader</option>
                  {users.filter(u => u.role === 'group_a').map((u) => (
                    <option key={u.id} value={u.email}>
                      {u.full_name || u.email} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Members emails */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                Email thành viên dự án
              </label>
              <textarea
                value={memberEmails}
                onChange={(e) => setMemberEmails(e.target.value)}
                placeholder="member1@company.com, member2@company.com"
                rows={2}
                className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3.5 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/20 placeholder-slate-500 transition-all resize-none"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Nhập nhiều email bằng cách phân cách bởi dấu phẩy (,)
              </p>
            </div>

            {/* Google Sheets Connection Type */}
            <div className="border-t border-[#2e3250]/40 pt-4 space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoCreate"
                  checked={autoCreate}
                  onChange={(e) => setAutoCreate(e.target.checked)}
                  className="w-4 h-4 rounded text-[#6366f1] bg-[#22263a] border-[#2e3250] focus:ring-[#6366f1] cursor-pointer"
                />
                <label htmlFor="autoCreate" className="text-xs font-semibold text-[#cbd5e1] cursor-pointer selection:bg-transparent">
                  Tự động khởi tạo Google Sheet mẫu <span className="text-indigo-400 font-bold ml-1">(Khuyên dùng)</span>
                </label>
              </div>

              {!autoCreate && (
                <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Đường dẫn Google Sheet có sẵn <span className="text-rose-500 font-bold ml-0.5">*</span>
                  </label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3.5 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/20 placeholder-slate-500 transition-all"
                  />
                  <span className="text-[10px] text-slate-400 block">
                    Lưu ý: Bạn phải chia sẻ quyền Editor cho email Service Account của hệ thống để đồng bộ.
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-6 border-t border-[#2e3250]/40 mt-4">
              <button
                type="button"
                onClick={() => router.push('/project')}
                className="bg-transparent border border-[#2e3250] hover:border-slate-500 hover:bg-[#22263a] text-slate-300 px-5 py-2 rounded-lg text-xs font-semibold transition-all"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                disabled={loading}
                className="bg-[#6366f1] hover:bg-[#818cf8] text-white px-6 py-2 rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Đang tạo...
                  </>
                ) : (
                  'Tạo dự án mới'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
