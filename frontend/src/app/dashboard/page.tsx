'use client';
import { useEffect, useState, useCallback, useRef, Fragment, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getViolations, getSheets, checkSheet, getSheetLogs, addTask, checkSingleTask } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

const PHASE_TABS = [
  { key: 'A', label: '1.Sale/Admin' },
  { key: 'B', label: '2.Init' },
  { key: 'C', label: '2.1.Lab/PoC' },
  { key: 'D', label: '3.Implement' },
  { key: 'E', label: '4.MA' },
];

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sheets, setSheets] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sheetId, setSheetId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [activePhase, setActivePhase] = useState<string>('A');
  const [isScanning, setIsScanning] = useState(false);
  const pollRef = useRef<any>(null);
  const PER_PAGE = 500;

  const [addingTaskBelowId, setAddingTaskBelowId] = useState<number | null>(null);
  const [checkingTaskId, setCheckingTaskId] = useState<number | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [newForm, setNewForm] = useState({
    taskId: '',
    detail: '',
    priority: '',
    manday: '',
    status: 'Todo',
    date: '',
    assigned: '',
    support: '',
    kpiRatio: '',
    skillSolution: '',
    skillVendor: '',
    ticketId: '',
    remark: '',
    send: '',
    endDate: '',
    mandayActual: '',
  });

  useEffect(() => {
    getSheets().then(setSheets).catch(() => {});
  }, []);

  const proj = searchParams.get('project');

  const activeSheet = sheets.find(s => String(s.id) === sheetId);
  const activeSheetName = activeSheet ? activeSheet.name : (sheetId ? 'Loading Project...' : 'All Sheets');

  useEffect(() => {
    if (proj && proj !== 'all') {
      setSheetId(proj);
    } else {
      setSheetId('');
    }
  }, [proj]);

  const load = useCallback(() => {
    setLoading(true);
    const params: any = { page: 1, per_page: PER_PAGE };
    if (sheetId) params.sheet_id = sheetId;
    if (search) params.search = search;
    getViolations(params)
      .then(d => { setItems(d.items); setTotal(d.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sheetId, search]);

  const poll = useCallback((id: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await getSheetLogs(id);
        if (['success', 'failed', 'error'].includes(r.status)) {
          clearInterval(pollRef.current);
          setIsScanning(false);
          load();
        }
      } catch {
        clearInterval(pollRef.current);
        setIsScanning(false);
        load();
      }
    }, 2000);
  }, [load]);

  const handleSync = useCallback(async () => {
    if (!sheetId) return;
    setIsScanning(true);
    try {
      await checkSheet(Number(sheetId));
      poll(Number(sheetId));
    } catch {
      setIsScanning(false);
      load();
    }
  }, [sheetId, poll, load]);
  // Load data on sheet selection change
  useEffect(() => {
    setIsScanning(false);
    load();
  }, [sheetId, load]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // --- Helpers ---
  const getRowPhase = (tabName: string): string => {
    const n = (tabName || '').toLowerCase();
    if (n.includes('sale') || n.includes('admin') || n.startsWith('1.')) return 'A';
    if (n.includes('poc') || n.includes('lab') || n.startsWith('2.1.')) return 'C';
    if (n.includes('init') || n.startsWith('2.')) return 'B';
    if (n.includes('implement') || n.startsWith('3.')) return 'D';
    if (n.includes('ma') || n.startsWith('4.')) return 'E';
    return 'A';
  };

  const parseRowData = (rowData: string) => {
    try {
      const d = JSON.parse(rowData || '{}');
      return {
        taskId: d['TASK ID'] || d['Task ID'] || d['ID'] || '',
        detail: d['DETAIL TASK'] || d['Task'] || d['Description'] || '',
        priority: d['PRIORITY'] || d['Priority'] || '',
        manday: d['MANDAY (EST)'] || d['MANDAY EST'] || d['Manday'] || '',
        status: d['STATUS'] || d['Status'] || '',
        date: d['START DATE (EST)'] || d['START DATE'] || d['Start Date'] || d['DATE'] || d['Date'] || '',
        assigned: d['ASSIGNED'] || d['Assigned'] || d['Assignee'] || '',
        support: d['SUPPORT'] || d['Support'] || '',
        kpiRatio: d['KPI RATIO'] || d['KPI Ratio'] || d['Kpi Ratio'] || d['kpi ratio'] || '',
        skillSolution: d['SKILL SOLUTION'] || d['Skill Solution'] || d['Skill solution'] || d['skill solution'] || '',
        skillVendor: d['SKILL VENDOR'] || d['Skill Vendor'] || d['Skill vendor'] || d['skill vendor'] || '',
        ticketId: d['TICKET ID'] || d['Ticket ID'] || d['Ticket Id'] || d['ticket id'] || '',
        remark: d['REMARK'] || d['Remark'] || d['remark'] || '',
        send: d['SEND'] || d['Send'] || d['send'] || '',
        endDate: d['END DAY (EST)'] || d['END DAY EST'] || d['End Day'] || d['End Day (Est)'] || d['End Date'] || d['END DATE'] || '',
        mandayActual: d['MANDAY ACTUAL'] || d['Manday Actual'] || d['MANDAY_ACTUAL'] || d['Manday actual'] || '',
      };
    } catch {
      return {
        taskId: '', detail: '', priority: '', manday: '', status: '', date: '', assigned: '', support: '',
        kpiRatio: '', skillSolution: '', skillVendor: '', ticketId: '', remark: '', send: '', endDate: '', mandayActual: ''
      };
    }
  };

  const handleOpenAddTask = (item: any) => {
    const parsed = parseRowData(item.row_data);
    let nextId = '';
    const idVal = parsed.taskId || '';
    const numPart = idVal.match(/\d+$/);
    if (numPart) {
      const nextNum = parseInt(numPart[0], 10) + 1;
      nextId = idVal.slice(0, numPart.index) + nextNum;
    }
    
    setNewForm({
      taskId: nextId,
      detail: '',
      priority: '',
      manday: '',
      status: 'Todo',
      date: '',
      assigned: '',
      support: '',
      kpiRatio: '',
      skillSolution: '',
      skillVendor: '',
      ticketId: '',
      remark: '',
      send: '',
      endDate: '',
      mandayActual: '',
    });
    setAddingTaskBelowId(item.id);
  };

  const handleCancelAddTask = () => {
    setAddingTaskBelowId(null);
  };

  const handleSaveTask = async () => {
    if (!sheetId) return;
    if (!newForm.detail.trim()) {
      alert('Vui lòng nhập Detail Task!');
      return;
    }
    
    const belowItem = items.find(x => x.id === addingTaskBelowId);
    if (!belowItem) return;
    
    setSavingTask(true);
    try {
      const taskData = {
        'TASK ID': newForm.taskId,
        'DETAIL TASK': newForm.detail,
        'PRIORITY': newForm.priority,
        'MANDAY (EST)': newForm.manday,
        'STATUS': newForm.status,
        'START DATE (EST)': newForm.date,
        'ASSIGNED': newForm.assigned,
        'SUPPORT': newForm.support,
        'KPI RATIO': newForm.kpiRatio,
        'SKILL SOLUTION': newForm.skillSolution,
        'SKILL VENDOR': newForm.skillVendor,
        'TICKET ID': newForm.ticketId,
        'REMARK': newForm.remark,
        'SEND': newForm.send,
        'END DAY (EST)': newForm.endDate,
        'MANDAY ACTUAL': newForm.mandayActual,
      };
      
      await addTask(Number(sheetId), {
        tab_name: belowItem.tab_name,
        after_row: belowItem.row_number,
        task_data: taskData
      });
      
      setAddingTaskBelowId(null);
      load();
    } catch (err: any) {
      alert('Lỗi thêm task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSavingTask(false);
    }
  };

  const handleCheckTask = async (violationId: number) => {
    setCheckingTaskId(violationId);
    try {
      const result = await checkSingleTask(violationId);
      setItems(prev => prev.map(item => {
        if (item.id === violationId) {
          return {
            ...item,
            ai_verdict: result.ai_verdict,
            ai_reason: result.ai_reason,
            ai_suggestion: result.ai_suggestion,
            row_data: result.row_data
          };
        }
        return item;
      }));
    } catch (err: any) {
      alert('Lỗi kiểm tra task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setCheckingTaskId(null);
    }
  };

  // --- Computed data ---
  const phaseItems = items.filter(x => getRowPhase(x.tab_name) === activePhase);
  const phaseLabel = PHASE_TABS.find(p => p.key === activePhase)?.label || '';

  const realTasks = phaseItems.filter(x => x.ai_verdict !== 'SECTION');
  const totalTasks = realTasks.length;
  const highPriority = realTasks.filter(x => {
    const p = parseRowData(x.row_data).priority.toLowerCase();
    return p === 'high' || p === 'critical' || p === 'urgent';
  }).length;
  const inProgress = realTasks.filter(x => {
    const s = parseRowData(x.row_data).status.toLowerCase();
    return s === 'process' || s === 'doing' || s === 'in progress';
  }).length;
  const completed = realTasks.filter(x => {
    const s = parseRowData(x.row_data).status.toLowerCase();
    return s === 'done' || s === 'completed';
  }).length;

  // --- Status & Priority helpers ---
  const getStatusInfo = (status: string) => {
    const s = (status || '').trim().toLowerCase();
    if (s === 'done' || s === 'completed') return { label: 'Done', dot: 'bg-emerald-400', text: 'text-emerald-400' };
    if (s === 'process' || s === 'doing' || s === 'in progress') return { label: 'Process', dot: 'bg-amber-400', text: 'text-amber-400' };
    if (s === 'review') return { label: 'Review', dot: 'bg-indigo-400', text: 'text-indigo-400' };
    if (s === 'pending') return { label: 'Pending', dot: 'bg-slate-400', text: 'text-slate-400' };
    return { label: status || 'Todo', dot: 'bg-slate-500', text: 'text-slate-400' };
  };

  const getPriorityStyle = (priority: string) => {
    const p = (priority || '').trim().toLowerCase();
    if (p === 'critical' || p === 'urgent') return 'bg-red-500/15 text-red-400 border-red-500/30';
    if (p === 'high') return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
    if (p === 'normal' || p === 'medium') return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    if (p === 'low') return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
    return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  };

  return (
    <div className="h-screen bg-[#0f1117] text-[#e2e8f0] flex overflow-hidden">
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">

        {/* Top Bar */}
        <div className="h-14 bg-[#1a1d27]/80 backdrop-blur-md border-b border-[#2e3250] flex items-center justify-between px-6 shrink-0 z-40">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-sm font-bold text-slate-200">Dashboard</h2>
            {activeSheetName && (
              <>
                <span className="text-slate-600">/</span>
                <span className="text-xs font-semibold text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-lg border border-indigo-500/20 max-w-[220px] truncate flex items-center gap-1.5" title={activeSheetName}>
                  {isScanning ? (
                    <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
                  ) : (
                    <span>📂</span>
                  )}
                  <span>{activeSheetName}</span>
                  {isScanning && <span className="text-[10px] text-indigo-400/70 animate-pulse">(syncing...)</span>}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <button onClick={load} disabled={isScanning}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-slate-200 transition-all disabled:opacity-50">
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className={`p-6 flex flex-col space-y-4 flex-1 min-h-0 overflow-hidden transition-opacity duration-200 ${loading ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>

          {/* 4 Stat Cards — Pulse style */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Tasks', value: totalTasks, sub: `Across all phases in ${phaseLabel}`, icon: '📋', border: 'border-l-indigo-500', text: 'text-indigo-400' },
              { label: 'High Priority', value: highPriority, sub: 'Tasks marked as high priority', icon: '🔥', border: 'border-l-rose-500', text: 'text-rose-400' },
              { label: 'In Progress', value: inProgress, sub: 'Tasks currently active', icon: '⚡', border: 'border-l-amber-500', text: 'text-amber-400' },
              { label: 'Completed', value: completed, sub: 'Tasks marked as done', icon: '✅', border: 'border-l-emerald-500', text: 'text-emerald-400' },
            ].map(c => (
              <div key={c.label} className={`relative overflow-hidden rounded-xl border border-[#2e3250]/70 border-l-4 ${c.border} bg-[#1a1d27]/70 backdrop-blur-sm p-5`}>
                <div className="absolute -right-2 -top-2 text-4xl opacity-15">{c.icon}</div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{c.label}</p>
                <p className={`text-3xl font-extrabold mt-2 ${c.text}`}>{c.value}</p>
                <p className="text-[11px] text-slate-400 mt-1">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Phase Tabs + Search */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1 bg-[#1a1d27] border border-[#2e3250] rounded-xl p-1">
              {PHASE_TABS.map(p => (
                <button key={p.key} onClick={() => setActivePhase(p.key)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activePhase === p.key ? 'bg-indigo-500/20 text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput); } }}
                placeholder="Search tasks..."
                className="bg-[#1a1d27] border border-[#2e3250] rounded-lg px-3 py-2 text-xs text-slate-200 outline-none w-52 focus:border-indigo-500/50 placeholder-slate-500 transition-colors" />
              {search && (
                <button onClick={() => { setSearch(''); setSearchInput(''); }} className="text-red-400 text-xs hover:underline">Clear</button>
              )}
            </div>
          </div>

          {/* Task List Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-slate-100">Task List</h3>
              <span className="bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                {phaseItems.length} items
              </span>
            </div>
          </div>

          {/* Task Table */}
          <div className="bg-[#1a1d27] border border-[#2e3250] rounded-xl shadow-xl flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs min-w-max">
                <thead className="sticky top-0 z-20 bg-[#151821] border-b border-[#2e3250] shadow-sm">
                  <tr>
                    <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[110px]">ACTIONS</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[70px]">TASK ID</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[240px]">DETAIL TASK</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[100px]">PRIORITY</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[90px]">MANDAY EST</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[100px]">STATUS</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[110px]">START DATE</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[110px]">ASSIGNED</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[110px]">SUPPORT</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[85px]">KPI RATIO</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[120px]">SKILL SOLUTION</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[110px]">SKILL VENDOR</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[100px]">TICKET ID</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[120px]">REMARK</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[80px]">SEND</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[110px]">END DAY EST</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[95px]">MANDAY ACTUAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2e3250]/50">
                  {loading && (
                    <tr><td colSpan={17} className="text-center py-16 text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /> Loading...
                      </div>
                    </td></tr>
                  )}
                  {!loading && phaseItems.length === 0 && (
                    <tr><td colSpan={17} className="text-center py-16 text-slate-500 font-medium">
                      No tasks found in {phaseLabel}
                    </td></tr>
                  )}
                  {!loading && phaseItems.map((v, idx) => {
                    const td = parseRowData(v.row_data);
                    const isSection = v.ai_verdict === 'SECTION';

                    let rowElement = null;

                    if (isSection) {
                      const detail = td.detail || '';
                      const isMainSection = /^PHASE\s/i.test(detail) || (detail === detail.toUpperCase() && detail.length > 10 && !/^[IVXLC]+\./.test(detail));

                      if (isMainSection) {
                        rowElement = (
                          <tr className="bg-[#15152a] border-l-[4px] border-l-[#5b57d6] border-b border-[#2e3250]/20 group relative">
                            <td className="px-4 py-3.5"></td>
                            <td colSpan={16} className="px-4 py-3.5 relative">
                              <span className="text-[12px] font-black text-slate-100 uppercase tracking-wider">{detail}</span>
                              
                              {/* Hover Add Task Button */}
                              <div className="absolute left-0 right-0 -bottom-3.5 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                                <button
                                  onClick={() => handleOpenAddTask(v)}
                                  className="pointer-events-auto bg-[#5b57d6]/95 hover:bg-[#5b57d6] text-white text-[9px] font-extrabold px-3 py-1 rounded-full shadow-xl flex items-center gap-1 active:scale-95 transition-all border border-[#5b57d6]/30 uppercase tracking-wider"
                                >
                                  <span>+ Add task below</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      } else {
                        rowElement = (
                          <tr className="bg-[#1c1a3a]/40 border-b border-[#2e3250]/20 font-bold group relative">
                            {/* 1. ACTIONS */}
                            <td className="px-4 py-3"></td>
                            {/* 2. TASK ID */}
                            <td className="px-4 py-3"></td>
                            {/* 3. DETAIL TASK */}
                            <td className="px-4 py-3 text-slate-200 relative pl-8">
                              <span className="text-[11px] font-bold uppercase tracking-wider">{detail}</span>
                              
                              {/* Hover Add Task Button */}
                              <div className="absolute left-0 right-0 -bottom-3.5 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                                <button
                                  onClick={() => handleOpenAddTask(v)}
                                  className="pointer-events-auto bg-indigo-600/95 hover:bg-indigo-600 text-white text-[9px] font-extrabold px-3 py-1 rounded-full shadow-xl flex items-center gap-1 active:scale-95 transition-all border border-indigo-400/30 uppercase tracking-wider"
                                >
                                  <span>+ Add task below</span>
                                </button>
                              </div>
                            </td>
                            {/* 4. PRIORITY */}
                            <td className="px-4 py-3"></td>
                            {/* 5. MANDAY EST */}
                            <td className="px-4 py-3 text-slate-500 font-mono text-[11px] font-bold">
                              {td.manday || '—'}
                            </td>
                            {/* 6. STATUS */}
                            <td className="px-4 py-3"></td>
                            {/* 7. START DATE */}
                            <td className="px-4 py-3 text-slate-500">
                              {td.date || '—'}
                            </td>
                            {/* 8. ASSIGNED */}
                            <td className="px-4 py-3"></td>
                            {/* 9. SUPPORT */}
                            <td className="px-4 py-3"></td>
                            {/* 10. KPI RATIO */}
                            <td className="px-4 py-3"></td>
                            {/* 11. SKILL SOLUTION */}
                            <td className="px-4 py-3"></td>
                            {/* 12. SKILL VENDOR */}
                            <td className="px-4 py-3"></td>
                            {/* 13. TICKET ID */}
                            <td className="px-4 py-3"></td>
                            {/* 14. REMARK */}
                            <td className="px-4 py-3"></td>
                            {/* 15. SEND */}
                            <td className="px-4 py-3"></td>
                            {/* 16. END DATE */}
                            <td className="px-4 py-3 text-slate-500">
                              {td.endDate || '—'}
                            </td>
                            {/* 17. MANDAY ACTUAL */}
                            <td className="px-4 py-3 text-slate-500">
                              {td.mandayActual || '—'}
                            </td>
                          </tr>
                        );
                      }
                    } else {
                      const statusInfo = getStatusInfo(td.status);
                      const priStyle = getPriorityStyle(td.priority);

                      rowElement = (
                        <tr className={`group relative hover:bg-[#22263a]/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-[#151821]/30'}`}>
                          {/* 1. ACTIONS */}
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => handleCheckTask(v.id)}
                              disabled={checkingTaskId === v.id}
                              className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 px-2 py-1 rounded text-[10px] font-bold transition-all disabled:opacity-50 flex items-center gap-1 mx-auto"
                              title="Kiểm tra task này"
                            >
                              {checkingTaskId === v.id ? (
                                <>
                                  <div className="w-2.5 h-2.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
                                  <span>Checking...</span>
                                </>
                              ) : (
                                <>
                                  <span>🔍</span>
                                  <span>Check Task</span>
                                </>
                              )}
                            </button>
                          </td>
                          {/* 2. TASK ID */}
                          <td className="px-4 py-3 font-mono text-slate-400 font-semibold flex items-center gap-1.5">
                            {v.ai_verdict === 'FAIL' ? (
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="FAIL" />
                            ) : v.ai_verdict === 'PASS' ? (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="PASS" />
                            ) : v.ai_verdict === 'REVIEW' ? (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="REVIEW" />
                            ) : null}
                            <span>{td.taskId || v.row_number}</span>
                          </td>
                          {/* 3. DETAIL TASK */}
                          <td className="px-4 py-3 relative">
                            <p className="text-slate-200 text-xs font-semibold leading-relaxed">{td.detail || <span className="opacity-30">—</span>}</p>
                            {v.ai_verdict === 'FAIL' && v.ai_reason && (
                              <p className="text-red-400/80 text-[10px] mt-1">⚠️ {v.ai_reason}</p>
                            )}
                            {v.ai_suggestion && v.ai_verdict !== 'PASS' && (
                              <p className="text-indigo-400/70 text-[10px] mt-0.5">💡 {v.ai_suggestion}</p>
                            )}

                            {/* Hover Add Task Button */}
                            <div className="absolute left-0 right-0 -bottom-3.5 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                              <button
                                onClick={() => handleOpenAddTask(v)}
                                className="pointer-events-auto bg-indigo-600/95 hover:bg-indigo-600 text-white text-[9px] font-extrabold px-3 py-1 rounded-full shadow-xl flex items-center gap-1 active:scale-95 transition-all border border-indigo-400/30 uppercase tracking-wider"
                              >
                                <span>+ Add task below</span>
                              </button>
                            </div>
                          </td>
                          {/* 4. PRIORITY */}
                          <td className="px-4 py-3">
                            {td.priority ? (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${priStyle}`}>
                                {td.priority}
                              </span>
                            ) : <span className="opacity-30">—</span>}
                          </td>
                          {/* 5. MANDAY EST */}
                          <td className="px-4 py-3 text-slate-300 font-mono">{td.manday || <span className="opacity-30">—</span>}</td>
                          {/* 6. STATUS */}
                          <td className="px-4 py-3">
                            {td.status ? (
                              <div className="flex items-center gap-1.5">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusInfo.dot}`} />
                                <span className={`text-[10px] font-bold ${statusInfo.text}`}>{statusInfo.label}</span>
                              </div>
                            ) : <span className="opacity-30">—</span>}
                          </td>
                          {/* 7. START DATE */}
                          <td className="px-4 py-3 text-slate-400">{td.date || <span className="opacity-30">—</span>}</td>
                          {/* 8. ASSIGNED */}
                          <td className="px-4 py-3 text-slate-300">{td.assigned || <span className="opacity-30">—</span>}</td>
                          {/* 9. SUPPORT */}
                          <td className="px-4 py-3 text-slate-400">{td.support || <span className="opacity-30">—</span>}</td>
                          {/* 10. KPI RATIO */}
                          <td className="px-4 py-3 text-slate-400 font-mono">{td.kpiRatio || <span className="opacity-30">—</span>}</td>
                          {/* 11. SKILL SOLUTION */}
                          <td className="px-4 py-3 text-slate-300">{td.skillSolution || <span className="opacity-30">—</span>}</td>
                          {/* 12. SKILL VENDOR */}
                          <td className="px-4 py-3 text-slate-400">{td.skillVendor || <span className="opacity-30">—</span>}</td>
                          {/* 13. TICKET ID */}
                          <td className="px-4 py-3 text-slate-400 font-mono">{td.ticketId || <span className="opacity-30">—</span>}</td>
                          {/* 14. REMARK */}
                          <td className="px-4 py-3 text-slate-400 max-w-[150px] truncate" title={td.remark}>{td.remark || <span className="opacity-30">—</span>}</td>
                          {/* 15. SEND */}
                          <td className="px-4 py-3 text-slate-400">{td.send || <span className="opacity-30">—</span>}</td>
                          {/* 16. END DATE */}
                          <td className="px-4 py-3 text-slate-400">{td.endDate || <span className="opacity-30">—</span>}</td>
                          {/* 17. MANDAY ACTUAL */}
                          <td className="px-4 py-3 text-slate-300 font-mono">{td.mandayActual || <span className="opacity-30">—</span>}</td>
                        </tr>
                      );
                    }

                    return (
                      <Fragment key={v.id}>
                        {rowElement}
                        {addingTaskBelowId === v.id && (
                          <tr className="bg-[#1b1c2b] border-2 border-indigo-500/40">
                            {/* 1. ACTIONS */}
                            <td className="p-1"></td>
                            {/* 2. TASK ID */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.taskId}
                                onChange={e => setNewForm({ ...newForm, taskId: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                                placeholder="ID"
                              />
                            </td>
                            {/* 3. DETAIL TASK */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.detail}
                                onChange={e => setNewForm({ ...newForm, detail: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
                                placeholder="Task detail description..."
                                autoFocus
                              />
                            </td>
                            {/* 4. PRIORITY */}
                            <td className="p-1">
                              <select
                                value={newForm.priority}
                                onChange={e => setNewForm({ ...newForm, priority: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
                              >
                                <option value="">None</option>
                                <option value="Critical">Critical</option>
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Normal">Normal</option>
                                <option value="Low">Low</option>
                              </select>
                            </td>
                            {/* 5. MANDAY EST */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.manday}
                                onChange={e => setNewForm({ ...newForm, manday: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                                placeholder="Est"
                              />
                            </td>
                            {/* 6. STATUS */}
                            <td className="p-1">
                              <select
                                value={newForm.status}
                                onChange={e => setNewForm({ ...newForm, status: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
                              >
                                <option value="">None</option>
                                <option value="Todo">Todo</option>
                                <option value="Process">Process</option>
                                <option value="Review">Review</option>
                                <option value="Pending">Pending</option>
                                <option value="Done">Done</option>
                              </select>
                            </td>
                            {/* 7. START DATE */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.date}
                                onChange={e => setNewForm({ ...newForm, date: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                                placeholder="Start Date"
                              />
                            </td>
                            {/* 8. ASSIGNED */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.assigned}
                                onChange={e => setNewForm({ ...newForm, assigned: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                                placeholder="Assignee"
                              />
                            </td>
                            {/* 9. SUPPORT */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.support}
                                onChange={e => setNewForm({ ...newForm, support: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                                placeholder="Support"
                              />
                            </td>
                            {/* 10. KPI RATIO */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.kpiRatio}
                                onChange={e => setNewForm({ ...newForm, kpiRatio: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                                placeholder="KPI"
                              />
                            </td>
                            {/* 11. SKILL SOLUTION */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.skillSolution}
                                onChange={e => setNewForm({ ...newForm, skillSolution: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                                placeholder="Solution"
                              />
                            </td>
                            {/* 12. SKILL VENDOR */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.skillVendor}
                                onChange={e => setNewForm({ ...newForm, skillVendor: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                                placeholder="Vendor"
                              />
                            </td>
                            {/* 13. TICKET ID */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.ticketId}
                                onChange={e => setNewForm({ ...newForm, ticketId: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                                placeholder="Ticket ID"
                              />
                            </td>
                            {/* 14. REMARK */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.remark}
                                onChange={e => setNewForm({ ...newForm, remark: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                                placeholder="Remark"
                              />
                            </td>
                            {/* 15. SEND */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.send}
                                onChange={e => setNewForm({ ...newForm, send: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                                placeholder="Send"
                              />
                            </td>
                            {/* 16. END DATE */}
                            <td className="p-1">
                              <input
                                type="text"
                                value={newForm.endDate}
                                onChange={e => setNewForm({ ...newForm, endDate: e.target.value })}
                                className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                                placeholder="End Date"
                              />
                            </td>
                            {/* 17. MANDAY ACTUAL */}
                            <td className="p-1">
                              <div className="flex items-center gap-1 w-full min-w-[145px]">
                                <input
                                  type="text"
                                  value={newForm.mandayActual}
                                  onChange={e => setNewForm({ ...newForm, mandayActual: e.target.value })}
                                  className="w-12 bg-[#0f1117] border border-[#2e3250] rounded px-1 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                                  placeholder="Actual"
                                />
                                <button
                                  onClick={handleSaveTask}
                                  disabled={savingTask}
                                  className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[9px] font-black px-2 py-1 rounded shadow transition-colors shrink-0 uppercase"
                                >
                                  {savingTask ? '...' : 'Save'}
                                </button>
                                <button
                                  onClick={handleCancelAddTask}
                                  disabled={savingTask}
                                  className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-[9px] font-black px-2 py-1 rounded shadow transition-colors shrink-0 uppercase"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="border-t border-[#2e3250] bg-[#1a1d27] px-6 py-3 text-center text-[10px] text-slate-600">
          © 2026 SecurityZone Team · Plane.so Compliance Dashboard
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-[#0f1117] flex items-center justify-center text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading dashboard...</span>
        </div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
