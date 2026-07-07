'use client';
import { useEffect, useState, useCallback, useRef, Fragment, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getViolations, getSheets, addTask, checkSingleTask, updateSheet, deleteSheet, getChatGroups, createChatGroup, deleteChatGroup, updateTask, deleteTask, addTaskLocal, getPhases, createPhase, updatePhase, deletePhase } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

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
  const [activePhase, setActivePhase] = useState<string>('ALL');
  const [phases, setPhases] = useState<any[]>([]);
  const [showPhaseModal, setShowPhaseModal] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [editingPhaseId, setEditingPhaseId] = useState<number | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [selectedFormPhase, setSelectedFormPhase] = useState<string>('');

  // Interactive Task Management additions
  const [editingCell, setEditingCell] = useState<{ taskId: number; colName: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [taskToDelete, setTaskToDelete] = useState<number | null>(null);

  const TASK_COLUMNS = [
    "TASK ID", "DETAIL TASK", "PRIORITY", "MANDAY EST", "STATUS", "START DATE",
    "ASSIGNED", "SUPPORT", "KPI RATIO", "SKILL SOLUTION", "SKILL VENDOR", "TICKET ID",
    "REMARK", "SEND", "END DATE EST", "MD ACTUAL", "END ACTUAL", "DAYS LATE",
    "KPI BASE", "KPI PERFORM", "KPI OVERTIME", "KPI FINAL", "SUB ID", "ROOT TASKS",
    "NOTES", "WEEK EST", "MONTH EST", "WEEK ACTUAL", "MONTH ACTUAL"
  ];

  const ALIASES: Record<string, string[]> = {
    'MANDAY EST': ['MANDAY (EST)', 'MANDAY EST', 'MANDAY'],
    'START DATE': ['START DATE (EST)', 'START DATE', 'START DATE EST', 'DATE'],
    'END DATE EST': ['END DAY (EST)', 'END DATE', 'END DATE EST', 'END DATE (EST)', 'END DAY EST'],
    'MD ACTUAL': ['MANDAY ACTUAL', 'MD ACTUAL', 'MANDAY_ACTUAL'],
    'END ACTUAL': ['END ACTUAL', 'END DATE ACTUAL', 'END_ACTUAL']
  };

  const getCellValue = (rowData: Record<string, any>, colName: string): string => {
    const colUpper = colName.trim().toUpperCase();
    const aliases = ALIASES[colUpper] || [colUpper];
    for (const key of Object.keys(rowData)) {
      const keyUpper = key.trim().toUpperCase();
      if (keyUpper === colUpper || aliases.includes(keyUpper)) {
        return String(rowData[key] ?? '');
      }
    }
    return '';
  };

  const setCellValue = (rowData: Record<string, any>, colName: string, value: any): Record<string, any> => {
    const updated = { ...rowData };
    const colUpper = colName.trim().toUpperCase();
    const aliases = ALIASES[colUpper] || [colUpper];
    let foundKey = colName;
    for (const key of Object.keys(updated)) {
      const keyUpper = key.trim().toUpperCase();
      if (keyUpper === colUpper || aliases.includes(keyUpper)) {
        foundKey = key;
        break;
      }
    }
    updated[foundKey] = value;
    return updated;
  };

  const getDynamicColumns = () => {
    return TASK_COLUMNS;
  };

  const dynamicTabs = [
    { key: 'ALL', label: 'Master', is_master: true, id: undefined as any },
    ...phases.filter(p => !p.is_master).map(p => ({
      key: p.name,
      label: p.name,
      id: p.id,
      is_master: false
    }))
  ];


  // Local state for meetings, chats
  const [meetings, setMeetings] = useState<any[]>([]);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [newMeetingTitle, setNewMeetingTitle] = useState('');
  const [newMeetingPlatform, setNewMeetingPlatform] = useState('Microsoft Teams');
  const [newMeetingDate, setNewMeetingDate] = useState('');
  const [newMeetingTime, setNewMeetingTime] = useState('');
  const [newMeetingEndTime, setNewMeetingEndTime] = useState('');

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

  const [newForm, setNewForm] = useState<any>({});

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const flash = (t: string, e = false) => {
    setMsg({ t, e });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleDeleteSheet = async () => {
    try {
      await deleteSheet(Number(id));
      flash('Xóa dự án thành công!');
      router.push('/project');
    } catch {
      flash('Xóa dự án thất bại', true);
    }
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

  const loadChatGroups = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getChatGroups(Number(id));
      setChatGroups(data || []);
    } catch {
      flash('Không thể tải danh sách group chat từ database', true);
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
        { id: '1', title: 'Review tiến độ tuần 24', platform: 'Microsoft Teams', date: '2024-10-24', time: '09:00', endTime: '10:30', status: 'done', aiSummary: ['Hoàn thành 80% giai đoạn PoC, cần đẩy nhanh tích hợp API.', 'Vấn đề: Chậm trễ trong việc kết nối phụ lục gia hạn thiết bị.', 'Action: Lê Hoa liên hệ phòng mua hàng trong ngày mai.'] },
        { id: '2', title: 'Họp kỹ thuật: Tối ưu hóa Database', platform: 'Zoom Meeting', date: '2026-10-26', time: '14:00', endTime: '15:00', status: 'upcoming' },
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
  }, [id]);

  const loadPhases = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getPhases(Number(id));
      setPhases(data || []);
    } catch {
      flash('Không thể tải danh sách phase', true);
    }
  }, [id]);

  useEffect(() => {
    loadProject();
    loadTasks();
    loadChatGroups();
    loadPhases();
  }, [id, loadProject, loadTasks, loadChatGroups, loadPhases]);

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

  const handleCreatePhase = async () => {
    const name = newPhaseName.trim();
    if (!name) {
      alert('Tên Phase không được để trống!');
      return;
    }
    if (name.toLowerCase() === 'master') {
      alert('Tên "Master" là dành riêng cho Phase mặc định!');
      return;
    }
    const dup = phases.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      alert('Phase này đã tồn tại trong dự án!');
      return;
    }
    try {
      await createPhase(Number(id), { name });
      flash('Tạo Phase mới thành công!');
      setShowPhaseModal(false);
      setNewPhaseName('');
      loadPhases();
    } catch (err: any) {
      alert('Lỗi tạo phase: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleRenamePhase = async () => {
    const name = editingPhaseName.trim();
    if (!name) {
      alert('Tên Phase không được để trống!');
      return;
    }
    if (name.toLowerCase() === 'master') {
      alert('Tên "Master" là dành riêng cho Phase mặc định!');
      return;
    }
    const dup = phases.some(p => p.id !== editingPhaseId && p.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      alert('Phase này đã tồn tại trong dự án!');
      return;
    }
    if (editingPhaseId === null) return;
    try {
      await updatePhase(Number(id), editingPhaseId, { name });
      flash('Đổi tên Phase thành công!');
      setShowRenameModal(false);
      setEditingPhaseId(null);
      setEditingPhaseName('');
      loadPhases();
      loadTasks();
    } catch (err: any) {
      alert('Lỗi đổi tên phase: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleDeletePhase = async (pid: number, pname: string) => {
    if (pname.toLowerCase() === 'master') {
      alert('Không thể xóa Phase Master!');
      return;
    }
    if (!confirm(`Bạn có chắc chắn muốn xóa Phase "${pname}"?\nTất cả nhiệm vụ thuộc Phase này cũng sẽ bị xóa vĩnh viễn.`)) {
      return;
    }
    try {
      await deletePhase(Number(id), pid);
      flash('Đã xóa Phase thành công!');
      if (activePhase === pname) {
        setActivePhase('ALL');
      }
      loadPhases();
      loadTasks();
    } catch (err: any) {
      alert('Lỗi xóa phase: ' + (err.response?.data?.detail || err.message));
    }
  };

  const parseRowData = (rowData: string) => {
    try {
      const d = JSON.parse(rowData || '{}');
      return {
        taskId: getCellValue(d, 'TASK ID'),
        detail: getCellValue(d, 'DETAIL TASK'),
        priority: getCellValue(d, 'PRIORITY'),
        manday: getCellValue(d, 'MANDAY EST'),
        status: getCellValue(d, 'STATUS'),
        date: getCellValue(d, 'START DATE'),
        assigned: getCellValue(d, 'ASSIGNED'),
        support: getCellValue(d, 'SUPPORT'),
        kpiRatio: getCellValue(d, 'KPI RATIO'),
        skillSolution: getCellValue(d, 'SKILL SOLUTION'),
        skillVendor: getCellValue(d, 'SKILL VENDOR'),
        ticketId: getCellValue(d, 'TICKET ID'),
        remark: getCellValue(d, 'REMARK'),
        send: getCellValue(d, 'SEND'),
        endDate: getCellValue(d, 'END DATE EST'),
        mandayActual: getCellValue(d, 'MD ACTUAL'),
        endActual: getCellValue(d, 'END ACTUAL'),
        daysLate: getCellValue(d, 'DAYS LATE'),
        kpiBase: getCellValue(d, 'KPI BASE'),
        kpiPerform: getCellValue(d, 'KPI PERFORM'),
        kpiOvertime: getCellValue(d, 'KPI OVERTIME'),
        kpiFinal: getCellValue(d, 'KPI FINAL'),
        subId: getCellValue(d, 'SUB ID'),
        rootTasks: getCellValue(d, 'ROOT TASKS'),
        notes: getCellValue(d, 'NOTES'),
        weekEst: getCellValue(d, 'WEEK EST'),
        monthEst: getCellValue(d, 'MONTH EST'),
        weekActual: getCellValue(d, 'WEEK ACTUAL'),
        monthActual: getCellValue(d, 'MONTH ACTUAL')
      };
    } catch {
      return {
        taskId: '', detail: '', priority: '', manday: '', status: '', date: '', assigned: '', support: '',
        kpiRatio: '', skillSolution: '', skillVendor: '', ticketId: '', remark: '', send: '', endDate: '', mandayActual: '',
        endActual: '', daysLate: '', kpiBase: '', kpiPerform: '', kpiOvertime: '', kpiFinal: '', subId: '', rootTasks: '',
        notes: '', weekEst: '', monthEst: '', weekActual: '', monthActual: ''
      };
    }
  };

  const handleOpenAddTask = (item: any) => {
    const dynamicCols = getDynamicColumns();
    const initialForm: Record<string, string> = {};
    dynamicCols.forEach(col => {
      initialForm[col] = '';
    });
    
    const idCol = dynamicCols.find(c => c.toUpperCase().includes('ID'));
    if (idCol) {
      const parsed = JSON.parse(item.row_data || '{}');
      const idVal = parsed[idCol] || '';
      const numPart = String(idVal).match(/\d+$/);
      if (numPart) {
        const nextNum = parseInt(numPart[0], 10) + 1;
        initialForm[idCol] = idVal.slice(0, numPart.index) + nextNum;
      }
    }
    
    const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
    if (statusCol) {
      initialForm[statusCol] = 'Todo';
    }
    
    setNewForm(initialForm);
    setSelectedFormPhase(activePhase === 'ALL' ? (item.tab_name || '') : activePhase);
    setAddingTaskBelowId(item.id);
  };

  const renderFormCell = (col: string, cIdx: number) => {
    const colUpper = col.toUpperCase().trim();
    
    // Rule 1: TASK ID - automatically generated by system, not editable, leave empty
    if (colUpper === 'TASK ID' || colUpper === 'TASKID' || colUpper === 'ID') {
      if (activePhase === 'ALL') {
        return (
          <td key={col} className="p-1 min-w-[120px]">
            <select
              value={selectedFormPhase}
              onChange={e => setSelectedFormPhase(e.target.value)}
              className="w-full bg-white border border-[#0058be] rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-bold"
            >
              <option value="">-- Phase * --</option>
              {phases.filter(p => !p.is_master).map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </td>
        );
      }
      return (
        <td key={col} className="p-1">
          <input
            type="text"
            value=""
            placeholder="Auto"
            disabled
            className="w-full bg-[#f1f5f9] border border-[#cbd5e1] rounded px-1.5 py-1 text-[11px] text-[#64748b] font-semibold cursor-not-allowed text-center"
          />
        </td>
      );
    }

    // Rule 3: System auto-calculated columns (cannot input on creation, leave empty)
    const SYSTEM_COLS = [
      'END DATE EST', 'MD ACTUAL', 'END ACTUAL', 'DAYS LATE',
      'KPI BASE', 'KPI PERFORM', 'KPI OVERTIME', 'KPI FINAL', 'SUB ID',
      'WEEK EST', 'MONTH EST', 'WEEK ACTUAL', 'MONTH ACTUAL'
    ];
    if (SYSTEM_COLS.includes(colUpper)) {
      return (
        <td key={col} className="p-1">
          <input
            type="text"
            value=""
            disabled
            className="w-full bg-[#f8fafc] border border-[#e2e8f0] rounded px-1.5 py-1 text-[11px] text-[#94a3b8] cursor-not-allowed italic text-center"
          />
        </td>
      );
    }

    // Rule 2: Editable columns
    const REQUIRED_COLS = [
      'DETAIL TASK', 'PRIORITY', 'MANDAY EST', 'STATUS',
      'START DATE', 'ASSIGNED', 'SUPPORT', 'KPI RATIO'
    ];
    const isRequired = REQUIRED_COLS.includes(colUpper);

    let inputField = null;

    if (colUpper === 'STATUS') {
      inputField = (
        <select
          value={newForm[col] || 'Todo'}
          onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
          className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${
            isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
          }`}
        >
          <option value="Todo">Todo</option>
          <option value="Waiting">Waiting</option>
          <option value="Process">Process</option>
          <option value="Done">Done</option>
          <option value="Cancel">Cancel</option>
        </select>
      );
    } else if (colUpper === 'PRIORITY') {
      inputField = (
        <select
          value={newForm[col] || ''}
          onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
          className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${
            isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
          }`}
        >
          <option value="">-- Chọn --</option>
          <option value="Normal">Normal</option>
          <option value="High">High</option>
          <option value="Critical">Critical</option>
        </select>
      );
    } else {
      const isDateCol = colUpper.includes('DATE') || (colUpper.includes('ACTUAL') && colUpper.includes('END'));
      const isUserCol = colUpper === 'ASSIGNED' || colUpper === 'SUPPORT';
      const isNumeric = colUpper.includes('MANDAY') || colUpper.includes('BASE') || colUpper.includes('PERFORM') || colUpper.includes('OVERTIME') || colUpper.includes('FINAL') || colUpper.includes('LATE');

      if (isDateCol) {
        inputField = (
          <input
            type="date"
            value={newForm[col] ? toPickerDate(newForm[col]) : ''}
            onChange={e => setNewForm({ ...newForm, [col]: fromPickerDate(e.target.value) })}
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
          />
        );
      } else if (isUserCol) {
        inputField = (
          <input
            type="text"
            list="member-emails"
            value={newForm[col] || ''}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
          />
        );
      } else if (isNumeric) {
        inputField = (
          <input
            type="number"
            step="any"
            value={newForm[col] || ''}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
          />
        );
      } else {
        inputField = (
          <input
            type="text"
            value={newForm[col] || ''}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] ${
              colUpper.includes('DETAIL') ? 'font-semibold' : ''
            } ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
            placeholder={col + (isRequired ? ' *' : '')}
            autoFocus={cIdx === 1}
          />
        );
      }
    }

    return (
      <td key={col} className="p-1">
        {inputField}
      </td>
    );
  };

  const handleSaveTask = async () => {
    const dynamicCols = getDynamicColumns();
    
    // Required fields: DETAIL TASK, PRIORITY, MANDAY EST, STATUS, START DATE, KPI RATIO
    const REQUIRED_COLS = [
      'DETAIL TASK',
      'PRIORITY',
      'MANDAY EST',
      'STATUS',
      'START DATE',
      'KPI RATIO'
    ];

    // Helper to find actual column key by case-insensitive name
    const findColKey = (name: string) => {
      return dynamicCols.find(c => c.toUpperCase().trim() === name.toUpperCase().trim());
    };

    // Prepare a temporary newForm representation
    const tempForm = { ...newForm };

    // Default status to 'Todo' if empty
    const statusColKey = findColKey('STATUS');
    if (statusColKey && !tempForm[statusColKey]) {
      tempForm[statusColKey] = 'Todo';
    }

    // Default KPI RATIO: if support is empty, default KPI RATIO to 100/0
    const supportColKey = findColKey('SUPPORT');
    const supportVal = supportColKey ? (tempForm[supportColKey] || '').trim() : '';
    const kpiRatioColKey = findColKey('KPI RATIO');
    if (kpiRatioColKey && !tempForm[kpiRatioColKey] && !supportVal) {
      tempForm[kpiRatioColKey] = '100/0';
    }

    const missing: string[] = [];
    REQUIRED_COLS.forEach(req => {
      const formKey = findColKey(req);
      const val = formKey ? tempForm[formKey] : undefined;
      if (val === undefined || val === null || String(val).trim() === '' || String(val).trim().toUpperCase() === 'NONE') {
        missing.push(req);
      }
    });
    
    if (missing.length > 0) {
      alert(`Vui lòng nhập/chọn đầy đủ các trường bắt buộc sau:\n- ${missing.join('\n- ')}`);
      return;
    }

    // 1. MANDAY EST validation (> 0)
    const mandayEstColKey = findColKey('MANDAY EST');
    const mandayEstVal = mandayEstColKey ? Number(tempForm[mandayEstColKey]) : 0;
    if (isNaN(mandayEstVal) || mandayEstVal <= 0) {
      alert('MANDAY EST phải là số lớn hơn 0!');
      return;
    }

    // 2. ASSIGNED validation (optional, must belong to project if entered)
    const assignedColKey = findColKey('ASSIGNED');
    const assignedVal = assignedColKey ? (tempForm[assignedColKey] || '').trim() : '';
    if (assignedVal && !memberSuggestions.includes(assignedVal)) {
      alert(`Người thực hiện (ASSIGNED) "${assignedVal}" không thuộc danh sách thành viên dự án!`);
      return;
    }

    // 3. SUPPORT validation (optional, must belong to project if entered)
    if (supportVal && !memberSuggestions.includes(supportVal)) {
      alert(`Người hỗ trợ (SUPPORT) "${supportVal}" không thuộc danh sách thành viên dự án!`);
      return;
    }

    // 4. KPI RATIO validation: pattern A/B, sum = 100
    const kpiRatioVal = kpiRatioColKey ? (tempForm[kpiRatioColKey] || '').trim() : '';
    const ratioMatch = kpiRatioVal.match(/^(\d+)\/(\d+)$/);
    if (!ratioMatch) {
      alert('KPI RATIO phải có định dạng Assigned/Support (ví dụ: 100/0, 80/20, 50/50)!');
      return;
    }
    const ratioAssigned = Number(ratioMatch[1]);
    const ratioSupport = Number(ratioMatch[2]);
    if (ratioAssigned + ratioSupport !== 100) {
      alert('Tổng tỉ lệ KPI RATIO (Assigned + Support) phải bằng 100!');
      return;
    }
    if (!supportVal && ratioSupport > 0) {
      alert('Không có người hỗ trợ (SUPPORT), tỉ lệ KPI RATIO bắt buộc phải là 100/0!');
      return;
    }

    // Update state with defaults/modifications
    setNewForm(tempForm);

    const belowItem = items.find(x => x.id === addingTaskBelowId);
    if (!belowItem && addingTaskBelowId !== 0) return;
    
    setSavingTask(true);
    try {
      const taskData: Record<string, string> = {};
      dynamicCols.forEach(col => {
        const colUpper = col.toUpperCase().trim();
        // Rule 1: TASK ID is auto-generated, send empty
        // Rule 3: System columns are auto-calculated later, send empty
        const SYSTEM_COLS = [
          'END DATE EST', 'MD ACTUAL', 'END ACTUAL', 'DAYS LATE',
          'KPI BASE', 'KPI PERFORM', 'KPI OVERTIME', 'KPI FINAL', 'SUB ID',
          'WEEK EST', 'MONTH EST', 'WEEK ACTUAL', 'MONTH ACTUAL'
        ];
        if (colUpper === 'TASK ID' || colUpper === 'TASKID' || colUpper === 'ID') {
          taskData[col] = '';
        } else if (SYSTEM_COLS.includes(colUpper)) {
          taskData[col] = '';
        } else {
          taskData[col] = tempForm[col] || '';
        }
      });
      
      const tabName = selectedFormPhase || (belowItem ? belowItem.tab_name : '');
      if (!tabName || tabName === 'ALL') {
        alert('Vui lòng chọn Phase cho nhiệm vụ!');
        setSavingTask(false);
        return;
      }
      const afterRow = belowItem ? belowItem.row_number : 0;
      
      await addTaskLocal(Number(id), {
        tab_name: tabName,
        after_row: afterRow,
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

  const toPickerDate = (val: string): string => {
    if (!val) return '';
    const parts = val.split('/');
    if (parts.length === 3) {
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      const y = parts[2];
      return `${y}-${m}-${d}`;
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
    return '';
  };

  const fromPickerDate = (val: string): string => {
    if (!val) return '';
    const parts = val.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return val;
  };

  const handleKeyDown = (e: React.KeyboardEvent, taskId: number, colName: string, isDateOrDropdown = false) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCellSave(taskId, colName, editValue);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  const handleCellSave = async (taskId: number, colName: string, value: string) => {
    const task = items.find(item => item.id === taskId);
    if (!task) return;

    let rowDataObj: Record<string, any> = {};
    try {
      rowDataObj = JSON.parse(task.row_data || '{}');
    } catch {}

    const originalVal = getCellValue(rowDataObj, colName);
    if (originalVal === value) {
      setEditingCell(null);
      return;
    }

    const updatedRowData = setCellValue(rowDataObj, colName, value);

    try {
      const res = await updateTask(taskId, updatedRowData);
      setItems(prev => prev.map(item => {
        if (item.id === taskId) {
          return {
            ...item,
            row_data: res.row_data,
            ai_verdict: res.ai_verdict,
            ai_reason: res.ai_reason,
            ai_suggestion: res.ai_suggestion
          };
        }
        return item;
      }));
      flash('Đã cập nhật task thành công!');
    } catch (err: any) {
      alert('Lỗi cập nhật task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setEditingCell(null);
    }
  };

  const handleDeleteTaskConfirm = async () => {
    if (taskToDelete === null) return;
    try {
      await deleteTask(taskToDelete);
      setItems(prev => prev.filter(item => item.id !== taskToDelete));
      flash('Đã xóa nhiệm vụ thành công!');
    } catch (err: any) {
      alert('Lỗi xóa task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setTaskToDelete(null);
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
    const meetDate = new Date(newMeetingDate);
    const today = new Date(); today.setHours(0,0,0,0);
    const status = meetDate < today ? 'done' : 'upcoming';
    const meet = {
      id: String(Date.now()),
      title: newMeetingTitle,
      platform: newMeetingPlatform,
      date: newMeetingDate,
      time: newMeetingTime,
      endTime: newMeetingEndTime,
      status,
    };
    const updated = [meet, ...meetings];
    setMeetings(updated);
    localStorage.setItem(`meetings_${id}`, JSON.stringify(updated));
    setNewMeetingTitle('');
    setNewMeetingPlatform('Microsoft Teams');
    setNewMeetingDate('');
    setNewMeetingTime('');
    setNewMeetingEndTime('');
    setShowMeetingModal(false);
    flash('Đã tạo cuộc họp mới!');
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
    : realTasks.filter(x => x.tab_name === activePhase);

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
    if (activePhase !== 'ALL' && x.tab_name !== activePhase) return false;
    if (!taskSearch.trim()) return true;
    try {
      const td = JSON.parse(x.row_data || '{}');
      const query = taskSearch.toLowerCase();
      return Object.values(td).some(val => String(val).toLowerCase().includes(query));
    } catch {
      return false;
    }
  });
  const phaseLabel = activePhase === 'ALL' ? 'Master (Tất cả)' : (dynamicTabs.find(p => p.key === activePhase)?.label || '');

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
  const memberSuggestions = Array.from(new Set([
    project.leader_email,
    project.pm_email,
    ...membersList
  ].filter(Boolean))) as string[];

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
                  Năm: {project.project_code || 'Chưa cấu hình'} | Khởi tạo: {project.created_at ? new Date(project.created_at).toLocaleDateString('vi-VN') : '12/01/2024'}
                </p>
              </div>
              <div className="flex gap-2">
                {isAdmin() && (
                  <button 
                    onClick={() => setShowDeleteModal(true)}
                    className="bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-lg text-[13px] font-semibold flex items-center border border-red-200 transition-colors shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[18px] mr-2">delete</span>
                    Xóa dự án
                  </button>
                )}
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
                    <div className="flex items-center gap-1 bg-[#eff4ff] border border-[#c2c6d6]/60 rounded-xl p-1 flex-wrap">
                      {dynamicTabs.map(p => (
                        <button key={p.key} onClick={() => setActivePhase(p.key)}
                          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                            activePhase === p.key
                              ? p.key === 'ALL'
                                ? 'bg-[#0058be] text-white shadow-sm'
                                : 'bg-white text-[#0058be] shadow-sm'
                              : 'text-[#565e74] hover:text-[#0058be]'
                          }`}>
                          <span>{p.label}</span>
                          {activePhase === p.key && !p.is_master && (
                            <span className="flex items-center gap-1 shrink-0">
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPhaseId(p.id);
                                  setEditingPhaseName(p.label);
                                  setShowRenameModal(true);
                                }}
                                className="text-amber-500 hover:text-amber-700 transition-colors p-0.5 rounded cursor-pointer text-[10px]"
                                title="Đổi tên phase"
                              >
                                ✏️
                              </span>
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePhase(p.id!, p.label);
                                }}
                                className="text-red-500 hover:text-red-700 transition-colors p-0.5 rounded cursor-pointer text-[10px]"
                                title="Xóa phase"
                              >
                                🗑️
                              </span>
                            </span>
                          )}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          setNewPhaseName('');
                          setShowPhaseModal(true);
                        }}
                        className="px-3 py-2 rounded-lg text-xs font-bold text-[#0058be] hover:bg-white hover:shadow-sm transition-all flex items-center gap-1 active:scale-95 shrink-0"
                        title="Tạo Phase mới"
                      >
                        <span className="material-symbols-outlined text-[15px] font-bold">add</span>
                        Thêm Phase
                      </button>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input value={taskSearch} onChange={e => setTaskSearch(e.target.value)}
                        placeholder="Tìm kiếm nhiệm vụ..."
                        className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] outline-none w-52 focus:border-[#0058be] placeholder-[#727785] transition-colors" />
                      {taskSearch && (
                        <button onClick={() => setTaskSearch('')} className="text-red-600 text-xs hover:underline">Xóa</button>
                      )}
                      <button
                        onClick={() => {
                          const dynamicCols = getDynamicColumns();
                          const initialForm: Record<string, string> = {};
                          dynamicCols.forEach(col => {
                            initialForm[col] = '';
                          });
                          const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
                          if (statusCol) initialForm[statusCol] = 'Todo';
                          setNewForm(initialForm);
                          setSelectedFormPhase(activePhase === 'ALL' ? '' : activePhase);
                          setAddingTaskBelowId(0); // 0 means adding at the end of current tab/phase
                        }}
                        className="bg-[#0058be] hover:bg-[#0058be]/95 text-white font-bold text-xs px-3 py-2 rounded-lg shadow-sm transition-all flex items-center gap-1 active:scale-95"
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                        Thêm task
                      </button>
                    </div>
                  </div>

                  {/* Task Table */}
                  <div className="bg-white border border-[#c2c6d6]/60 rounded-xl shadow-sm flex flex-col overflow-hidden">
                    <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
                      <table className="w-full text-xs min-w-max border-collapse">
                        <thead className="sticky top-0 z-20 bg-[#f8f9ff] border-b-2 border-[#c2c6d6]" style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                          <tr>
                            <th className="text-center px-2 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '80px', width: '80px' }}>THAO TÁC</th>
                            {getDynamicColumns().map((col) => {
                              let widthStyle = {};
                              const colUpper = col.toUpperCase();
                              if (colUpper.includes('DETAIL TASK') || colUpper === 'TASK' || colUpper === 'DESCRIPTION') {
                                widthStyle = { minWidth: '350px', width: '350px' };
                              } else if (colUpper.includes('ID')) {
                                widthStyle = { minWidth: '80px' };
                              } else {
                                widthStyle = { minWidth: '110px' };
                              }
                              return (
                                <th
                                  key={col}
                                  className="text-left px-4 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]"
                                  style={widthStyle}
                                >
                                  {col}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#c2c6d6]/40 bg-white">
                          {loadingTasks && (
                            <tr>
                              <td colSpan={getDynamicColumns().length + 1} className="text-center py-16 text-[#565e74]">
                                <div className="flex items-center justify-center gap-2">
                                  <div className="w-4 h-4 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" /> Đang tải...
                                </div>
                              </td>
                            </tr>
                          )}
                           {!loadingTasks && phaseItems.length === 0 && addingTaskBelowId !== 0 && (
                            <tr>
                              <td colSpan={getDynamicColumns().length + 1} className="text-center py-16 text-[#565e74] font-medium">
                                <div className="flex flex-col items-center gap-3">
                                  <span>Không tìm thấy nhiệm vụ nào trong {phaseLabel}</span>
                                  <button
                                    onClick={() => {
                                      const dynamicCols = getDynamicColumns();
                                      const initialForm: Record<string, string> = {};
                                      dynamicCols.forEach(col => {
                                        initialForm[col] = '';
                                      });
                                      const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
                                      if (statusCol) initialForm[statusCol] = 'Todo';
                                      setNewForm(initialForm);
                                      setSelectedFormPhase(activePhase === 'ALL' ? '' : activePhase);
                                      setAddingTaskBelowId(0); // 0 means adding first task in empty table
                                    }}
                                    className="bg-[#0058be] hover:bg-[#0058be]/95 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm transition-all flex items-center gap-1.5"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">add</span>
                                    Thêm nhiệm vụ đầu tiên
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {!loadingTasks && phaseItems.map((v, idx) => {
                            const isSection = v.ai_verdict === 'SECTION';
                            let rowElement = null;

                            if (isSection) {
                              if (activePhase === 'ALL') return <Fragment key={v.id} />;
                              
                              let detail = '';
                              try {
                                const td = JSON.parse(v.row_data || '{}');
                                const firstKey = Object.keys(td).find(k => k !== '_row');
                                detail = firstKey ? td[firstKey] : '';
                              } catch {
                                detail = '';
                              }
                              
                              const isPhaseHeader = /^PHASE\s/i.test(detail);

                              if (isPhaseHeader) {
                                rowElement = (
                                  <tr className="bg-[#eff4ff] border-l-[4px] border-l-[#0058be] border-b border-[#c2c6d6]/30 group relative">
                                    <td className="px-4 py-3.5"></td>
                                    <td colSpan={getDynamicColumns().length + 1} className="px-4 py-3.5 relative">
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
                                rowElement = (
                                  <tr className="bg-[#f8f9ff] border-l-[3px] border-l-[#0058be]/40 border-b border-[#c2c6d6]/30 group relative">
                                    <td className="px-1 py-2.5"></td>
                                    <td colSpan={getDynamicColumns().length + 1} className="px-4 py-2.5 relative">
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
                              const dynamicCols = getDynamicColumns();
                              let td: Record<string, string> = {};
                              try {
                                td = JSON.parse(v.row_data || '{}');
                              } catch {}

                              const handleStartEdit = (colName: string, currentVal: string) => {
                                setEditingCell({ taskId: v.id, colName });
                                setEditValue(currentVal);
                              };

                              rowElement = (
                                <tr className={`group relative hover:bg-[#eff4ff]/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-[#f8f9ff]/30'}`}>
                                  {/* 1. ACTIONS */}
                                  <td className="px-1 py-3 text-center" style={{ width: '80px' }}>
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        onClick={() => handleCheckTask(v.id)}
                                        disabled={checkingTaskId === v.id}
                                        className="bg-[#eff4ff] hover:bg-[#0058be]/10 text-[#0058be] border border-[#0058be]/20 p-1.5 rounded text-[10px] font-bold transition-all disabled:opacity-50"
                                        title="Kiểm tra task này"
                                      >
                                        {checkingTaskId === v.id ? (
                                          <div className="w-3 h-3 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                          <span>🔍</span>
                                        )}
                                      </button>
                                      <button
                                        onClick={() => setTaskToDelete(v.id)}
                                        className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 p-1.5 rounded text-[10px] font-bold transition-all"
                                        title="Xóa task"
                                      >
                                        🗑️
                                      </button>
                                    </div>
                                  </td>
                                  {/* 3+. DYNAMIC CELLS */}
                                  {dynamicCols.map((col) => {
                                    const val = getCellValue(td, col);
                                    const colUpper = col.toUpperCase();
                                    const isEditing = editingCell?.taskId === v.id && editingCell?.colName === col;

                                    if (isEditing) {
                                      // Status editor
                                      if (colUpper === 'STATUS') {
                                        return (
                                          <td key={col} className="px-2 py-1.5 min-w-[110px]">
                                            <select
                                              value={editValue}
                                              autoFocus
                                              onChange={e => setEditValue(e.target.value)}
                                              onBlur={() => handleCellSave(v.id, col, editValue)}
                                              className="w-full bg-white border border-[#0058be] rounded px-1 py-1 text-xs text-[#0b1c30] focus:outline-none font-semibold"
                                            >
                                              <option value="Todo">Todo</option>
                                              <option value="Waiting">Waiting</option>
                                              <option value="Process">Process</option>
                                              <option value="Done">Done</option>
                                              <option value="Cancel">Cancel</option>
                                            </select>
                                          </td>
                                        );
                                      }

                                      // Priority editor
                                      if (colUpper === 'PRIORITY') {
                                        return (
                                          <td key={col} className="px-2 py-1.5 min-w-[110px]">
                                            <select
                                              value={editValue}
                                              autoFocus
                                              onChange={e => setEditValue(e.target.value)}
                                              onBlur={() => handleCellSave(v.id, col, editValue)}
                                              className="w-full bg-white border border-[#0058be] rounded px-1 py-1 text-xs text-[#0b1c30] focus:outline-none font-semibold"
                                            >
                                              <option value="Normal">Normal</option>
                                              <option value="High">High</option>
                                              <option value="Critical">Critical</option>
                                            </select>
                                          </td>
                                        );
                                      }

                                      // Date editor
                                      const isDateCol = colUpper.includes('DATE') || (colUpper.includes('ACTUAL') && colUpper.includes('END'));
                                      if (isDateCol) {
                                        return (
                                          <td key={col} className="px-2 py-1.5 min-w-[110px]">
                                            <input
                                              type="date"
                                              value={toPickerDate(editValue)}
                                              autoFocus
                                              onChange={e => setEditValue(fromPickerDate(e.target.value))}
                                              onBlur={() => handleCellSave(v.id, col, editValue)}
                                              onKeyDown={e => handleKeyDown(e, v.id, col, true)}
                                              className="w-full bg-white border border-[#0058be] rounded px-1 py-1 text-xs text-[#0b1c30] focus:outline-none font-mono font-semibold"
                                            />
                                          </td>
                                        );
                                      }

                                      // User selector
                                      const isUserCol = colUpper === 'ASSIGNED' || colUpper === 'SUPPORT';
                                      if (isUserCol) {
                                        return (
                                          <td key={col} className="px-2 py-1.5 min-w-[110px]">
                                            <input
                                              type="text"
                                              list="member-emails"
                                              value={editValue}
                                              autoFocus
                                              onChange={e => setEditValue(e.target.value)}
                                              onBlur={() => handleCellSave(v.id, col, editValue)}
                                              onKeyDown={e => handleKeyDown(e, v.id, col, true)}
                                              className="w-full bg-white border border-[#0058be] rounded px-1 py-1 text-xs text-[#0b1c30] focus:outline-none"
                                            />
                                          </td>
                                        );
                                      }

                                      // Numeric editor
                                      const isNumeric = colUpper.includes('MANDAY') || colUpper.includes('BASE') || colUpper.includes('PERFORM') || colUpper.includes('OVERTIME') || colUpper.includes('FINAL') || colUpper.includes('LATE');
                                      if (isNumeric) {
                                        return (
                                          <td key={col} className="px-2 py-1.5 min-w-[110px]">
                                            <input
                                              type="number"
                                              step="any"
                                              value={editValue}
                                              autoFocus
                                              onChange={e => setEditValue(e.target.value)}
                                              onBlur={() => handleCellSave(v.id, col, editValue)}
                                              onKeyDown={e => handleKeyDown(e, v.id, col, false)}
                                              className="w-full bg-white border border-[#0058be] rounded px-1 py-1 text-xs text-[#0b1c30] focus:outline-none font-mono font-semibold"
                                            />
                                          </td>
                                        );
                                      }

                                      // Detail Task (Textarea)
                                      const isDetailCol = colUpper.includes('DETAIL TASK') || colUpper === 'TASK' || colUpper === 'DESCRIPTION';
                                      if (isDetailCol) {
                                        return (
                                          <td key={col} className="px-2 py-1.5" style={{ maxWidth: '350px', width: '350px' }}>
                                            <textarea
                                              value={editValue}
                                              autoFocus
                                              onChange={e => setEditValue(e.target.value)}
                                              onBlur={() => handleCellSave(v.id, col, editValue)}
                                              onKeyDown={e => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                  e.preventDefault();
                                                  handleCellSave(v.id, col, editValue);
                                                } else if (e.key === 'Escape') {
                                                  setEditingCell(null);
                                                }
                                              }}
                                              rows={2}
                                              className="w-full bg-white border border-[#0058be] rounded px-1.5 py-1 text-xs text-[#0b1c30] focus:outline-none font-semibold leading-relaxed"
                                            />
                                          </td>
                                        );
                                      }

                                      // Other text columns
                                      return (
                                        <td key={col} className="px-2 py-1.5 min-w-[110px]">
                                          <input
                                            type="text"
                                            value={editValue}
                                            autoFocus
                                            onChange={e => setEditValue(e.target.value)}
                                            onBlur={() => handleCellSave(v.id, col, editValue)}
                                            onKeyDown={e => handleKeyDown(e, v.id, col, false)}
                                            className="w-full bg-white border border-[#0058be] rounded px-1 py-1 text-xs text-[#0b1c30] focus:outline-none"
                                          />
                                        </td>
                                      );
                                    }

                                                                    // Render normal cells
                                    const isDetailCol = colUpper.includes('DETAIL TASK') || colUpper === 'TASK' || colUpper === 'DESCRIPTION';
                                    if (isDetailCol) {
                                      return (
                                        <td key={col} className="px-4 py-3 relative hover:bg-slate-100/80 group/cell cursor-pointer" style={{ maxWidth: '350px', width: '350px' }} onDoubleClick={() => handleStartEdit(col, val)}>
                                          <div className="relative pr-4">
                                            <p className="text-[#0b1c30] text-xs font-semibold leading-relaxed break-words whitespace-normal">{val || <span className="opacity-30">—</span>}</p>
                                            <span className="absolute right-0 top-0.5 opacity-0 group-hover/cell:opacity-40 text-[10px] transition-opacity shrink-0">✏️</span>
                                          </div>
                                          {/* Hover Add Task Button */}
                                          <div className="absolute left-0 right-0 -bottom-3.5 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenAddTask(v);
                                              }}
                                              className="pointer-events-auto bg-[#0058be] hover:bg-[#0058be]/90 text-white text-[9px] font-extrabold px-3 py-1 rounded-full shadow-xl flex items-center gap-1 active:scale-95 transition-all uppercase tracking-wider"
                                            >
                                              <span>+ Thêm task phía dưới</span>
                                            </button>
                                          </div>
                                        </td>
                                      );
                                    }

                                    const isStatusCol = colUpper === 'STATUS';
                                    if (isStatusCol) {
                                      const statusInfo = getStatusInfo(val);
                                      return (
                                        <td key={col} className="px-4 py-3 cursor-pointer hover:bg-slate-100/80 group/cell" onDoubleClick={() => handleStartEdit(col, val)}>
                                          <div className="flex items-center justify-between w-full">
                                            {val ? (
                                              <div className="flex items-center gap-1.5">
                                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusInfo.dot}`} />
                                                <span className={`text-[10px] font-bold ${statusInfo.text}`}>{statusInfo.label}</span>
                                              </div>
                                            ) : <span className="opacity-30">—</span>}
                                            <span className="opacity-0 group-hover/cell:opacity-40 text-[10px] transition-opacity shrink-0">✏️</span>
                                          </div>
                                        </td>
                                      );
                                    }

                                    const isPriorityCol = colUpper === 'PRIORITY';
                                    if (isPriorityCol) {
                                      const priStyle = getPriorityStyle(val);
                                      return (
                                        <td key={col} className="px-4 py-3 cursor-pointer hover:bg-slate-100/80 group/cell" onDoubleClick={() => handleStartEdit(col, val)}>
                                          <div className="flex items-center justify-between w-full">
                                            {val ? (
                                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${priStyle}`}>
                                                {val}
                                              </span>
                                            ) : <span className="opacity-30">—</span>}
                                            <span className="opacity-0 group-hover/cell:opacity-40 text-[10px] transition-opacity shrink-0">✏️</span>
                                          </div>
                                        </td>
                                      );
                                    }

                                    const isNumericOrDate = colUpper.includes('MANDAY') || colUpper.includes('DATE') || colUpper.includes('RATIO') || colUpper.includes('ID');
                                    return (
                                      <td
                                        key={col}
                                        className={`px-4 py-3 text-xs cursor-pointer hover:bg-slate-100/80 group/cell ${isNumericOrDate ? 'font-mono text-[#0b1c30] font-semibold' : 'text-[#565e74]'}`}
                                        onDoubleClick={() => handleStartEdit(col, val)}
                                      >
                                        <div className="flex items-center justify-between w-full">
                                          <span>{val || <span className="opacity-30">—</span>}</span>
                                          <span className="opacity-0 group-hover/cell:opacity-40 text-[10px] transition-opacity shrink-0">✏️</span>
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            }

                            return (
                              <Fragment key={v.id}>
                                {rowElement}
                                {addingTaskBelowId === v.id && (
                                  <tr className="bg-[#f1f5f9] border-2 border-[#0058be]/40 animate-fade-in">
                                    <td className="p-1 text-center sticky left-0 bg-[#f1f5f9] z-10" style={{ width: '80px', minWidth: '80px' }}>
                                      <div className="flex items-center justify-center gap-1">
                                        <button
                                          onClick={handleSaveTask}
                                          disabled={savingTask}
                                          className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[10px] font-bold px-2 py-1 rounded shadow transition-colors shrink-0 uppercase"
                                          title="Lưu"
                                        >
                                          {savingTask ? '...' : 'Lưu'}
                                        </button>
                                        <button
                                          onClick={handleCancelAddTask}
                                          className="bg-gray-400 hover:bg-gray-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow transition-colors shrink-0 uppercase"
                                          title="Hủy"
                                        >
                                          Hủy
                                        </button>
                                      </div>
                                    </td>
                                    {getDynamicColumns().map((col, cIdx) => renderFormCell(col, cIdx))}
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                          {addingTaskBelowId === 0 && (
                            <tr className="bg-[#f1f5f9] border-2 border-[#0058be]/40 animate-fade-in">
                              <td className="p-1 text-center sticky left-0 bg-[#f1f5f9] z-10" style={{ width: '80px', minWidth: '80px' }}>
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={handleSaveTask}
                                    disabled={savingTask}
                                    className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[10px] font-bold px-2 py-1 rounded shadow transition-colors shrink-0 uppercase"
                                    title="Lưu"
                                  >
                                    {savingTask ? '...' : 'Lưu'}
                                  </button>
                                  <button
                                    onClick={handleCancelAddTask}
                                    className="bg-gray-400 hover:bg-gray-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow transition-colors shrink-0 uppercase"
                                    title="Hủy"
                                  >
                                    Hủy
                                  </button>
                                </div>
                              </td>
                              {getDynamicColumns().map((col, cIdx) => renderFormCell(col, cIdx))}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: MEETINGS */}
              {activeMainTab === 'meetings' && (
                <div>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-sm font-bold text-[#0b1c30]">Lịch họp dự án</h2>
                    <button
                      onClick={() => setShowMeetingModal(true)}
                      className="flex items-center gap-2 bg-[#0058be] hover:bg-[#0058be]/90 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition-all"
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                      Tạo meeting
                    </button>
                  </div>

                  {/* Meeting Cards */}
                  <div className="space-y-3">
                    {meetings.length === 0 ? (
                      <div className="bg-white border border-[#c2c6d6]/60 rounded-xl py-16 text-center">
                        <span className="material-symbols-outlined text-slate-300 text-[48px] block mb-3">event</span>
                        <p className="text-sm font-semibold text-slate-500">Chưa có cuộc họp nào</p>
                        <p className="text-xs text-slate-400 mt-1">Nhấn "+ Tạo meeting" để thêm cuộc họp đầu tiên</p>
                      </div>
                    ) : (
                      meetings.map(m => {
                        const isDone = m.status === 'done';
                        const timeLabel = [m.time, m.endTime].filter(Boolean).join(' - ');
                        const dateLabel = m.date
                          ? new Date(m.date + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
                          : '';

                        return (
                          <div key={m.id} className="bg-white border border-[#c2c6d6]/60 rounded-xl p-5 shadow-sm hover:shadow-md transition-all">
                            {/* Row 1: icon + title + badge + delete */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-lg bg-[#eff4ff] border border-[#0058be]/10 flex items-center justify-center shrink-0 mt-0.5">
                                  <span className="material-symbols-outlined text-[#0058be] text-[18px]">{isDone ? 'event_available' : 'event_upcoming'}</span>
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-[#0b1c30] leading-snug">{m.title}</p>
                                  <p className="text-[11px] text-slate-400 mt-0.5">
                                    {m.platform || 'Online Meeting'}
                                    {dateLabel ? ` • ${dateLabel}` : ''}
                                    {timeLabel ? ` • ${timeLabel}` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {isDone ? (
                                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wide border border-emerald-200">
                                    Đã diễn ra
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-1 rounded-full bg-[#eff4ff] text-[#0058be] text-[10px] font-bold uppercase tracking-wide border border-[#0058be]/20">
                                    Sắp tới
                                  </span>
                                )}
                                <button
                                  onClick={() => {
                                    const updated = meetings.filter(x => x.id !== m.id);
                                    setMeetings(updated);
                                    localStorage.setItem(`meetings_${id}`, JSON.stringify(updated));
                                    flash('Đã xóa cuộc họp');
                                  }}
                                  className="text-slate-300 hover:text-red-500 p-1 rounded transition-colors"
                                  title="Xóa cuộc họp"
                                >
                                  <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                              </div>
                            </div>

                            {/* AI Summary (for done meetings) */}
                            {isDone && m.aiSummary && m.aiSummary.length > 0 && (
                              <div className="mt-4 ml-12 bg-[#f8f9fe] border border-[#0058be]/10 rounded-lg p-4">
                                <p className="text-[11px] font-bold text-[#0058be] mb-2 flex items-center gap-1.5">
                                  <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                                  AI Summary
                                </p>
                                <ul className="space-y-1">
                                  {m.aiSummary.map((line: string, idx: number) => (
                                    <li key={idx} className="text-[11px] text-[#0058be]/80 flex items-start gap-1.5">
                                      <span className="mt-1.5 w-1 h-1 rounded-full bg-[#0058be]/40 shrink-0" />
                                      {line}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Create Meeting Modal */}
                  {showMeetingModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
                        <div className="flex items-center justify-between mb-5">
                          <h3 className="text-sm font-bold text-[#0b1c30] flex items-center gap-2">
                            <span className="material-symbols-outlined text-[#0058be] text-[20px]">event_add</span>
                            Tạo cuộc họp mới
                          </h3>
                          <button onClick={() => setShowMeetingModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded">
                            <span className="material-symbols-outlined text-[20px]">close</span>
                          </button>
                        </div>
                        <form onSubmit={handleAddMeeting} className="space-y-4">
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Tên cuộc họp *</label>
                            <input
                              type="text"
                              required
                              value={newMeetingTitle}
                              onChange={e => setNewMeetingTitle(e.target.value)}
                              placeholder="VD: Review tiến độ tuần 25"
                              className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Nền tảng</label>
                            <select
                              value={newMeetingPlatform}
                              onChange={e => setNewMeetingPlatform(e.target.value)}
                              className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                            >
                              <option>Microsoft Teams</option>
                              <option>Zoom Meeting</option>
                              <option>Google Meet</option>
                              <option>Họp trực tiếp</option>
                              <option>Khác</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Ngày họp *</label>
                            <input
                              type="date"
                              required
                              value={newMeetingDate}
                              onChange={e => setNewMeetingDate(e.target.value)}
                              className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Giờ bắt đầu *</label>
                              <input
                                type="time"
                                required
                                value={newMeetingTime}
                                onChange={e => setNewMeetingTime(e.target.value)}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Giờ kết thúc</label>
                              <input
                                type="time"
                                value={newMeetingEndTime}
                                onChange={e => setNewMeetingEndTime(e.target.value)}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                              />
                            </div>
                          </div>
                          <div className="flex gap-3 pt-2">
                            <button
                              type="button"
                              onClick={() => setShowMeetingModal(false)}
                              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2.5 rounded-lg transition-all"
                            >
                              Huỷ
                            </button>
                            <button
                              type="submit"
                              className="flex-1 bg-[#0058be] hover:bg-[#0058be]/90 text-white font-bold text-xs py-2.5 rounded-lg shadow-sm transition-all"
                            >
                              Tạo meeting
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              )}


              {activeMainTab === 'chats' && (
                <div className="space-y-4">

                  {/* Add Group Form */}
                  <div className="bg-white border border-[#c2c6d6]/60 shadow-sm rounded-xl p-5">
                    <h3 className="text-sm font-bold text-[#0b1c30] mb-4 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#0058be] text-[20px]">add_circle</span>
                      Thêm Chat Group
                    </h3>
                    <form
                      onSubmit={async e => {
                        e.preventDefault();
                        if (!newGroupName.trim() || !newGroupLink.trim()) return;
                        try {
                          const group = await createChatGroup(Number(id), {
                            name: newGroupName.trim(),
                            platform: newGroupPlatform,
                            link: newGroupLink.trim(),
                            desc: newGroupDesc.trim(),
                          });
                          setChatGroups(prev => [group, ...prev]);
                          setNewGroupName('');
                          setNewGroupLink('');
                          setNewGroupDesc('');
                          flash('Đã thêm group chat!');
                        } catch (err: any) {
                          alert('Lỗi thêm group chat: ' + (err.response?.data?.detail || err.message));
                        }
                      }}
                      className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
                    >
                      <div>
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
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Nền Tảng</label>
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

                      <div className="sm:col-span-2">
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
                  {chatGroups.length === 0 ? (
                    <div className="bg-white border border-[#c2c6d6]/60 shadow-sm rounded-xl py-16 text-center">
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
                          Telegram:  { bg: 'bg-[#229ED9]', icon: '▶',  label: 'Telegram' },
                          Zalo:      { bg: 'bg-[#0068FF]', icon: '💬', label: 'Zalo' },
                          Slack:     { bg: 'bg-[#4A154B]', icon: '#',  label: 'Slack' },
                          Teams:     { bg: 'bg-[#6264A7]', icon: 'T',  label: 'Teams' },
                          Discord:   { bg: 'bg-[#5865F2]', icon: '⚡', label: 'Discord' },
                          WhatsApp:  { bg: 'bg-[#25D366]', icon: '📱', label: 'WhatsApp' },
                          Khác:      { bg: 'bg-slate-500', icon: '💬', label: 'Group' },
                        };
                        const ps = PLATFORM_STYLES[g.platform] || PLATFORM_STYLES['Khác'];

                        return (
                          <div key={g.id} className="relative group bg-white border border-[#c2c6d6]/60 rounded-xl p-5 flex flex-col items-center text-center shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5">
                            {/* Delete btn */}
                            <button
                              onClick={async () => {
                                try {
                                  await deleteChatGroup(Number(id), g.id);
                                  setChatGroups(prev => prev.filter(x => x.id !== g.id));
                                  flash('Đã xóa group');
                                } catch (err: any) {
                                  alert('Lỗi xóa group: ' + (err.response?.data?.detail || err.message));
                                }
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

      {/* Modal xác nhận xóa */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 text-red-600 mb-3">
                <span className="material-symbols-outlined text-[28px]">warning</span>
                <h3 className="text-base font-bold">Xác nhận xóa dự án</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Bạn có chắc chắn muốn xóa dự án <strong>{project.name}</strong> không? Hành động này sẽ xóa toàn bộ các vi phạm, tác vụ liên quan và không thể hoàn tác.
              </p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleDeleteSheet}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal xác nhận xóa task */}
      {taskToDelete !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 text-red-600 mb-3">
                <span className="material-symbols-outlined text-[28px]">warning</span>
                <h3 className="text-base font-bold">Xác nhận xóa nhiệm vụ</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Bạn có chắc chắn muốn xóa nhiệm vụ này không? Hành động này sẽ xóa vĩnh viễn nhiệm vụ khỏi cơ sở dữ liệu và không thể hoàn tác.
              </p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => setTaskToDelete(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleDeleteTaskConfirm}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tạo Phase */}
      {showPhaseModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 text-[#0058be] mb-4">
                <span className="material-symbols-outlined text-[28px]">add_circle</span>
                <h3 className="text-base font-bold text-[#0b1c30]">Tạo Phase mới</h3>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Tên Phase *</label>
                <input
                  type="text"
                  required
                  value={newPhaseName}
                  onChange={e => setNewPhaseName(e.target.value)}
                  placeholder="VD: 1.Sale/Admin"
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors font-bold"
                />
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => setShowPhaseModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleCreatePhase}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors shadow-sm"
              >
                Tạo Phase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Đổi Tên Phase */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 text-amber-500 mb-4">
                <span className="material-symbols-outlined text-[28px]">edit</span>
                <h3 className="text-base font-bold text-[#0b1c30]">Đổi tên Phase</h3>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Tên Phase Mới *</label>
                <input
                  type="text"
                  required
                  value={editingPhaseName}
                  onChange={e => setEditingPhaseName(e.target.value)}
                  placeholder="VD: 1.Sale/Admin"
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors font-bold"
                />
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => setShowRenameModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleRenamePhase}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors shadow-sm"
              >
                Lưu Thay Đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Datalist for autocomplete suggestions */}
      <datalist id="member-emails">
        {memberSuggestions.map(email => (
          <option key={email} value={email} />
        ))}
      </datalist>

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
