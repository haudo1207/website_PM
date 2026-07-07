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
  const autoCreate = true;
  const url = '';

  // Contact channels
  const [zaloLink, setZaloLink] = useState('');
  const [telegramLink, setTelegramLink] = useState('');
  const [teamsLink, setTeamsLink] = useState('');
  const [zaloEnabled, setZaloEnabled] = useState(true);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [teamsEnabled, setTeamsEnabled] = useState(false);


  
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

    if (!projectCode.trim()) {
      setErrorMsg('Năm là bắt buộc.');
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
        zalo_link: zaloEnabled ? (zaloLink || undefined) : undefined,
        telegram_link: telegramEnabled ? (telegramLink || undefined) : undefined,
        teams_link: teamsEnabled ? (teamsLink || undefined) : undefined,
      });

      router.push(`/project/detail?id=${res.id}`);

      
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
    <div className="min-h-screen bg-[#f0f2f5] text-[#0b1c30] flex" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      {/* Sidebar Navigation */}
      <Navbar />

      {/* Main Content Area */}
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen relative overflow-hidden bg-[#f0f2f5]">
        {/* Animated Background Glow */}
        <div className="absolute inset-0 pointer-events-none opacity-5 flex items-center justify-center overflow-hidden z-0">
          <div className="w-[800px] h-[800px] bg-[#0058be] rounded-full blur-[130px] mix-blend-multiply"></div>
        </div>

        {/* Topbar */}
        <div className="h-16 bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-8 sticky top-0 z-40 relative">
          <h2 className="text-sm font-bold tracking-wider text-[#0b1c30] uppercase">Tạo dự án mới</h2>
          <button
            onClick={() => router.push('/project')}
            className="text-xs text-[#565e74] hover:text-[#0b1c30] flex items-center gap-1.5 transition-all font-semibold"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Quay lại danh sách
          </button>
        </div>

        {/* Form Container */}
        <div className="p-8 max-w-[1000px] w-full mx-auto space-y-6 overflow-y-auto flex-1 relative z-10">
          <div className="text-center mb-8">
            <h3 className="text-xl font-bold text-[#0b1c30] mb-2 flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[#0058be]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
              Tạo dự án mới
            </h3>
            <p className="text-xs text-[#565e74] max-w-2xl mx-auto">
              Nhập thông tin dự án để hệ thống tiến hành khởi tạo và theo dõi công việc.
            </p>
          </div>

          {/* Success Dialog */}
          {successData && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-3 shadow-sm max-w-3xl mx-auto animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">check_circle</span>
                <h3 className="text-sm font-bold text-emerald-700">Tạo dự án thành công!</h3>
              </div>
              <p className="text-xs text-slate-600">
                Dự án đã được tạo trên hệ thống và đang tiến hành quét cấu trúc bảng.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <a
                  href={successData.url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-[#10b981] hover:bg-[#059669] text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  🟢 Mở Google Sheet liên kết
                </a>
                <button
                  onClick={() => router.push('/project')}
                  className="bg-white border border-[#c2c6d6] hover:bg-[#f8f9ff] text-[#565e74] px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
                >
                  Xem danh sách dự án
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 max-w-3xl mx-auto animate-in fade-in duration-200 font-medium">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-red-600">error</span>
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="bg-white border border-[#c2c6d6]/60 rounded-xl p-8 space-y-6 shadow-sm max-w-3xl mx-auto backdrop-blur-sm">
            {/* Row 1: Project Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Tên dự án */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-[#565e74] block">
                  Tên dự án <span className="text-rose-500 font-bold ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ví dụ: Dự án GoDN Korea"
                  className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all placeholder:text-[#727785] text-xs"
                />
              </div>

              {/* Năm */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-[#565e74] block">
                  Năm <span className="text-rose-500 font-bold ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="project-years"
                  value={projectCode}
                  onChange={(e) => setProjectCode(e.target.value)}
                  placeholder="Chọn hoặc nhập năm (VD: 2026)"
                  className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all placeholder:text-[#727785] text-xs"
                />
                <datalist id="project-years">
                  <option value="2024" />
                  <option value="2025" />
                  <option value="2026" />
                  <option value="2027" />
                  <option value="2028" />
                  <option value="2029" />
                  <option value="2030" />
                </datalist>
              </div>
            </div>

            {/* Row 2: Customer & Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Tên khách hàng */}
              <div ref={customerRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-[#565e74] block">Tên khách hàng</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCustomerDropdownOpen(!customerDropdownOpen);
                    setPhaseDropdownOpen(false);
                    setPmDropdownOpen(false);
                    setLeaderDropdownOpen(false);
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-4 py-3 text-xs text-[#0b1c30] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all cursor-pointer text-left"
                >
                  <span className={customerName ? 'text-[#0b1c30]' : 'text-[#727785]'}>
                    {customerName || 'Chọn hoặc nhập mới...'}
                  </span>
                  <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                </button>
                
                {customerDropdownOpen && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 p-2 space-y-2"
                  >
                    {/* Search / Type Input */}
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Tìm kiếm hoặc nhập mới..."
                      className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0058be]"
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
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#eff4ff]/60 text-[#727785] rounded transition-colors"
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
                          className="w-full text-left px-2 py-1.5 text-xs bg-[#0058be]/10 hover:bg-[#0058be]/20 text-[#0058be] rounded transition-colors font-semibold flex items-center gap-1"
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
                            className={`w-full text-left px-2 py-1.5 text-xs hover:bg-[#eff4ff]/60 rounded transition-colors ${customerName === c ? 'bg-[#eff4ff] text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
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
                <label className="text-[11px] font-semibold text-[#565e74] block">Giai đoạn hiện tại</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPhaseDropdownOpen(!phaseDropdownOpen);
                    setCustomerDropdownOpen(false);
                    setPmDropdownOpen(false);
                    setLeaderDropdownOpen(false);
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-4 py-3 text-xs text-[#0b1c30] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all cursor-pointer text-left"
                >
                  <span>{currentPhase}</span>
                  <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                </button>
                
                {phaseDropdownOpen && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 max-h-[220px] overflow-y-auto scrollbar-thin"
                  >
                    {phases.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setCurrentPhase(p);
                          setPhaseDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-xs hover:bg-[#eff4ff]/60 transition-colors ${currentPhase === p ? 'bg-[#eff4ff] text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Row 3: Leaders */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-[#c2c6d6]/60 pt-4">
              {/* PM selection */}
              <div ref={pmRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-[#565e74] block">Project Manager (PM)</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPmDropdownOpen(!pmDropdownOpen);
                    setCustomerDropdownOpen(false);
                    setPhaseDropdownOpen(false);
                    setLeaderDropdownOpen(false);
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-4 py-3 text-xs text-[#0b1c30] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all cursor-pointer text-left"
                >
                  <span className={pmEmail ? 'text-[#0b1c30]' : 'text-[#727785]'}>
                    {pmEmail ? (users.find(u => u.email === pmEmail)?.full_name || pmEmail) : 'Chọn Project Manager'}
                  </span>
                  <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                </button>
                
                {pmDropdownOpen && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 max-h-[220px] overflow-y-auto"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setPmEmail('');
                        setPmDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-[#eff4ff]/60 text-[#727785] transition-colors"
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
                        className={`w-full text-left px-4 py-2.5 text-xs hover:bg-[#eff4ff]/60 transition-colors ${pmEmail === u.email ? 'bg-[#eff4ff] text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
                      >
                        {u.full_name || u.email} ({u.email})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Leader selection */}
              <div ref={leaderRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-[#565e74] block">Technical Leader</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLeaderDropdownOpen(!leaderDropdownOpen);
                    setCustomerDropdownOpen(false);
                    setPhaseDropdownOpen(false);
                    setPmDropdownOpen(false);
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-4 py-3 text-xs text-[#0b1c30] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all cursor-pointer text-left"
                >
                  <span className={leaderEmail ? 'text-[#0b1c30]' : 'text-[#727785]'}>
                    {leaderEmail ? (users.find(u => u.email === leaderEmail)?.full_name || leaderEmail) : 'Chọn Technical Leader'}
                  </span>
                  <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                </button>
                
                {leaderDropdownOpen && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 max-h-[220px] overflow-y-auto"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setLeaderEmail('');
                        setLeaderDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-[#eff4ff]/60 text-[#727785] transition-colors"
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
                        className={`w-full text-left px-4 py-2.5 text-xs hover:bg-[#eff4ff]/60 transition-colors ${leaderEmail === u.email ? 'bg-[#eff4ff] text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
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
              <label className="text-[11px] font-semibold text-[#565e74] block">
                Email thành viên dự án
              </label>
              <textarea
                value={memberEmails}
                onChange={(e) => setMemberEmails(e.target.value)}
                placeholder="member1@company.com, member2@company.com"
                rows={3}
                className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all placeholder:text-[#727785] text-xs resize-none"
              />
              <p className="text-[10px] text-[#727785]">Nhập nhiều email bằng cách phân cách bởi dấu phẩy (,)</p>
            </div>


            {/* Row 6: Kênh liên lạc dự án */}
            <div className="space-y-4 border-t border-[#c2c6d6]/60 pt-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-[#0058be] text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>forum</span>
                <label className="text-[11px] font-semibold text-[#565e74]">Kênh liên lạc dự án</label>
                <span className="text-[10px] text-[#727785] ml-1">(Tùy chọn)</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Zalo Card */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${zaloEnabled ? 'bg-white border-[#0058be]/60 shadow-sm shadow-[#0058be]/5' : 'bg-[#f0f2f5]/40 border-[#c2c6d6]/30 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-[#0068FF] text-white flex items-center justify-center text-[10px] font-bold">Z</span>
                      <span className="text-xs font-bold text-[#0b1c30]">Zalo</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={zaloEnabled}
                      onChange={(e) => setZaloEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-[#c2c6d6] text-[#0058be] focus:ring-[#0058be] focus:ring-offset-0 bg-white cursor-pointer"
                    />
                  </div>
                  <input
                    type="url"
                    disabled={!zaloEnabled}
                    value={zaloLink}
                    onChange={(e) => setZaloLink(e.target.value)}
                    placeholder="Link tham gia nhóm..."
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0058be] placeholder:text-[#727785] text-xs disabled:opacity-40"
                  />
                  <div className={`flex items-center gap-1 text-[10px] font-semibold pt-0.5 ${(zaloEnabled && zaloLink.trim()) ? 'text-emerald-600' : 'text-[#727785]'}`}>
                    <span className="text-[8px]">●</span> {(zaloEnabled && zaloLink.trim()) ? 'Đã lưu liên kết' : 'Chưa kết nối'}
                  </div>
                </div>

                {/* Telegram Card */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${telegramEnabled ? 'bg-white border-[#0058be]/60 shadow-sm shadow-[#0058be]/5' : 'bg-[#f0f2f5]/40 border-[#c2c6d6]/30 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-[#2AABEE] text-white flex items-center justify-center text-[10px] font-bold">✈</span>
                      <span className="text-xs font-bold text-[#0b1c30]">Telegram</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={telegramEnabled}
                      onChange={(e) => setTelegramEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-[#c2c6d6] text-[#0058be] focus:ring-[#0058be] focus:ring-offset-0 bg-white cursor-pointer"
                    />
                  </div>
                  <input
                    type="url"
                    disabled={!telegramEnabled}
                    value={telegramLink}
                    onChange={(e) => setTelegramLink(e.target.value)}
                    placeholder="https://t.me/joinchat/..."
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0058be] placeholder:text-[#727785] text-xs disabled:opacity-40"
                  />
                  <div className={`flex items-center gap-1 text-[10px] font-semibold pt-0.5 ${(telegramEnabled && telegramLink.trim()) ? 'text-emerald-600' : 'text-[#727785]'}`}>
                    <span className="text-[8px]">●</span> {(telegramEnabled && telegramLink.trim()) ? 'Đã lưu liên kết' : 'Chưa kết nối'}
                  </div>
                </div>

                {/* Teams Card */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${teamsEnabled ? 'bg-white border-[#0058be]/60 shadow-sm shadow-[#0058be]/5' : 'bg-[#f0f2f5]/40 border-[#c2c6d6]/30 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-[#4F52B2] text-white flex items-center justify-center text-[10px] font-bold">T</span>
                      <span className="text-xs font-bold text-[#0b1c30]">Teams</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={teamsEnabled}
                      onChange={(e) => setTeamsEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-[#c2c6d6] text-[#0058be] focus:ring-[#0058be] focus:ring-offset-0 bg-white cursor-pointer"
                    />
                  </div>
                  <input
                    type="url"
                    disabled={!teamsEnabled}
                    value={teamsLink}
                    onChange={(e) => setTeamsLink(e.target.value)}
                    placeholder="Link workspace..."
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0058be] placeholder:text-[#727785] text-xs disabled:opacity-40"
                  />
                  <div className={`flex items-center gap-1 text-[10px] font-semibold pt-0.5 ${(teamsEnabled && teamsLink.trim()) ? 'text-emerald-600' : 'text-[#727785]'}`}>
                    <span className="text-[8px]">●</span> {(teamsEnabled && teamsLink.trim()) ? 'Đã lưu liên kết' : 'Chưa kết nối'}
                  </div>
                </div>
              </div>
            </div>


            {/* Actions */}
            <div className="flex justify-end items-center gap-4 pt-6 border-t border-[#c2c6d6]/60">
              <button
                type="button"
                onClick={() => router.push('/project')}
                className="px-6 py-2.5 rounded-lg text-xs font-bold text-[#565e74] hover:text-[#0b1c30] hover:bg-[#eff4ff]/60 border border-[#c2c6d6] transition-all"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-8 py-2.5 bg-[#0058be] hover:bg-[#0058be]/90 text-white rounded-lg text-xs font-bold shadow-md transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
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
