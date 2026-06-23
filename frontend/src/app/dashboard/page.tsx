'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Navbar from '@/components/Navbar';
import { getViolations, getSheets, checkSheet, getSheetLogs } from '@/lib/api';

const VERDICT_STYLE: Record<string, string> = {
  FAIL: 'bg-red-950/40 text-[#f87171] border border-red-800/40',
  REVIEW: 'bg-amber-950/40 text-[#fbbf24] border border-amber-800/40',
  PASS: 'bg-emerald-950/40 text-[#34d399] border border-emerald-800/40'
};
const VERDICT_DOT: Record<string, string> = { FAIL: 'bg-red-500', REVIEW: 'bg-amber-500', PASS: 'bg-emerald-500' };

export default function DashboardPage() {
  const [sheets, setSheets] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sheetId, setSheetId] = useState('');
  const [verdict, setVerdict] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<'flat' | 'phase'>('flat');
  const [activePhase, setActivePhase] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('A');
  const [isScanning, setIsScanning] = useState(false);
  const [scanLogs, setScanLogs] = useState<any[]>([]);
  const pollRef = useRef<any>(null);
  const PER_PAGE = 25;

  useEffect(() => {
    getSheets().then(setSheets).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const proj = sp.get('project');
      if (proj) {
        if (proj === 'all') {
          setSheetId('');
        } else {
          setSheetId(proj);
        }
        setPage(1);
      }
    }
  }, [typeof window !== 'undefined' ? window.location.search : '']);

  const load = useCallback(() => {
    setLoading(true);
    const params: any = {
      page: viewMode === 'phase' ? 1 : page,
      per_page: viewMode === 'phase' ? 500 : PER_PAGE
    };
    if (sheetId) params.sheet_id = sheetId;
    if (verdict) params.ai_verdict = verdict;
    if (search) params.search = search;
    getViolations(params)
      .then(d => {
        setItems(d.items);
        setTotal(d.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sheetId, verdict, search, page, viewMode]);

  useEffect(() => {
    load();
  }, [load]);

  const poll = useCallback((id: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setScanLogs([]);
    pollRef.current = setInterval(async () => {
      try {
        const r = await getSheetLogs(id);
        setScanLogs(r.logs || []);
        if (r.status === 'success' || r.status === 'failed' || r.status === 'error') {
          clearInterval(pollRef.current);
          setIsScanning(false);
          load();
        }
      } catch {
        // ignore errors
      }
    }, 2000);
  }, [load]);

  const handleSync = async () => {
    if (!sheetId) return;
    setIsScanning(true);
    try {
      await checkSheet(Number(sheetId));
      poll(Number(sheetId));
    } catch {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const totalPages = Math.ceil(total / PER_PAGE);

  const getSheetName = (id: number) => {
    const s = sheets.find(x => x.id === id);
    return s?.name || s?.spreadsheet_id?.slice(0, 20) || 'Unknown';
  };

  const getRowPhase = (tabName: string): 'A' | 'B' | 'C' | 'D' | 'E' => {
    const name = (tabName || '').toLowerCase();
    if (name.includes('sale') || name.includes('admin') || name.startsWith('1.')) return 'A';
    if (name.includes('init') || name.startsWith('2.')) {
      if (name.includes('poc') || name.includes('lab') || name.startsWith('2.1.')) return 'C';
      return 'B';
    }
    if (name.includes('implement') || name.startsWith('3.')) return 'D';
    if (name.includes('ma') || name.startsWith('4.')) return 'E';
    
    if (name.includes('phase a')) return 'A';
    if (name.includes('phase b')) return 'B';
    if (name.includes('phase c')) return 'C';
    if (name.includes('phase d')) return 'D';
    if (name.includes('phase e')) return 'E';
    
    return 'A';
  };

  const parseRowData = (rowData: string) => {
    try {
      const d = JSON.parse(rowData || '{}');
      return {
        taskId: d['TASK ID'] || d['Task ID'] || d['ID'] || '',
        detail: d['DETAIL TASK'] || d['Task'] || d['Description'] || '',
        priority: d['PRIORITY'] || d['Priority'] || '',
        manday: d['MANDAY (EST)'] || d['Manday'] || '',
        status: d['STATUS'] || d['Status'] || '',
        date: d['START DATE (EST)'] || d['DATE'] || d['Date'] || d['Start Date'] || '',
        assigned: d['ASSIGNED'] || d['Assigned'] || d['Assignee'] || '',
        solutions: d['SOLUTIONS'] || d['Solutions'] || d['Solution'] || 'Other / General'
      };
    } catch {
      return { taskId: '', detail: '', priority: '', manday: '', status: '', date: '', assigned: '', solutions: 'Other / General' };
    }
  };

  const parseTask = (row_data: string) => {
    return parseRowData(row_data).detail;
  };

  const parsePriority = (row_data: string) => {
    return parseRowData(row_data).priority;
  };

  const parseManday = (row_data: string) => {
    return parseRowData(row_data).manday;
  };

  const parseAssigned = (row_data: string) => {
    return parseRowData(row_data).assigned;
  };

  // Group items by SOLUTIONS for the active phase
  const filteredPhaseItems = items.filter(x => getRowPhase(x.tab_name) === activePhase);
  const groups: Record<string, any[]> = {};
  filteredPhaseItems.forEach(item => {
    const taskData = parseRowData(item.row_data);
    const groupName = taskData.solutions || 'Other / General';
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(item);
  });

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0] flex">
      {/* Sidebar Navigation */}
      <Navbar />

      {/* Main Content Area */}
      <div className="flex-1 pl-[230px] flex flex-col min-h-screen">
        {/* Topbar */}
        <div className="h-[52px] bg-[#1a1d27] border-b border-[#2e3250] flex items-center justify-between px-6 sticky top-0 z-40">
          <h2 className="text-sm font-bold tracking-wider text-slate-200 uppercase">Compliance Dashboard</h2>
          <div className="flex items-center gap-3">
            {sheetId && (
              <button
                onClick={handleSync}
                disabled={isScanning}
                className="text-xs font-semibold px-3 py-1.5 rounded bg-[#10b981]/15 border border-[#10b981]/30 hover:bg-[#10b981]/25 text-[#34d399] transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {isScanning ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-[#34d399] border-t-transparent rounded-full animate-spin" />
                    Syncing...
                  </>
                ) : (
                  '⚡ Sync Google Sheet'
                )}
              </button>
            )}
            <button
              onClick={load}
              disabled={isScanning}
              className="text-xs font-semibold px-3 py-1.5 rounded bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-[#e2e8f0] transition-colors disabled:opacity-50"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="p-6 space-y-6">
          {/* Scanning Progress Console */}
          {isScanning && (
            <div className="bg-[#151821] rounded-xl border border-[#2e3250] overflow-hidden shadow-2xl animate-in fade-in duration-200">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[#2e3250] bg-[#1a1d27]">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-[#34d399] rounded-full animate-pulse" />
                  <span className="text-[#34d399] text-[10px] font-bold uppercase tracking-wider">Syncing in Real-Time</span>
                  <span className="text-[#64748b] text-[10px] font-semibold">{scanLogs.length} entries</span>
                </div>
              </div>
              <div className="h-40 overflow-y-auto p-4 space-y-1 font-mono text-[11px] leading-relaxed">
                {scanLogs.length === 0 && <p className="text-[#64748b] animate-pulse">Initializing sheet connection...</p>}
                {scanLogs.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-[#64748b] w-24 flex-shrink-0">{(l.time || '').split(' ')[1] || l.time || ''}</span>
                    <span className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : l.level === 'success' ? 'text-emerald-400' : 'text-gray-300'}>
                      {l.msg}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Header Description */}
          <div>
            <h1 className="text-xl font-bold text-slate-200">System Báo Cáo Tuân Thủ</h1>
            <p className="text-xs text-[#64748b] mt-0.5">Tìm thấy {total} lỗi vi phạm trên hệ thống</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {[
              { label: 'Total Violations', val: total, sub: `trên ${sheets.length} dự án`, color: 'text-[#f87171]', icon: '🚨' },
              { label: 'FAIL', val: sheets.reduce((a, s) => a + (s.fail_count || 0), 0), sub: 'manday sai, thiếu mô tả', color: 'text-[#f87171]', icon: '❌' },
              { label: 'REVIEW', val: total - sheets.reduce((a, s) => a + (s.fail_count || 0), 0), sub: 'cần leader xác nhận', color: 'text-[#fbbf24]', icon: '⚠️' },
              { label: 'PASS', val: '—', sub: 'tasks hợp lệ', color: 'text-[#34d399]', icon: '✅' },
              { label: 'Task Library', val: '—', sub: 'mẫu task chuẩn', color: 'text-[#818cf8]', icon: '📚' }
            ].map(m => (
              <div key={m.label} className="bg-[#1a1d27] border border-[#2e3250] rounded-xl p-4 relative overflow-hidden flex flex-col justify-between min-h-[96px]">
                <div className="text-[9px] font-bold text-[#64748b] uppercase tracking-wider">{m.label}</div>
                <div className={`text-2xl font-bold mt-1 ${m.color}`}>{m.val}</div>
                <div className="text-[10px] text-[#64748b] mt-1">{m.sub}</div>
                <div className="absolute right-4 bottom-4 text-xl opacity-40">{m.icon}</div>
              </div>
            ))}
          </div>

          {/* Sheets Overview Tabs */}
          {sheets.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-2">Sheets Overview</div>
              <div className="flex gap-1.5 bg-[#1a1d27] border border-[#2e3250] p-1 rounded-lg w-max max-w-full overflow-x-auto">
                <button
                  onClick={() => {
                    setSheetId('');
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    !sheetId ? 'bg-[#22263a] text-[#e2e8f0] shadow-sm' : 'text-[#94a3b8] hover:text-[#e2e8f0]'
                  }`}
                >
                  All Sheets
                </button>
                {sheets.map(s => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSheetId(String(s.id));
                      setPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      sheetId === String(s.id)
                        ? 'bg-[#22263a] text-[#e2e8f0] shadow-sm'
                        : 'text-[#94a3b8] hover:text-[#e2e8f0]'
                    }`}
                  >
                    <span className="truncate max-w-[120px]">{s.name || s.spreadsheet_id.slice(0, 16)}</span>
                    {s.violation_count > 0 && (
                      <span className="bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/30 px-1 py-0.2 rounded text-[9px] font-bold">
                        {s.violation_count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filters Area */}
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl p-4">
            <div className="flex gap-3 flex-wrap items-center justify-between">
              <div className="flex gap-3 flex-wrap items-center">
                {/* Status Filter */}
                <div className="flex gap-1 bg-[#22263a] p-1 rounded-lg">
                  {['', 'FAIL', 'REVIEW', 'PASS'].map(v => (
                    <button
                      key={v}
                      onClick={() => {
                        setVerdict(v);
                        setPage(1);
                      }}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                        verdict === v ? 'bg-[#1a1d27] text-[#e2e8f0] shadow-sm' : 'text-[#94a3b8] hover:text-[#e2e8f0]'
                      }`}
                    >
                      {v || 'All Status'}
                    </button>
                  ))}
                </div>

                {/* View Mode Toggle */}
                <div className="flex gap-1 bg-[#22263a] p-1 rounded-lg">
                  <button
                    onClick={() => setViewMode('flat')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                      viewMode === 'flat' ? 'bg-[#1a1d27] text-[#e2e8f0] shadow-sm' : 'text-[#94a3b8] hover:text-[#e2e8f0]'
                    }`}
                  >
                    Flat List
                  </button>
                  <button
                    onClick={() => setViewMode('phase')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                      viewMode === 'phase' ? 'bg-[#1a1d27] text-[#e2e8f0] shadow-sm' : 'text-[#94a3b8] hover:text-[#e2e8f0]'
                    }`}
                  >
                    Phase View
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      setSearch(searchInput);
                      setPage(1);
                    }
                  }}
                  placeholder="Search task content..."
                  className="bg-[#22263a] border border-[#2e3250] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] outline-none w-48 focus:border-[#6366f1] placeholder-[#64748b] transition-colors"
                />
                <button
                  onClick={() => {
                    setSearch(searchInput);
                    setPage(1);
                  }}
                  className="bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-xs font-semibold text-[#e2e8f0] px-3.5 py-1.5 rounded-lg transition-colors"
                >
                  Search
                </button>
                {search && (
                  <button
                    onClick={() => {
                      setSearch('');
                      setSearchInput('');
                      setPage(1);
                    }}
                    className="text-[#f87171] hover:underline text-xs px-2"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Phase Tabs (A/B/C/D/E) */}
          {viewMode === 'phase' && (
            <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl p-4 flex gap-2 flex-wrap shadow-md">
              {[
                { key: 'A', name: 'Phase A', desc: '1.Sale/Admin' },
                { key: 'B', name: 'Phase B', desc: '2.Init' },
                { key: 'C', name: 'Phase C', desc: '2.1.Lab/PoC' },
                { key: 'D', name: 'Phase D', desc: '3.Implement' },
                { key: 'E', name: 'Phase E', desc: '4.MA' }
              ].map(p => {
                const count = items.filter(x => getRowPhase(x.tab_name) === p.key).length;
                const active = activePhase === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => setActivePhase(p.key as any)}
                    className={`flex-1 min-w-[120px] p-3 rounded-lg border text-left transition-all ${
                      active
                        ? 'bg-gradient-to-r from-[#6366f1]/20 to-[#818cf8]/20 border-[#6366f1] shadow-lg'
                        : 'bg-[#22263a]/50 border-[#2e3250] hover:bg-[#22263a] hover:border-[#434768]'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className={`text-xs font-bold ${active ? 'text-[#818cf8]' : 'text-slate-300'}`}>
                        {p.name}
                      </span>
                      {count > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                          active ? 'bg-[#6366f1] text-white' : 'bg-[#1a1d27] text-[#94a3b8]'
                        }`}>
                          {count}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#64748b] mt-1 truncate">{p.desc}</div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Table */}
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl overflow-hidden shadow-xl">
            <table className="w-full text-xs text-[#cbd5e1]">
              <thead>
                <tr className="border-b border-[#2e3250] bg-[#22263a]">
                  {viewMode === 'phase' ? (
                    <>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider w-24">
                        TASK ID
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">
                        DETAIL
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider w-28">
                        PRIORITY
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider w-24">
                        MANDAY
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider w-28">
                        STATUS
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider w-36">
                        DATE
                      </th>
                    </>
                  ) : (
                    <>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider w-40">
                        Sheet / Tab
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">
                        Task Description
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider w-24">
                        Priority
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider w-20">
                        Manday
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider w-28">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-[#64748b] uppercase tracking-wider">
                        AI Evaluation & Suggestion
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              {viewMode === 'phase' ? (
                <>
                  {Object.entries(groups).map(([groupName, groupTasks]) => (
                    <tbody key={groupName} className="divide-y divide-[#2e3250] border-t border-[#2e3250]">
                      {/* Task Group Header Row */}
                      <tr className="bg-[#1e2235]/65">
                        <td colSpan={6} className="px-4 py-2.5 font-bold text-[#818cf8] text-xs uppercase tracking-wider border-b border-[#2e3250]">
                          📂 {groupName} ({groupTasks.length} tasks)
                        </td>
                      </tr>
                      {groupTasks.map((v, i) => {
                        const taskData = parseRowData(v.row_data);
                        return (
                          <tr
                            key={v.id}
                            className={`hover:bg-[#1e2235] transition-colors ${i % 2 === 0 ? '' : 'bg-[#151821]/30'}`}
                          >
                            <td className="px-4 py-3 font-mono text-[#cbd5e1] font-bold">
                              #{taskData.taskId || v.row_number}
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-[#cbd5e1] text-xs leading-relaxed">
                                {taskData.detail || '—'}
                              </p>
                              <div className="flex gap-2 items-center mt-1.5 flex-wrap">
                                {taskData.assigned && (
                                  <span className="bg-[#10b981]/15 text-[#34d399] px-2 py-0.5 rounded text-[10px] font-semibold border border-[#10b981]/25">
                                    👤 {taskData.assigned}
                                  </span>
                                )}
                                {v.violation_code && v.violation_code !== 'AI_REVIEW' && v.violation_code !== 'PASS' && (
                                  <span className="bg-[#22263a] text-[#94a3b8] px-2 py-0.5 rounded text-[10px] border border-[#2e3250]">
                                    {v.violation_code}: {v.violation_msg}
                                  </span>
                                )}
                              </div>
                              {v.ai_verdict !== 'PASS' && (v.ai_reason || v.ai_suggestion) && (
                                <div className="mt-2 bg-[#6366f1]/5 border border-[#6366f1]/15 rounded-md px-2.5 py-1.5">
                                  {v.ai_reason && <p className="text-[#94a3b8] text-xs leading-relaxed">{v.ai_reason}</p>}
                                  {v.ai_suggestion && (
                                    <p className="text-[#818cf8] text-xs leading-relaxed mt-1">
                                      <span className="font-semibold">💡 Suggestion: </span>
                                      {v.ai_suggestion}
                                    </p>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                  taskData.priority === 'Critical' || taskData.priority === 'URGENT'
                                    ? 'bg-red-950/40 text-[#f87171] border-red-800/40'
                                    : taskData.priority === 'High'
                                    ? 'bg-orange-950/40 text-[#fdba74] border-orange-800/40'
                                    : 'bg-blue-950/40 text-[#93c5fd] border-blue-800/40'
                                }`}
                              >
                                {taskData.priority || 'Normal'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[#94a3b8] text-xs font-mono">
                              {taskData.manday ? `${taskData.manday}d` : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${VERDICT_DOT[v.ai_verdict] ?? 'bg-gray-500'}`} />
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                    VERDICT_STYLE[v.ai_verdict] ?? 'bg-[#22263a] text-[#94a3b8]'
                                  }`}
                                >
                                  {v.ai_verdict}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-[#94a3b8] text-xs">
                              {taskData.date || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
                </>
              ) : (
                <tbody className="divide-y divide-[#2e3250]">
                  {loading && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-[#64748b]">
                        <div className="flex items-center justify-center gap-2">
                          <svg className="animate-spin h-4 w-4 text-[#6366f1]" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          Loading...
                        </div>
                      </td>
                    </tr>
                  )}
                  {!loading && items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-[#64748b] font-medium">
                        No violations found
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    items.map((v, i) => (
                      <tr
                        key={v.id}
                        className={`hover:bg-[#1e2235] transition-colors ${i % 2 === 0 ? '' : 'bg-[#151821]/30'}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-bold text-[#e2e8f0] text-xs leading-tight">
                            {v.sheet_name || getSheetName(v.sheet_id)}
                          </p>
                          {v.leader_email && (
                            <p className="text-[#818cf8] text-[10px] font-semibold mt-1" title="Leader">
                              LDR: {v.leader_email}
                            </p>
                          )}
                          {v.pm_email && (
                            <p className="text-[#38bdf8] text-[10px] font-semibold" title="PM">
                              PM: {v.pm_email}
                            </p>
                          )}
                          <p className="text-[#64748b] text-[10px] mt-0.5">
                            {v.tab_name} · Row {v.row_number}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[#cbd5e1] text-xs leading-relaxed line-clamp-2">
                            {String(parseTask(v.row_data))}
                          </p>
                          <div className="flex gap-2 items-center mt-1.5 flex-wrap">
                            {parseAssigned(v.row_data) && (
                              <span className="bg-[#10b981]/15 text-[#34d399] px-2 py-0.5 rounded text-[10px] font-semibold border border-[#10b981]/25">
                                👤 {parseAssigned(v.row_data)}
                              </span>
                            )}
                            {v.violation_code && v.violation_code !== 'AI_REVIEW' && (
                              <span className="bg-[#22263a] text-[#94a3b8] px-2 py-0.5 rounded text-[10px] border border-[#2e3250]">
                                {v.violation_code}: {v.violation_msg}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                              parsePriority(v.row_data) === 'Critical' || parsePriority(v.row_data) === 'URGENT'
                                ? 'bg-red-950/40 text-[#f87171] border-red-800/40'
                                : parsePriority(v.row_data) === 'High'
                                ? 'bg-orange-950/40 text-[#fdba74] border-orange-800/40'
                                : 'bg-blue-950/40 text-[#93c5fd] border-blue-800/40'
                            }`}
                          >
                            {parsePriority(v.row_data) || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#94a3b8] text-xs font-mono">{parseManday(v.row_data) || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${VERDICT_DOT[v.ai_verdict] ?? 'bg-gray-500'}`} />
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                VERDICT_STYLE[v.ai_verdict] ?? 'bg-[#22263a] text-[#94a3b8]'
                              }`}
                            >
                              {v.ai_verdict}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {v.ai_reason && <p className="text-[#94a3b8] text-xs leading-relaxed">{v.ai_reason}</p>}
                          {v.ai_suggestion && (
                            <div className="mt-1.5 bg-[#6366f1]/5 border border-[#6366f1]/15 rounded-md px-2.5 py-1.5">
                              <p className="text-[#818cf8] text-xs leading-relaxed">
                                <span className="font-semibold">💡 Suggestion: </span>
                                {v.ai_suggestion}
                              </p>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              )}
            </table>

            {/* Pagination */}
            {viewMode !== 'phase' && totalPages > 1 && (
              <div className="border-t border-[#2e3250] bg-[#22263a] px-4 py-3 flex items-center justify-between">
                <p className="text-xs text-[#64748b]">
                  Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} of {total}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-xs rounded-lg bg-[#1a1d27] border border-[#2e3250] hover:bg-[#22263a] disabled:opacity-40 text-[#94a3b8] transition-colors"
                  >
                    Previous
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = page <= 3 ? i + 1 : page + i - 2;
                    if (p < 1 || p > totalPages) return null;
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                          p === page
                            ? 'bg-[#6366f1] border-[#6366f1] text-white font-bold'
                            : 'bg-[#1a1d27] border-[#2e3250] text-[#94a3b8] hover:bg-[#22263a]'
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-xs rounded-lg bg-[#1a1d27] border border-[#2e3250] hover:bg-[#22263a] disabled:opacity-40 text-[#94a3b8] transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
