'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { addSheet, getUsers } from '@/lib/api';

export default function NewProjectPage() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [currentPhase, setCurrentPhase] = useState('1. Tư vấn');
  const [leaderEmail, setLeaderEmail] = useState('');
  const [pmEmail, setPmEmail] = useState('');
  const [memberEmails, setMemberEmails] = useState('');
  
  // Auto create Google Sheet settings
  const [autoCreate, setAutoCreate] = useState(false);
  const [url, setUrl] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successData, setSuccessData] = useState<{ id: number; url: string } | null>(null);

  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [phaseDropdownOpen, setPhaseDropdownOpen] = useState(false);
  const [pmDropdownOpen, setPmDropdownOpen] = useState(false);
  const [leaderDropdownOpen, setLeaderDropdownOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  const customerRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<HTMLDivElement>(null);
  const pmRef = useRef<HTMLDivElement>(null);
  const leaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      if (customerDropdownOpen && customerRef.current && !customerRef.current.contains(target)) {
        setCustomerDropdownOpen(false);
        setCustomerSearch('');
      }
      if (phaseDropdownOpen && phaseRef.current && !phaseRef.current.contains(target)) {
        setPhaseDropdownOpen(false);
      }
      if (pmDropdownOpen && pmRef.current && !pmRef.current.contains(target)) {
        setPmDropdownOpen(false);
      }
      if (leaderDropdownOpen && leaderRef.current && !leaderRef.current.contains(target)) {
        setLeaderDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [customerDropdownOpen, phaseDropdownOpen, pmDropdownOpen, leaderDropdownOpen]);

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
      setErrorMsg('Đường dẫn Google Sheet là bắt buộc.');
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
    '1. Tư vấn',
    '2. Báo giá',
    '3. Làm specs',
    '4. Duyệt HSMT',
    '5. Chờ ra thầu',
    '6. Tham gia thầu POP',
    '6. Tham gia thầu nhà phụ',
    '7. Trúng Thầu',
    '7. Rớt thầu',
    '8. Ký hợp đồng',
    '9. Đặt hàng',
    '10. Giao hàng',
    '11. Triển khai',
    '12. Hoàn thành triển khai',
    '13. Nghiệm thu',
    '14. Thanh toán',
    '15. Kết thúc dự án',
    '0. Huỷ'
  ];

  const customers = [
    'Samsung SDS',
    'LG CNS',
    'Viettel',
    'FPT Software',
    'Vingroup',
    'Khác'
  ];

  return (
    <div className="min-h-screen bg-[#0b1326] text-[#dae2fd] flex">
      {/* Sidebar Navigation */}
      <Navbar />

      {/* Main Content Area */}
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen relative overflow-hidden bg-[#0b1326]">
        {/* Animated Background Glow */}
        <div className="absolute inset-0 pointer-events-none opacity-20 flex items-center justify-center overflow-hidden z-0">
          <div className="w-[800px] h-[800px] bg-[#7c3aed] rounded-full blur-[130px] mix-blend-screen animate-pulse"></div>
        </div>

        {/* Topbar */}
        <div className="h-16 bg-[#0b1326] border-b border-[#4a4455] flex items-center justify-between px-8 sticky top-0 z-40 relative">
          <h2 className="text-sm font-bold tracking-wider text-[#dae2fd] uppercase">Tạo dự án mới</h2>
          <button
            onClick={() => router.push('/project')}
            className="text-xs text-slate-400 hover:text-[#dae2fd] flex items-center gap-1.5 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Quay lại danh sách
          </button>
        </div>

        {/* Form Container */}
        <div className="p-8 max-w-[1000px] w-full mx-auto space-y-6 overflow-y-auto flex-1 relative z-10">
          <div className="text-center mb-8">
            <h3 className="text-xl font-bold text-[#dae2fd] mb-2 flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[#d2bbff]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
              Tạo dự án mới
            </h3>
            <p className="text-xs text-slate-400 max-w-2xl mx-auto">
              Nhập thông tin dự án và liên kết đường dẫn Google Sheet để hệ thống tiến hành đồng bộ và theo dõi công việc.
            </p>
          </div>

          {/* Success Dialog */}
          {successData && (
            <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-xl p-5 space-y-3 shadow-lg max-w-3xl mx-auto animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400">check_circle</span>
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
                  🟢 Mở Google Sheet liên kết
                </a>
                <button
                  onClick={() => router.push('/project')}
                  className="bg-[#171f33] border border-[#4a4455] hover:bg-[#222a3d] text-slate-300 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
                >
                  Xem danh sách dự án
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="bg-red-950/40 border border-red-800/40 rounded-xl p-4 text-xs text-red-400 max-w-3xl mx-auto animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-red-400">error</span>
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="bg-[#171f33] border border-[#4a4455] rounded-xl p-8 space-y-6 shadow-2xl max-w-3xl mx-auto">
            {/* Row 1: Project Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Tên dự án */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-slate-300 block">
                  Tên dự án <span className="text-rose-500 font-bold ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ví dụ: Dự án GoDN Korea"
                  className="w-full bg-[#0b1326] border border-[#4a4455] text-[#dae2fd] px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7c3aed] focus:border-transparent transition-all placeholder:text-[#4a4455] text-xs"
                />
              </div>

              {/* Mã dự án */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-slate-300 block">Mã dự án</label>
                <input
                  type="text"
                  value={projectCode}
                  onChange={(e) => setProjectCode(e.target.value)}
                  placeholder="Ví dụ: GDN-2026"
                  className="w-full bg-[#0b1326] border border-[#4a4455] text-[#dae2fd] px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7c3aed] focus:border-transparent transition-all placeholder:text-[#4a4455] text-xs"
                />
              </div>
            </div>

            {/* Row 2: Customer & Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Tên khách hàng */}
              <div ref={customerRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-slate-300 block">Tên khách hàng</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCustomerDropdownOpen(!customerDropdownOpen);
                    setPhaseDropdownOpen(false);
                    setPmDropdownOpen(false);
                    setLeaderDropdownOpen(false);
                  }}
                  className="w-full bg-[#0b1326] border border-[#4a4455] rounded-lg px-4 py-3 text-xs text-[#dae2fd] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#7c3aed] transition-all cursor-pointer text-left"
                >
                  <span className={customerName ? 'text-[#dae2fd]' : 'text-slate-500'}>
                    {customerName || 'Chọn hoặc nhập mới...'}
                  </span>
                  <span className="material-symbols-outlined text-[#958da1] text-[18px]">expand_more</span>
                </button>
                
                {customerDropdownOpen && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-[#171f33] border border-[#4a4455] rounded-lg shadow-xl z-50 p-2 space-y-2"
                  >
                    {/* Search / Type Input */}
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Tìm kiếm hoặc nhập mới..."
                      className="w-full bg-[#0b1326] border border-[#4a4455] text-[#dae2fd] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
                    />

                    <div className="max-h-[160px] overflow-y-auto space-y-1">
                      {/* Option to clear/reset */}
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerName('');
                          setCustomerSearch('');
                          setCustomerDropdownOpen(false);
                        }}
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#222a3d] text-slate-400 rounded transition-colors"
                      >
                        Chọn khách hàng (Trống)
                      </button>

                      {/* Add new custom option */}
                      {customerSearch.trim() && !customers.some(c => c.toLowerCase() === customerSearch.trim().toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerName(customerSearch.trim());
                            setCustomerSearch('');
                            setCustomerDropdownOpen(false);
                          }}
                          className="w-full text-left px-2 py-1.5 text-xs bg-[#7c3aed]/10 hover:bg-[#7c3aed]/20 text-[#d2bbff] rounded transition-colors font-medium flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[14px]">add</span>
                          Sử dụng &quot;{customerSearch.trim()}&quot;
                        </button>
                      )}

                      {/* Filtered list of existing customers */}
                      {customers
                        .filter(c => c.toLowerCase().includes(customerSearch.toLowerCase()))
                        .map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setCustomerName(c);
                              setCustomerSearch('');
                              setCustomerDropdownOpen(false);
                            }}
                            className={`w-full text-left px-2 py-1.5 text-xs hover:bg-[#222a3d] rounded transition-colors ${customerName === c ? 'bg-[#7c3aed]/20 text-[#d2bbff] font-semibold' : 'text-[#dae2fd]'}`}
                          >
                            {c}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Giai đoạn */}
              <div ref={phaseRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-slate-300 block">Giai đoạn hiện tại</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPhaseDropdownOpen(!phaseDropdownOpen);
                    setCustomerDropdownOpen(false);
                    setPmDropdownOpen(false);
                    setLeaderDropdownOpen(false);
                  }}
                  className="w-full bg-[#0b1326] border border-[#4a4455] rounded-lg px-4 py-3 text-xs text-[#dae2fd] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#7c3aed] transition-all cursor-pointer text-left"
                >
                  <span>{currentPhase}</span>
                  <span className="material-symbols-outlined text-[#958da1] text-[18px]">expand_more</span>
                </button>
                
                {phaseDropdownOpen && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-[#171f33] border border-[#4a4455] rounded-lg shadow-xl z-50 max-h-[220px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700"
                  >
                    {phases.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setCurrentPhase(p);
                          setPhaseDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-xs hover:bg-[#222a3d] transition-colors ${currentPhase === p ? 'bg-[#7c3aed]/20 text-[#d2bbff] font-semibold' : 'text-[#dae2fd]'}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Row 3: Leaders */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-[#4a4455]/40 pt-4">
              {/* PM selection */}
              <div ref={pmRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-slate-300 block">Project Manager (PM)</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPmDropdownOpen(!pmDropdownOpen);
                    setCustomerDropdownOpen(false);
                    setPhaseDropdownOpen(false);
                    setLeaderDropdownOpen(false);
                  }}
                  className="w-full bg-[#0b1326] border border-[#4a4455] rounded-lg px-4 py-3 text-xs text-[#dae2fd] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#7c3aed] transition-all cursor-pointer text-left"
                >
                  <span className={pmEmail ? 'text-[#dae2fd]' : 'text-slate-500'}>
                    {pmEmail ? (users.find(u => u.email === pmEmail)?.full_name || pmEmail) : 'Chọn Project Manager'}
                  </span>
                  <span className="material-symbols-outlined text-[#958da1] text-[18px]">expand_more</span>
                </button>
                
                {pmDropdownOpen && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-[#171f33] border border-[#4a4455] rounded-lg shadow-xl z-50 max-h-[220px] overflow-y-auto"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setPmEmail('');
                        setPmDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-[#222a3d] text-slate-400 transition-colors"
                    >
                      Chọn Project Manager
                    </button>
                    {users.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setPmEmail(u.email);
                          setPmDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-xs hover:bg-[#222a3d] transition-colors ${pmEmail === u.email ? 'bg-[#7c3aed]/20 text-[#d2bbff] font-semibold' : 'text-[#dae2fd]'}`}
                      >
                        {u.full_name || u.email} ({u.email})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Leader selection */}
              <div ref={leaderRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-slate-300 block">Technical Leader</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLeaderDropdownOpen(!leaderDropdownOpen);
                    setCustomerDropdownOpen(false);
                    setPhaseDropdownOpen(false);
                    setPmDropdownOpen(false);
                  }}
                  className="w-full bg-[#0b1326] border border-[#4a4455] rounded-lg px-4 py-3 text-xs text-[#dae2fd] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#7c3aed] transition-all cursor-pointer text-left"
                >
                  <span className={leaderEmail ? 'text-[#dae2fd]' : 'text-slate-500'}>
                    {leaderEmail ? (users.find(u => u.email === leaderEmail)?.full_name || leaderEmail) : 'Chọn Technical Leader'}
                  </span>
                  <span className="material-symbols-outlined text-[#958da1] text-[18px]">expand_more</span>
                </button>
                
                {leaderDropdownOpen && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-[#171f33] border border-[#4a4455] rounded-lg shadow-xl z-50 max-h-[220px] overflow-y-auto"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setLeaderEmail('');
                        setLeaderDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-[#222a3d] text-slate-400 transition-colors"
                    >
                      Chọn Technical Leader
                    </button>
                    {users.filter(u => u.role === 'group_a').map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setLeaderEmail(u.email);
                          setLeaderDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-xs hover:bg-[#222a3d] transition-colors ${leaderEmail === u.email ? 'bg-[#7c3aed]/20 text-[#d2bbff] font-semibold' : 'text-[#dae2fd]'}`}
                      >
                        {u.full_name || u.email} ({u.email})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Row 4: Emails */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-slate-300 block">
                Email thành viên dự án
              </label>
              <textarea
                value={memberEmails}
                onChange={(e) => setMemberEmails(e.target.value)}
                placeholder="member1@company.com, member2@company.com"
                rows={3}
                className="w-full bg-[#0b1326] border border-[#4a4455] text-[#dae2fd] px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7c3aed] focus:border-transparent transition-all placeholder:text-[#4a4455] text-xs resize-none"
              />
              <p className="text-[10px] text-slate-400">Nhập nhiều email bằng cách phân cách bởi dấu phẩy (,)</p>
            </div>

            {/* Row 5: Google Sheets */}
            <div className="space-y-3 border-t border-[#4a4455]/40 pt-4">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-slate-300 block">
                  Đường dẫn Google Sheet <span className="text-rose-500 font-bold ml-0.5">*</span>
                </label>
                <div className="relative">
                  <input
                    type="url"
                    required
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full bg-[#0b1326] border border-[#4a4455] text-[#dae2fd] pl-12 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7c3aed] focus:border-transparent transition-all placeholder:text-[#4a4455] text-xs"
                  />
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">description</span>
                </div>
              </div>
              
              <div className="p-3 bg-[#7c3aed]/10 border border-[#7c3aed]/30 rounded-lg flex gap-3 items-start">
                <span className="material-symbols-outlined text-[#d2bbff] text-[18px] mt-0.5">info</span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <span className="text-[#d2bbff] font-bold">Lưu ý:</span> Bạn phải chia sẻ quyền Editor cho email Service Account của hệ thống để đồng bộ.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end items-center gap-4 pt-6 border-t border-[#4a4455]">
              <button
                type="button"
                onClick={() => router.push('/project')}
                className="px-6 py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-[#dae2fd] hover:bg-[#222a3d] border border-[#4a4455] transition-all"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-8 py-2.5 bg-[#7c3aed] hover:bg-[#8b5cf6] text-white rounded-lg text-xs font-bold shadow-lg transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Đang tạo...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>add_circle</span>
                    Tạo dự án mới
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Bottom Space */}
          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}
