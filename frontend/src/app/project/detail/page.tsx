'use client';
import { useEffect, useState, useCallback, useRef, Fragment, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getViolations, getSheets, addTask, checkSingleTask, updateSheet } from '@/lib/api';

const PHASE_TABS = [
  { key: 'ALL', label: 'Master' },
  { key: 'A', label: '1.Sale/Admin' },
  { key: 'B', label: '2.Init' },
  { key: 'C', label: '2.1.Lab/PoC' },
  { key: 'D', label: '3.Implement' },
  { key: 'E', label: '4.MA' },
];

const getRowPhase = (tabName: string): string => {
  const n = (tabName || '').toLowerCase();
  if (n.includes('sale') || n.includes('admin') || n.startsWith('1.')) return 'A';
  if (n.includes('poc') || n.includes('lab') || n.startsWith('2.1.')) return 'C';
  if (n.includes('init') || n.startsWith('2.')) return 'B';
  if (n.includes('implement') || n.startsWith('3.')) return 'D';
  if (n.includes('ma') || n.startsWith('4.')) return 'E';
  return 'A';
};

function ProjectDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id') || '';

  const [project, setProject] = useState<any>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [taskSearch, setTaskSearch] = useState('');
  const [checkingTaskId, setCheckingTaskId] = useState<number | null>(null);
  const [addingTaskBelowId, setAddingTaskBelowId] = useState<number | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);

  // Main Tabs State: 'tasks' | 'meetings' | 'chats' | 'members'
  const [activeMainTab, setActiveMainTab] = useState<'tasks' | 'meetings' | 'chats' | 'members'>('tasks');
  const [activePhase, setActivePhase] = useState<string>('A');


  // Local state for meetings, chats
  const [meetings, setMeetings] = useState<any[]>([]);
  const [newMeetingTitle, setNewMeetingTitle] = useState('');
  const [newMeetingDate, setNewMeetingDate] = useState('');
  const [newMeetingTime, setNewMeetingTime] = useState('');

  const [chats, setChats] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');

  // Group Chats state
  const [chatGroups, setChatGroups] = useState<any[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupPlatform, setNewGroupPlatform] = useState('Telegram');
  const [newGroupLink, setNewGroupLink] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');

  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);

  // Link edit state
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

  // Load meetings and chats from localStorage
  useEffect(() => {
    if (!id) return;
    const savedMeetings = localStorage.getItem(`meetings_${id}`);
    if (savedMeetings) {
      setMeetings(JSON.parse(savedMeetings));
    } else {
      const defaultMeetings = [
        { id: '1', title: 'Họp kick-off dự án và phân công nhiệm vụ', date: '2026-07-02', time: '14:00', status: 'scheduled', attendees: ['admin@portal.so', 'pm@portal.so'] },
        { id: '2', title: 'Rà soát lỗ hổng bảo mật và tuân thủ phase 1', date: '2026-07-05', time: '09:30', status: 'scheduled', attendees: ['admin@portal.so', 'leader@portal.so'] }
      ];
      setMeetings(defaultMeetings);
      localStorage.setItem(`meetings_${id}`, JSON.stringify(defaultMeetings));
    }

    const savedChats = localStorage.getItem(`chats_${id}`);
    if (savedChats) {
      setChats(JSON.parse(savedChats));
    } else {
      const defaultChats = [
        { id: '1', sender: 'Technical Lead', role: 'Leader', message: 'Mọi người lưu ý hoàn thành specs đúng hạn để kịp làm HSMT nhé.', time: '15:30 30/06/2026', avatarColor: 'bg-blue-500' },
        { id: '2', sender: 'Product Manager', role: 'PM', message: 'Tôi đã cập nhật lại file Google Sheet, nhờ AI quét lại hộ xem đạt bao nhiêu % tuân thủ.', time: '16:00 30/06/2026', avatarColor: 'bg-emerald-500' }
      ];
      setChats(defaultChats);
      localStorage.setItem(`chats_${id}`, JSON.stringify(defaultChats));
    }

    const savedChatGroups = localStorage.getItem(`chatgroups_${id}`);
    if (savedChatGroups) {
      setChatGroups(JSON.parse(savedChatGroups));
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
      flash('Đã thêm nhiệm vụ thành công!');
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
      flash('AI kiểm tra tuân thủ hoàn tất!');
    } catch (err: any) {
      alert('Lỗi kiểm tra task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setCheckingTaskId(null);
    }
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
    if (s === 'done' || s === 'completed' || s === 'hoàn tất') return { label: 'Done', dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-[#dcfce7] text-[#15803d]' };
    if (s === 'process' || s === 'doing' || s === 'in progress' || s === 'đang xử lý') return { label: 'Process', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-[#fef9c3] text-[#854d0e]' };
    if (s === 'review') return { label: 'Review', dot: 'bg-blue-500', text: 'text-[#0058be]', bg: 'bg-[#dbeafe] text-[#1d4ed8]' };
    if (s === 'pending') return { label: 'Pending', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-100 text-slate-700' };
    return { label: status || 'Todo', dot: 'bg-slate-500', text: 'text-slate-600', bg: 'bg-slate-100 text-slate-700' };
  };

  const getPriorityStyle = (priority: string) => {
    const p = (priority || '').trim().toLowerCase();
    if (p === 'critical' || p === 'urgent') return 'bg-red-50 text-red-700 border-red-200';
    if (p === 'high') return 'bg-orange-50 text-orange-700 border-orange-200';
    if (p === 'normal' || p === 'medium') return 'bg-[#eff4ff] text-[#0058be] border-[#0058be]/20';
    if (p === 'low') return 'bg-slate-50 text-slate-700 border-slate-200';
    return 'bg-slate-50 text-slate-700 border-slate-200';
  };

  const handleAddMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMeetingTitle.trim() || !newMeetingDate || !newMeetingTime) {
      alert('Vui lòng điền đầy đủ thông tin cuộc họp!');
      return;
    }
    const meet = {
      id: String(Date.now()),
      title: newMeetingTitle,
      date: newMeetingDate,
      time: newMeetingTime,
      status: 'scheduled',
      attendees: ['admin@portal.so']
    };
    const updated = [meet, ...meetings];
    setMeetings(updated);
    localStorage.setItem(`meetings_${id}`, JSON.stringify(updated));
    setNewMeetingTitle('');
    setNewMeetingDate('');
    setNewMeetingTime('');
    flash('Đã lên lịch cuộc họp mới!');
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msgObj = {
      id: String(Date.now()),
      sender: 'Admin User',
      role: 'Administrator',
      message: chatInput.trim(),
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date().toLocaleDateString('vi-VN'),
      avatarColor: 'bg-blue-600'
    };
    const updated = [...chats, msgObj];
    setChats(updated);
    localStorage.setItem(`chats_${id}`, JSON.stringify(updated));
    setChatInput('');
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail.trim()) return;
    setIsAddingMember(true);
    try {
      const currentMembers = project.member_emails ? project.member_emails.split(',') : [];
      if (currentMembers.includes(newMemberEmail.trim())) {
        alert('Thành viên này đã tồn tại!');
        return;
      }
      const updatedList = [...currentMembers, newMemberEmail.trim()].join(',');
      const updated = await updateSheet(Number(id), { member_emails: updatedList });
      setProject((prev: any) => ({ ...prev, ...updated }));
      setNewMemberEmail('');
      flash('Đã thêm thành viên mới thành công!');
    } catch (err: any) {
      alert('Không thể thêm thành viên: ' + (err.response?.data?.detail || err.message));
    } finally {
      setIsAddingMember(false);
    }
  };

  // --- Dynamic Stats calculation ---
  const realTasks = items.filter(x => x.ai_verdict !== 'SECTION');
  const totalTasks = realTasks.length;
  
  const completedTasks = realTasks.filter(x => {
    const s = parseRowData(x.row_data).status.toLowerCase();
    return s === 'done' || s === 'completed' || s === 'hoàn tất';
  }).length;
  
  const passTasks = realTasks.filter(x => x.ai_verdict === 'PASS').length;
  const evaluatedTasks = realTasks.filter(x => ['PASS', 'FAIL', 'REVIEW'].includes(x.ai_verdict)).length;
  
  const complianceScore = evaluatedTasks > 0 ? Math.round((passTasks / evaluatedTasks) * 100) : null;
  const devProgressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  
  const needEditTasks = realTasks.filter(x => x.ai_verdict === 'REVIEW').length;
  const flaggedTasks = realTasks.filter(x => x.ai_verdict === 'FAIL').length;

  // Phase-filtered stats for KPI cards (using realTasks to exclude SECTION rows representing phase headers and Roman numerals)
  const kpiTasks = activePhase === 'ALL'
    ? realTasks
    : realTasks.filter(x => getRowPhase(x.tab_name) === activePhase);

  const kpiTotal = kpiTasks.length;
  const kpiWarning = kpiTasks.filter(x => x.ai_verdict === 'FAIL').length;
  
  // KPI Done: tasks with completed status
  const kpiDone = kpiTasks.filter(x => {
    const s = parseRowData(x.row_data).status?.toLowerCase() || '';
    return s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish');
  }).length;

  const kpiPass = kpiTasks.filter(x => x.ai_verdict === 'PASS').length;
  const kpiEvaluated = kpiTasks.length;

  const kpiInProgress = kpiTasks.filter(x => {
    const s = parseRowData(x.row_data).status?.toLowerCase() || '';
    return s.includes('process') || s.includes('progress') || s.includes('inprogress') || s.includes('doing') || s === 'in progress';
  }).length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const kpiOverdue = kpiTasks.filter(x => {
    if (x.ai_verdict === 'SECTION') return false;
    const td = parseRowData(x.row_data);
    const s = td.status?.toLowerCase() || '';
    if (s === 'done' || s === 'completed' || s.includes('hoàn')) return false;
    const endDate = td.endDate || td.date || '';
    if (!endDate) return false;
    const parts = endDate.split('/');
    let d: Date;
    if (parts.length === 3) {
      d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    } else {
      d = new Date(endDate);
    }
    return !isNaN(d.getTime()) && d < today;
  }).length;



  const handleCancelAddTask = () => {
    setAddingTaskBelowId(null);
  };

  const phaseItems = items.filter(x => {
    if (activePhase !== 'ALL' && getRowPhase(x.tab_name) !== activePhase) return false;
    if (!taskSearch.trim()) return true;
    const td = parseRowData(x.row_data);
    const detail = (td.detail || '').toLowerCase();
    const taskId = (td.taskId || '').toLowerCase();
    const assigned = (td.assigned || '').toLowerCase();
    const query = taskSearch.toLowerCase();
    return detail.includes(query) || taskId.includes(query) || assigned.includes(query);
  });
  const phaseLabel = activePhase === 'ALL' ? 'Master (Tất cả)' : (PHASE_TABS.find(p => p.key === activePhase)?.label || '');

  if (loadingProject || !project) {
    return (
      <div className="h-screen bg-[#f0f2f5] flex items-center justify-center text-[#565e74]" style={{ fontFamily: "'Work Sans', sans-serif" }}>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" />
          <span>Đang tải thông tin dự án...</span>
        </div>
      </div>
    );
  }

  const pmInfo = getPMDisplay(project.pm_email);
  const leadInfo = getPMDisplay(project.leader_email);
  const membersList = project.member_emails ? project.member_emails.split(',').filter(Boolean) : [];

  return (
    <div className="h-screen bg-[#f0f2f5] text-[#0b1c30] flex overflow-hidden font-body-md" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />
      
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        
        {/* TOP BAR / NAVIGATION HEADER */}
        <div className="h-[52px] bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-3">
            <span className="text-[#565e74] hover:text-[#0058be] cursor-pointer text-xs font-semibold" onClick={() => router.push('/project')}>Dự án</span>
            <span className="text-[#c2c6d6] text-xs">/</span>
            <span className="text-xs font-bold text-[#0b1c30]">{project.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadTasks} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#eff4ff] border border-[#0058be]/20 hover:bg-[#eff4ff]/80 text-[#0058be] transition-all">
              ↻ Tải lại
            </button>
          </div>
        </div>

        {/* MAIN CONTAINER */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {msg && (
            <div className={`fixed top-4 right-4 z-50 p-3 rounded-lg text-xs font-semibold shadow-xl border ${msg.e ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
              {msg.t}
            </div>
          )}

          {/* Breadcrumbs & Header */}
          <div className="mb-4">

            <div className="flex justify-between items-end">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-[#0b1c30] tracking-tight">{project.name}</h2>
                  <span className="px-3 py-1 rounded-full bg-[#eff4ff] text-[#1d4ed8] text-[10px] font-bold uppercase border border-[#0058be]/10">
                    Phase {project.current_phase || '11. Triển khai'}
                  </span>
                </div>
                <p className="text-[12px] text-[#565e74] mt-1">
                  Mã dự án: {project.project_code || 'Chưa cấu hình'} | Khởi tạo: {project.created_at ? new Date(project.created_at).toLocaleDateString('vi-VN') : '12/01/2024'}
                </p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => router.push(`/project`)}
                  className="bg-white text-slate-800 px-4 py-2 rounded-lg text-[13px] font-medium flex items-center border border-slate-200 hover:bg-slate-50 transition-colors shadow-sm"
                >
                  <span className="material-symbols-outlined text-[18px] mr-2">arrow_back</span>
                  Quay lại
                </button>
              </div>
            </div>
          </div>

          {/* KPI ROW */}
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* KPI 1 - Tổng nhiệm vụ */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-0.5">
                <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Tổng nhiệm vụ</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold text-[#0b1c30]">{kpiTotal}</span>
                </div>
                <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                  <div className="bg-[#0058be] h-full" style={{ width: '100%' }}></div>
                </div>
              </div>

              {/* KPI 2 - Đã phê duyệt */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-0.5">
                <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Đã phê duyệt (AI OK)</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold text-emerald-600">{kpiPass}</span>
                  <span className="text-[#565e74] text-xs">/ {kpiEvaluated}</span>
                </div>
                <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                  <div className="bg-emerald-500 h-full" style={{ width: `${kpiEvaluated > 0 ? (kpiPass / kpiEvaluated) * 100 : 0}%` }}></div>
                </div>
              </div>

              {/* KPI 3 - Đang thực hiện */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-0.5">
                <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Đang thực hiện</p>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-2xl font-bold text-blue-600">{kpiInProgress}</span>
                  <span className="material-symbols-outlined text-blue-400 text-[18px]">pending_actions</span>
                </div>
                <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                  <div className="bg-blue-500 h-full" style={{ width: `${kpiEvaluated > 0 ? (kpiInProgress / kpiEvaluated) * 100 : 0}%` }}></div>
                </div>
              </div>

              {/* KPI 4 - Cảnh báo */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-0.5">
                <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Cảnh báo</p>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-2xl font-bold text-red-600">{kpiWarning}</span>
                  <span className="material-symbols-outlined text-red-500 text-[18px]">warning</span>
                </div>
                <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                  <div className="bg-red-500 h-full" style={{ width: `${kpiTotal > 0 ? (kpiWarning / kpiTotal) * 100 : 0}%` }}></div>
                </div>
              </div>

              {/* KPI 5 - Hoàn thành */}
              <div className="bg-white p-5 rounded-xl border border-emerald-200 border-2 shadow-sm transition-transform hover:-translate-y-0.5">
                <p className="text-[10px] text-emerald-700 uppercase font-bold tracking-wider">Hoàn thành</p>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-2xl font-bold text-emerald-600">{kpiDone}</span>
                  <span className="material-symbols-outlined text-emerald-500 text-[18px]">task_alt</span>
                </div>
                <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                  <div className="bg-emerald-500 h-full" style={{ width: `${kpiTotal > 0 ? (kpiDone / kpiTotal) * 100 : 0}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* TAB NAVIGATION */}
          <div className="border-b border-[#c2c6d6]/60 flex space-x-8">
            <button 
              onClick={() => setActiveMainTab('tasks')}
              className={`px-1 py-3 border-b-2 font-medium flex items-center text-[13px] transition-all ${
                activeMainTab === 'tasks' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
              }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">task</span>
              Tasks
            </button>
            <button 
              onClick={() => setActiveMainTab('meetings')}
              className={`px-1 py-3 border-b-2 font-medium flex items-center text-[13px] transition-all ${
                activeMainTab === 'meetings' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
              }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">calendar_month</span>
              Meetings
            </button>
            <button 
              onClick={() => setActiveMainTab('chats')}
              className={`px-1 py-3 border-b-2 font-medium flex items-center text-[13px] transition-all ${
                activeMainTab === 'chats' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
              }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">chat</span>
              Chats
            </button>
            <button 
              onClick={() => setActiveMainTab('members')}
              className={`px-1 py-3 border-b-2 font-medium flex items-center text-[13px] transition-all ${
                activeMainTab === 'members' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
              }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">groups</span>
              Members
            </button>
          </div>

          {/* MAIN TABS CONTENT AREA */}
          <div className="w-full">
            
            {/* LEFT COLUMN: ACTIVE TAB WORKSPACE */}
            <div className="space-y-6">
              
              {/* TAB 1: TASKS */}
              {activeMainTab === 'tasks' && (
                <div className="space-y-6">
                  {/* Phase Tabs + Search */}
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-1 bg-[#eff4ff] border border-[#c2c6d6]/60 rounded-xl p-1">
                      {PHASE_TABS.map(p => (
                        <button key={p.key} onClick={() => setActivePhase(p.key)}
                          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                            activePhase === p.key
                              ? p.key === 'ALL'
                                ? 'bg-[#0058be] text-white shadow-sm'
                                : 'bg-white text-[#0058be] shadow-sm'
                              : 'text-[#565e74] hover:text-[#0058be]'
                          }`}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 items-center">
                      <input value={taskSearch} onChange={e => setTaskSearch(e.target.value)}
                        placeholder="Tìm kiếm nhiệm vụ..."
                        className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none w-52 focus:border-[#0058be] placeholder-[#727785] transition-colors" />
                      {taskSearch && (
                        <button onClick={() => setTaskSearch('')} className="text-red-600 text-xs hover:underline">Xóa</button>
                      )}
                    </div>
                  </div>

                  {/* Task Table */}
                  <div className="bg-white border border-[#c2c6d6]/60 rounded-xl shadow-sm flex flex-col overflow-hidden">
                    <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
                      <table className="w-full text-xs min-w-max border-collapse">
                        <thead className="sticky top-0 z-20 bg-[#f8f9ff] border-b-2 border-[#c2c6d6]" style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                          <tr>
                            <th className="text-center px-2 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '80px', width: '80px' }}>THAO TÁC</th>
                            <th className="text-left px-2 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '60px', width: '60px' }}>ID</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '300px', width: '300px' }}>DETAIL TASK</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '100px' }}>PRIORITY</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '90px' }}>MANDAY EST</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '105px' }}>STATUS</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '110px' }}>START DATE</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '110px' }}>ASSIGNED</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '110px' }}>SUPPORT</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '85px' }}>KPI RATIO</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '120px' }}>SKILL SOLUTION</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '115px' }}>SKILL VENDOR</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '100px' }}>TICKET ID</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '130px' }}>REMARK</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '80px' }}>SEND</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '110px' }}>END DAY EST</th>
                            <th className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '100px' }}>MANDAY ACTUAL</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#c2c6d6]/40 bg-white">
                          {loadingTasks && (
                            <tr>
                              <td colSpan={17} className="text-center py-16 text-[#565e74]">
                                <div className="flex items-center justify-center gap-2">
                                  <div className="w-4 h-4 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" /> Đang tải...
                                </div>
                              </td>
                            </tr>
                          )}
                          {!loadingTasks && phaseItems.length === 0 && (
                            <tr>
                              <td colSpan={17} className="text-center py-16 text-[#565e74] font-medium">
                                Không tìm thấy nhiệm vụ nào trong {phaseLabel}
                              </td>
                            </tr>
                          )}
                          {!loadingTasks && phaseItems.map((v, idx) => {
                            const td = parseRowData(v.row_data);
                            const isSection = v.ai_verdict === 'SECTION';

                            let rowElement = null;

                            if (isSection) {
                              // In Master view, hide all section headers (phase banners + Roman numerals)
                              if (activePhase === 'ALL') return <Fragment key={v.id} />;

                              const detail = td.detail || '';
                              // Only PHASE-prefixed rows get the main banner treatment
                              const isPhaseHeader = /^PHASE\s/i.test(detail);

                              if (isPhaseHeader) {
                                rowElement = (
                                  <tr className="bg-[#eff4ff] border-l-[4px] border-l-[#0058be] border-b border-[#c2c6d6]/30 group relative">
                                    <td className="px-4 py-3.5"></td>
                                    <td colSpan={16} className="px-4 py-3.5 relative">
                                      <span className="text-[12px] font-black text-[#0b1c30] uppercase tracking-wider">{detail}</span>

                                      {/* Hover Add Task Button */}
                                      <div className="absolute left-0 right-0 -bottom-3.5 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                                        <button
                                          onClick={() => handleOpenAddTask(v)}
                                          className="pointer-events-auto bg-[#0058be] hover:bg-[#0058be]/90 text-white text-[9px] font-extrabold px-3 py-1 rounded-full shadow-xl flex items-center gap-1 active:scale-95 transition-all uppercase tracking-wider"
                                        >
                                          <span>+ Thêm task phía dưới</span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              } else {
                                // All other sections (Roman numerals, ALL CAPS group names) → same horizontal position as Phase, lighter style
                                rowElement = (
                                  <tr className="bg-[#f8f9ff] border-l-[3px] border-l-[#0058be]/40 border-b border-[#c2c6d6]/30 group relative">
                                    <td className="px-1 py-2.5"></td>
                                    <td colSpan={16} className="px-4 py-2.5 relative">
                                      <span className="text-[11px] font-bold text-[#0058be] uppercase tracking-wide flex items-center gap-2">
                                        <span className="w-0.5 h-3.5 rounded bg-[#0058be]/40 shrink-0 inline-block" />
                                        {detail}
                                      </span>

                                      {/* Hover Add Task Button */}
                                      <div className="absolute left-0 right-0 -bottom-3.5 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                                        <button
                                          onClick={() => handleOpenAddTask(v)}
                                          className="pointer-events-auto bg-[#0058be] hover:bg-[#0058be]/90 text-white text-[9px] font-extrabold px-3 py-1 rounded-full shadow-xl flex items-center gap-1 active:scale-95 transition-all uppercase tracking-wider"
                                        >
                                          <span>+ Thêm task phía dưới</span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }
                            } else {
                              const statusInfo = getStatusInfo(td.status);
                              const priStyle = getPriorityStyle(td.priority);

                              rowElement = (
                                <tr className={`group relative hover:bg-[#eff4ff]/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-[#f8f9ff]/30'}`}>
                                  {/* 1. ACTIONS */}
                                  <td className="px-1 py-3 text-center" style={{ width: '80px' }}>
                                    <button
                                      onClick={() => handleCheckTask(v.id)}
                                      disabled={checkingTaskId === v.id}
                                      className="bg-[#eff4ff] hover:bg-[#0058be]/10 text-[#0058be] border border-[#0058be]/20 px-1.5 py-1 rounded text-[10px] font-bold transition-all disabled:opacity-50 flex items-center gap-1 mx-auto"
                                      title="Kiểm tra task này"
                                    >
                                      {checkingTaskId === v.id ? (
                                        <div className="w-3 h-3 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" />
                                      ) : (
                                        <span>🔍</span>
                                      )}
                                    </button>
                                  </td>
                                  {/* 2. TASK ID */}
                                  <td className="px-2 py-3" style={{ width: '60px' }}>
                                    <div className="flex items-center gap-1 font-mono text-[#565e74] font-semibold text-[11px]">
                                      {v.ai_verdict === 'FAIL' ? (
                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="FAIL" />
                                      ) : v.ai_verdict === 'PASS' ? (
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="PASS" />
                                      ) : v.ai_verdict === 'REVIEW' ? (
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="REVIEW" />
                                      ) : null}
                                      <span className="truncate">{td.taskId || v.row_number}</span>
                                    </div>
                                  </td>
                                  {/* 3. DETAIL TASK */}
                                  <td className="px-4 py-3 relative" style={{ maxWidth: '300px', width: '300px' }}>
                                    <p className="text-[#0b1c30] text-xs font-semibold leading-relaxed break-words whitespace-normal">{td.detail || <span className="opacity-30">—</span>}</p>
                                    {v.ai_verdict === 'FAIL' && v.ai_reason && (
                                      <p className="text-red-600 text-[10px] mt-1 font-semibold">⚠️ {v.ai_reason}</p>
                                    )}
                                    {v.ai_suggestion && v.ai_verdict !== 'PASS' && (
                                      <p className="text-[#0058be]/80 text-[10px] mt-0.5 font-semibold">💡 {v.ai_suggestion}</p>
                                    )}

                                    {/* Hover Add Task Button */}
                                    <div className="absolute left-0 right-0 -bottom-3.5 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                                      <button
                                        onClick={() => handleOpenAddTask(v)}
                                        className="pointer-events-auto bg-[#0058be] hover:bg-[#0058be]/90 text-white text-[9px] font-extrabold px-3 py-1 rounded-full shadow-xl flex items-center gap-1 active:scale-95 transition-all uppercase tracking-wider"
                                      >
                                        <span>+ Thêm task phía dưới</span>
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
                                  <td className="px-4 py-3 text-[#0b1c30] font-mono">{td.manday || <span className="opacity-30">—</span>}</td>
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
                                  <td className="px-4 py-3 text-[#565e74]">{td.date || <span className="opacity-30">—</span>}</td>
                                  {/* 8. ASSIGNED */}
                                  <td className="px-4 py-3 text-[#0b1c30]">{td.assigned || <span className="opacity-30">—</span>}</td>
                                  {/* 9. SUPPORT */}
                                  <td className="px-4 py-3 text-[#565e74]">{td.support || <span className="opacity-30">—</span>}</td>
                                  {/* 10. KPI RATIO */}
                                  <td className="px-4 py-3 text-[#565e74] font-mono">{td.kpiRatio || <span className="opacity-30">—</span>}</td>
                                  {/* 11. SKILL SOLUTION */}
                                  <td className="px-4 py-3 text-[#0b1c30]">{td.skillSolution || <span className="opacity-30">—</span>}</td>
                                  {/* 12. SKILL VENDOR */}
                                  <td className="px-4 py-3 text-[#565e74]">{td.skillVendor || <span className="opacity-30">—</span>}</td>
                                  {/* 13. TICKET ID */}
                                  <td className="px-4 py-3 text-[#565e74] font-mono">{td.ticketId || <span className="opacity-30">—</span>}</td>
                                  {/* 14. REMARK */}
                                  <td className="px-4 py-3 text-[#565e74] max-w-[150px] truncate" title={td.remark}>{td.remark || <span className="opacity-30">—</span>}</td>
                                  {/* 15. SEND */}
                                  <td className="px-4 py-3 text-[#565e74]">{td.send || <span className="opacity-30">—</span>}</td>
                                  {/* 16. END DATE */}
                                  <td className="px-4 py-3 text-[#565e74]">{td.endDate || <span className="opacity-30">—</span>}</td>
                                  {/* 17. MANDAY ACTUAL */}
                                  <td className="px-4 py-3 text-[#0b1c30] font-mono">{td.mandayActual || <span className="opacity-30">—</span>}</td>
                                </tr>
                              );
                            }

                            return (
                              <Fragment key={v.id}>
                                {rowElement}
                                {addingTaskBelowId === v.id && (
                                  <tr className="bg-[#f1f5f9] border-2 border-[#0058be]/40">
                                    <td className="p-1"></td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.taskId}
                                        onChange={e => setNewForm({ ...newForm, taskId: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono"
                                        placeholder="ID"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.detail}
                                        onChange={e => setNewForm({ ...newForm, detail: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold"
                                        placeholder="Task detail description..."
                                        autoFocus
                                      />
                                    </td>
                                    <td className="p-1">
                                      <select
                                        value={newForm.priority}
                                        onChange={e => setNewForm({ ...newForm, priority: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold"
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
                                      <input
                                        type="text"
                                        value={newForm.manday}
                                        onChange={e => setNewForm({ ...newForm, manday: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono"
                                        placeholder="Est"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <select
                                        value={newForm.status}
                                        onChange={e => setNewForm({ ...newForm, status: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold"
                                      >
                                        <option value="">None</option>
                                        <option value="Todo">Todo</option>
                                        <option value="Process">Process</option>
                                        <option value="Review">Review</option>
                                        <option value="Pending">Pending</option>
                                        <option value="Done">Done</option>
                                      </select>
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.date}
                                        onChange={e => setNewForm({ ...newForm, date: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                        placeholder="Start Date"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.assigned}
                                        onChange={e => setNewForm({ ...newForm, assigned: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                        placeholder="Assignee"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.support}
                                        onChange={e => setNewForm({ ...newForm, support: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                        placeholder="Support"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.kpiRatio}
                                        onChange={e => setNewForm({ ...newForm, kpiRatio: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono"
                                        placeholder="KPI"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.skillSolution}
                                        onChange={e => setNewForm({ ...newForm, skillSolution: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                        placeholder="Solution"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.skillVendor}
                                        onChange={e => setNewForm({ ...newForm, skillVendor: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                        placeholder="Vendor"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.ticketId}
                                        onChange={e => setNewForm({ ...newForm, ticketId: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono"
                                        placeholder="Ticket ID"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.remark}
                                        onChange={e => setNewForm({ ...newForm, remark: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                        placeholder="Remark"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.send}
                                        onChange={e => setNewForm({ ...newForm, send: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                        placeholder="Send"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <input
                                        type="text"
                                        value={newForm.endDate}
                                        onChange={e => setNewForm({ ...newForm, endDate: e.target.value })}
                                        className="w-full bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                        placeholder="End Date"
                                      />
                                    </td>
                                    <td className="p-1">
                                      <div className="flex items-center gap-1 w-full min-w-[145px]">
                                        <input
                                          type="text"
                                          value={newForm.mandayActual}
                                          onChange={e => setNewForm({ ...newForm, mandayActual: e.target.value })}
                                          className="w-12 bg-white border border-[#c2c6d6] rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono"
                                          placeholder="Actual"
                                        />
                                        <button
                                          onClick={handleSaveTask}
                                          disabled={savingTask}
                                          className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[9px] font-black px-2 py-1 rounded shadow transition-colors shrink-0 uppercase"
                                        >
                                          {savingTask ? '...' : 'Lưu'}
                                        </button>
                                        <button
                                          onClick={handleCancelAddTask}
                                          className="bg-white border border-slate-300 text-slate-700 text-[9px] font-black px-2 py-1 rounded shadow hover:bg-slate-50 transition-colors shrink-0 uppercase"
                                        >
                                          Hủy
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
              )}

              {/* TAB 2: MEETINGS */}
              {activeMainTab === 'meetings' && (
                <div className="space-y-6">
                  {/* Schedule Meeting Card */}
                  <div className="bg-white border border-[#c2c6d6]/60 shadow-sm rounded-xl p-6">
                    <h3 className="text-sm font-bold text-[#0b1c30] mb-4 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#0058be]">add_circle</span>
                      Lên lịch cuộc họp dự án
                    </h3>
                    <form onSubmit={handleAddMeeting} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                      <div className="sm:col-span-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tên cuộc họp *</label>
                        <input
                          type="text"
                          required
                          value={newMeetingTitle}
                          onChange={e => setNewMeetingTitle(e.target.value)}
                          placeholder="Ví dụ: Rà soát bảo mật tuần 2"
                          className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-1.5 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngày họp *</label>
                        <input
                          type="date"
                          required
                          value={newMeetingDate}
                          onChange={e => setNewMeetingDate(e.target.value)}
                          className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-1.5 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                        />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Giờ họp *</label>
                          <input
                            type="time"
                            required
                            value={newMeetingTime}
                            onChange={e => setNewMeetingTime(e.target.value)}
                            className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-1.5 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                          />
                        </div>
                        <button
                          type="submit"
                          className="bg-[#0058be] hover:bg-[#0058be]/95 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm transition-all"
                        >
                          Đặt lịch
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Meetings List */}
                  <div className="bg-white border border-[#c2c6d6]/60 shadow-sm rounded-xl p-6">
                    <h3 className="text-sm font-bold text-[#0b1c30] mb-5 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#0058be]">calendar_today</span>
                      Danh sách cuộc họp ({meetings.length})
                    </h3>
                    
                    <div className="space-y-4">
                      {meetings.map(m => (
                        <div key={m.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center hover:bg-slate-100/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-[#eff4ff] text-[#0058be] flex flex-col items-center justify-center shrink-0 border border-[#0058be]/10">
                              <span className="text-[10px] font-bold uppercase">{new Date(m.date).toLocaleDateString('vi-VN', { month: 'short' })}</span>
                              <span className="text-base font-black leading-none">{new Date(m.date).getDate()}</span>
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-[#0b1c30]">{m.title}</h4>
                              <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                                <span className="material-symbols-outlined text-[12px]">schedule</span>
                                {m.time} · Tham gia: {m.attendees.join(', ')}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[9px] font-bold uppercase">
                              Lên lịch
                            </span>
                            <button
                              onClick={() => {
                                const updated = meetings.filter(x => x.id !== m.id);
                                setMeetings(updated);
                                localStorage.setItem(`meetings_${id}`, JSON.stringify(updated));
                                flash('Đã xóa cuộc họp');
                              }}
                              className="text-slate-400 hover:text-red-600 p-1 rounded"
                              title="Xóa cuộc họp"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        </div>
                      ))}

                      {meetings.length === 0 && (
                        <div className="text-center py-8 text-slate-400 text-xs italic">
                          Chưa có cuộc họp nào được lên lịch cho dự án này
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: GROUP CHATS */}
              {activeMainTab === 'chats' && (
                <div className="space-y-6">

                  {/* Official Channels (Database backed) */}
                  <div className="bg-white border border-[#c2c6d6]/60 shadow-sm rounded-xl p-6">
                    <h3 className="text-sm font-bold text-[#0b1c30] mb-5 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#0058be] text-[20px]">cloud_done</span>
                      Kênh Liên Lạc Chính Thức (Lưu trên Hệ thống)
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {[
                        { key: 'zalo_link', label: 'Zalo Group', bg: 'bg-[#0068FF]', colorText: 'text-[#0068FF]', logo: '💬', val: project.zalo_link || '' },
                        { key: 'telegram_link', label: 'Telegram Channel', bg: 'bg-[#229ED9]', colorText: 'text-[#229ED9]', logo: '▶', val: project.telegram_link || '' },
                        { key: 'teams_link', label: 'Microsoft Teams', bg: 'bg-[#6264A7]', colorText: 'text-[#6264A7]', logo: 'T', val: project.teams_link || '' },
                      ].map(ch => {
                        const isEditing = editingChannel === ch.key;
                        return (
                          <div key={ch.key} className="bg-slate-50/50 border border-slate-200/80 rounded-xl p-5 flex flex-col justify-between space-y-4 hover:shadow-sm transition-all">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-xl ${ch.bg} flex items-center justify-center text-white text-lg font-bold shadow-sm`}>
                                {ch.logo}
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-[#0b1c30]">{ch.label}</h4>
                                <p className="text-[10px] text-slate-400">Đồng bộ trên toàn hệ thống</p>
                              </div>
                            </div>

                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="url"
                                  value={editingValue}
                                  onChange={e => setEditingValue(e.target.value)}
                                  placeholder="Nhập liên kết https://..."
                                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-2.5 py-1.5 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleSaveChannelLink(ch.key, editingValue)}
                                    disabled={isSavingLink}
                                    className="flex-1 bg-[#0058be] hover:bg-[#0058be]/90 text-white font-bold text-[10px] py-1.5 rounded-md shadow-sm transition-all flex items-center justify-center gap-1"
                                  >
                                    {isSavingLink ? (
                                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      'Lưu'
                                    )}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingChannel(null);
                                      setEditingValue('');
                                    }}
                                    disabled={isSavingLink}
                                    className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-[10px] py-1.5 rounded-md transition-all"
                                  >
                                    Huỷ
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {ch.val ? (
                                  <div className="space-y-2">
                                    <div className="text-[10px] text-slate-500 truncate" title={ch.val}>
                                      {ch.val}
                                    </div>
                                    <div className="flex gap-2">
                                      <a
                                        href={ch.val}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-1 bg-slate-100 hover:bg-slate-200 text-center py-1.5 rounded-md text-[10px] font-bold text-slate-700 transition-colors flex items-center justify-center gap-1 border border-slate-200"
                                      >
                                        <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                                        Truy cập
                                      </a>
                                      <button
                                        onClick={() => {
                                          setEditingChannel(ch.key);
                                          setEditingValue(ch.val);
                                        }}
                                        className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-colors"
                                      >
                                        Sửa
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <div className="text-[10px] text-slate-400 italic">Chưa liên kết group chat</div>
                                    <button
                                      onClick={() => {
                                        setEditingChannel(ch.key);
                                        setEditingValue('');
                                      }}
                                      className={`w-full py-1.5 rounded-md border border-dashed border-slate-300 hover:border-slate-400 text-center text-[10px] font-bold ${ch.colorText} transition-all`}
                                    >
                                      + Kết nối
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Add Group Form */}
                  <div className="bg-white border border-[#c2c6d6]/60 shadow-sm rounded-xl p-6">
                    <h3 className="text-sm font-bold text-[#0b1c30] mb-5 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#0058be] text-[20px]">add_circle</span>
                      Thêm Kênh Thảo Luận Phụ (Lưu ở Trình duyệt)
                    </h3>
                    <form
                      onSubmit={e => {
                        e.preventDefault();
                        if (!newGroupName.trim() || !newGroupLink.trim()) return;
                        const group = {
                          id: Date.now(),
                          name: newGroupName.trim(),
                          platform: newGroupPlatform,
                          link: newGroupLink.trim(),
                          desc: newGroupDesc.trim(),
                          createdAt: new Date().toISOString(),
                        };
                        const updated = [...chatGroups, group];
                        setChatGroups(updated);
                        localStorage.setItem(`chatgroups_${id}`, JSON.stringify(updated));
                        setNewGroupName('');
                        setNewGroupLink('');
                        setNewGroupDesc('');
                        flash('Đã thêm group chat!');
                      }}
                      className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end"
                    >
                      <div className="sm:col-span-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Tên Group *</label>
                        <input
                          type="text"
                          required
                          value={newGroupName}
                          onChange={e => setNewGroupName(e.target.value)}
                          placeholder="VD: VCB-Network-Main"
                          className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Nền tảng</label>
                        <select
                          value={newGroupPlatform}
                          onChange={e => setNewGroupPlatform(e.target.value)}
                          className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                        >
                          <option value="Telegram">Telegram</option>
                          <option value="Zalo">Zalo</option>
                          <option value="Slack">Slack</option>
                          <option value="Teams">Microsoft Teams</option>
                          <option value="Discord">Discord</option>
                          <option value="WhatsApp">WhatsApp</option>
                          <option value="Khác">Khác</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Mô tả (tuỳ chọn)</label>
                        <input
                          type="text"
                          value={newGroupDesc}
                          onChange={e => setNewGroupDesc(e.target.value)}
                          placeholder="VD: Kênh thông báo nhanh"
                          className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Link *</label>
                        <div className="flex gap-2">
                          <input
                            type="url"
                            required
                            value={newGroupLink}
                            onChange={e => setNewGroupLink(e.target.value)}
                            placeholder="https://..."
                            className="flex-1 bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                          />
                          <button
                            type="submit"
                            className="bg-[#0058be] hover:bg-[#0058be]/90 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm transition-all whitespace-nowrap"
                          >
                            Thêm mới
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>

                  {/* Groups Grid */}
                  <div className="bg-white border border-[#c2c6d6]/60 shadow-sm rounded-xl p-6">
                    <h3 className="text-sm font-bold text-[#0b1c30] mb-5 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#0058be] text-[20px]">forum</span>
                      Danh sách Group ({chatGroups.length})
                    </h3>

                    {chatGroups.length === 0 ? (
                      <div className="py-16 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-[#eff4ff] mx-auto flex items-center justify-center mb-4">
                          <span className="material-symbols-outlined text-[#0058be] text-[28px]">forum</span>
                        </div>
                        <p className="text-sm font-semibold text-[#565e74]">Chưa có group nào</p>
                        <p className="text-xs text-slate-400 mt-1">Thêm group chat đầu tiên cho dự án này</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                        {chatGroups.map(g => {
                          const PLATFORM_STYLES: Record<string, { bg: string; icon: string; label: string }> = {
                            Telegram:  { bg: 'bg-[#229ED9]',  icon: '▶',  label: 'Telegram' },
                            Zalo:      { bg: 'bg-[#0068FF]',  icon: '💬', label: 'Zalo' },
                            Slack:     { bg: 'bg-[#4A154B]',  icon: '#',  label: 'Slack' },
                            Teams:     { bg: 'bg-[#6264A7]',  icon: 'T',  label: 'Teams' },
                            Discord:   { bg: 'bg-[#5865F2]',  icon: '⚡', label: 'Discord' },
                            WhatsApp:  { bg: 'bg-[#25D366]',  icon: '📱', label: 'WhatsApp' },
                            Khác:      { bg: 'bg-slate-500',  icon: '💬', label: 'Group' },
                          };
                          const ps = PLATFORM_STYLES[g.platform] || PLATFORM_STYLES['Khác'];

                          return (
                            <div key={g.id} className="relative group bg-white border border-[#c2c6d6]/60 rounded-xl p-5 flex flex-col items-center text-center shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5">
                              {/* Delete btn */}
                              <button
                                onClick={() => {
                                  const updated = chatGroups.filter(x => x.id !== g.id);
                                  setChatGroups(updated);
                                  localStorage.setItem(`chatgroups_${id}`, JSON.stringify(updated));
                                  flash('Đã xóa group');
                                }}
                                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-500 p-1 rounded"
                                title="Xóa group"
                              >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                              </button>

                              {/* Platform icon */}
                              <div className={`w-12 h-12 rounded-2xl ${ps.bg} flex items-center justify-center text-white text-xl mb-3 shadow-sm`}>
                                {ps.icon}
                              </div>

                              {/* Name */}
                              <p className="text-xs font-bold text-[#0b1c30] mb-1 leading-snug">{g.name}</p>

                              {/* Platform + desc */}
                              <p className="text-[10px] text-slate-400 mb-3">
                                {ps.label} Group{g.desc ? ` • ${g.desc}` : ''}
                              </p>

                              {/* Open link */}
                              <a
                                href={g.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-bold text-[#0058be] hover:underline flex items-center gap-1"
                              >
                                <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                                Mở ứng dụng
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: MEMBERS */}
              {activeMainTab === 'members' && (
                <div className="space-y-6">
                  {/* Add Member Card */}
                  <div className="bg-white border border-[#c2c6d6]/60 shadow-sm rounded-xl p-6">
                    <h3 className="text-sm font-bold text-[#0b1c30] mb-4 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#0058be]">person_add</span>
                      Thêm thành viên mới
                    </h3>
                    <form onSubmit={handleAddMember} className="flex gap-2">
                      <input
                        type="email"
                        required
                        value={newMemberEmail}
                        onChange={e => setNewMemberEmail(e.target.value)}
                        placeholder="Nhập địa chỉ email thành viên mới..."
                        className="flex-1 bg-white border border-[#c2c6d6] rounded-lg px-4 py-2 text-xs focus:outline-none focus:border-[#0058be]"
                      />
                      <button
                        type="submit"
                        disabled={isAddingMember}
                        className="bg-[#0058be] hover:bg-[#0058be]/95 text-white font-bold text-xs px-5 py-2 rounded-lg shadow-sm transition-all disabled:opacity-50"
                      >
                        {isAddingMember ? 'Đang thêm...' : 'Thêm'}
                      </button>
                    </form>
                  </div>

                  {/* Members List Card */}
                  <div className="bg-white border border-[#c2c6d6]/60 shadow-sm rounded-xl p-6">
                    <h3 className="text-sm font-bold text-[#0b1c30] mb-5 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#0058be]">groups</span>
                      Đội ngũ phát triển dự án
                    </h3>

                    <div className="divide-y divide-slate-100">
                      {/* Tech Lead */}
                      {project.leader_email && (
                        <div className="py-4 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-[#eff4ff] border border-[#0058be]/20 flex items-center justify-center text-xs font-extrabold text-[#0058be]">
                              {leadInfo.initials}
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-[#0b1c30]">{leadInfo.name}</h4>
                              <p className="text-[10px] text-slate-500 mt-0.5">{leadInfo.email}</p>
                            </div>
                          </div>
                          <span className="px-2.5 py-0.5 bg-[#eff4ff] text-[#0058be] text-[10px] font-bold rounded-full uppercase border border-[#0058be]/10">
                            Technical Lead
                          </span>
                        </div>
                      )}

                      {/* PM */}
                      {project.pm_email && (
                        <div className="py-4 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-xs font-extrabold text-emerald-700">
                              {pmInfo.initials}
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-[#0b1c30]">{pmInfo.name}</h4>
                              <p className="text-[10px] text-slate-500 mt-0.5">{pmInfo.email}</p>
                            </div>
                          </div>
                          <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full uppercase border border-emerald-200/50">
                            Product Manager
                          </span>
                        </div>
                      )}

                      {/* Other members */}
                      {membersList.map((m: string) => {
                        const mInfo = getPMDisplay(m);
                        return (
                          <div key={m} className="py-4 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                                {mInfo.initials}
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-[#0b1c30]">{mInfo.name}</h4>
                                <p className="text-[10px] text-slate-500 mt-0.5">{mInfo.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-full uppercase border border-slate-200">
                                Member
                              </span>
                              <button
                                onClick={async () => {
                                  const filtered = membersList.filter((x: string) => x !== m).join(',');
                                  const updated = await updateSheet(Number(id), { member_emails: filtered });
                                  setProject((prev: any) => ({ ...prev, ...updated }));
                                  flash('Đã gỡ bỏ thành viên');
                                }}
                                className="text-slate-400 hover:text-red-600 p-1"
                                title="Gỡ thành viên"
                              >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {!project.leader_email && !project.pm_email && membersList.length === 0 && (
                        <p className="py-8 text-center text-slate-400 text-xs italic">Chưa có thành viên nào tham gia dự án này</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

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
      <div className="h-screen bg-[#f0f2f5] flex items-center justify-center text-[#565e74]" style={{ fontFamily: "'Work Sans', sans-serif" }}>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" />
          <span>Đang tải thông tin...</span>
        </div>
      </div>
    }>
      <ProjectDetailContent />
    </Suspense>
  );
}
