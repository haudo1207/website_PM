'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { createProject, getMembers, getCustomers } from '@/lib/api';

export default function NewProjectPage() {
  const router = useRouter();
  const [membersList, setMembersList] = useState<any[]>([]);
  const [dbCustomers, setDbCustomers] = useState<any[]>([]);

  const [name, setName] = useState('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [customerName, setCustomerName] = useState('');
  const [currentPhase, setCurrentPhase] = useState('Master');
  const [selectedPms, setSelectedPms] = useState<number[]>([]);
  const [selectedLeaders, setSelectedLeaders] = useState<number[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [pmDropdownOpen, setPmDropdownOpen] = useState(false);
  const [leaderDropdownOpen, setLeaderDropdownOpen] = useState(false);
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);
  const [phaseDropdownOpen, setPhaseDropdownOpen] = useState(false);

  const [customerSearch, setCustomerSearch] = useState('');
  const [pmSearch, setPmSearch] = useState('');
  const [leaderSearch, setLeaderSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');

  const customerRef = useRef<HTMLDivElement>(null);
  const pmRef = useRef<HTMLDivElement>(null);
  const leaderRef = useRef<HTMLDivElement>(null);
  const memberRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (customerDropdownOpen && customerRef.current && !customerRef.current.contains(target)) {
        setCustomerDropdownOpen(false);
        setCustomerSearch('');
      }
      if (pmDropdownOpen && pmRef.current && !pmRef.current.contains(target)) {
        setPmDropdownOpen(false);
        setPmSearch('');
      }
      if (leaderDropdownOpen && leaderRef.current && !leaderRef.current.contains(target)) {
        setLeaderDropdownOpen(false);
        setLeaderSearch('');
      }
      if (memberDropdownOpen && memberRef.current && !memberRef.current.contains(target)) {
        setMemberDropdownOpen(false);
        setMemberSearch('');
      }
      if (phaseDropdownOpen && phaseRef.current && !phaseRef.current.contains(target)) {
        setPhaseDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [customerDropdownOpen, pmDropdownOpen, leaderDropdownOpen, memberDropdownOpen, phaseDropdownOpen]);

  useEffect(() => {
    getMembers()
      .then((data) => {
        setMembersList(data || []);
      })
      .catch((err) => {
        console.error('Error fetching members:', err);
      });

    getCustomers()
      .then((data) => {
        setDbCustomers(data || []);
      })
      .catch((err) => {
        console.error('Error fetching customers:', err);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    if (!name.trim()) {
      setErrorMsg('Tên dự án là bắt buộc.');
      setLoading(false);
      return;
    }

    if (!year) {
      setErrorMsg('Năm dự án là bắt buộc.');
      setLoading(false);
      return;
    }

    if (!currentPhase) {
      setErrorMsg('Giai đoạn hiện tại là bắt buộc.');
      setLoading(false);
      return;
    }

    try {
      const res = await createProject({
        name,
        code: `${name}-${year}`,
        year,
        customer_name: customerName || undefined,
        current_phase: 'Master',
        pm_ids: selectedPms,
        technical_leader_ids: selectedLeaders,
        member_ids: selectedMembers,
        status: 'Planning',
      });

      router.push(`/project/detail?id=${res.id}`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.response?.data?.detail || 'Lỗi khi tạo dự án. Vui lòng kiểm tra lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#0b1c30] flex" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />

      <div className="flex-1 pl-[230px] flex flex-col min-h-screen relative overflow-hidden bg-[#f0f2f5]">
        {/* Subtle background glow */}
        <div className="absolute inset-0 pointer-events-none opacity-5 flex items-center justify-center overflow-hidden z-0">
          <div className="w-[800px] h-[800px] bg-[#0058be] rounded-full blur-[130px] mix-blend-multiply"></div>
        </div>

        {/* Header bar */}
        <div className="h-16 bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-8 sticky top-0 z-40 relative">
          <h2 className="text-sm font-bold tracking-wider text-[#0b1c30] uppercase">Khởi tạo dự án</h2>
          <button
            onClick={() => router.push('/project')}
            className="text-xs text-[#565e74] hover:text-[#0b1c30] flex items-center gap-1.5 transition-all font-semibold"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Quay lại danh sách
          </button>
        </div>

        {/* Form container */}
        <div className="p-8 max-w-[1000px] w-full mx-auto space-y-6 overflow-y-auto flex-1 relative z-10">
          <div className="text-center mb-8">
            <h3 className="text-xl font-bold text-[#0b1c30] mb-2 flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[#0058be]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
              Thông tin dự án mới
            </h3>
            <p className="text-xs text-[#565e74] max-w-2xl mx-auto">
              Vui lòng hoàn thành các thông tin bắt buộc dưới đây để thiết lập dự án mới.
            </p>
          </div>

          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 max-w-3xl mx-auto animate-in fade-in duration-200 font-medium">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-red-600">error</span>
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="bg-white border border-[#c2c6d6]/60 rounded-xl p-8 space-y-6 shadow-sm max-w-3xl mx-auto backdrop-blur-sm">
            {/* Section 1: Project Information */}
            <div className="space-y-4">
              <h4 className="text-[11px] font-bold text-[#0058be] uppercase tracking-wider border-b border-slate-100 pb-2">
                1. Thông tin chung
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Project Name */}
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-[#565e74] block">
                    Tên dự án <span className="text-rose-500 font-bold ml-0.5">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ví dụ: Portal KPI, Web Portal..."
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all placeholder:text-[#727785] text-xs font-semibold"
                  />
                </div>

                {/* Project Year */}
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-[#565e74] block">
                    Năm dự án <span className="text-rose-500 font-bold ml-0.5">*</span>
                  </label>
                  <select
                    required
                    value={year}
                    onChange={(e) => setYear(parseInt(e.target.value, 10))}
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all text-xs font-semibold"
                  >
                    {Array.from({ length: 15 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                {/* Customer Dropdown */}
                <div ref={customerRef} className="space-y-2 relative">
                  <label className="text-[11px] font-semibold text-[#565e74] block">Khách hàng</label>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCustomerDropdownOpen(!customerDropdownOpen);
                      setPmDropdownOpen(false);
                      setLeaderDropdownOpen(false);
                      setMemberDropdownOpen(false);
                      setPhaseDropdownOpen(false);
                    }}
                    className="w-full bg-white border border-[#c2c6d6] rounded-lg px-4 py-3 text-xs text-[#0b1c30] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all cursor-pointer text-left font-semibold"
                  >
                    <span className={customerName ? 'text-[#0b1c30]' : 'text-[#727785]'}>
                      {customerName || 'Chọn khách hàng (Để trống nếu là dự án nội bộ)'}
                    </span>
                    <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                  </button>

                  {customerDropdownOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 p-2 space-y-2"
                    >
                      <input
                        type="text"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Tìm kiếm khách hàng..."
                        className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0058be]"
                      />

                      <div className="max-h-[160px] overflow-y-auto space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerName('');
                            setCustomerSearch('');
                            setCustomerDropdownOpen(false);
                          }}
                          className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#eff4ff]/60 text-[#727785] rounded transition-colors"
                        >
                          Chọn khách hàng
                        </button>

                        {dbCustomers
                          .filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()))
                          .map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setCustomerName(c.name);
                                setCustomerSearch('');
                                setCustomerDropdownOpen(false);
                              }}
                              className={`w-full text-left px-2 py-1.5 text-xs hover:bg-[#eff4ff]/60 rounded transition-colors ${customerName === c.name ? 'bg-[#eff4ff] text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
                            >
                              {c.name}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Section 2: Project Stakeholders */}
            <div className="space-y-6 border-t border-[#c2c6d6]/60 pt-4">
              <h4 className="text-[11px] font-bold text-[#0058be] uppercase tracking-wider border-b border-slate-100 pb-2">
                2. Thành viên dự án
              </h4>

              {/* PM Selection */}
              <div ref={pmRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-[#565e74] block">
                  Project Manager (PM)
                </label>
                <div
                  onClick={() => {
                    setPmDropdownOpen(!pmDropdownOpen);
                    setLeaderDropdownOpen(false);
                    setMemberDropdownOpen(false);
                    setCustomerDropdownOpen(false);
                    setPhaseDropdownOpen(false);
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs text-[#0b1c30] flex flex-wrap gap-1.5 items-center justify-between min-h-[42px] cursor-pointer focus-within:ring-2 focus-within:ring-[#0058be]/20 focus-within:border-[#0058be] transition-all"
                >
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {selectedPms.length === 0 ? (
                      <span className="text-[#727785] px-2 py-1">Chọn Project Manager (PM)...</span>
                    ) : (
                      selectedPms.map(id => {
                        const m = membersList.find(x => x.id === id);
                        return (
                          <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-semibold text-[11px] flex items-center gap-1">
                            {m?.display_name || id}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPms(selectedPms.filter(x => x !== id));
                              }}
                              className="text-blue-500 hover:text-blue-700 font-bold ml-0.5"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>
                  <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                </div>

                {pmDropdownOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 p-2 space-y-2 max-h-[250px] flex flex-col"
                  >
                    <input
                      type="text"
                      value={pmSearch}
                      onChange={(e) => setPmSearch(e.target.value)}
                      placeholder="Tìm kiếm PM..."
                      className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0058be]"
                    />
                    <div className="overflow-y-auto space-y-1 flex-1 max-h-[160px]">
                      {membersList
                        .filter(u => u.display_name?.toLowerCase().includes(pmSearch.toLowerCase()) || u.full_name?.toLowerCase().includes(pmSearch.toLowerCase()))
                        .map((u) => {
                          const isSelected = selectedPms.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedPms(selectedPms.filter(id => id !== u.id));
                                } else {
                                  setSelectedPms([...selectedPms, u.id]);
                                }
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#eff4ff]/60 rounded transition-colors flex items-center justify-between ${isSelected ? 'bg-[#eff4ff]/60 text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
                            >
                              <span>{u.display_name} <span className="text-[10px] text-slate-400 font-normal">({u.team || 'No Team'})</span></span>
                              {isSelected && <span className="text-emerald-600 font-bold text-[14px]">✓</span>}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* Technical Leader Selection */}
              <div ref={leaderRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-[#565e74] block">
                  Technical Leader
                </label>
                <div
                  onClick={() => {
                    setLeaderDropdownOpen(!leaderDropdownOpen);
                    setPmDropdownOpen(false);
                    setMemberDropdownOpen(false);
                    setCustomerDropdownOpen(false);
                    setPhaseDropdownOpen(false);
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs text-[#0b1c30] flex flex-wrap gap-1.5 items-center justify-between min-h-[42px] cursor-pointer focus-within:ring-2 focus-within:ring-[#0058be]/20 focus-within:border-[#0058be] transition-all"
                >
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {selectedLeaders.length === 0 ? (
                      <span className="text-[#727785] px-2 py-1">Chọn Technical Leader...</span>
                    ) : (
                      selectedLeaders.map(id => {
                        const m = membersList.find(x => x.id === id);
                        return (
                          <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-semibold text-[11px] flex items-center gap-1">
                            {m?.display_name || id}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLeaders(selectedLeaders.filter(x => x !== id));
                              }}
                              className="text-blue-500 hover:text-blue-700 font-bold ml-0.5"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>
                  <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                </div>

                {leaderDropdownOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 p-2 space-y-2 max-h-[250px] flex flex-col"
                  >
                    <input
                      type="text"
                      value={leaderSearch}
                      onChange={(e) => setLeaderSearch(e.target.value)}
                      placeholder="Tìm kiếm Technical Leader..."
                      className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0058be]"
                    />
                    <div className="overflow-y-auto space-y-1 flex-1 max-h-[160px]">
                      {membersList
                        .filter(u => u.display_name?.toLowerCase().includes(leaderSearch.toLowerCase()) || u.full_name?.toLowerCase().includes(leaderSearch.toLowerCase()))
                        .map((u) => {
                          const isSelected = selectedLeaders.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedLeaders(selectedLeaders.filter(id => id !== u.id));
                                } else {
                                  setSelectedLeaders([...selectedLeaders, u.id]);
                                }
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#eff4ff]/60 rounded transition-colors flex items-center justify-between ${isSelected ? 'bg-[#eff4ff]/60 text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
                            >
                              <span>{u.display_name} <span className="text-[10px] text-slate-400 font-normal">({u.team || 'No Team'})</span></span>
                              {isSelected && <span className="text-emerald-600 font-bold text-[14px]">✓</span>}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* Members Selection */}
              <div ref={memberRef} className="space-y-2 relative">
                <label className="text-[11px] font-semibold text-[#565e74] block">
                  Danh sách thành viên dự án
                </label>
                <div
                  onClick={() => {
                    setMemberDropdownOpen(!memberDropdownOpen);
                    setPmDropdownOpen(false);
                    setLeaderDropdownOpen(false);
                    setCustomerDropdownOpen(false);
                    setPhaseDropdownOpen(false);
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs text-[#0b1c30] flex flex-wrap gap-1.5 items-center justify-between min-h-[42px] cursor-pointer focus-within:ring-2 focus-within:ring-[#0058be]/20 focus-within:border-[#0058be] transition-all"
                >
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {selectedMembers.length === 0 ? (
                      <span className="text-[#727785] px-2 py-1">Chọn thành viên tham gia...</span>
                    ) : (
                      selectedMembers.map(id => {
                        const m = membersList.find(x => x.id === id);
                        return (
                          <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-semibold text-[11px] flex items-center gap-1">
                            {m?.display_name || id}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedMembers(selectedMembers.filter(x => x !== id));
                              }}
                              className="text-blue-500 hover:text-blue-700 font-bold ml-0.5"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>
                  <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                </div>

                {memberDropdownOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 p-2 space-y-2 max-h-[250px] flex flex-col"
                  >
                    <input
                      type="text"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Tìm kiếm thành viên..."
                      className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0058be]"
                    />
                    <div className="overflow-y-auto space-y-1 flex-1 max-h-[160px]">
                      {membersList
                        .filter(u => u.display_name?.toLowerCase().includes(memberSearch.toLowerCase()) || u.full_name?.toLowerCase().includes(memberSearch.toLowerCase()))
                        .map((u) => {
                          const isSelected = selectedMembers.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedMembers(selectedMembers.filter(id => id !== u.id));
                                } else {
                                  setSelectedMembers([...selectedMembers, u.id]);
                                }
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#eff4ff]/60 rounded transition-colors flex items-center justify-between ${isSelected ? 'bg-[#eff4ff]/60 text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
                            >
                              <span>{u.display_name} <span className="text-[10px] text-slate-400 font-normal">({u.team || 'No Team'})</span></span>
                              {isSelected && <span className="text-emerald-600 font-bold text-[14px]">✓</span>}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
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
          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}
