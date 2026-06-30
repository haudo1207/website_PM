'use client';
import { useEffect, useState, useCallback, useRef, Fragment, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getViolations, getSheets, addTask, checkSingleTask, updateSheet } from '@/lib/api';

const PHASE_TABS = [
  { key: 'A', label: '1.Sale/Admin' },
  { key: 'B', label: '2.Init' },
  { key: 'C', label: '2.1.Lab/PoC' },
  { key: 'D', label: '3.Implement' },
  { key: 'E', label: '4.MA' },
];

function ProjectDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id') || '';

  const [project, setProject] = useState<any>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [activePhase, setActivePhase] = useState<string>('A');
  const [taskSearch, setTaskSearch] = useState('');
  const [checkingTaskId, setCheckingTaskId] = useState<number | null>(null);
  const [addingTaskBelowId, setAddingTaskBelowId] = useState<number | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);

  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [addChannelKey, setAddChannelKey] = useState('');
  const [addChannelValue, setAddChannelValue] = useState('');

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

  const flash = (t: string, e = false) => {
    setMsg({ t, e });
    setTimeout(() => setMsg(null), 4000);
  };

  const loadProject = useCallback(async () => {
    try {
      const sheets = await getSheets();
      const found = sheets.find((s: any) => String(s.id) === id);
      if (found) {
        setProject(found);
      }
    } catch {
      flash('Không thể tải thông tin dự án', true);
    } finally {
      setLoadingProject(false);
    }
  }, [id]);

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const data = await getViolations({ sheet_id: id, per_page: 500 });
      setItems(data.items || []);
    } catch {
      flash('Không thể tải danh sách nhiệm vụ', true);
    } finally {
      setLoadingTasks(false);
    }
  }, [id]);

  useEffect(() => {
    loadProject();
    loadTasks();
  }, [id, loadProject, loadTasks]);

  const handleSaveChannelLink = async (channelKey: string, value: string) => {
    setIsSavingLink(true);
    try {
      const updated = await updateSheet(Number(id), { [channelKey]: value.trim() });
      setProject((prev: any) => ({ ...prev, ...updated }));
      setEditingChannel(null);
      setEditingValue('');
      setShowAddChannel(false);
      setAddChannelValue('');
      flash('Cập nhật liên kết kênh thành công!');
    } catch (err: any) {
      alert('Lỗi cập nhật liên kết: ' + (err.response?.data?.detail || err.message));
    } finally {
      setIsSavingLink(false);
    }
  };

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

  const handleSaveTask = async () => {
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
      
      await addTask(Number(id), {
        tab_name: belowItem.tab_name,
        after_row: belowItem.row_number,
        task_data: taskData
      });
      
      setAddingTaskBelowId(null);
      loadTasks();
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
    if (!email) return { initials: 'PM', name: 'Chưa cấu hình' };
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
      name: cleanName,
      email
    };
  };

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

  // --- Dynamic Stats calculation ---
  const realTasks = items.filter(x => x.ai_verdict !== 'SECTION');
  const totalTasks = realTasks.length;
  
  const completedTasks = realTasks.filter(x => {
    const s = parseRowData(x.row_data).status.toLowerCase();
    return s === 'done' || s === 'completed';
  }).length;
  
  const passTasks = realTasks.filter(x => x.ai_verdict === 'PASS').length;
  const evaluatedTasks = realTasks.filter(x => ['PASS', 'FAIL', 'REVIEW'].includes(x.ai_verdict)).length;
  
  const complianceScore = evaluatedTasks > 0 ? Math.round((passTasks / evaluatedTasks) * 100) : null;
  const devProgressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  
  const highPriority = realTasks.filter(x => {
    const p = parseRowData(x.row_data).priority.toLowerCase();
    return p === 'high' || p === 'critical' || p === 'urgent';
  }).length;

  const activeMembers = Array.from(new Set(realTasks.map(x => parseRowData(x.row_data).assigned).filter(Boolean))).length;

  const phaseItems = items.filter(x => {
    if (getRowPhase(x.tab_name) !== activePhase) return false;
    if (x.ai_verdict === 'SECTION') return true;
    if (!taskSearch.trim()) return true;
    const td = parseRowData(x.row_data);
    const detail = (td.detail || '').toLowerCase();
    const taskId = (td.taskId || '').toLowerCase();
    const assigned = (td.assigned || '').toLowerCase();
    const query = taskSearch.toLowerCase();
    return detail.includes(query) || taskId.includes(query) || assigned.includes(query);
  });
  const phaseLabel = PHASE_TABS.find(p => p.key === activePhase)?.label || '';  // Milestones dynamic check
  const getPhaseMilestoneState = (key: string) => {
    const pItems = items.filter(x => getRowPhase(x.tab_name) === key && x.ai_verdict !== 'SECTION');
    if (pItems.length === 0) return 'planned'; // No tasks
    const allPass = pItems.every(x => x.ai_verdict === 'PASS');
    if (allPass) return 'completed';
    return 'in_progress';
  };

  const getPhaseStats = (key: string) => {
    const pItems = items.filter(x => getRowPhase(x.tab_name) === key && x.ai_verdict !== 'SECTION');
    const total = pItems.length;
    const pass = pItems.filter(x => x.ai_verdict === 'PASS').length;
    const fail = pItems.filter(x => x.ai_verdict === 'FAIL').length;
    return { total, pass, fail };
  };
  if (loadingProject || !project) {
    return (
      <div className="h-screen bg-[#0f1117] flex items-center justify-center text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading project details...</span>
        </div>
      </div>
    );
  }

  const pmInfo = getPMDisplay(project.pm_email);
  const leadInfo = getPMDisplay(project.leader_email);

  const renderChannelRow = (
    label: string,
    key: string,
    value: string,
    icon: string,
    iconBg: string,
    iconColor: string,
    placeholder: string
  ) => {
    const isEditing = editingChannel === key;

    return (
      <div className="flex items-center justify-between p-3 bg-[#12141c]/50 rounded-lg border border-[#2e3250]/40">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-8 h-8 rounded-full ${iconBg} ${iconColor} flex items-center justify-center font-black text-xs shrink-0`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-200">{label}</p>
            {isEditing ? (
              <div className="flex items-center gap-2 mt-1.5 w-full">
                <input
                  type="text"
                  value={editingValue}
                  onChange={e => setEditingValue(e.target.value)}
                  placeholder={placeholder}
                  className="flex-1 bg-[#0f1117] border border-[#2e3250] rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  autoFocus
                />
                <button
                  onClick={() => handleSaveChannelLink(key, editingValue)}
                  disabled={isSavingLink}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] px-2.5 py-1 rounded font-bold shrink-0 shadow transition-colors"
                >
                  {isSavingLink ? '...' : 'Lưu'}
                </button>
                <button
                  onClick={() => setEditingChannel(null)}
                  disabled={isSavingLink}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] px-2 py-1 rounded font-bold shrink-0 shadow transition-colors"
                >
                  Hủy
                </button>
              </div>
            ) : (
              <p className="text-[10px] text-slate-500 truncate max-w-[180px] sm:max-w-xs mt-0.5">
                {value || `Chưa cấu hình liên kết ${label}`}
              </p>
            )}
          </div>
        </div>

        {!isEditing && (
          <div className="flex items-center gap-2 shrink-0">
            {value ? (
              <>
                <a
                  href={value}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-bold bg-[#6366f1]/10 hover:bg-[#6366f1]/25 text-indigo-400 hover:text-indigo-300 border border-[#6366f1]/20 px-3 py-1.5 rounded transition-all shadow-sm"
                >
                  Truy cập kênh
                </a>
                <button
                  onClick={() => {
                    setEditingChannel(key);
                    setEditingValue(value);
                  }}
                  className="p-1.5 hover:bg-[#22263a] rounded text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center border border-[#2e3250]/40"
                  title="Sửa liên kết"
                >
                  <span className="material-symbols-outlined text-[14px]">edit</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setEditingChannel(key);
                  setEditingValue('');
                }}
                className="text-[10px] font-bold bg-[#6366f1]/15 hover:bg-[#6366f1]/30 text-indigo-400 px-3 py-1.5 rounded transition-all border border-[#6366f1]/20 flex items-center gap-1 shadow-sm"
              >
                <span className="material-symbols-outlined text-[12px]">add</span>
                Thêm liên kết
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen bg-[#0f1117] text-[#e2e8f0] flex overflow-hidden">
      <Navbar />
      
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        
        {/* TOP BAR / NAVIGATION HEADER */}
        <div className="h-14 bg-[#1a1d27]/80 backdrop-blur-md border-b border-[#2e3250] flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-3">
            <span className="text-slate-500 hover:text-slate-300 cursor-pointer text-xs font-semibold" onClick={() => router.push('/project')}>Danh sách dự án</span>
            <span className="text-slate-600 text-xs">/</span>
            <span className="text-xs font-semibold text-slate-300">{project.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadTasks} className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#22263a] border border-[#2e3250] hover:bg-[#2a2f47] text-slate-200 transition-all">
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* MAIN DETAILS AREA */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {msg && (
            <div className={`p-3 rounded-lg text-xs font-semibold ${msg.e ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'} animate-in fade-in slide-in-from-top-1`}>
              {msg.t}
            </div>
          )}

          {/* PAGE HERO ROW */}
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded">
                  ID: {project.project_code || `PRJ-2024-${String(project.id).padStart(3, '0')}`}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${
                  project.current_phase 
                    ? getStatusStyle(project.current_phase).className 
                    : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {project.current_phase ? getStatusStyle(project.current_phase).text : 'ACTIVE'}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-slate-100">{project.name}</h1>
              <p className="text-xs text-slate-500 mt-1.5 max-w-2xl leading-relaxed">
                {project.customer_name ? `Khách hàng: ${project.customer_name} · ` : ''}Dự án giám sát và đánh giá tuân thủ chính sách bảo mật hệ thống.
              </p>
            </div>
          </div>

          {/* THREE STATS CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#1a1d27]/70 border border-[#2e3250]/70 rounded-xl p-5 relative overflow-hidden">
              <span className="absolute right-4 top-4 text-emerald-400 text-lg">⚡</span>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Điểm Tuân Thủ (AI)</p>
              <h3 className="text-2xl font-extrabold text-slate-100 mt-2">
                {complianceScore !== null ? `${complianceScore}%` : 'Chưa đánh giá'}
              </h3>
              <div className="w-full bg-[#22263a] h-1.5 rounded-full mt-4 overflow-hidden">
                <div className="bg-emerald-400 h-full rounded-full transition-all duration-500" style={{ width: `${complianceScore !== null ? complianceScore : 0}%` }} />
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Dựa trên tỷ lệ số lượng task vượt qua kiểm tra AI</p>
            </div>

            <div className="bg-[#1a1d27]/70 border border-[#2e3250]/70 rounded-xl p-5 relative overflow-hidden">
              <span className="absolute right-4 top-4 text-indigo-400 text-lg">📈</span>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tiến Độ Thực Hiện</p>
              <h3 className="text-2xl font-extrabold text-slate-100 mt-2">{devProgressPercent}%</h3>
              <div className="w-full bg-[#22263a] h-1.5 rounded-full mt-4 overflow-hidden">
                <div className="bg-indigo-500 h-full rounded-full transition-all duration-500" style={{ width: `${devProgressPercent}%` }} />
              </div>
              <p className="text-[10px] text-slate-500 mt-2">{completedTasks}/{totalTasks} nhiệm vụ hoàn thành</p>
            </div>

            <div className="bg-[#1a1d27]/70 border border-[#2e3250]/70 rounded-xl p-5 relative overflow-hidden">
              <span className="absolute right-4 top-4 text-slate-400 text-lg">📋</span>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tổng Số Nhiệm Vụ</p>
              <h3 className="text-2xl font-extrabold text-slate-100 mt-2">{totalTasks}</h3>
              <div className="flex gap-4 mt-4 text-[10px] text-slate-400">
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-rose-400">error</span>
                  <span className="text-rose-400 font-bold">{highPriority}</span> Ưu tiên cao
                </div>
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-indigo-400">group</span>
                  <span className="text-slate-300 font-bold">{activeMembers}</span> Thành viên
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Phân bổ trên {PHASE_TABS.length} giai đoạn triển khai</p>
            </div>
          </div>

          {/* TWO COLUMN GRID */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* LEFT COLUMN: COMMUNICATION HUB & COMPLIANCE TABLE */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* COMMUNICATION HUB */}
              <div className="bg-[#1a1d27]/70 border border-[#2e3250]/70 rounded-xl p-6">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                    <span className="text-indigo-400">💬</span> Communication Hub
                  </h3>
                </div>

                <div className="space-y-4">
                  {project.zalo_link && renderChannelRow(
                    'Zalo Group Discussion',
                    'zalo_link',
                    project.zalo_link,
                    'Z',
                    'bg-[#0068FF]/10',
                    'text-[#0068FF]',
                    'zalo.me/g/...'
                  )}

                  {project.telegram_link && renderChannelRow(
                    'Telegram Channel',
                    'telegram_link',
                    project.telegram_link,
                    '✈',
                    'bg-[#2AABEE]/10',
                    'text-[#2AABEE]',
                    't.me/...'
                  )}

                  {project.teams_link && renderChannelRow(
                    'Microsoft Teams Channel',
                    'teams_link',
                    project.teams_link,
                    'T',
                    'bg-[#4F52B2]/10',
                    'text-[#4F52B2]',
                    'teams.microsoft.com/...'
                  )}

                  {!project.zalo_link && !project.telegram_link && !project.teams_link && (
                    <div className="text-center py-6 text-slate-500 text-xs italic">
                      Chưa cấu hình kênh liên lạc nào cho dự án này
                    </div>
                  )}

                  {/* Dash bordered button */}
                  {!showAddChannel && (!project.zalo_link || !project.telegram_link || !project.teams_link) && (
                    <button
                      onClick={() => {
                        setShowAddChannel(true);
                        if (!project.zalo_link) setAddChannelKey('zalo_link');
                        else if (!project.telegram_link) setAddChannelKey('telegram_link');
                        else if (!project.teams_link) setAddChannelKey('teams_link');
                        else setAddChannelKey('');
                        setAddChannelValue('');
                      }}
                      className="w-full py-3 mt-4 border border-dashed border-[#2e3250] hover:border-indigo-500/60 hover:bg-indigo-500/5 rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-slate-400 hover:text-indigo-400 transition-all cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">add_circle</span>
                      Thêm kênh liên lạc
                    </button>
                  )}

                  {/* Inline add form */}
                  {showAddChannel && (
                    <div className="mt-4 p-4 bg-[#12141c]/40 rounded-xl border border-[#2e3250]/70 space-y-3 animate-in fade-in duration-200">
                      <p className="text-xs font-bold text-slate-300">Thêm kênh liên lạc mới</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <select
                          value={addChannelKey}
                          onChange={e => setAddChannelKey(e.target.value)}
                          className="bg-[#0f1117] border border-[#2e3250] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-bold"
                        >
                          <option value="">-- Chọn kênh --</option>
                          {!project.zalo_link && <option value="zalo_link">Zalo Group Discussion</option>}
                          {!project.telegram_link && <option value="telegram_link">Telegram Channel</option>}
                          {!project.teams_link && <option value="teams_link">Microsoft Teams Channel</option>}
                        </select>
                        
                        <input
                          type="text"
                          value={addChannelValue}
                          onChange={e => setAddChannelValue(e.target.value)}
                          placeholder="Nhập đường dẫn liên kết..."
                          className="sm:col-span-2 bg-[#0f1117] border border-[#2e3250] rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                      <div className="flex justify-end gap-2 text-xs">
                        <button
                          onClick={() => {
                            if (!addChannelKey) {
                              alert('Vui lòng chọn loại kênh liên lạc!');
                              return;
                            }
                            if (!addChannelValue.trim()) {
                              alert('Vui lòng nhập đường dẫn liên kết!');
                              return;
                            }
                            handleSaveChannelLink(addChannelKey, addChannelValue);
                          }}
                          disabled={isSavingLink}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-1.5 rounded shadow transition-colors"
                        >
                          {isSavingLink ? 'Đang lưu...' : 'Thêm'}
                        </button>
                        <button
                          onClick={() => setShowAddChannel(false)}
                          disabled={isSavingLink}
                          className="bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold px-4 py-1.5 rounded shadow transition-colors"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* TASK LIST / COMPLIANCE CHECKLIST */}
              <div className="bg-[#1a1d27]/70 border border-[#2e3250]/70 rounded-xl p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 flex-1">
                    <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 shrink-0">
                      <span className="text-indigo-400">📋</span> Compliance Checklist
                    </h3>
                    
                    <div className="relative flex-1 max-w-xs">
                      <span className="material-symbols-outlined text-[16px] text-slate-500 absolute left-3 top-1/2 -translate-y-1/2">search</span>
                      <input
                        type="text"
                        placeholder="Tìm kiếm nhiệm vụ..."
                        value={taskSearch}
                        onChange={e => setTaskSearch(e.target.value)}
                        className="w-full bg-[#12141c] text-slate-200 border border-[#2e3250] pl-8 pr-4 py-1.5 rounded-lg text-xs outline-none focus:border-[#7c3aed] transition-all placeholder-slate-500 shadow-sm"
                      />
                    </div>
                  </div>
                  
                  <div className="flex bg-[#12141c] p-0.5 rounded-lg border border-[#2e3250]/60 max-w-full overflow-x-auto no-scrollbar gap-1">
                    {PHASE_TABS.map(tab => {
                      const { total, pass, fail } = getPhaseStats(tab.key);
                      return (
                        <button
                          key={tab.key}
                          onClick={() => { setActivePhase(tab.key); setAddingTaskBelowId(null); }}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all whitespace-nowrap flex flex-col items-center gap-0.5 min-w-[75px] ${
                            activePhase === tab.key
                              ? 'bg-[#22263a] text-indigo-400 shadow-sm border border-[#2e3250]'
                              : 'text-slate-500 hover:text-slate-400'
                          }`}
                        >
                          <span>{tab.label}</span>
                          {total > 0 && (
                            <span className="text-[9px] font-semibold opacity-90 flex items-center gap-1.5 lowercase">
                              <span className="text-emerald-400">✅ {pass}</span>
                              {fail > 0 && <span className="text-rose-400">❌ {fail}</span>}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {loadingTasks ? (
                  <div className="py-12 text-center text-slate-500 font-medium">
                    <div className="inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2" />
                    <p className="text-xs">Đang tải danh sách nhiệm vụ...</p>
                  </div>
                ) : (
                  <div className="border border-[#2e3250]/50 rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-[#cbd5e1] text-left border-collapse">
                    <thead>
                      <tr className="bg-[#22263a]/40 border-b border-[#2e3250]/60 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <th className="px-4 py-3 text-center w-[100px]">Thao tác</th>
                        <th className="px-4 py-3 text-left w-[120px]">Task ID</th>
                        <th className="px-4 py-3 text-left min-w-[280px]">Nhiệm vụ</th>
                        <th className="px-4 py-3 text-left w-[80px]">Độ ưu tiên</th>
                        <th className="px-4 py-3 text-left w-[90px]">Giai đoạn</th>
                        <th className="px-4 py-3 text-left w-[120px]">Người thực hiện</th>
                      </tr>
                    </thead>
                        <tbody className="divide-y divide-[#2e3250]/40">
                          {phaseItems.map((v, idx) => {
                            const td = parseRowData(v.row_data);

                            if (v.ai_verdict === 'SECTION') {
                              return (
                                <tr key={v.id} className="bg-[#22263a]/20 font-bold border-t border-[#2e3250]/60">
                                  <td className="px-4 py-2"></td>
                                  <td className="px-4 py-2"></td>
                                  <td colSpan={4} className="px-4 py-2 text-indigo-400 uppercase tracking-wider text-[10px] font-extrabold">
                                    {td.detail || 'SECTION'}
                                  </td>
                                </tr>
                              );
                            }

                            const statusInfo = getStatusInfo(td.status);
                            const priStyle = getPriorityStyle(td.priority);

                            return (
                              <Fragment key={v.id}>
                                <tr className={`group relative hover:bg-[#22263a]/40 transition-colors ${idx % 2 === 0 ? '' : 'bg-[#151821]/20'}`}>
                                  {/* 1. ACTIONS */}
                                  <td className="px-4 py-3 text-center">
                                    <div className={`transition-opacity duration-150 flex items-center justify-center ${
                                      checkingTaskId === v.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                    }`}>
                                      <button
                                        onClick={() => handleCheckTask(v.id)}
                                        disabled={checkingTaskId === v.id}
                                        className="bg-[#6366f1]/10 hover:bg-[#6366f1]/20 text-[#818cf8] border border-[#6366f1]/20 px-2.5 py-1 rounded text-[9px] font-bold transition-all disabled:opacity-50 flex items-center gap-1 mx-auto"
                                      >
                                        {checkingTaskId === v.id ? 'Checking...' : 'Check'}
                                      </button>
                                    </div>
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
                                    <p className="text-slate-200 text-[11px] font-semibold leading-relaxed">{td.detail || <span className="opacity-30">—</span>}</p>
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
                                        className="pointer-events-auto bg-indigo-600 hover:bg-indigo-500 text-white text-[8px] font-black px-2.5 py-0.5 rounded-full shadow-lg flex items-center gap-1 active:scale-95 transition-all border border-indigo-400/30 uppercase tracking-wider"
                                      >
                                        <span>+ Add task below</span>
                                      </button>
                                    </div>
                                  </td>
                                  {/* 4. PRIORITY */}
                                  <td className="px-4 py-3">
                                    {td.priority ? (
                                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${priStyle}`}>
                                        {td.priority}
                                      </span>
                                    ) : <span className="opacity-30">—</span>}
                                  </td>
                                  {/* 5. STATUS */}
                                  <td className="px-4 py-3">
                                    {td.status ? (
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-1 h-1 rounded-full shrink-0 ${statusInfo.dot}`} />
                                        <span className={`text-[9px] font-bold ${statusInfo.text}`}>{statusInfo.label}</span>
                                      </div>
                                    ) : <span className="opacity-30">—</span>}
                                  </td>
                                  {/* 6. ASSIGNED */}
                                  <td className="px-4 py-3 text-slate-300 font-semibold">{td.assigned || <span className="opacity-30">—</span>}</td>
                                </tr>

                                {addingTaskBelowId === v.id && (
                                  <tr className="bg-[#1b1c2b] border-2 border-indigo-500/40">
                                    <td className="p-1"></td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.taskId}
                                        onChange={e => setNewForm({ ...newForm, taskId: e.target.value })}
                                        className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                                        placeholder="ID"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.detail}
                                        onChange={e => setNewForm({ ...newForm, detail: e.target.value })}
                                        className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
                                        placeholder="Task detail description..."
                                        autoFocus
                                      />
                                    </td>
                                    <td className="p-1">
                                      <select
                                        value={newForm.priority}
                                        onChange={e => setNewForm({ ...newForm, priority: e.target.value })}
                                        className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
                                      >
                                        <option value="">None</option>
                                        <option value="Critical">Critical</option>
                                        <option value="High">High</option>
                                        <option value="Medium">Medium</option>
                                        <option value="Normal">Normal</option>
                                        <option value="Low">Low</option>
                                      </select>
                                    </td>
                                    <td className="p-1">
                                      <select
                                        value={newForm.status}
                                        onChange={e => setNewForm({ ...newForm, status: e.target.value })}
                                        className="w-full bg-[#0f1117] border border-[#2e3250] rounded px-1 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
                                      >
                                        <option value="Todo">Todo</option>
                                        <option value="Process">Process</option>
                                        <option value="Review">Review</option>
                                        <option value="Pending">Pending</option>
                                        <option value="Done">Done</option>
                                      </select>
                                    </td>
                                    <td className="p-1">
                                      <div className="flex items-center gap-1 w-full">
                                        <input
                                          type="text"
                                          value={newForm.assigned}
                                          onChange={e => setNewForm({ ...newForm, assigned: e.target.value })}
                                          className="w-16 bg-[#0f1117] border border-[#2e3250] rounded px-1 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500"
                                          placeholder="Assign"
                                        />
                                        <button
                                          onClick={handleSaveTask}
                                          disabled={savingTask}
                                          className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[8px] font-black px-1.5 py-1 rounded"
                                        >
                                          {savingTask ? '...' : 'Save'}
                                        </button>
                                        <button
                                          onClick={() => setAddingTaskBelowId(null)}
                                          disabled={savingTask}
                                          className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-[8px] font-black px-1.5 py-1 rounded"
                                        >
                                          X
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}

                          {phaseItems.length === 0 && (
                            <tr>
                              <td colSpan={6} className="text-center py-8 text-slate-500 font-medium">
                                Không có nhiệm vụ nào trong giai đoạn này
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: OWNERS, KEY MILESTONES, EFFICIENCY */}
            <div className="space-y-6">
              {/* PROJECT OWNERS */}
              <div className="bg-[#1a1d27]/70 border border-[#2e3250]/70 rounded-xl p-6">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-4">👥 Project Owners</h3>
                <div className="space-y-4">
                  {/* Leader */}
                  {project.leader_email && (
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-[10px] font-extrabold text-indigo-400">
                        {leadInfo.initials}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200">{leadInfo.name}</h4>
                        <p className="text-[10px] text-slate-500">Technical Lead ({leadInfo.email})</p>
                      </div>
                    </div>
                  )}

                  {/* PM */}
                  {project.pm_email && (
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-[10px] font-extrabold text-emerald-400">
                        {pmInfo.initials}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200">{pmInfo.name}</h4>
                        <p className="text-[10px] text-slate-500">Product Manager ({pmInfo.email})</p>
                      </div>
                    </div>
                  )}

                  {!project.leader_email && !project.pm_email && (
                    <p className="text-xs text-slate-500 italic">Chưa cấu hình thông tin quản trị dự án</p>
                  )}
                </div>
              </div>

              <div className="bg-[#1a1d27]/70 border border-[#2e3250]/70 rounded-xl p-6 flex flex-col items-center">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-6 w-full text-left">📊 Project Progress</h3>
                
                {/* Circular Progress Ring */}
                <div className="relative w-36 h-36 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="72" cy="72" r="60" stroke="#22263a" strokeWidth="10" fill="transparent" />
                    <circle cx="72" cy="72" r="60" stroke="#6366f1" strokeWidth="10" fill="transparent"
                      strokeDasharray={2 * Math.PI * 60}
                      strokeDashoffset={2 * Math.PI * 60 * (1 - devProgressPercent / 100)}
                      strokeLinecap="round" className="transition-all duration-500" />
                  </svg>
                  <div className="absolute text-center">
                    <h4 className="text-2xl font-black text-slate-100">{devProgressPercent}%</h4>
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Progress</p>
                  </div>
                </div>

                <div className="w-full grid grid-cols-2 gap-4 mt-6 border-t border-[#2e3250]/60 pt-4 text-[10px]">
                  <div>
                    <p className="text-slate-500">Hoàn thành</p>
                    <p className="text-xs font-bold text-emerald-400 mt-0.5">{completedTasks} Tasks</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Chờ kiểm duyệt</p>
                    <p className="text-xs font-bold text-amber-400 mt-0.5">{realTasks.filter(x => parseRowData(x.row_data).status.toLowerCase() === 'review').length} Tasks</p>
                  </div>
                </div>
              </div>

              {/* KEY MILESTONES */}
              <div className="bg-[#1a1d27]/70 border border-[#2e3250]/70 rounded-xl p-6">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-5">🏁 Key Milestones</h3>
                <div className="space-y-5 relative pl-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-[#2e3250]/80">
                  {PHASE_TABS.map((phase, idx) => {
                    const state = getPhaseMilestoneState(phase.key);
                    let indicatorBg = 'bg-[#22263a] border-[#2e3250]';
                    let textClass = 'text-slate-500';
                    let stateLabel = 'Chưa bắt đầu';

                    if (state === 'completed') {
                      indicatorBg = 'bg-emerald-500/20 border-emerald-400';
                      textClass = 'text-emerald-400 font-bold';
                      stateLabel = 'Đã hoàn thành';
                    } else if (state === 'in_progress') {
                      indicatorBg = 'bg-indigo-500/20 border-indigo-400';
                      textClass = 'text-slate-200 font-bold';
                      stateLabel = 'Đang thực hiện';
                    }

                    return (
                      <div key={phase.key} className="relative">
                        {/* Dot indicator */}
                        <div className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full border-2 ${indicatorBg}`} />
                        <div>
                          <p className={`text-xs ${textClass}`}>{phase.label}</p>
                          <p className="text-[9px] text-slate-500 mt-0.5">Tiến độ: {stateLabel}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

          </div>

        </div>

      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-[#0f1117] flex items-center justify-center text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span>Đang tải thông tin...</span>
        </div>
      </div>
    }>
      <ProjectDetailContent />
    </Suspense>
  );
}
