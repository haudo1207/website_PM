'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getSheets, addSheet, checkSheet, deleteSheet, getSheetLogs } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

interface Log {
  time: string;
  msg: string;
  level: string;
}

interface CS {
  id: number;
  status: string;
  logs: Log[];
}

export default function SheetsPage() {
  const router = useRouter();
  const [sheets, setSheets] = useState<any[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [leaderEmail, setLeaderEmail] = useState('');
  const [pmEmail, setPmEmail] = useState('');
  const [memberEmails, setMemberEmails] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [sheetToDelete, setSheetToDelete] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [cs, setCs] = useState<CS | null>(null);
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<any>(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [pmFilter, setPmFilter] = useState('All');

  const uniquePMs = Array.from(new Set(sheets.map(s => s.pm_email).filter(Boolean)));

  const reload = () => getSheets().then(setSheets).catch(() => {});

  const [activeMenu, setActiveMenu] = useState<number | null>(null);

  useEffect(() => {
    const handleClose = () => setActiveMenu(null);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  const getStatusStyle = (phase: string) => {
    const p = (phase || '').toLowerCase();
    if (p.includes('thực thi') || p.includes('giám sát') || p.includes('execution') || p.includes('monitoring')) {
      return {
        text: 'ĐANG TRIỂN KHAI',
        className: 'bg-[#7c3aed]/10 text-[#d2bbff] border-[#7c3aed]/20'
      };
    }
    if (p.includes('khởi tạo') || p.includes('lập kế hoạch') || p.includes('planning') || p.includes('init')) {
      return {
        text: 'ĐÃ LÊN LỊCH',
        className: 'bg-slate-800/40 text-slate-300 border-slate-700/40'
      };
    }
    if (p.includes('trì hoãn') || p.includes('delay')) {
      return {
        text: 'TRÌ HOÃN',
        className: 'bg-rose-500/10 text-rose-400 border-rose-500/20'
      };
    }
    if (p.includes('đóng') || p.includes('hoàn thành') || p.includes('close') || p.includes('done')) {
      return {
        text: 'HOÀN THÀNH',
        className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      };
    }
    return {
      text: phase?.toUpperCase() || 'ĐANG TRIỂN KHAI',
      className: 'bg-[#7c3aed]/10 text-[#d2bbff] border-[#7c3aed]/20'
    };
  };

  const getPMDisplay = (email: string) => {
    if (!email) return { initials: 'PM', name: 'Chưa có PM' };
    const namePart = email.split('@')[0];
    const cleanName = namePart
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    
    const parts = cleanName.split(' ');
    let initials = '';
    if (parts.length >= 2) {
      initials = parts[0][0] + parts[parts.length - 1][0];
    } else if (parts.length === 1) {
      initials = parts[0].substring(0, 2);
    }
    return {
      initials: initials.toUpperCase() || 'PM',
      name: cleanName
    };
  };

  const getProjectProgress = (s: any) => {
    if (s.current_phase?.toLowerCase().includes('hoàn thành') || s.current_phase?.toLowerCase().includes('done')) return 100;
    const seed = (s.id * 17) % 50 + 40; // yields 40% to 90%
    return s.violation_count > 0 ? Math.max(30, seed - s.violation_count * 5) : seed;
  };

  const getMockActivities = (projectList: any[]) => {
    const names = projectList.map(p => p.name);
    const name1 = names[0] || 'Sky Garden';
    const name2 = names[1] || 'Web App E-commerce';
    const name3 = names[2] || 'Ahamove';
    
    return [
      {
        icon: '💬',
        color: 'text-[#8b5cf6] bg-[#8b5cf6]/10 border-[#8b5cf6]/20',
        text: `Minh đã nhắn tin trên Zalo cho dự án ${name1}.`,
        time: '10 phút trước'
      },
      {
        icon: '⚡',
        color: 'text-[#38bdf8] bg-[#38bdf8]/10 border-[#38bdf8]/20',
        text: `Dự án ${name2} đã hoàn thành kiểm tra tuân thủ.`,
        time: '2 giờ trước'
      },
      {
        icon: '⚠️',
        color: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
        text: `Phát hiện cảnh báo mới tại dự án ${name3}.`,
        time: '5 giờ trước'
      }
    ];
  };

  useEffect(() => {
    reload();
    if (typeof window !== 'undefined' && window.location.search.includes('add=true')) {
      router.push('/projects/new');
    }
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [cs?.logs]);

  const flash = (t: string, e = false) => {
    setMsg({ t, e });
    setTimeout(() => setMsg(null), 4000);
  };

  const poll = (id: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setCs({ id, status: 'running', logs: [] });
    setShowLog(true);
    pollRef.current = setInterval(async () => {
      try {
        const r = await getSheetLogs(id);
        setCs({ id, status: r.status, logs: r.logs || [] });
        if (r.status === 'success' || r.status === 'failed' || r.status === 'error') {
          clearInterval(pollRef.current);
          reload();
        }
      } catch {
        // Suppress errors during polling
      }
    }, 2000);
  };

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const d = await addSheet({
        url,
        name: name || 'Sheet',
        leader_email: leaderEmail || undefined,
        pm_email: pmEmail || undefined,
        member_emails: memberEmails || undefined,
        auto_create: false
      });
      setUrl('');
      setName('');
      setLeaderEmail('');
      setPmEmail('');
      setMemberEmails('');
      setShowAddModal(false);
      flash('Added & check started!');
      reload();
      poll(d.id);
    } catch {
      flash('Invalid URL or not shared with service account', true);
    }
  };

  const lc: Record<string, string> = {
    info: 'text-gray-300',
    warn: 'text-amber-400',
    error: 'text-red-400',
    success: 'text-emerald-400'
  };

  const filteredSheets = sheets.filter(s => {
    const n = (s.name || '').toLowerCase();
    const c = (s.project_code || '').toLowerCase();
    const pm = (s.pm_email || '').toLowerCase();
    const cust = (s.customer_name || '').toLowerCase();
    const query = searchTerm.toLowerCase();
    const matchesSearch = n.includes(query) || c.includes(query) || pm.includes(query) || cust.includes(query);

    let matchesStatus = true;
    if (statusFilter !== 'All') {
      const phase = (s.current_phase || '').toLowerCase();
      if (statusFilter === 'execution') {
        matchesStatus = ['thực thi', 'giám sát', 'execution', 'monitoring'].some(p => phase.includes(p));
      } else if (statusFilter === 'planning') {
        matchesStatus = ['khởi tạo', 'lập kế hoạch', 'planning', 'init'].some(p => phase.includes(p));
      } else if (statusFilter === 'delay') {
        matchesStatus = phase.includes('trì hoãn') || phase.includes('delay');
      } else if (statusFilter === 'done') {
        matchesStatus = ['đóng', 'hoàn thành', 'close', 'done'].some(p => phase.includes(p));
      }
    }

    let matchesPM = true;
    if (pmFilter !== 'All') {
      matchesPM = s.pm_email === pmFilter;
    }

    return matchesSearch && matchesStatus && matchesPM;
  });

  return (
    <div className="min-h-screen bg-[#12141c] text-[#f8fafc] flex">
      {/* Sidebar Navigation */}
      <Navbar />

      {/* Main Content Area */}
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
        {/* Sheets Content */}
        <div className="p-8 space-y-6">
          {/* Header row matching screenshot */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Danh sách dự án</h1>
              <p className="text-xs text-slate-400 mt-1">Quản lý và theo dõi tiến độ các dự án đang hoạt động.</p>
            </div>
            
            <button
              onClick={() => router.push('/projects/new')}
              className="bg-gradient-to-r from-[#7c3aed] to-[#8b5cf6] hover:from-[#8b5cf6] hover:to-[#a78bfa] text-white px-5 py-2.5 rounded-lg text-xs font-bold transition-all shadow-lg active:scale-95 flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Tạo dự án mới
            </button>
          </div>

          {/* Global Toast Alert */}
          {msg && (
            <div
              className={`rounded-lg px-4 py-3 text-xs border shadow-sm ${
                msg.e
                  ? 'bg-red-950/40 text-[#f87171] border-red-800/40'
                  : 'bg-emerald-950/40 text-[#34d399] border-emerald-800/40'
              }`}
            >
              {msg.t}
            </div>
          )}

          {/* KPI Dashboard Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Card 1: TỔNG DỰ ÁN */}
            <div className="bg-gradient-to-br from-[#1a1d27] to-[#12141c] border border-[#2e3250]/70 rounded-xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden group hover:border-[#7c3aed]/40 transition-all duration-300">
              <div className="absolute -right-2 -bottom-2 text-[#7c3aed]/5 text-7xl font-black select-none pointer-events-none group-hover:scale-110 transition-transform duration-300">SUM</div>
              <div className="flex flex-col justify-between h-full">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">TỔNG DỰ ÁN</span>
                <span className="text-3xl font-black text-slate-100 tracking-tight">{String(sheets.length).padStart(2, '0')}</span>
                <span className="text-[10px] text-slate-500 font-semibold mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-[11px]">folder_open</span> Tất cả dự án</span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-[#7c3aed]/10 border border-[#7c3aed]/20 flex items-center justify-center text-[#a78bfa]">
                <span className="material-symbols-outlined text-[20px]">folder</span>
              </div>
            </div>

            {/* Card 2: ĐANG THỰC HIỆN */}
            <div className="bg-gradient-to-br from-[#1a1d27] to-[#12141c] border border-[#2e3250]/70 rounded-xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden group hover:border-[#38bdf8]/40 transition-all duration-300">
              <div className="absolute -right-2 -bottom-2 text-[#38bdf8]/5 text-7xl font-black select-none pointer-events-none group-hover:scale-110 transition-transform duration-300">RUN</div>
              <div className="flex flex-col justify-between h-full">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">ĐANG THỰC HIỆN</span>
                <span className="text-3xl font-black text-slate-100 tracking-tight">
                  {String(sheets.filter(s => ['thực thi', 'giám sát', 'execution', 'monitoring'].some(p => (s.current_phase || '').toLowerCase().includes(p))).length).padStart(2, '0')}
                </span>
                <span className="text-[10px] text-sky-400 font-semibold mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-[11px]">bolt</span> Đang hoạt động</span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-[#38bdf8]/10 border border-[#38bdf8]/20 flex items-center justify-center text-[#38bdf8]">
                <span className="material-symbols-outlined text-[20px]">bolt</span>
              </div>
            </div>

            {/* Card 3: HOÀN THÀNH */}
            <div className="bg-gradient-to-br from-[#1a1d27] to-[#12141c] border border-[#2e3250]/70 rounded-xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden group hover:border-emerald-500/40 transition-all duration-300">
              <div className="absolute -right-2 -bottom-2 text-emerald-500/5 text-7xl font-black select-none pointer-events-none group-hover:scale-110 transition-transform duration-300">OK</div>
              <div className="flex flex-col justify-between h-full">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">HOÀN THÀNH</span>
                <span className="text-3xl font-black text-slate-100 tracking-tight">
                  {String(sheets.filter(s => ['đóng', 'hoàn thành', 'close', 'done'].some(p => (s.current_phase || '').toLowerCase().includes(p))).length).padStart(2, '0')}
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-[11px]">task_alt</span> Đã hoàn tất</span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20 flex items-center justify-center text-[#10b981]">
                <span className="material-symbols-outlined text-[20px]">check_circle</span>
              </div>
            </div>

            {/* Card 4: CẦN LƯU Ý */}
            <div className="bg-gradient-to-br from-[#1a1d27] to-[#12141c] border border-[#2e3250]/70 rounded-xl p-5 flex items-center justify-between shadow-lg relative overflow-hidden group hover:border-rose-500/40 transition-all duration-300">
              <div className="absolute -right-2 -bottom-2 text-rose-500/5 text-7xl font-black select-none pointer-events-none group-hover:scale-110 transition-transform duration-300">WARN</div>
              <div className="flex flex-col justify-between h-full">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">CẦN LƯU Ý</span>
                <span className="text-3xl font-black text-slate-100 tracking-tight">
                  {String(sheets.filter(s => s.violation_count > 0).length).padStart(2, '0')}
                </span>
                <span className="text-[10px] text-rose-400 font-semibold mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-[11px]">warning</span> Có vi phạm tuân thủ</span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-[#f43f5e]/10 border border-[#f43f5e]/20 flex items-center justify-center text-[#f43f5e]">
                <span className="material-symbols-outlined text-[20px]">warning</span>
              </div>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-[#1a1d27]/40 border border-[#2e3250]/30 p-4 rounded-xl">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              {/* Search Project Input */}
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <span className="material-symbols-outlined text-[16px] text-slate-500 absolute left-3 top-1/2 -translate-y-1/2">search</span>
                <input
                  type="text"
                  placeholder="Tìm theo tên dự án, khách hàng..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-[#12141c] text-slate-200 border border-[#2e3250] pl-8 pr-4 py-2 rounded-lg text-xs outline-none focus:border-[#7c3aed] transition-all placeholder-slate-500 shadow-sm"
                />
              </div>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-[#12141c] text-slate-300 border border-[#2e3250] px-3.5 py-2 rounded-lg text-xs outline-none focus:border-[#7c3aed] cursor-pointer shadow-sm min-w-[130px]"
              >
                <option value="All">Tất cả giai đoạn</option>
                <option value="execution">Đang triển khai</option>
                <option value="planning">Đã lên lịch</option>
                <option value="delay">Trì hoãn</option>
                <option value="done">Hoàn thành</option>
              </select>

              {/* PM Filter */}
              <select
                value={pmFilter}
                onChange={e => setPmFilter(e.target.value)}
                className="bg-[#12141c] text-slate-300 border border-[#2e3250] px-3.5 py-2 rounded-lg text-xs outline-none focus:border-[#7c3aed] cursor-pointer shadow-sm min-w-[150px]"
              >
                <option value="All">Quản lý dự án (PM)</option>
                {uniquePMs.map(email => (
                  <option key={email} value={email}>
                    {getPMDisplay(email).name}
                  </option>
                ))}
              </select>

              {/* Advanced Filter Button */}
              <button
                type="button"
                className="bg-[#12141c] hover:bg-[#222634] text-slate-300 border border-[#2e3250] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px] text-slate-400">filter_alt</span>
                Bộ lọc nâng cao
              </button>
            </div>
          </div>

          {/* Log Worker Terminal */}
          {isAdmin() && showLog && cs != null && (
            <div className="bg-[#151821] rounded-xl border border-[#2e3250] overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-4.5 py-2.5 border-b border-[#2e3250] bg-[#1a1d27] px-4 py-2">
                <div className="flex items-center gap-3">
                  {cs.status === 'running' ? (
                    <>
                      <div className="w-2 h-2 bg-[#34d399] rounded-full animate-pulse" />
                      <span className="text-[#34d399] text-[10px] font-bold uppercase tracking-wider">RUNNING WORKER</span>
                    </>
                  ) : cs.status === 'success' ? (
                    <>
                      <div className="w-2 h-2 bg-[#10b981] rounded-full" />
                      <span className="text-[#10b981] text-[10px] font-bold uppercase tracking-wider">COMPLETED SUCCESSFULLY</span>
                    </>
                  ) : (
                    <>
                      <div className="w-2 h-2 bg-[#ef4444] rounded-full" />
                      <span className="text-[#ef4444] text-[10px] font-bold uppercase tracking-wider">WORKER FAILED</span>
                    </>
                  )}
                  <span className="text-[#64748b] text-[10px] font-semibold">Sheet #{cs.id} · {cs.logs.length} entries</span>
                </div>
                <button
                  onClick={() => setShowLog(false)}
                  className="text-[#64748b] hover:text-[#e2e8f0] text-[10px] font-bold px-2.5 py-1 rounded bg-[#22263a] hover:bg-[#2a2f47] transition-all"
                >
                  Hide Console
                </button>
              </div>
              <div ref={logRef} className="h-56 overflow-y-auto p-4.5 p-4 space-y-1 font-mono text-[11px] leading-relaxed">
                {cs.logs.length === 0 && <p className="text-[#64748b] animate-pulse">Initializing worker channel, waiting for events...</p>}
                {cs.logs.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-[#64748b] w-24 flex-shrink-0">{l.time.split(' ')[1] || l.time}</span>
                    <span className={lc[l.level] || 'text-[#cbd5e1]'}>{l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Project List Table */}
          <div className="bg-[#1a1d27] border border-[#2e3250]/70 rounded-xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-[#2e3250]/60 flex items-center justify-between bg-[#22263a]/10">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Tất cả dự án</h3>
              <div className="flex items-center gap-3 text-slate-400">
                <span className="material-symbols-outlined text-[18px] cursor-pointer hover:text-white transition-colors" title="Tải xuống CSV">download</span>
                <span className="material-symbols-outlined text-[18px] cursor-pointer hover:text-white transition-colors" title="In báo cáo">print</span>
              </div>
            </div>
            <table className="w-full text-xs text-[#cbd5e1]">
              <thead>
                <tr className="bg-[#22263a]/40 border-b border-[#2e3250]/60">
                  <th className="text-left px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tên dự án</th>
                  <th className="text-left px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Khách hàng</th>
                  <th className="text-left px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">GIAI ĐOẠN</th>
                  <th className="text-left px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Quản lý (PM)</th>
                  <th className="text-left px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Kênh kết nối</th>
                  <th className="text-center px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-[100px]">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2e3250]/40">
                {filteredSheets.map(s => {
                  const running = cs != null && cs.id === s.id && cs.status === 'running';
                  const statusInfo = getStatusStyle(s.current_phase);
                  const pm = getPMDisplay(s.pm_email);

                  return (
                    <tr key={s.id} className={`hover:bg-[#1f2331]/30 transition-colors ${running ? 'bg-[#7c3aed]/5' : ''}`}>
                      {/* Name & ID Column */}
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span
                            onClick={() => router.push(`/project/detail?id=${s.id}`)}
                            className="font-bold text-slate-200 text-xs hover:text-[#a78bfa] transition-colors cursor-pointer"
                          >
                            {s.name || 'Unnamed Project'}
                          </span>
                          <span className="text-[10px] text-slate-500 mt-1">
                            ID: {s.project_code || `PRJ-2024-${String(s.id).padStart(3, '0')}`}
                          </span>
                        </div>
                      </td>

                      {/* Customer Column */}
                      <td className="px-6 py-4 text-slate-300 font-medium">
                        {s.customer_name || <span className="text-slate-600 italic text-[10px]">—</span>}
                      </td>

                      {/* Status Column */}
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-extrabold uppercase border ${statusInfo.className}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {statusInfo.text}
                        </span>
                      </td>

                      {/* PM Column */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700/60 flex items-center justify-center text-[9px] font-extrabold text-slate-300">
                            {pm.initials}
                          </div>
                          <span className="text-xs font-semibold text-slate-300">{pm.name}</span>
                        </div>
                      </td>

                      {/* Contact Channels Column */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          {s.zalo_link ? (
                            <a href={s.zalo_link} target="_blank" rel="noreferrer"
                              className="w-5 h-5 rounded-full bg-[#0068FF] text-white flex items-center justify-center text-[9px] font-black hover:scale-110 transition-transform shadow-sm"
                              title="Zalo Group">Z</a>
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-slate-800/40 text-slate-600 flex items-center justify-center text-[9px]" title="Zalo (Chưa cấu hình)">Z</span>
                          )}
                          {s.telegram_link ? (
                            <a href={s.telegram_link} target="_blank" rel="noreferrer"
                              className="w-5 h-5 rounded-full bg-[#2AABEE] text-white flex items-center justify-center text-[9px] hover:scale-110 transition-transform shadow-sm"
                              title="Telegram Group">✈</a>
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-slate-800/40 text-slate-600 flex items-center justify-center text-[9px]" title="Telegram (Chưa cấu hình)">✈</span>
                          )}
                          {s.teams_link ? (
                            <a href={s.teams_link} target="_blank" rel="noreferrer"
                              className="w-5 h-5 rounded-full bg-[#4F52B2] text-white flex items-center justify-center text-[9px] font-black hover:scale-110 transition-transform shadow-sm"
                              title="Teams Group">T</a>
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-slate-800/40 text-slate-600 flex items-center justify-center text-[9px]" title="Teams (Chưa cấu hình)">T</span>
                          )}
                        </div>
                      </td>

                      {/* Actions Column */}
                      <td className="px-6 py-4 text-center">
                        <div className="relative flex justify-center items-center">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === s.id ? null : s.id); }}
                            className="p-1 hover:bg-slate-800/60 rounded-full text-slate-400 hover:text-slate-100 transition-all active:scale-95"
                          >
                            <span className="material-symbols-outlined text-[18px]">more_vert</span>
                          </button>
                          {activeMenu === s.id && (
                            <div className="absolute right-6 top-0 w-44 bg-[#1a1d27] border border-[#2e3250] rounded-xl shadow-2xl z-50 py-1.5 text-left">
                              <button
                                type="button"
                                onClick={() => router.push(`/project/detail?id=${s.id}`)}
                                className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-[#7c3aed]/15 hover:text-[#d2bbff] transition-colors flex items-center gap-2"
                              >
                                <span className="material-symbols-outlined text-[16px] text-slate-400">visibility</span>
                                Xem chi tiết dự án
                              </button>
                              <a
                                href={s.spreadsheet_url || `https://docs.google.com/spreadsheets/d/${s.spreadsheet_id}`}
                                target="_blank" rel="noreferrer"
                                className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-[#7c3aed]/15 hover:text-[#d2bbff] transition-colors flex items-center gap-2 block"
                              >
                                <span className="material-symbols-outlined text-[16px] text-slate-400">open_in_new</span>
                                Mở Google Sheet
                              </a>
                              {cs != null && cs.id === s.id && !showLog && (
                                <button
                                  type="button"
                                  onClick={() => setShowLog(true)}
                                  className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-[#7c3aed]/15 hover:text-[#d2bbff] transition-colors flex items-center gap-2"
                                >
                                  <span className="material-symbols-outlined text-[16px] text-slate-400">terminal</span>
                                  Xem Console Logs
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSheetToDelete(s.id)}
                                className="w-full text-left px-4 py-2 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-2 border-t border-[#2e3250]/60 mt-1 pt-1.5"
                              >
                                <span className="material-symbols-outlined text-[16px] text-rose-400">delete</span>
                                Xóa dự án
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredSheets.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-500 font-medium">
                      Chưa có dự án nào được đăng ký hoặc khớp bộ lọc
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </div>
      </div>


      {/* MODAL: Add Sheet Form */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl shadow-2xl p-6 max-w-xl w-full relative animate-in fade-in zoom-in-95 duration-150 text-[#e2e8f0]">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 text-[#64748b] hover:text-[#e2e8f0] font-bold text-lg"
            >
              ✕
            </button>
            <h2 className="text-base font-bold text-slate-200 mb-1 flex items-center gap-2">
              <span className="text-xl">⚡</span> Add New Google Sheet
            </h2>
            <p className="text-[#64748b] text-[11px] mb-5 leading-normal">
              Register a new project sheet. Please ensure the Google Service Account has reader permissions on the sheet.
            </p>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Google Sheet URL *</label>
                <input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  required
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
              </div>
              <div>
                <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Project Name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. GoDN Korea"
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Leader Email</label>
                  <input
                    value={leaderEmail}
                    onChange={e => setLeaderEmail(e.target.value)}
                    placeholder="leader@company.com"
                    type="email"
                    className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">PM Email</label>
                  <input
                    value={pmEmail}
                    onChange={e => setPmEmail(e.target.value)}
                    placeholder="pm@company.com"
                    type="email"
                    className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Members (comma-separated emails)</label>
                <textarea
                  value={memberEmails}
                  onChange={e => setMemberEmails(e.target.value)}
                  placeholder="member1@company.com, member2@company.com"
                  rows={2}
                  className="w-full bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] outline-none focus:border-[#6366f1] placeholder-[#64748b] transition-colors resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-[#e2e8f0] px-4.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#6366f1] hover:bg-[#818cf8] text-white px-5 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-md"
                >
                  Add & Start Import
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Delete Confirmation */}
      {sheetToDelete !== null && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl shadow-2xl p-6 max-w-sm w-full relative animate-in fade-in zoom-in-95 duration-150 text-[#e2e8f0]">
            <h2 className="text-base font-bold text-slate-200 mb-2 flex items-center gap-2">
              <span className="text-red-400">⚠️</span> Delete Project Sheet
            </h2>
            <p className="text-[#64748b] text-[11px] mb-6 leading-normal">
              Are you sure you want to delete this project sheet? This will permanently remove all analyzed compliance violations. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setSheetToDelete(null)}
                className="bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-[#e2e8f0] px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = sheetToDelete;
                  setSheetToDelete(null);
                  try {
                    await deleteSheet(id);
                    reload();
                  } catch {
                    flash('Failed to delete project sheet', true);
                  }
                }}
                className="bg-red-600 hover:bg-red-500 text-white px-5 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-md"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
