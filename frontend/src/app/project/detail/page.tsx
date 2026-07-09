'use client';
import { useEffect, useState, useCallback, useRef, Fragment, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
  getProjects, getProject, updateProject, deleteProject,
  getChatGroups, createChatGroup, updateChatGroup, deleteChatGroup,
  getPhases, createPhase, updatePhase, deletePhase,
  getTaskGroups, createTaskGroup, updateTaskGroup, deleteTaskGroup,
  getAllProjectTasks, createTask, updateTask, deleteTask,
  getProjectMembers, addProjectMember, removeProjectMember,
  getMembers, getCustomers, getCategories, getPriorities, getStatuses,
  duplicateTask, moveTask, moveTaskGroup, reorderTaskGroups, reorderTasks
} from '@/lib/api';
import { isAdmin } from '@/lib/auth';

const ROMAN_PAIRS: [number, string][] = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
const to_roman = (n: number): string => {
  if (n <= 0) return String(n);
  let result = '';
  for (const [value, numeral] of ROMAN_PAIRS) {
    while (n >= value) { result += numeral; n -= value; }
  }
  return result;
};

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
  const [taskGroups, setTaskGroups] = useState<any[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const [addingTaskGroupId, setAddingTaskGroupId] = useState<number | null>(null);
  const [addingTaskParentCode, setAddingTaskParentCode] = useState<string | null>(null);
  const [addingTaskAfterCode, setAddingTaskAfterCode] = useState<string | null>(null);
  const [hoveredSpacerPos, setHoveredSpacerPos] = useState<{ id: string; left: string } | null>(null);
  
  // Task Group CRUD States
  const [showTaskGroupModal, setShowTaskGroupModal] = useState(false);
  const [editingTaskGroup, setEditingTaskGroup] = useState<any>(null);
  const [tgName, setTgName] = useState('');
  const [tgDesc, setTgDesc] = useState('');
  const [tgStatus, setTgStatus] = useState('Waiting');
  const [tgPhaseId, setTgPhaseId] = useState<number | ''>('');
  
  // Inline Task Group States
  const [addingTaskGroupPhaseId, setAddingTaskGroupPhaseId] = useState<number | null>(null);
  const [newTgForm, setNewTgForm] = useState({
    name: '',
    manday_est: '',
    status: 'Waiting',
    start_date_est: ''
  });

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

  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  const toggleParentCollapse = (parentTaskId: string) => {
    setCollapsedParents(prev => {
      const next = new Set(prev);
      if (next.has(parentTaskId)) {
        next.delete(parentTaskId);
      } else {
        next.add(parentTaskId);
      }
      return next;
    });
  };

  const toggleGroupCollapse = (groupId: number) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleOpenAddTaskGroupModal = (group: any = null) => {
    if (group && group.id) {
      setEditingTaskGroup(group);
      setTgName(group.name);
      setTgDesc(group.description || '');
      setTgStatus(group.status || 'Waiting');
      setTgPhaseId(group.phase_id);
    } else {
      setEditingTaskGroup(null);
      setTgName('');
      setTgDesc('');
      setTgStatus('Waiting');
      const currentPhaseObj = phases.find(p => p.name === activePhase);
      setTgPhaseId(currentPhaseObj ? currentPhaseObj.id : (phases[0]?.id || ''));
    }
    setShowTaskGroupModal(true);
  };

  const handleSaveTaskGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tgName.trim()) {
      alert('Tên Task Group không được để trống!');
      return;
    }
    if (!tgPhaseId) {
      alert('Vui lòng chọn Phase cho Task Group!');
      return;
    }
    try {
      if (editingTaskGroup) {
        await updateTaskGroup(Number(tgPhaseId), editingTaskGroup.id, {
          name: tgName.trim(),
          description: tgDesc.trim(),
          status: tgStatus,
        });
        flash('Cập nhật Task Group thành công!');
      } else {
        await createTaskGroup(Number(tgPhaseId), {
          name: tgName.trim(),
          description: tgDesc.trim(),
          status: tgStatus,
        } as any);
        flash('Tạo Task Group thành công!');
      }
      setShowTaskGroupModal(false);
      reloadAll();
    } catch (err: any) {
      alert('Lỗi lưu Task Group: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleSaveInlineTaskGroup = async (phaseId: number) => {
    const name = newTgForm.name.trim();
    if (!name) {
      setAddingTaskGroupPhaseId(null);
      return;
    }
    const manday_est = newTgForm.manday_est ? parseFloat(newTgForm.manday_est) : null;
    if (newTgForm.manday_est && isNaN(manday_est as number)) {
      alert('Manday EST phải là số!');
      return;
    }
    try {
      await createTaskGroup(phaseId, {
        name,
        manday_est,
        status: newTgForm.status,
        start_date_est: newTgForm.start_date_est || null,
      } as any);
      flash('Tạo Task Group thành công!');
      setAddingTaskGroupPhaseId(null);
      reloadAll();
    } catch (err: any) {
      alert('Lỗi tạo Task Group: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleDeleteTaskGroupClick = async (group: any) => {
    if (group.task_count > 0) {
      alert(`Không thể xóa Task Group "${group.name}" vì còn ${group.task_count} Task. Hãy xóa hết Task trước.`);
      return;
    }
    if (!confirm(`Bạn có chắc chắn muốn xóa Task Group "${group.name}"?`)) {
      return;
    }
    try {
      await deleteTaskGroup(group.phase_id, group.id);
      flash('Đã xóa Task Group thành công!');
      reloadAll();
    } catch (err: any) {
      alert('Lỗi xóa Task Group: ' + (err.response?.data?.detail || err.message));
    }
  };

  const getParentCode = (code: string): string => {
    if (!code) return '';
    const idx = code.lastIndexOf('.');
    if (idx === -1) return '';
    return code.substring(0, idx);
  };

  const getNextSubTaskId = (parentTaskId: string) => {
    const siblingCodes = items
      .filter(t => getParentCode(t.task_code) === parentTaskId)
      .map(t => t.task_code || '');
    const subtaskNums = siblingCodes.map(c => {
      const suffix = c.substring(parentTaskId.length + 1);
      return parseInt(suffix, 10);
    }).filter(n => !isNaN(n));
    const nextSubNum = subtaskNums.length > 0 ? Math.max(...subtaskNums) + 1 : 1;
    return `${parentTaskId}.${nextSubNum}`;
  };

  const TASK_COLUMNS = [
    "TASK ID", "DETAIL TASK", "PRIORITY", "MANDAY EST", "STATUS", "START DATE",
    "ASSIGNED", "SUPPORT", "KPI RATIO", "SKILL SOLUTION", "SKILL VENDOR", "TICKET ID",
    "REMARK", "SEND", "END DATE EST", "MD ACTUAL", "END ACTUAL", "DAYS LATE",
    "KPI BASE", "KPI PERFORM", "KPI OVERTIME", "KPI FINAL", "SUB ID", "ROOT TASKS",
    "NOTES", "SOLUTION"
  ];

  const ALIASES: Record<string, string[]> = {
    'MANDAY EST': ['MANDAY (EST)', 'MANDAY EST', 'MANDAY'],
    'START DATE': ['START DATE (EST)', 'START DATE', 'START DATE EST', 'DATE'],
    'END DATE EST': ['END DAY (EST)', 'END DATE', 'END DATE EST', 'END DATE (EST)', 'END DAY EST'],
    'MD ACTUAL': ['MANDAY ACTUAL', 'MD ACTUAL', 'MANDAY_ACTUAL'],
    'END ACTUAL': ['END ACTUAL', 'END DATE ACTUAL', 'END_ACTUAL']
  };

  const getCellValue = (task: any, colName: string): string => {
    if (!task) return '';
    const colUpper = colName.trim().toUpperCase();
    
    switch (colUpper) {
      case 'TASK ID': return task.task_code || task.task_id || '';
      case 'DETAIL TASK': return task.detail || '';
      case 'PRIORITY': return task.priority || 'Normal';
      case 'MANDAY EST':
      case 'MANDAY (EST)':
      case 'MANDAY': return task.manday_est !== null && task.manday_est !== undefined ? String(task.manday_est) : '';
      case 'STATUS': return task.status || 'Waiting';
      case 'START DATE':
      case 'START DATE (EST)': return task.start_date || '';
      case 'ASSIGNED': return task.assigned_name || '';
      case 'SUPPORT': return task.support_name || '';
      case 'KPI RATIO': return task.support_id ? `${task.kpi_ratio_assign}/${task.kpi_ratio_support}` : '100/0';
      case 'SKILL SOLUTION': return task.skill_solution_name || '';
      case 'SKILL VENDOR': return task.skill_vendor_name || '';
      case 'TICKET ID': return task.ticket_id || '';
      case 'REMARK': return task.remark || '';
      case 'SEND': return task.send || '';
      case 'END DATE EST':
      case 'END DAY (EST)':
      case 'END DATE (EST)': return task.end_date_est || '';
      case 'MD ACTUAL':
      case 'MANDAY ACTUAL': return task.manday_actual !== null && task.manday_actual !== undefined ? String(task.manday_actual) : '';
      case 'END ACTUAL':
      case 'END DATE ACTUAL': return task.end_date_actual || '';
      case 'DAYS LATE': return task.days_late !== null && task.days_late !== undefined ? String(task.days_late) : '';
      case 'KPI BASE': return task.kpi_base !== null && task.kpi_base !== undefined ? String(task.kpi_base) : '';
      case 'KPI PERFORM': return task.kpi_perform !== null && task.kpi_perform !== undefined ? String(task.kpi_perform) : '';
      case 'KPI OVERTIME': return task.kpi_ot !== null && task.kpi_ot !== undefined ? String(task.kpi_ot) : '';
      case 'KPI FINAL': return task.kpi_final !== null && task.kpi_final !== undefined ? String(task.kpi_final) : '';
      case 'SUB ID': return task.sub_id || '';
      case 'ROOT TASKS':
      case 'ROOT TASK': return getParentCode(task.task_code) || task.root_task || '';
      case 'NOTES': return task.notes || '';
      case 'SOLUTION': return task.solution || '';
      default: return '';
    }
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

  // Edit Project Modal state and form values
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [editProjectName, setEditProjectName] = useState('');
  const [editProjectYear, setEditProjectYear] = useState<number>(new Date().getFullYear());
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCurrentPhase, setEditCurrentPhase] = useState('');

  const [selectedPms, setSelectedPms] = useState<number[]>([]);
  const [selectedLeaders, setSelectedLeaders] = useState<number[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [savingProject, setSavingProject] = useState(false);

  const [projectMembers, setProjectMembers] = useState<any[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [categories, setCategories] = useState<any[]>([]);
  const [dbPriorities, setDbPriorities] = useState<any[]>([]);
  const [dbStatuses, setDbStatuses] = useState<any[]>([]);

  const [membersList, setMembersList] = useState<any[]>([]);
  const [dbCustomers, setDbCustomers] = useState<any[]>([]);

  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [phaseDropdownOpen, setPhaseDropdownOpen] = useState(false);
  const [pmDropdownOpen, setPmDropdownOpen] = useState(false);
  const [leaderDropdownOpen, setLeaderDropdownOpen] = useState(false);
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);

  const [customerSearch, setCustomerSearch] = useState('');
  const [pmSearch, setPmSearch] = useState('');
  const [leaderSearch, setLeaderSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');

  const customerRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<HTMLDivElement>(null);
  const pmRef = useRef<HTMLDivElement>(null);
  const leaderRef = useRef<HTMLDivElement>(null);
  const memberRef = useRef<HTMLDivElement>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const flash = (t: string, e = false) => {
    setMsg({ t, e });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleDeleteSheet = async () => {
    try {
      await deleteProject(Number(id));
      flash('Xóa dự án thành công!');
      router.push('/project');
    } catch {
      flash('Xóa dự án thất bại', true);
    }
  };

  const loadProject = useCallback(async () => {
    try {
      const found = await getProject(Number(id));
      if (found) {
        setProject(found);
      }
    } catch {
      flash('Không thể tải thông tin dự án', true);
    } finally {
      setLoadingProject(false);
    }
  }, [id]);

  const loadProjectMembers = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getProjectMembers(Number(id));
      setProjectMembers(data || []);
    } catch {
      console.error('Không thể tải danh sách thành viên dự án');
    }
  }, [id]);

  const reloadAll = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const phs = await getPhases(Number(id));
      setPhases(phs || []);

      const allGroups: any[] = [];
      if (phs && phs.length > 0) {
        for (const p of phs) {
          const grps = await getTaskGroups(p.id);
          allGroups.push(...grps);
        }
      }
      setTaskGroups(allGroups);

      const tsks = await getAllProjectTasks(Number(id));
      setItems(tsks || []);
    } catch (err) {
      console.error('Lỗi khi tải dữ liệu dự án:', err);
      flash('Không thể tải dữ liệu dự án', true);
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

  useEffect(() => {
    loadProject();
    reloadAll();
    loadChatGroups();
    loadProjectMembers();
  }, [id, loadProject, reloadAll, loadChatGroups, loadProjectMembers]);

  // Load members, customers and categories
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
    
    getCategories()
      .then((data) => {
        setCategories(data || []);
      })
      .catch((err) => {
        console.error('Error fetching categories:', err);
      });

    getPriorities()
      .then((data) => {
        setDbPriorities(data || []);
      })
      .catch((err) => {
        console.error('Error fetching priorities:', err);
      });

    getStatuses()
      .then((data) => {
        setDbStatuses(data || []);
      })
      .catch((err) => {
        console.error('Error fetching statuses:', err);
      });
  }, []);

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
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [customerDropdownOpen, phaseDropdownOpen, pmDropdownOpen, leaderDropdownOpen, memberDropdownOpen]);

  const handleUpdateProject = async () => {
    if (!editProjectName.trim()) {
      flash('Tên dự án không được để trống!', true);
      return;
    }
    setSavingProject(true);
    try {
      const updated = await updateProject(Number(id), {
        name: editProjectName.trim(),
        code: `${editProjectName.trim()}-${editProjectYear}`,
        year: editProjectYear,
        customer_name: editCustomerName.trim(),
        current_phase: editCurrentPhase.trim(),
        pm_ids: selectedPms,
        technical_leader_ids: selectedLeaders,
        member_ids: selectedMembers
      });
      setProject(updated);
      setShowEditProjectModal(false);
      flash('Cập nhật thông tin dự án thành công!');
      loadProject();
    } catch (err: any) {
      flash('Cập nhật thông tin dự án thất bại: ' + (err.response?.data?.detail || err.message), true);
    } finally {
      setSavingProject(false);
    }
  };

  const handleSaveChannelLink = async (channelKey: string, value: string) => {
    setIsSavingLink(true);
    try {
      const updated = await updateProject(Number(id), { [channelKey]: value.trim() });
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
      reloadAll();
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
      reloadAll();
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
      reloadAll();
    } catch (err: any) {
      alert('Lỗi xóa phase: ' + (err.response?.data?.detail || err.message));
    }
  };

  const getTaskPhaseId = (task: any): number | null => {
    const group = taskGroups.find(g => g.id === task.task_group_id);
    return group ? group.phase_id : null;
  };

  const getFilteredTasks = () => {
    if (activePhase === 'ALL') {
      return items;
    }
    const currentPhaseObj = phases.find(p => p.name === activePhase);
    if (!currentPhaseObj) return [];
    return items.filter(t => getTaskPhaseId(t) === currentPhaseObj.id);
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

    const originalVal = getCellValue(task, colName);
    if (originalVal === value) {
      setEditingCell(null);
      return;
    }

    const colUpper = colName.trim().toUpperCase();
    const payload: Record<string, any> = {};

    switch (colUpper) {
      case 'DETAIL TASK':
        payload.detail = value;
        break;
      case 'PRIORITY':
        payload.priority = value;
        break;
      case 'MANDAY EST':
      case 'MANDAY (EST)':
      case 'MANDAY':
        payload.manday_est = value ? parseFloat(value) : null;
        break;
      case 'STATUS':
        payload.status = value;
        break;
      case 'START DATE':
      case 'START DATE (EST)':
        payload.start_date = value || null;
        break;
      case 'ASSIGNED':
        payload.assigned_id = value ? parseInt(value, 10) : null;
        break;
      case 'SUPPORT':
        payload.support_id = value ? parseInt(value, 10) : null;
        break;
      case 'KPI RATIO':
        if (value && value.includes('/')) {
          const parts = value.split('/');
          payload.kpi_ratio_assign = parseInt(parts[0], 10) || 100;
          payload.kpi_ratio_support = parseInt(parts[1], 10) || 0;
        } else {
          payload.kpi_ratio_assign = 100;
          payload.kpi_ratio_support = 0;
        }
        break;
      case 'SKILL SOLUTION':
        payload.skill_solution_id = value ? parseInt(value, 10) : null;
        payload.skill_vendor_id = null; // Reset vendor when solution group changes
        break;
      case 'SKILL VENDOR':
        payload.skill_vendor_id = value ? parseInt(value, 10) : null;
        break;
      case 'TICKET ID':
        payload.ticket_id = value;
        break;
      case 'REMARK':
        payload.remark = value;
        break;
      case 'SEND':
        payload.send = value;
        break;
      case 'END DATE ACTUAL':
      case 'END ACTUAL':
        payload.end_date_actual = value || null;
        break;
      case 'NOTES':
        payload.notes = value;
        break;
      case 'SUB ID':
        payload.sub_id = value;
        break;
      case 'ROOT TASKS':
      case 'ROOT TASK':
        payload.root_task = value || null;
        break;
    }

    try {
      await updateTask(task.task_group_id, taskId, payload);
      flash('Đã cập nhật task thành công!');
      reloadAll();
    } catch (err: any) {
      alert('Lỗi cập nhật task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setEditingCell(null);
    }
  };

  const handleDeleteTaskConfirm = async () => {
    if (taskToDelete === null) return;
    const task = items.find(item => item.id === taskToDelete);
    if (!task) return;
    try {
      await deleteTask(task.task_group_id, taskToDelete);
      flash('Đã xóa nhiệm vụ thành công!');
      reloadAll();
    } catch (err: any) {
      alert('Lỗi xóa task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setTaskToDelete(null);
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
    if (!selectedMemberId) return;
    setIsAddingMember(true);
    try {
      await addProjectMember(Number(id), Number(selectedMemberId));
      loadProjectMembers();
      setSelectedMemberId('');
      flash('Đã thêm thành viên mới thành công!');
    } catch (err: any) {
      alert('Không thể thêm thành viên: ' + (err.response?.data?.detail || err.message));
    } finally {
      setIsAddingMember(false);
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

  // --- Dynamic Stats calculation ---
  const kpiTasks = getFilteredTasks();
  const kpiTotal = kpiTasks.length;
  const kpiWarning = 0; // Warnings are no longer tracked via violations

  const kpiDone = kpiTasks.filter(x => {
    const s = (x.status || '').toLowerCase();
    return s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish');
  }).length;

  const kpiInProgress = kpiTasks.filter(x => {
    const s = (x.status || '').toLowerCase();
    return s.includes('process') || s.includes('progress') || s.includes('inprogress') || s.includes('doing') || s === 'in progress';
  }).length;

  const kpiPass = kpiDone; // Sync approved status with Done for UI compliance
  const kpiEvaluated = kpiTotal;

  // Global progress bar calculation
  const totalTasks = items.length;
  const completedTasks = items.filter(x => {
    const s = (x.status || '').toLowerCase();
    return s === 'done' || s === 'completed' || s.includes('hoàn');
  }).length;
  const devProgressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const getGroupIndex = (groupId: number) => {
    const group = taskGroups.find(g => g.id === groupId);
    if (!group) return 1;
    const groupsInPhase = taskGroups
      .filter(g => g.phase_id === group.phase_id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = groupsInPhase.findIndex(g => g.id === groupId);
    return idx >= 0 ? idx + 1 : 1;
  };

  const getNextRootCodeForGroup = (groupId: number) => {
    const groupIdx = getGroupIndex(groupId);
    const groupTasks = items.filter(t => t.task_group_id === groupId);
    const prefix = `${groupIdx}.`;
    const seqs = groupTasks
      .map(t => {
        const code = t.task_code || '';
        if (code.startsWith(prefix)) {
          const suffix = code.substring(prefix.length);
          const n = parseInt(suffix, 10);
          return isNaN(n) ? 0 : n;
        }
        return 0;
      })
      .filter(n => n > 0);
    const nextSeq = seqs.length > 0 ? Math.max(...seqs) + 1 : 1;
    return `${groupIdx}.${nextSeq}`;
  };





  // --- Hierarchical Tree Table Processing ---
    const renderFormCell = (col: string, cIdx: number, groupId: number, parentCode: string | null, level: number) => {
    const colUpper = col.toUpperCase().trim();
    
    // TASK ID - automatically generated preview
    if (colUpper === 'TASK ID' || colUpper === 'TASKID' || colUpper === 'ID') {
      const generatedId = parentCode ? getNextSubTaskId(parentCode) : getNextRootCodeForGroup(groupId);
      return (
        <td key={col} className="p-1">
          <input
            type="text"
            value={generatedId}
            disabled
            className="w-full bg-[#f1f5f9] border border-[#cbd5e1] rounded px-1.5 py-1 text-[11px] text-[#64748b] font-mono font-bold cursor-not-allowed text-center"
          />
        </td>
      );
    }

    // System auto-calculated columns (cannot input on creation)
    const SYSTEM_COLS = [
      'END DATE EST', 'MD ACTUAL', 'END ACTUAL', 'DAYS LATE',
      'KPI BASE', 'KPI PERFORM', 'KPI OVERTIME', 'KPI FINAL', 'SUB ID',
      'SOLUTION'
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

    // Editable columns
    const REQUIRED_COLS = [
      'DETAIL TASK', 'PRIORITY', 'MANDAY EST', 'STATUS',
      'START DATE', 'ASSIGNED', 'SUPPORT', 'KPI RATIO'
    ];
    const isRequired = REQUIRED_COLS.includes(colUpper);

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveTask();
      } else if (e.key === 'Escape') {
        setAddingTaskGroupId(null);
        setAddingTaskParentCode(null);
        setNewForm({});
      }
    };

    let inputField = null;

    if (colUpper === 'STATUS') {
      inputField = (
        <select
          value={newForm[col] || (dbStatuses[0]?.name || 'Todo')}
          onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
          onKeyDown={handleInputKeyDown}
          className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${
            isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
          }`}
        >
          {dbStatuses.length === 0 ? (
            <>
              <option value="Todo">Todo</option>
              <option value="Waiting">Waiting</option>
              <option value="Process">Process</option>
              <option value="Done">Done</option>
              <option value="Cancel">Cancel</option>
            </>
          ) : (
            dbStatuses.map((st: any) => (
              <option key={st.id} value={st.name}>{st.name}</option>
            ))
          )}
        </select>
      );
    } else if (colUpper === 'PRIORITY') {
      inputField = (
        <select
          value={newForm[col] || 'Normal'}
          onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
          onKeyDown={handleInputKeyDown}
          className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${
            isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
          }`}
        >
          {dbPriorities.length === 0 ? (
            <>
              <option value="Normal">Normal</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </>
          ) : (
            dbPriorities.map((pr: any) => (
              <option key={pr.id} value={pr.name}>{pr.name}</option>
            ))
          )}
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
            onKeyDown={handleInputKeyDown}
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
          />
        );
      } else if (isUserCol) {
        inputField = (
          <select
            value={newForm[col] || ''}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            onKeyDown={handleInputKeyDown}
            className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
          >
            <option value="">-- Chọn thành viên --</option>
            {projectMembers.map((m: any) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        );
      } else if (isNumeric) {
        inputField = (
          <input
            type="number"
            step="any"
            value={newForm[col] || ''}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            onKeyDown={handleInputKeyDown}
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
          />
        );
      } else if (colUpper === 'SKILL SOLUTION') {
        const activeGroups = categories
          .filter(c => c.is_active)
          .flatMap(c => c.groups || []);
        
        inputField = (
          <select
            value={newForm[col] || ''}
            onChange={e => {
              const selectedGrpId = e.target.value;
              const vendorCol = getDynamicColumns().find(c => c.toUpperCase().trim() === 'SKILL VENDOR') || 'SKILL VENDOR';
              setNewForm({
                ...newForm,
                [col]: selectedGrpId,
                [vendorCol]: ''
              });
            }}
            onKeyDown={handleInputKeyDown}
            className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
          >
            <option value="">-- Chọn Group --</option>
            {activeGroups.map((g: any) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        );
      } else if (colUpper === 'SKILL VENDOR') {
        const solCol = getDynamicColumns().find(c => c.toUpperCase().trim() === 'SKILL SOLUTION') || 'SKILL SOLUTION';
        const selectedGroupId = newForm[solCol] || '';
        let availableSkills: any[] = [];
        if (selectedGroupId) {
          const groupObj = categories
            .filter(c => c.is_active)
            .flatMap(c => c.groups || [])
            .find((g: any) => String(g.id) === String(selectedGroupId));
          if (groupObj) {
            availableSkills = (groupObj.skills || []).filter((s: any) => s.is_active);
          }
        } else {
          availableSkills = categories
            .filter(c => c.is_active)
            .flatMap(c => c.groups || [])
            .flatMap((g: any) => g.skills || [])
            .filter((s: any) => s.is_active);
        }

        inputField = (
          <select
            value={newForm[col] || ''}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            onKeyDown={handleInputKeyDown}
            className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
          >
            <option value="">-- Chọn Skill --</option>
            {availableSkills.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        );
      } else if (colUpper === 'KPI RATIO') {
        inputField = (
          <input
            type="text"
            value={newForm[col] || '100/0'}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            onKeyDown={handleInputKeyDown}
            placeholder="100/0"
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
            onKeyDown={handleInputKeyDown}
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
    if (addingTaskGroupId === null) return;
    
    // Required fields: DETAIL TASK, PRIORITY, MANDAY EST, STATUS, START DATE, KPI RATIO
    const detailVal = (newForm['DETAIL TASK'] || '').trim();
    const priorityVal = newForm['PRIORITY'] || 'Normal';
    const mandayEstVal = parseFloat(newForm['MANDAY EST'] || '0');
    const statusVal = newForm['STATUS'] || 'Waiting';
    const startDateVal = newForm['START DATE'] || null;
    
    if (!detailVal) {
      alert('Tên nhiệm vụ (DETAIL TASK) không được để trống!');
      return;
    }
    if (isNaN(mandayEstVal) || mandayEstVal <= 0) {
      alert('MANDAY EST phải là số lớn hơn 0!');
      return;
    }
    if (!startDateVal) {
      alert('Ngày bắt đầu (START DATE) không được để trống!');
      return;
    }

    setSavingTask(true);
    try {
      const taskCode = addingTaskParentCode
        ? getNextSubTaskId(addingTaskParentCode)
        : getNextRootCodeForGroup(addingTaskGroupId);

      const payload: any = {
        task_code: taskCode,
        detail: detailVal,
        priority: priorityVal,
        status: statusVal,
        start_date: startDateVal,
        manday_est: mandayEstVal,
        ticket_id: newForm['TICKET ID'] || '',
        remark: newForm['REMARK'] || '',
        send: newForm['SEND'] || '',
        notes: newForm['NOTES'] || '',
        assigned_id: newForm['ASSIGNED'] ? parseInt(newForm['ASSIGNED'], 10) : null,
        support_id: newForm['SUPPORT'] ? parseInt(newForm['SUPPORT'], 10) : null,
        skill_solution_id: newForm['SKILL SOLUTION'] ? parseInt(newForm['SKILL SOLUTION'], 10) : null,
        skill_vendor_id: newForm['SKILL VENDOR'] ? parseInt(newForm['SKILL VENDOR'], 10) : null,
      };

      // KPI ratio
      const kpiRatio = newForm['KPI RATIO'] || '100/0';
      const parts = kpiRatio.split('/');
      payload.kpi_ratio_assign = parseInt(parts[0], 10) || 100;
      payload.kpi_ratio_support = parseInt(parts[1], 10) || 0;

      await createTask(addingTaskGroupId, payload);
      setAddingTaskGroupId(null);
      setAddingTaskParentCode(null);
      setAddingTaskAfterCode(null);
      setNewForm({});
      reloadAll();
      flash('Đã thêm nhiệm vụ thành công!');
    } catch (err: any) {
      alert('Lỗi thêm task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSavingTask(false);
    }
  };

  const handleDuplicateTask = async (groupId: number, taskId: number) => {
    try {
      await duplicateTask(groupId, taskId);
      flash('Đã nhân bản task thành công!');
      reloadAll();
    } catch (err: any) {
      alert('Lỗi nhân bản task: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleMoveTask = async (groupId: number, taskId: number) => {
    const otherGroups = taskGroups.filter(g => g.id !== groupId);
    if (otherGroups.length === 0) {
      alert('Không có Task Group khác trong dự án này để di chuyển!');
      return;
    }
    const listText = otherGroups.map((g, idx) => `${idx + 1}. ${g.name}`).join('\n');
    const input = prompt(`Nhập số thứ tự của Task Group muốn di chuyển tới:\n${listText}`);
    if (input === null) return;
    const choice = parseInt(input, 10);
    if (isNaN(choice) || choice < 1 || choice > otherGroups.length) {
      alert('Lựa chọn không hợp lệ!');
      return;
    }
    const targetGroup = otherGroups[choice - 1];
    try {
      await moveTask(groupId, taskId, targetGroup.id);
      flash(`Đã di chuyển task sang nhóm "${targetGroup.name}" thành công!`);
      reloadAll();
    } catch (err: any) {
      alert('Lỗi di chuyển task: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleMoveTaskGroup = async (phaseId: number, groupId: number) => {
    const otherPhases = phases.filter(p => p.id !== phaseId);
    if (otherPhases.length === 0) {
      alert('Không có Phase khác trong dự án này để di chuyển Task Group!');
      return;
    }
    const listText = otherPhases.map((p, idx) => `${idx + 1}. ${p.name}`).join('\n');
    const input = prompt(`Nhập số thứ tự của Phase muốn di chuyển Task Group tới:\n${listText}`);
    if (input === null) return;
    const choice = parseInt(input, 10);
    if (isNaN(choice) || choice < 1 || choice > otherPhases.length) {
      alert('Lựa chọn không hợp lệ!');
      return;
    }
    const targetPhase = otherPhases[choice - 1];
    try {
      await moveTaskGroup(phaseId, groupId, targetPhase.id);
      flash(`Đã di chuyển Task Group sang Phase "${targetPhase.name}" thành công!`);
      reloadAll();
    } catch (err: any) {
      alert('Lỗi di chuyển Task Group: ' + (err.response?.data?.detail || err.message));
    }
  };

  const buildTaskTree = (groupTasks: any[]) => {
    const sorted = [...groupTasks].sort((a, b) => {
      const codeA = a.task_code || '';
      const codeB = b.task_code || '';
      return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
    });
    return sorted;
  };

  const isAncestorCollapsed = (code: string) => {
    if (!code) return false;
    const parts = code.split('.');
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('.');
      if (collapsedParents.has(ancestor)) {
        return true;
      }
    }
    return false;
  };

  const renderInlineAddRow = (groupId: number, parentCode: string | null, level: number) => {
    return (
      <tr key={`add-task-row-${groupId}-${parentCode || 'root'}`} className="bg-[#f0fdf4] border-2 border-emerald-500/40 animate-fade-in">
        <td className="p-1 text-center sticky left-0 bg-[#f0fdf4] z-10" style={{ width: '130px', minWidth: '130px' }}>
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={handleSaveTask}
              disabled={savingTask}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold px-2 py-1 rounded shadow transition-colors shrink-0 uppercase"
              title="Lưu"
            >
              {savingTask ? '...' : 'Lưu'}
            </button>
            <button
              onClick={() => {
                setAddingTaskGroupId(null);
                setAddingTaskParentCode(null);
                setAddingTaskAfterCode(null);
                setNewForm({});
              }}
              className="bg-gray-400 hover:bg-gray-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow transition-colors shrink-0 uppercase"
              title="Hủy"
            >
              Hủy
            </button>
          </div>
        </td>
        {getDynamicColumns().map((col, cIdx) => renderFormCell(col, cIdx, groupId, parentCode, level))}
      </tr>
    );
  };

  const handleSpacerMouseEnter = (e: React.MouseEvent<HTMLDivElement>, spacerId: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const width = rect.width;
    const ratio = relativeX / width;
    
    let snapLeft = '50%';
    if (ratio < 0.2) {
      snapLeft = '10%';
    } else if (ratio >= 0.2 && ratio < 0.4) {
      snapLeft = '30%';
    } else if (ratio >= 0.4 && ratio < 0.6) {
      snapLeft = '50%';
    } else if (ratio >= 0.6 && ratio < 0.8) {
      snapLeft = '70%';
    } else {
      snapLeft = '90%';
    }
    
    setHoveredSpacerPos({ id: spacerId, left: snapLeft });
  };

  const handleSpacerMouseLeave = () => {
    setHoveredSpacerPos(null);
  };

  const renderHoverTgSpacerRow = (phaseId: number) => {
    const dynamicCols = getDynamicColumns();
    const spacerId = `spacer-tg-${phaseId}`;
    const snappedPos = hoveredSpacerPos?.id === spacerId ? hoveredSpacerPos.left : '50%';

    const handleAddTgClick = () => {
      setAddingTaskGroupPhaseId(phaseId);
      setNewTgForm({ name: '', manday_est: '', status: 'Waiting', start_date_est: '' });
    };

    return (
      <tr 
        key={spacerId} 
        className="group/spacer border-none bg-transparent"
      >
        <td colSpan={dynamicCols.length + 1} className="p-0 border-none bg-transparent relative">
          <div 
            onMouseEnter={(e) => handleSpacerMouseEnter(e, spacerId)}
            onMouseLeave={handleSpacerMouseLeave}
            className="relative flex items-center h-2 hover:h-11 transition-all duration-200 group-hover/spacer:bg-slate-50/20"
          >
            {/* Dashed line */}
            <div className="absolute inset-x-4 flex items-center pointer-events-none w-[calc(100%-2rem)]">
              <div className="w-full border-t border-slate-300 border-dashed opacity-0 group-hover/spacer:opacity-100 transition-opacity duration-200"></div>
            </div>
            {/* Emerald pill button */}
            <button
              type="button"
              onClick={handleAddTgClick}
              style={{ left: snappedPos, transform: 'translateX(-50%)' }}
              className="absolute opacity-0 group-hover/spacer:opacity-100 transition-all duration-200 bg-[#006847] hover:bg-[#00583b] text-white font-bold text-[10px] px-3.5 py-1.5 rounded-full shadow-md flex items-center gap-1 active:scale-95 z-10 cursor-pointer hover:shadow-lg hover:scale-105"
            >
              <span className="text-[12px] font-extrabold">+</span> Thêm Task Group
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const renderHoverSpacerRow = (groupId: number, afterCode: string | null, level: number, isLast: boolean) => {
    const dynamicCols = getDynamicColumns();
    const spacerId = `spacer-${groupId}-${afterCode || 'root'}-${isLast ? 'last' : 'mid'}`;
    const snappedPos = hoveredSpacerPos?.id === spacerId ? hoveredSpacerPos.left : '50%';

    const handleAddClick = () => {
      setAddingTaskGroupId(groupId);
      const parentCode = afterCode ? (getParentCode(afterCode) || null) : null;
      setAddingTaskParentCode(parentCode);
      setAddingTaskAfterCode(afterCode);
      const todayStr = fromPickerDate(new Date().toISOString().split('T')[0]);
      const initialForm: Record<string, string> = {};
      dynamicCols.forEach(col => {
        const colUpper = col.toUpperCase().trim();
        if (colUpper === 'STATUS') {
          initialForm[col] = 'Waiting';
        } else if (colUpper === 'PRIORITY') {
          initialForm[col] = 'Normal';
        } else if (colUpper === 'START DATE') {
          initialForm[col] = todayStr;
        } else if (colUpper === 'KPI RATIO') {
          initialForm[col] = '100/0';
        } else if (colUpper === 'MANDAY EST') {
          initialForm[col] = '1.0';
        } else {
          initialForm[col] = '';
        }
      });
      setNewForm(initialForm);
    };

    return (
      <tr 
        key={spacerId} 
        className="group/spacer border-none bg-transparent"
      >
        <td colSpan={dynamicCols.length + 1} className="p-0 border-none bg-transparent relative">
          <div 
            onMouseEnter={(e) => handleSpacerMouseEnter(e, spacerId)}
            onMouseLeave={handleSpacerMouseLeave}
            className="relative flex items-center h-2 hover:h-11 transition-all duration-200 group-hover/spacer:bg-slate-50/20"
          >
            {/* Dashed line */}
            <div className="absolute inset-x-4 flex items-center pointer-events-none w-[calc(100%-2rem)]">
              <div className="w-full border-t border-slate-300 border-dashed opacity-0 group-hover/spacer:opacity-100 transition-opacity duration-200"></div>
            </div>
            {/* Teal/emerald pill button */}
            <button
              type="button"
              onClick={handleAddClick}
              style={{ left: snappedPos, transform: 'translateX(-50%)' }}
              className="absolute opacity-0 group-hover/spacer:opacity-100 transition-all duration-200 bg-[#006847] hover:bg-[#00583b] text-white font-bold text-[10px] px-3.5 py-1.5 rounded-lg shadow-md flex items-center gap-1 active:scale-95 z-10 cursor-pointer hover:shadow-lg hover:scale-105"
            >
              <span className="text-[12px] font-extrabold">+</span> Thêm Task
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const renderSingleTaskRow = (task: any, level: number, hasChildren: boolean, isCollapsedParent: boolean) => {
    const dynamicCols = getDynamicColumns();
    const taskIdVal = task.task_code || '';
    const isSubTask = level > 0;

    const handleStartEdit = (colName: string, currentVal: string) => {
      setEditingCell({ taskId: task.id, colName });
      const colUpper = colName.toUpperCase().trim();
      if (colUpper === 'ASSIGNED') {
        setEditValue(task.assigned_id ? String(task.assigned_id) : '');
      } else if (colUpper === 'SUPPORT') {
        setEditValue(task.support_id ? String(task.support_id) : '');
      } else if (colUpper === 'SKILL SOLUTION') {
        setEditValue(task.skill_solution_id ? String(task.skill_solution_id) : '');
      } else if (colUpper === 'SKILL VENDOR') {
        setEditValue(task.skill_vendor_id ? String(task.skill_vendor_id) : '');
      } else {
        setEditValue(currentVal);
      }
    };

    const rowBgClass = isSubTask 
      ? "bg-[#fafbfc]/70 hover:bg-[#eff4ff]/60" 
      : "bg-[#f8fafc] hover:bg-[#f1f5f9] font-bold border-l-4 border-l-slate-400";

    const cellStyle = "px-4 py-2 border-r border-slate-100 last:border-r-0 text-left align-middle text-xs";

    return (
      <tr 
        id={`task-row-${task.id}`}
        key={task.id} 
        className={`group relative transition-colors border-b border-slate-200/60 ${rowBgClass}`}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/json", JSON.stringify({ type: "task", taskId: task.id, groupId: task.task_group_id }));
        }}
        onDragEnd={(e) => {
          const el = document.getElementById(`task-row-${task.id}`);
          if (el) el.setAttribute('draggable', 'false');
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("bg-slate-100");
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove("bg-slate-100");
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("bg-slate-100");
          try {
            const raw = e.dataTransfer.getData("application/json");
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.type === "task") {
              if (data.groupId === task.task_group_id) {
                const groupTasks = items.filter(t => t.task_group_id === task.task_group_id);
                const sorted = buildTaskTree(groupTasks);
                const fromIdx = sorted.findIndex(t => t.id === data.taskId);
                const toIdx = sorted.findIndex(t => t.id === task.id);
                if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                  const reordered = [...sorted];
                  const [removed] = reordered.splice(fromIdx, 1);
                  reordered.splice(toIdx, 0, removed);
                  await reorderTasks(task.task_group_id, reordered.map(t => t.id));
                  flash("Đã đổi thứ tự Task thành công!");
                  reloadAll();
                }
              } else {
                await moveTask(data.groupId, data.taskId, task.task_group_id);
                flash(`Đã di chuyển task sang nhóm mới thành công!`);
                reloadAll();
              }
            }
          } catch (err: any) {
            console.error(err);
          }
        }}
      >
        {/* ACTIONS */}
        <td className="px-1 py-1.5 text-center" style={{ width: '130px', minWidth: '130px' }}>
          <div className="flex items-center justify-center gap-1.5 text-slate-500">
            {/* 1. Drag Handle / Move Task (Always visible, clickable) */}
            <button 
              type="button"
              onMouseDown={() => {
                const el = document.getElementById(`task-row-${task.id}`);
                if (el) el.setAttribute('draggable', 'true');
              }}
              onMouseUp={() => {
                const el = document.getElementById(`task-row-${task.id}`);
                if (el) el.setAttribute('draggable', 'false');
              }}
              onClick={() => handleMoveTask(task.task_group_id, task.id)}
              className="flex items-center justify-center w-5 h-5 cursor-grab active:cursor-grabbing hover:bg-slate-200 rounded text-slate-400 font-bold"
              title="Di chuyển task sang group khác"
            >
              <span>☰</span>
            </button>

            {/* 2. View details / AI Compliance (Hover visible) */}
            <button
              type="button"
              onClick={async () => {
                setCheckingTaskId(task.id);
                try {
                  flash('AI kiểm tra tuân thủ hoàn tất!');
                } finally {
                  setCheckingTaskId(null);
                }
              }}
              disabled={checkingTaskId === task.id}
              className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 text-slate-400 disabled:opacity-50"
              title="Kiểm tra tuân thủ AI"
            >
              {checkingTaskId === task.id ? (
                <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span>🔍</span>
              )}
            </button>

            {/* 3. Duplicate Task (Hover visible) */}
            <button
              type="button"
              onClick={() => handleDuplicateTask(task.task_group_id, task.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 text-slate-400"
              title="Nhân bản Task"
            >
              <span>📄</span>
            </button>

            {/* 4. Delete Task (Hover visible) */}
            <button
              type="button"
              onClick={() => setTaskToDelete(task.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 text-slate-400"
              title="Xóa Task"
            >
              <span>🗑️</span>
            </button>
          </div>
        </td>

        {/* DYNAMIC CELLS */}
        {dynamicCols.map((col) => {
          const val = getCellValue(task, col);
          const colUpper = col.toUpperCase().trim();
          const isEditing = editingCell?.taskId === task.id && editingCell?.colName === col;

          if (isEditing) {
            if (colUpper === 'STATUS') {
              return (
                <td key={col} className="px-2 py-1 min-w-[110px]">
                  <select
                    value={editValue}
                    autoFocus
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => handleCellSave(task.id, col, editValue)}
                    className="w-full bg-white border border-[#0058be] rounded px-1 py-0.5 text-xs text-[#0b1c30] focus:outline-none font-semibold"
                  >
                    {dbStatuses.length === 0 ? (
                      <>
                        <option value="Todo">Todo</option>
                        <option value="Waiting">Waiting</option>
                        <option value="Process">Process</option>
                        <option value="Done">Done</option>
                        <option value="Cancel">Cancel</option>
                      </>
                    ) : (
                      dbStatuses.map((st: any) => (
                        <option key={st.id} value={st.name}>{st.name}</option>
                      ))
                    )}
                  </select>
                </td>
              );
            }

            if (colUpper === 'PRIORITY') {
              return (
                <td key={col} className="px-2 py-1 min-w-[110px]">
                  <select
                    value={editValue}
                    autoFocus
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => handleCellSave(task.id, col, editValue)}
                    className="w-full bg-white border border-[#0058be] rounded px-1 py-0.5 text-xs text-[#0b1c30] focus:outline-none font-semibold"
                  >
                    {dbPriorities.length === 0 ? (
                      <>
                        <option value="Normal">Normal</option>
                        <option value="High">High</option>
                        <option value="Critical">Critical</option>
                      </>
                    ) : (
                      dbPriorities.map((pr: any) => (
                        <option key={pr.id} value={pr.name}>{pr.name}</option>
                      ))
                    )}
                  </select>
                </td>
              );
            }

            if (colUpper === 'ASSIGNED' || colUpper === 'SUPPORT') {
              return (
                <td key={col} className="px-2 py-1 min-w-[155px]">
                  <select
                    value={editValue}
                    autoFocus
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => handleCellSave(task.id, col, editValue)}
                    className="w-full bg-white border border-[#0058be] rounded px-1 py-0.5 text-xs text-[#0b1c30] focus:outline-none font-semibold"
                  >
                    <option value="">-- Chọn thành viên --</option>
                    {projectMembers.map((m: any) => (
                      <option key={m.id} value={m.id}>{m.display_name}</option>
                    ))}
                  </select>
                </td>
              );
            }

            if (colUpper === 'SKILL SOLUTION') {
              const activeGroups = categories
                .filter(c => c.is_active)
                .flatMap(c => c.groups || []);
              
              return (
                <td key={col} className="px-2 py-1 min-w-[150px]">
                  <select
                    value={editValue}
                    autoFocus
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => handleCellSave(task.id, col, editValue)}
                    className="w-full bg-white border border-[#0058be] rounded px-1 py-0.5 text-xs text-[#0b1c30] focus:outline-none font-semibold"
                  >
                    <option value="">-- Chọn Group --</option>
                    {activeGroups.map((g: any) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </td>
              );
            }

            if (colUpper === 'SKILL VENDOR') {
              const currentGroupId = task.skill_solution_id;
              let availableSkills: any[] = [];
              if (currentGroupId) {
                const groupObj = categories
                  .filter(c => c.is_active)
                  .flatMap(c => c.groups || [])
                  .find((g: any) => g.id === currentGroupId);
                if (groupObj) {
                  availableSkills = (groupObj.skills || []).filter((s: any) => s.is_active);
                }
              } else {
                availableSkills = categories
                  .filter(c => c.is_active)
                  .flatMap(c => c.groups || [])
                  .flatMap((g: any) => g.skills || [])
                  .filter((s: any) => s.is_active);
              }

              return (
                <td key={col} className="px-2 py-1 min-w-[150px]">
                  <select
                    value={editValue}
                    autoFocus
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => handleCellSave(task.id, col, editValue)}
                    className="w-full bg-white border border-[#0058be] rounded px-1 py-0.5 text-xs text-[#0b1c30] focus:outline-none font-semibold"
                  >
                    <option value="">-- Chọn Skill --</option>
                    {availableSkills.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </td>
              );
            }

            return (
              <td key={col} className="px-2 py-1">
                <input
                  type="text"
                  value={editValue}
                  autoFocus
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCellSave(task.id, col, editValue);
                    if (e.key === 'Escape') setEditingCell(null);
                  }}
                  onBlur={() => handleCellSave(task.id, col, editValue)}
                  className="w-full bg-white border border-[#0058be] rounded px-1.5 py-0.5 text-xs text-[#0b1c30] focus:outline-none"
                />
              </td>
            );
          }

          let cellContent: React.ReactNode = val;

          if (colUpper === 'STATUS') {
            const info = getStatusInfo(val);
            cellContent = (
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${info.bg} border-current/10 shrink-0 shadow-sm`}>
                <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />
                {info.label}
              </span>
            );
          } else if (colUpper === 'PRIORITY') {
            const style = getPriorityStyle(val);
            cellContent = (
              <span className={`inline-block px-2.5 py-0.5 rounded-md border text-[10px] font-bold tracking-wide uppercase ${style}`}>
                {val || 'Normal'}
              </span>
            );
          } else if (colUpper === 'TASK ID') {
            cellContent = (
              <div className="flex items-center gap-1.5" style={{ paddingLeft: `${level * 16}px` }}>
                {hasChildren && (
                  <span 
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleParentCollapse(taskIdVal);
                    }}
                    className="cursor-pointer select-none text-[12px] p-0.5 hover:bg-slate-200 rounded font-normal text-slate-500 inline-flex items-center justify-center w-4 h-4 transition-transform duration-200"
                  >
                    {isCollapsedParent ? '▶' : '▼'}
                  </span>
                )}
                {!hasChildren && level > 0 && (
                  <span className="w-4 h-4 inline-block shrink-0" />
                )}
                <span className={`font-mono text-slate-700 ${!isSubTask ? 'font-bold' : 'text-slate-500 font-medium'}`}>
                  {val}
                </span>
              </div>
            );
          } else if (colUpper === 'DETAIL TASK') {
            cellContent = (
              <div className="flex items-center gap-1">
                {isSubTask && (
                  <span className="text-slate-400 font-mono select-none mr-1.5 inline-block shrink-0">
                    ├──
                  </span>
                )}
                <span className={`line-clamp-2 ${!isSubTask ? 'font-bold text-slate-900 text-[13px]' : 'text-slate-700 font-normal text-[12px]'}`}>
                  {val}
                </span>
              </div>
            );
          } else if (colUpper === 'KPI FINAL') {
            const s = (task.status || '').toLowerCase();
            const isDone = s === 'done' || s === 'completed' || s.includes('hoàn');
            if (isDone) {
              cellContent = (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-extrabold border border-emerald-200 shadow-sm" title="KPI Final được ghi nhận">
                  ✓ {val}
                </span>
              );
            } else {
              cellContent = (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-200 shadow-sm" title="KPI Final Pending (Chờ task hoàn thành)">
                  ⏳ {val}
                </span>
              );
            }
          }

          const isNumericOrDate = colUpper.includes('MANDAY') || colUpper.includes('DATE') || colUpper.includes('RATIO') || colUpper.includes('ID');

          const SYSTEM_COLS = [
            'TASK ID', 'END DATE EST', 'MD ACTUAL', 'DAYS LATE',
            'KPI BASE', 'KPI PERFORM', 'KPI OVERTIME', 'KPI FINAL', 'SUB ID', 'SOLUTION'
          ];
          const isReadOnly = SYSTEM_COLS.includes(colUpper);

          return (
            <td
              key={col}
              className={`${cellStyle} ${isReadOnly ? 'bg-[#f8fafc]/50 cursor-default' : 'cursor-pointer hover:bg-slate-100/80 group'} ${isNumericOrDate ? 'font-mono text-[#0b1c30] font-semibold' : 'text-[#565e74]'}`}
              onDoubleClick={() => {
                if (!isReadOnly) handleStartEdit(col, val);
              }}
            >
              <div className="flex items-center justify-between w-full">
                {cellContent}
                {!isReadOnly && (
                  <span className="opacity-0 group-hover:opacity-40 text-[10px] transition-opacity shrink-0">✏️</span>
                )}
              </div>
            </td>
          );
        })}
      </tr>
    );
  };

  const renderRows = () => {
    if (loadingTasks) {
      return (
        <tr>
          <td colSpan={getDynamicColumns().length + 1} className="text-center py-16 text-[#565e74]">
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" /> Đang tải...
            </div>
          </td>
        </tr>
      );
    }

    const phasesToRender = activePhase === 'ALL' 
      ? phases.filter(p => !p.is_master)
      : phases.filter(p => p.name === activePhase);

    if (phasesToRender.length === 0) {
      return (
        <tr>
          <td colSpan={getDynamicColumns().length + 1} className="text-center py-16 text-[#565e74] font-medium">
            Chưa có Giai đoạn (Phase) nào. Hãy click "Thêm Phase" để bắt đầu.
          </td>
        </tr>
      );
    }

    // Columns NOT applicable to Task Group (show as disabled/empty)
    const GROUP_DISABLED_COLS = [
      'PRIORITY', 'ASSIGNED', 'SUPPORT', 'KPI RATIO', 'SKILL SOLUTION', 'SKILL VENDOR',
      'TICKET ID', 'REMARK', 'SEND', 'KPI BASE', 'KPI PERFORM', 'KPI OVERTIME', 'KPI FINAL',
      'DAYS LATE', 'SUB ID', 'ROOT TASKS', 'SOLUTION', 'NOTES'
    ];
    // Editable columns for Task Group
    const GROUP_EDITABLE_COLS = ['DETAIL TASK', 'MANDAY EST', 'STATUS', 'START DATE'];
    // Auto columns for Task Group
    const GROUP_AUTO_COLS = ['END DATE EST', 'MD ACTUAL', 'END ACTUAL'];

    const getGroupCellValue = (group: any, colUpper: string): string => {
      switch (colUpper) {
        case 'TASK ID': return group.roman_index || 'I';
        case 'DETAIL TASK': return group.name || '';
        case 'MANDAY EST':
        case 'MANDAY (EST)':
        case 'MANDAY': return group.manday_est != null ? String(group.manday_est) : '';
        case 'STATUS': return group.status || 'Waiting';
        case 'START DATE':
        case 'START DATE (EST)': return group.start_date_est || '';
        case 'END DATE EST':
        case 'END DAY (EST)':
        case 'END DATE (EST)': return group.end_date_est || '';
        case 'MD ACTUAL':
        case 'MANDAY ACTUAL': return group.manday_actual != null ? String(group.manday_actual) : '';
        case 'END ACTUAL':
        case 'END DATE ACTUAL': return group.end_date_actual || '';
        default: return '';
      }
    };

    const handleGroupCellSave = async (group: any, colName: string, value: string) => {
      const colUpper = colName.trim().toUpperCase();
      const payload: Record<string, any> = {};
      switch (colUpper) {
        case 'DETAIL TASK': payload.name = value; break;
        case 'MANDAY EST':
        case 'MANDAY (EST)':
        case 'MANDAY': payload.manday_est = value ? parseFloat(value) : null; break;
        case 'STATUS': payload.status = value; break;
        case 'START DATE':
        case 'START DATE (EST)': payload.start_date_est = value || null; break;
        default: return;
      }
      try {
        await updateTaskGroup(group.phase_id, group.id, payload);
        flash('Đã cập nhật Task Group!');
        reloadAll();
      } catch (err: any) {
        alert('Lỗi cập nhật: ' + (err.response?.data?.detail || err.message));
      } finally {
        setEditingCell(null);
      }
    };

    const renderInlineAddGroupRow = (phaseId: number, romanIndex: string) => {
      const dynamicCols = getDynamicColumns();

      const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          handleSaveInlineTaskGroup(phaseId);
        } else if (e.key === 'Escape') {
          setAddingTaskGroupPhaseId(null);
        }
      };

      const handleBlurEvent = (e: React.FocusEvent) => {
        const currentTarget = e.currentTarget;
        setTimeout(() => {
          if (!currentTarget.contains(document.activeElement)) {
            handleSaveInlineTaskGroup(phaseId);
          }
        }, 150);
      };

      return (
        <tr
          key={`inline-add-tg-${phaseId}`}
          className="bg-[#f0f4ff] border-l-4 border-l-indigo-500 border-b border-indigo-200"
          onBlur={handleBlurEvent}
        >
          {/* Action Column */}
          <td className="px-1 py-2 text-center" style={{ width: '130px', minWidth: '130px' }}>
            <span className="text-[10px] text-indigo-600 font-bold">Thêm Group...</span>
          </td>

          {dynamicCols.map(col => {
            const colUpper = col.trim().toUpperCase();
            
            // Task ID
            if (colUpper === 'TASK ID') {
              return (
                <td key={col} className="px-4 py-2 font-black text-indigo-800 text-[13px] bg-slate-50/50">
                  {romanIndex}
                </td>
              );
            }

            // Detail Task
            if (colUpper === 'DETAIL TASK' || colUpper === 'TASK' || colUpper === 'DESCRIPTION') {
              return (
                <td key={col} className="px-2 py-1.5">
                  <input
                    type="text"
                    required
                    value={newTgForm.name}
                    onChange={e => setNewTgForm(prev => ({ ...prev, name: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    placeholder="Nhập tên Task Group (Bắt buộc)..."
                    className="w-full bg-white border border-indigo-500 text-[#0b1c30] px-2 py-1 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
                    autoFocus
                  />
                </td>
              );
            }

            // Manday EST
            if (colUpper === 'MANDAY EST' || colUpper === 'MANDAY' || colUpper === 'MANDAY (EST)') {
              return (
                <td key={col} className="px-2 py-1.5">
                  <input
                    type="text"
                    value={newTgForm.manday_est}
                    onChange={e => setNewTgForm(prev => ({ ...prev, manday_est: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    placeholder="EST Manday..."
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-2 py-1 rounded text-xs focus:outline-none focus:border-indigo-500 font-bold"
                  />
                </td>
              );
            }

            // Status
            if (colUpper === 'STATUS') {
              return (
                <td key={col} className="px-2 py-1.5">
                  <select
                    value={newTgForm.status}
                    onChange={e => setNewTgForm(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-2 py-1 rounded text-xs focus:outline-none focus:border-indigo-500 font-bold"
                  >
                    <option value="Waiting">Waiting</option>
                    <option value="Process">Process</option>
                    <option value="Done">Done</option>
                    <option value="Cancel">Cancel</option>
                  </select>
                </td>
              );
            }

            // Start Date
            if (colUpper === 'START DATE' || colUpper === 'START DATE (EST)') {
              return (
                <td key={col} className="px-2 py-1.5">
                  <input
                    type="date"
                    value={newTgForm.start_date_est}
                    onChange={e => setNewTgForm(prev => ({ ...prev, start_date_est: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-2 py-1 rounded text-xs focus:outline-none focus:border-indigo-500 font-bold"
                  />
                </td>
              );
            }

            // Auto columns
            if (['END DATE EST', 'MANDAY ACTUAL', 'END ACTUAL', 'MD ACTUAL', 'END DATE (EST)', 'END DAY (EST)', 'END DATE ACTUAL', 'MANDAY ACTUAL'].includes(colUpper)) {
              return (
                <td key={col} className="px-4 py-2 text-slate-400 font-mono text-center bg-slate-50/20 text-[10px]">
                  Auto
                </td>
              );
            }

            // Other columns not applicable to Task Group
            return (
              <td key={col} className="px-4 py-2 bg-slate-100/50 text-slate-300 text-center select-none">
                -
              </td>
            );
          })}
        </tr>
      );
    };

    const result: React.ReactNode[] = [];

    phasesToRender.forEach(phase => {
      const groupsInPhase = taskGroups.filter(g => g.phase_id === phase.id);

      // Phase header (ALWAYS rendered)
      result.push(
        <tr 
          key={`phase-hdr-${phase.id}`} 
          className="bg-[#e2e8f0] border-l-[6px] border-l-[#475569] border-b border-[#c2c6d6]/40 transition-colors duration-150"
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("bg-indigo-100");
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove("bg-indigo-100");
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("bg-indigo-100");
            try {
              const raw = e.dataTransfer.getData("application/json");
              if (!raw) return;
              const data = JSON.parse(raw);
              if (data.type === "group" && data.phaseId !== phase.id) {
                await moveTaskGroup(data.phaseId, data.groupId, phase.id);
                flash(`Đã di chuyển Task Group sang Phase "${phase.name}" thành công!`);
                reloadAll();
              }
            } catch (err: any) {
              console.error(err);
            }
          }}
        >
          <td className="px-2 py-2.5 text-center"></td>
          <td colSpan={getDynamicColumns().length} className="px-4 py-2.5">
            <span className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider">
              GIAI ĐOẠN: {phase.name}
            </span>
          </td>
        </tr>
      );

      if (groupsInPhase.length === 0) {
        if (addingTaskGroupPhaseId === phase.id) {
          result.push(renderInlineAddGroupRow(phase.id, 'I'));
        } else {
          result.push(renderHoverTgSpacerRow(phase.id));
        }
        return;
      }

      groupsInPhase.forEach((group, gIdx) => {
        const isCollapsed = collapsedGroups.has(group.id);
        const groupTasks = items.filter(t => t.task_group_id === group.id);
        const filteredTasks = taskSearch
          ? groupTasks.filter(t => (t.detail || '').toLowerCase().includes(taskSearch.toLowerCase()))
          : groupTasks;
        const dynamicCols = getDynamicColumns();

        // ═══ TASK GROUP ROW (rendered as table row) ═══
        result.push(
          <tr 
            id={`tg-row-${group.id}`}
            key={`tg-row-${group.id}`} 
            className="bg-[#eef2ff] hover:bg-[#e0e7ff] border-b border-[#c7d2fe] border-l-4 border-l-indigo-500 group transition-colors"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/json", JSON.stringify({ type: "group", groupId: group.id, phaseId: group.phase_id }));
            }}
            onDragEnd={(e) => {
              const el = document.getElementById(`tg-row-${group.id}`);
              if (el) el.setAttribute('draggable', 'false');
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add("bg-indigo-100");
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove("bg-indigo-100");
            }}
            onDrop={async (e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("bg-indigo-100");
              try {
                const raw = e.dataTransfer.getData("application/json");
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data.type === "group") {
                  const phaseGroups = taskGroups.filter(g => g.phase_id === group.phase_id);
                  const fromIdx = phaseGroups.findIndex(g => g.id === data.groupId);
                  const toIdx = phaseGroups.findIndex(g => g.id === group.id);
                  if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                    const reordered = [...phaseGroups];
                    const [removed] = reordered.splice(fromIdx, 1);
                    reordered.splice(toIdx, 0, removed);
                    await reorderTaskGroups(group.phase_id, reordered.map(g => g.id));
                    flash("Đã đổi thứ tự Task Group thành công!");
                    reloadAll();
                  }
                } else if (data.type === "task") {
                  if (data.groupId !== group.id) {
                    await moveTask(data.groupId, data.taskId, group.id);
                    flash(`Đã chuyển task vào nhóm "${group.name}" thành công!`);
                    reloadAll();
                  }
                }
              } catch (err: any) {
                console.error(err);
              }
            }}
          >
            {/* Actions column */}
            <td className="px-1 py-1.5 text-center" style={{ width: '130px', minWidth: '130px' }}>
              <div className="flex items-center justify-center gap-1.5 text-[12px] select-none">
                {/* 1. Toggle Expand/Collapse (Always visible) */}
                <button
                  type="button"
                  onClick={() => toggleGroupCollapse(group.id)}
                  className="flex items-center justify-center w-5 h-5 rounded hover:bg-indigo-200 text-indigo-700 font-bold"
                  title={isCollapsed ? 'Mở rộng' : 'Thu gọn'}
                >
                  <span>{isCollapsed ? '▶' : '▼'}</span>
                </button>

                {/* 2. Drag Handle / Move Task Group (Always visible, clickable) */}
                <button 
                  type="button"
                  onMouseDown={() => {
                    const el = document.getElementById(`tg-row-${group.id}`);
                    if (el) el.setAttribute('draggable', 'true');
                  }}
                  onMouseUp={() => {
                    const el = document.getElementById(`tg-row-${group.id}`);
                    if (el) el.setAttribute('draggable', 'false');
                  }}
                  onClick={() => handleMoveTaskGroup(group.phase_id, group.id)}
                  className="flex items-center justify-center w-5 h-5 cursor-grab active:cursor-grabbing hover:bg-indigo-200 rounded text-slate-400 font-bold"
                  title="Di chuyển Task Group sang Phase khác"
                >
                  <span>☰</span>
                </button>

                {/* 3. Add Task (Hover visible) */}
                <button
                  type="button"
                  onClick={() => {
                    setAddingTaskGroupId(group.id);
                    setAddingTaskParentCode(null);
                    const initialForm: Record<string, string> = {};
                    dynamicCols.forEach(col => { initialForm[col] = ''; });
                    if (dynamicCols.find(c => c.toUpperCase() === 'STATUS')) {
                      initialForm['STATUS'] = 'Waiting';
                    }
                    setNewForm(initialForm);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded hover:bg-indigo-200 text-slate-400"
                  title="Thêm Task con"
                >
                  <span>➕</span>
                </button>

                {/* 4. Edit Task Group Name (Hover visible) */}
                <button
                  type="button"
                  onClick={() => {
                    const detailCol = dynamicCols.find(c => ['DETAIL TASK', 'TASK', 'DESCRIPTION'].includes(c.toUpperCase().trim())) || 'Detail Task';
                    const groupVal = getGroupCellValue(group, detailCol.toUpperCase().trim());
                    setEditingCell({ taskId: -group.id, colName: detailCol });
                    setEditValue(groupVal);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded hover:bg-indigo-200 text-slate-400"
                  title="Chỉnh sửa Task Group"
                >
                  <span>✏️</span>
                </button>

                {/* 5. Delete Task Group (Hover visible) */}
                <button
                  type="button"
                  onClick={() => handleDeleteTaskGroupClick(group)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded hover:bg-indigo-200 text-slate-400"
                  title="Xóa Task Group"
                >
                  <span>🗑️</span>
                </button>
              </div>
            </td>

            {/* Dynamic columns — rendered inline */}
            {dynamicCols.map((col) => {
              const colUpper = col.toUpperCase().trim();
              const val = getGroupCellValue(group, colUpper);
              const isDisabled = GROUP_DISABLED_COLS.includes(colUpper);
              const isEditable = GROUP_EDITABLE_COLS.includes(colUpper);
              const isAuto = GROUP_AUTO_COLS.includes(colUpper);
              const isTaskId = colUpper === 'TASK ID' || colUpper === 'TASKID' || colUpper === 'ID';
              const isEditing = editingCell?.taskId === -group.id && editingCell?.colName === col;

              // TASK ID = Roman numeral
              if (isTaskId) {
                return (
                  <td key={col} className="px-4 py-2.5 text-[13px] font-black text-indigo-800 whitespace-nowrap">
                    {group.roman_index || to_roman(gIdx + 1)}
                  </td>
                );
              }

              // Disabled columns — show dash
              if (isDisabled) {
                return (
                  <td key={col} className="px-4 py-2.5 text-center text-slate-300 text-xs select-none">—</td>
                );
              }

              // Inline edit for editable columns
              if (isEditing) {
                if (colUpper === 'STATUS') {
                  return (
                    <td key={col} className="px-2 py-1 min-w-[110px]">
                      <select
                        value={editValue}
                        autoFocus
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => handleGroupCellSave(group, col, editValue)}
                        className="w-full bg-white border border-indigo-500 rounded px-1 py-0.5 text-xs text-[#0b1c30] focus:outline-none font-bold"
                      >
                        {dbStatuses.length === 0 ? (
                          <>
                            <option value="Waiting">Waiting</option>
                            <option value="Process">Process</option>
                            <option value="Done">Done</option>
                            <option value="Cancel">Cancel</option>
                          </>
                        ) : (
                          dbStatuses.map((st: any) => (
                            <option key={st.id} value={st.name}>{st.name}</option>
                          ))
                        )}
                      </select>
                    </td>
                  );
                }
                if (colUpper.includes('DATE')) {
                  return (
                    <td key={col} className="px-2 py-1 min-w-[130px]">
                      <input
                        type="date"
                        value={editValue ? toPickerDate(editValue) : ''}
                        autoFocus
                        onChange={e => setEditValue(fromPickerDate(e.target.value))}
                        onBlur={() => handleGroupCellSave(group, col, editValue)}
                        onKeyDown={e => { if (e.key === 'Enter') handleGroupCellSave(group, col, editValue); if (e.key === 'Escape') setEditingCell(null); }}
                        className="w-full bg-white border border-indigo-500 rounded px-1 py-0.5 text-xs font-mono focus:outline-none font-bold"
                      />
                    </td>
                  );
                }
                // Text / Number input
                return (
                  <td key={col} className="px-2 py-1">
                    <input
                      type={colUpper.includes('MANDAY') ? 'number' : 'text'}
                      step={colUpper.includes('MANDAY') ? 'any' : undefined}
                      value={editValue}
                      autoFocus
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => handleGroupCellSave(group, col, editValue)}
                      onKeyDown={e => { if (e.key === 'Enter') handleGroupCellSave(group, col, editValue); if (e.key === 'Escape') setEditingCell(null); }}
                      className="w-full bg-white border border-indigo-500 rounded px-1.5 py-0.5 text-xs focus:outline-none font-bold"
                    />
                  </td>
                );
              }

              // Display mode
              const cellStyle = "px-4 py-2.5 text-xs font-bold text-[#1e293b] whitespace-nowrap";
              let displayContent: React.ReactNode = val || '';

              // Status badge
              if (colUpper === 'STATUS' && val) {
                const si = getStatusInfo(val);
                displayContent = (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold ${si.bg}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${si.dot}`} />
                    {si.label}
                  </span>
                );
              }

              // Detail Task — bold with group icon
              if (colUpper === 'DETAIL TASK') {
                displayContent = (
                  <span className="text-[12px] font-black text-[#0f172a]">{val}</span>
                );
              }

              return (
                <td
                  key={col}
                  className={`${cellStyle} ${isEditable ? 'cursor-pointer hover:bg-indigo-100/60 group' : (isAuto ? 'text-slate-500 font-mono' : '')}`}
                  onDoubleClick={() => {
                    if (isEditable) {
                      setEditingCell({ taskId: -group.id, colName: col });
                      setEditValue(val);
                    }
                  }}
                >
                  <div className="flex items-center justify-between w-full">
                    {displayContent}
                    {isEditable && (
                      <span className="opacity-0 group-hover:opacity-40 text-[10px] transition-opacity shrink-0">✏️</span>
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        );

        // Skip tasks if collapsed
        if (isCollapsed) {
          return;
        }

        // ═══ TASK ROWS (child rows) ═══
        const sortedTasks = buildTaskTree(filteredTasks);

        sortedTasks.forEach((task, tIdx) => {
          if (isAncestorCollapsed(task.task_code)) {
            return;
          }

          const hasChildren = sortedTasks.some(t => getParentCode(t.task_code) === task.task_code);
          const isCollapsedParent = collapsedParents.has(task.task_code);
          const dotCount = (task.task_code || '').split('.').length - 1;
          const level = Math.max(0, dotCount);

          result.push(renderSingleTaskRow(task, level, hasChildren, isCollapsedParent));

          // 1. Render inline add row at hover position if adding after this task
          if (addingTaskGroupId === group.id && addingTaskAfterCode === task.task_code) {
            result.push(renderInlineAddRow(group.id, addingTaskParentCode, level));
          }

          // 2. Render sub-task inline add row if triggered from actions menu
          if (addingTaskGroupId === group.id && addingTaskParentCode === task.task_code && addingTaskAfterCode !== task.task_code) {
            result.push(renderInlineAddRow(group.id, task.task_code, level + 1));
          }

          // Render spacer row between tasks if there is a next visible task and we aren't currently adding there
          let nextVisibleTask = null;
          for (let i = tIdx + 1; i < sortedTasks.length; i++) {
            if (!isAncestorCollapsed(sortedTasks[i].task_code)) {
              nextVisibleTask = sortedTasks[i];
              break;
            }
          }

          if (nextVisibleTask && addingTaskAfterCode !== task.task_code) {
            result.push(renderHoverSpacerRow(group.id, task.task_code, level, false));
          }
        });

        if (addingTaskGroupId === group.id && addingTaskParentCode === null && addingTaskAfterCode === null) {
          result.push(renderInlineAddRow(group.id, null, 0));
        } else if (addingTaskGroupId !== group.id || addingTaskParentCode !== null || addingTaskAfterCode !== null) {
          result.push(renderHoverSpacerRow(group.id, null, 0, true));
        }
      });

      // Inline adding or hover add trigger at the end of the phase
      if (groupsInPhase.length > 0) {
        if (addingTaskGroupPhaseId === phase.id) {
          const nextIndex = to_roman(groupsInPhase.length + 1);
          result.push(renderInlineAddGroupRow(phase.id, nextIndex));
        } else {
          result.push(renderHoverTgSpacerRow(phase.id));
        }
      }
    });

    return result;
  };
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
  const localMembersList = project.member_emails ? project.member_emails.split(',').filter(Boolean) : [];
  const memberSuggestions = Array.from(new Set([
    project.leader_email,
    project.pm_email,
    ...localMembersList
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
            <button onClick={reloadAll} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#eff4ff] border border-[#0058be]/20 hover:bg-[#eff4ff]/80 text-[#0058be] transition-all">
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
                    Phase {project.current_phase || '1. Tư vấn'}
                  </span>
                </div>
                <p className="text-[12px] text-[#565e74] mt-1">
                  Năm: {project.project_code || 'Chưa cấu hình'}
                </p>
              </div>
              <div className="flex gap-2">
                {isAdmin() && (
                  <>
                    <button 
                      onClick={() => {
                        setEditProjectName(project.name || '');
                        setEditProjectYear(project.year || (project.project_code ? parseInt(project.project_code, 10) : new Date().getFullYear()));
                        setEditCustomerName(project.customer_name || '');
                        setEditCurrentPhase(project.current_phase || '');

                        setSelectedPms(project.pm_ids || (project.pm_id ? [project.pm_id] : []));
                        setSelectedLeaders(project.technical_leader_ids || (project.technical_leader_id ? [project.technical_leader_id] : []));
                        setSelectedMembers(project.member_ids || []);

                        setShowEditProjectModal(true);
                      }}
                      className="bg-white hover:bg-slate-50 text-slate-800 px-4 py-2 rounded-lg text-[13px] font-semibold flex items-center border border-slate-200 transition-colors shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[18px] mr-2">edit</span>
                      Chỉnh sửa dự án
                    </button>
                    <button 
                      onClick={() => setShowDeleteModal(true)}
                      className="bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-lg text-[13px] font-semibold flex items-center border border-red-200 transition-colors shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[18px] mr-2">delete</span>
                      Xóa dự án
                    </button>
                  </>
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
                        <button onClick={() => setTaskSearch('')} className="text-red-600 text-xs hover:underline mr-1">Xóa</button>
                      )}
                      
                      {/* + Thêm Group Task */}
                      <button
                        onClick={() => {
                          let defaultPhaseId: number = 0;
                          if (activePhase !== 'ALL') {
                            const curPhase = phases.find(p => p.name === activePhase);
                            if (curPhase) defaultPhaseId = curPhase.id;
                          }
                          if (!defaultPhaseId && phases.length > 0) {
                            const nonMaster = phases.filter(p => !p.is_master);
                            if (nonMaster.length > 0) defaultPhaseId = nonMaster[0].id;
                          }
                          if (!defaultPhaseId) {
                            alert('Vui lòng tạo Phase trước!');
                            return;
                          }
                          setAddingTaskGroupPhaseId(defaultPhaseId);
                          setNewTgForm({ name: '', manday_est: '', status: 'Waiting', start_date_est: '' });
                        }}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 py-2 rounded-lg shadow-sm transition-all flex items-center gap-1 active:scale-95 whitespace-nowrap"
                      >
                        <span className="material-symbols-outlined text-[16px]">add_box</span>
                        Thêm Group Task
                      </button>

                      {/* + Thêm task */}
                      <button
                        onClick={() => {
                          // Find group tasks in current active phase
                          const currentPhaseGroups = activePhase === 'ALL'
                            ? taskGroups
                            : taskGroups.filter(g => {
                                const ph = phases.find(p => p.id === g.phase_id);
                                return ph && ph.name === activePhase;
                              });
                          if (currentPhaseGroups.length === 0) {
                            alert('Hãy tạo ít nhất một Task Group trước khi thêm Task!');
                            return;
                          }
                          const targetGroup = currentPhaseGroups[0];
                          setAddingTaskGroupId(targetGroup.id);
                          setAddingTaskParentCode(null);
                          const dynamicCols = getDynamicColumns();
                          const initialForm: Record<string, string> = {};
                          dynamicCols.forEach(col => { initialForm[col] = ''; });
                          const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
                          if (statusCol) initialForm[statusCol] = 'Waiting';
                          setNewForm(initialForm);
                        }}
                        className="bg-[#0058be] hover:bg-[#0058be]/95 text-white font-bold text-xs px-3 py-2 rounded-lg shadow-sm transition-all flex items-center gap-1 active:scale-95 whitespace-nowrap"
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
                            <th className="text-center px-2 py-3 text-[10px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '130px', width: '130px' }}>THAO TÁC</th>
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
                          {renderRows()}
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
                      <select
                        required
                        value={selectedMemberId}
                        onChange={e => setSelectedMemberId(e.target.value)}
                        className="flex-1 bg-white border border-[#c2c6d6] rounded-lg px-4 py-2 text-xs focus:outline-none focus:border-[#0058be]"
                      >
                        <option value="">-- Chọn thành viên muốn thêm --</option>
                        {membersList
                          .filter((u: any) => !projectMembers.some((pm: any) => pm.email === u.email))
                          .map((u: any) => (
                            <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
                          ))
                        }
                      </select>
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
                      {projectMembers.map((m: any) => {
                        const isLeader = m.role === 'Leader';
                        const isPM = m.role === 'PM';
                        const roleLabel = isLeader ? 'Technical Lead' : isPM ? 'Product Manager' : 'Member';
                        const roleClass = isLeader 
                          ? 'bg-[#eff4ff] text-[#0058be] border border-[#0058be]/10' 
                          : isPM 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' 
                            : 'bg-slate-100 text-slate-600 border border-slate-200';
                        
                        const initials = (m.display_name || '').split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();

                        return (
                          <div key={m.id} className="py-4 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-extrabold ${isLeader ? 'bg-[#eff4ff] text-[#0058be]' : isPM ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                {initials || '?'}
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-[#0b1c30]">{m.display_name}</h4>
                                <p className="text-[10px] text-slate-500 mt-0.5">{m.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase ${roleClass}`}>
                                {roleLabel}
                              </span>
                              {!isLeader && !isPM && (
                                <button
                                  onClick={async () => {
                                    try {
                                      await removeProjectMember(Number(id), m.id);
                                      loadProjectMembers();
                                      flash('Đã gỡ bỏ thành viên');
                                    } catch (err: any) {
                                      alert('Lỗi gỡ thành viên: ' + (err.response?.data?.detail || err.message));
                                    }
                                  }}
                                  className="text-slate-400 hover:text-red-600 p-1"
                                  title="Gỡ thành viên"
                                >
                                  <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {projectMembers.length === 0 && (
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

      {/* Modal Chỉnh Sửa Dự Án */}
      {showEditProjectModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3 text-[#0058be]">
                <span className="material-symbols-outlined text-[28px]">edit_document</span>
                <h3 className="text-base font-bold text-[#0b1c30]">Chỉnh sửa thông tin dự án</h3>
              </div>
              <button
                onClick={() => setShowEditProjectModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Modal Form Content */}
            <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
              {/* Row 1: Tên dự án & Năm */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Project Name */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[#565e74] block">
                    Tên dự án <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editProjectName}
                    onChange={(e) => setEditProjectName(e.target.value)}
                    placeholder="Ví dụ: Portal KPI, Web Portal..."
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all placeholder:text-[#727785] text-xs font-semibold"
                  />
                </div>

                {/* Project Year */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[#565e74] block">
                    Năm dự án <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <select
                    required
                    value={editProjectYear}
                    onChange={(e) => setEditProjectYear(parseInt(e.target.value, 10))}
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all text-xs font-semibold"
                  >
                    {Array.from({ length: 15 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 2: Khách hàng & Giai đoạn */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Customer Dropdown */}
                <div ref={customerRef} className="space-y-1 relative">
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
                    className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all cursor-pointer text-left font-semibold"
                  >
                    <span className={editCustomerName ? 'text-[#0b1c30]' : 'text-[#727785]'}>
                      {editCustomerName || 'Chọn khách hàng (Để trống nếu là dự án nội bộ)'}
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
                            setEditCustomerName('');
                            setCustomerSearch('');
                            setCustomerDropdownOpen(false);
                          }}
                          className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#eff4ff]/60 text-[#727785] rounded transition-colors"
                        >
                          Chọn khách hàng (Để trống nếu là dự án nội bộ)
                        </button>

                        {dbCustomers
                          .filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()))
                          .map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setEditCustomerName(c.name);
                                setCustomerSearch('');
                                setCustomerDropdownOpen(false);
                              }}
                              className={`w-full text-left px-2 py-1.5 text-xs hover:bg-[#eff4ff]/60 rounded transition-colors ${editCustomerName === c.name ? 'bg-[#eff4ff] text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
                            >
                              {c.name}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Phase Selection */}
                <div ref={phaseRef} className="space-y-1 relative">
                  <label className="text-[11px] font-semibold text-[#565e74] block">
                    Giai đoạn hiện tại <span className="text-rose-500 font-bold ml-0.5">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPhaseDropdownOpen(!phaseDropdownOpen);
                      setCustomerDropdownOpen(false);
                      setPmDropdownOpen(false);
                      setLeaderDropdownOpen(false);
                      setMemberDropdownOpen(false);
                    }}
                    className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] flex items-center justify-between outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all cursor-pointer text-left font-semibold"
                  >
                    <span className="text-[#0b1c30]">{editCurrentPhase || 'Chọn giai đoạn...'}</span>
                    <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                  </button>

                  {phaseDropdownOpen && (
                    <div 
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 max-h-[180px] overflow-y-auto scrollbar-thin"
                    >
                      {[
                        '1. Tư vấn', '2. Báo giá', '3. Làm specs', '4. Duyệt HSMT',
                        '5. Chờ ra thầu', '6. Tham gia thầu POP', '6. Tham gia thầu nhà phụ',
                        '7. Trúng Thầu', '7. Rớt thầu', '8. Ký hợp đồng', '9. Đặt hàng',
                        '10. Giao hàng', '11. Triển khai', '12. Hoàn thành triển khai',
                        '13. Nghiệm thu', '14. Thanh toán', '15. Kết thúc dự án', '0. Huỷ'
                      ].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            setEditCurrentPhase(p);
                            setPhaseDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-xs hover:bg-[#eff4ff]/60 transition-colors ${editCurrentPhase === p ? 'bg-[#eff4ff] text-[#0058be] font-bold' : 'text-[#0b1c30]'}`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* PM Selection */}
              <div ref={pmRef} className="space-y-1 relative">
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
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs text-[#0b1c30] flex flex-wrap gap-1.5 items-center justify-between min-h-[38px] cursor-pointer focus-within:ring-2 focus-within:ring-[#0058be]/20 focus-within:border-[#0058be] transition-all"
                >
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {selectedPms.length === 0 ? (
                      <span className="text-[#727785] px-2 py-0.5">Chọn Project Manager (PM)...</span>
                    ) : (
                      selectedPms.map(id => {
                        const m = membersList.find(x => x.id === id);
                        return (
                          <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-semibold text-[10px] flex items-center gap-1">
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
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 p-2 space-y-2 max-h-[200px] flex flex-col"
                  >
                    <input
                      type="text"
                      value={pmSearch}
                      onChange={(e) => setPmSearch(e.target.value)}
                      placeholder="Tìm kiếm PM..."
                      className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0058be]"
                    />
                    <div className="overflow-y-auto space-y-1 flex-1 max-h-[140px]">
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
              <div ref={leaderRef} className="space-y-1 relative">
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
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs text-[#0b1c30] flex flex-wrap gap-1.5 items-center justify-between min-h-[38px] cursor-pointer focus-within:ring-2 focus-within:ring-[#0058be]/20 focus-within:border-[#0058be] transition-all"
                >
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {selectedLeaders.length === 0 ? (
                      <span className="text-[#727785] px-2 py-0.5">Chọn Technical Leader...</span>
                    ) : (
                      selectedLeaders.map(id => {
                        const m = membersList.find(x => x.id === id);
                        return (
                          <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-semibold text-[10px] flex items-center gap-1">
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
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 p-2 space-y-2 max-h-[200px] flex flex-col"
                  >
                    <input
                      type="text"
                      value={leaderSearch}
                      onChange={(e) => setLeaderSearch(e.target.value)}
                      placeholder="Tìm kiếm Technical Leader..."
                      className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0058be]"
                    />
                    <div className="overflow-y-auto space-y-1 flex-1 max-h-[140px]">
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
              <div ref={memberRef} className="space-y-1 relative">
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
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs text-[#0b1c30] flex flex-wrap gap-1.5 items-center justify-between min-h-[38px] cursor-pointer focus-within:ring-2 focus-within:ring-[#0058be]/20 focus-within:border-[#0058be] transition-all"
                >
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {selectedMembers.length === 0 ? (
                      <span className="text-[#727785] px-2 py-0.5">Chọn thành viên tham gia...</span>
                    ) : (
                      selectedMembers.map(id => {
                        const m = membersList.find(x => x.id === id);
                        return (
                          <span key={id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-semibold text-[10px] flex items-center gap-1">
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
                    className="absolute left-0 right-0 mt-1.5 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 p-2 space-y-2 max-h-[200px] flex flex-col"
                  >
                    <input
                      type="text"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Tìm kiếm thành viên..."
                      className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0058be]"
                    />
                    <div className="overflow-y-auto space-y-1 flex-1 max-h-[140px]">
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

            {/* Modal Footer */}
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => setShowEditProjectModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleUpdateProject}
                disabled={savingProject}
                className="px-5 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                {savingProject ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Đang lưu...
                  </>
                ) : (
                  <>Lưu thay đổi</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Modal Tạo/Sửa Task Group */}
      {showTaskGroupModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3 text-[#0058be]">
                <span className="material-symbols-outlined text-[28px]">add_box</span>
                <h3 className="text-base font-bold text-[#0b1c30]">
                  {editingTaskGroup ? 'Chỉnh sửa Task Group' : 'Tạo Task Group mới'}
                </h3>
              </div>
              <button
                onClick={() => setShowTaskGroupModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            {/* Modal Form */}
            <form onSubmit={handleSaveTaskGroup} className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Tên Task Group *</label>
                <input
                  type="text"
                  required
                  value={tgName}
                  onChange={e => setTgName(e.target.value)}
                  placeholder="VD: Khảo sát hệ thống"
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors font-bold"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Mô tả</label>
                <textarea
                  value={tgDesc}
                  onChange={e => setTgDesc(e.target.value)}
                  placeholder="Mô tả công việc của nhóm..."
                  rows={3}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Chọn Phase *</label>
                <select
                  value={tgPhaseId}
                  onChange={e => setTgPhaseId(e.target.value ? Number(e.target.value) : '')}
                  required
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors font-bold"
                >
                  <option value="">-- Chọn Phase --</option>
                  {phases.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Trạng thái</label>
                <select
                  value={tgStatus}
                  onChange={e => setTgStatus(e.target.value)}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors font-bold"
                >
                  <option value="Waiting">Waiting</option>
                  <option value="Process">Process</option>
                  <option value="Done">Done</option>
                  <option value="Cancel">Cancel</option>
                </select>
              </div>

              <div className="bg-slate-50 px-6 py-4 -mx-6 -mb-6 mt-6 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowTaskGroupModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors shadow-sm"
                >
                  {editingTaskGroup ? 'Lưu thay đổi' : 'Tạo Task Group'}
                </button>
              </div>
            </form>
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
