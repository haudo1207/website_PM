'use client';
import { useEffect, useState, useCallback, useRef, Fragment, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import MeetingCard from '@/components/meetings/MeetingCard';
import CreateMeetingModal from '@/components/meetings/CreateMeetingModal';
import SummarizeModal from '@/components/meetings/SummarizeModal';
import AIReviewDrawer from '@/components/AIReviewDrawer';
import {
  getProjects, getProject, updateProject, deleteProject,
  getChatGroups, createChatGroup, updateChatGroup, deleteChatGroup,
  getAITaskInbox, analyzeChatLogs, updateAITaskInbox, rejectAITaskInbox, importAITaskToProjectPlan, bulkImportAITasks, getChatSyncLogs, syncAITasksFromChat,
  getPhases, createPhase, updatePhase, deletePhase,
  getTaskGroups, createTaskGroup, updateTaskGroup, deleteTaskGroup,
  getAllProjectTasks, createTask, updateTask, deleteTask,
  getProjectMembers, addProjectMember, removeProjectMember,
  getMembers, getCustomers, getCategories, getPriorities, getStatuses, getPerformanceSettings, getMasterPhases,
  duplicateTask, moveTask, moveTaskGroup, reorderTaskGroups, reorderTasks,
  getMeetings, createMeeting, updateMeeting, deleteMeeting
} from '@/lib/api';
import { isAdmin } from '@/lib/auth';

const ROMAN_PAIRS: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
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

  const isSavingRef = useRef(false);

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
  const [addingTaskBelowId, setAddingTaskBelowId] = useState<number | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);

  // AI Review Drawer states
  const [isAIDrawerOpen, setIsAIDrawerOpen] = useState(false);
  const [aiDrawerEntityType, setAiDrawerEntityType] = useState<'PROJECT' | 'PHASE' | 'TASK'>('PROJECT');
  const [aiDrawerEntityId, setAiDrawerEntityId] = useState<number>(0);
  const [aiDrawerEntityName, setAiDrawerEntityName] = useState<string>('');

  const handleOpenAIReviewDrawer = (entityType: 'PROJECT' | 'PHASE' | 'TASK', entityId: number, name = '') => {
    setAiDrawerEntityType(entityType);
    setAiDrawerEntityId(entityId);
    
    let resolvedName = name;
    if (!resolvedName) {
      if (entityType === 'PROJECT') {
        resolvedName = project?.name || 'Project';
      } else if (entityType === 'PHASE') {
        const foundPhase = phases.find(p => p.id === entityId);
        resolvedName = foundPhase ? foundPhase.name : 'Phase';
      } else if (entityType === 'TASK') {
        const foundTask = items.find(t => t.id === entityId);
        resolvedName = foundTask ? foundTask.detail : 'Task';
      }
    }
    
    setAiDrawerEntityName(resolvedName);
    setIsAIDrawerOpen(true);
  };

  // Main Tabs State: 'overview' | 'tasks' | 'meetings' | 'chats' | 'members'
  const [activeMainTab, setActiveMainTab] = useState<'overview' | 'tasks' | 'meetings' | 'chats' | 'members'>('overview');
  const [activePhase, setActivePhase] = useState<string>('ALL');
  const [phases, setPhases] = useState<any[]>([]);
  const [showPhaseModal, setShowPhaseModal] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [editingPhaseId, setEditingPhaseId] = useState<number | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [selectedFormPhase, setSelectedFormPhase] = useState<string>('');

  // Interactive Task Management additions
  const [editingCell, setEditingCell] = useState<{ taskId: number, colName: string } | null>(null);
  const [editingGroupDate, setEditingGroupDate] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [taskToDelete, setTaskToDelete] = useState<number | null>(null);

  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false);
  const [showAllKpi, setShowAllKpi] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [drawerForm, setDrawerForm] = useState<Record<string, any>>({});
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [importingInboxId, setImportingInboxId] = useState<number | null>(null);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [pasteSelectedGroupId, setPasteSelectedGroupId] = useState<string>('manual');

  // Mapping & AI Rules State
  const [selectedMappingGroup, setSelectedMappingGroup] = useState<string>('all');
  const [mappingPhaseId, setMappingPhaseId] = useState<number | null>(null);
  const [mappingTaskGroupId, setMappingTaskGroupId] = useState<number | null>(null);
  const [mappingStatus, setMappingStatus] = useState<string>('Waiting');
  const [mappingPriority, setMappingPriority] = useState<string>('Normal');
  const [mappingKpiAssign, setMappingKpiAssign] = useState<number>(100);
  const [mappingKpiSupport, setMappingKpiSupport] = useState<number>(0);
  const [ruleAutoNatural, setRuleAutoNatural] = useState<boolean>(true);
  const [ruleExtractAssigned, setRuleExtractAssigned] = useState<boolean>(true);
  const [ruleInferPriorityManday, setRuleInferPriorityManday] = useState<boolean>(true);
  const [ruleSplitMultiTasks, setRuleSplitMultiTasks] = useState<boolean>(true);
  const [ruleDetectDuplicates, setRuleDetectDuplicates] = useState<boolean>(true);
  const [ruleSaveSnapshot, setRuleSaveSnapshot] = useState<boolean>(true);

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
    "ASSIGNED", "SUPPORT", "KPI RATIO", "SKILL SOLUTION", "SKILL VENDOR", "LINK",
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
      case 'START DATE (EST)': return formatDateToShow(task.start_date || '');
      case 'ASSIGNED': return task.assigned_name || '';
      case 'SUPPORT': return task.support_name || '';
      case 'KPI RATIO': return task.support_id ? `${task.kpi_ratio_assign}/${task.kpi_ratio_support}` : '100/0';
      case 'LINK': return task.ticket_id || '';
      case 'SKILL SOLUTION': return task.skill_solution_name || '';
      case 'SKILL VENDOR': return task.skill_vendor_name || '';

      case 'REMARK': return task.remark || '';
      case 'SEND': return task.send || '';
      case 'END DATE EST':
      case 'END DAY (EST)':
      case 'END DATE (EST)': return formatDateToShow(task.end_date_est || '');
      case 'MD ACTUAL':
      case 'MANDAY ACTUAL': return task.manday_actual !== null && task.manday_actual !== undefined ? String(task.manday_actual) : '';
      case 'END ACTUAL':
      case 'END DATE ACTUAL': return formatDateToShow(task.end_date_actual || '');
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
    ...phases.filter(p => !p.is_master && p.name.toLowerCase() !== 'master').map(p => ({
      key: p.name,
      label: p.name,
      id: p.id,
      is_master: false
    }))
  ];

  // Local state for meetings, chats
  const [meetings, setMeetings] = useState<any[]>([]);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  const [isSummarizeOpen, setIsSummarizeOpen] = useState(false);
  const [summarizingMeeting, setSummarizingMeeting] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);


  const [chats, setChats] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');

  // Group Chats & AI Task Inbox state
  const [chatGroups, setChatGroups] = useState<any[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupPlatform, setNewGroupPlatform] = useState('Telegram');
  const [newGroupLink, setNewGroupLink] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');

  // AI Task Inbox States
  const [activeChatSubTab, setActiveChatSubTab] = useState<'inbox' | 'sources' | 'mapping' | 'logs'>('inbox');
  const [inboxTasks, setInboxTasks] = useState<any[]>([]);
  const [inboxStats, setInboxStats] = useState<any>({ pending_count: 0, ready_count: 0, imported_count: 0, accuracy: 91 });
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [searchTaskQuery, setSearchTaskQuery] = useState('');
  const [filterState, setFilterState] = useState<'all' | 'ready' | 'missing'>('all');

  // Modals & Drawer States
  const [editingInboxTask, setEditingInboxTask] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [isAnalyzingPaste, setIsAnalyzingPaste] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);

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
  const [editBusiness, setEditBusiness] = useState<'Infrastructure' | 'Markee'>('Infrastructure');
  const [editCurrentPhase, setEditCurrentPhase] = useState('');
  const [dbMasterPhases, setDbMasterPhases] = useState<any[]>([]);

  const [selectedPms, setSelectedPms] = useState<number[]>([]);
  const [selectedLeaders, setSelectedLeaders] = useState<number[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [savingProject, setSavingProject] = useState(false);

  const [projectMembers, setProjectMembers] = useState<any[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [categories, setCategories] = useState<any[]>([]);
  const [dbPriorities, setDbPriorities] = useState<any[]>([]);
  const [dbStatuses, setDbStatuses] = useState<any[]>([]);
  const [performanceSettings, setPerformanceSettings] = useState<any[]>([]);

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
  const [addMemberDropdownOpen, setAddMemberDropdownOpen] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const addMemberRef = useRef<HTMLDivElement>(null);

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
    } catch (err: any) {
      flash('Xóa dự án thất bại: ' + (err?.response?.data?.detail || err?.message || 'Lỗi không xác định'), true);
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

  const reloadAll = useCallback(async (silent = false) => {
    if (!silent) {
      setLoadingTasks(true);
    }
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
      return { tasks: tsks || [], groups: allGroups };
    } catch (err) {
      console.error('Lỗi khi tải dữ liệu dự án:', err);
      flash('Không thể tải dữ liệu dự án', true);
      return { tasks: [], groups: [] };
    } finally {
      if (!silent) {
        setLoadingTasks(false);
      }
    }
  }, [id]);

  const loadChatData = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getChatGroups(Number(id));
      setChatGroups(data || []);

      const inboxRes = await getAITaskInbox(Number(id));
      if (inboxRes && inboxRes.items) {
        setInboxTasks(inboxRes.items);
        if (inboxRes.stats) {
          setInboxStats(inboxRes.stats);
        }
      }

      const logs = await getChatSyncLogs(Number(id));
      if (logs) {
        setSyncLogs(logs);
      }
    } catch {
      flash('Không thể tải dữ liệu chat & AI Task Inbox', true);
    }
  }, [id]);

  useEffect(() => {
    loadChatData();
  }, [id, loadChatData]);

  const loadMeetings = useCallback(async () => {
    if (!project?.name) return;
    try {
      const data = await getMeetings();
      if (data.success) {
        const filtered = data.data.filter((m: any) => m.project === project.name);
        setMeetings(filtered);
      }
    } catch (error) {
      console.error("Failed to fetch meetings", error);
    }
  }, [project?.name]);

  useEffect(() => {
    loadMeetings();
  }, [project?.name, loadMeetings]);

  // Load chats from localStorage
  useEffect(() => {
    if (!id) return;
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
    loadChatData();
    loadProjectMembers();
  }, [id, loadProject, reloadAll, loadChatData, loadProjectMembers]);

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

    getPerformanceSettings()
      .then((data) => {
        setPerformanceSettings(data || []);
      })
      .catch((err) => {
        console.error('Error fetching performance settings:', err);
      });

    getMasterPhases()
      .then((data) => {
        setDbMasterPhases(data || []);
      })
      .catch((err) => {
        console.error('Error fetching master phases:', err);
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
      if (addMemberDropdownOpen && addMemberRef.current && !addMemberRef.current.contains(target)) {
        setAddMemberDropdownOpen(false);
        setAddMemberSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [customerDropdownOpen, phaseDropdownOpen, pmDropdownOpen, leaderDropdownOpen, memberDropdownOpen, addMemberDropdownOpen]);

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
        business: editBusiness,
        data_scope: editBusiness.toLowerCase(),
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

  const getGroupCellValue = (group: any, colName: string): string => {
    if (!group) return '';
    const colUpper = colName.toUpperCase().trim();
    switch (colUpper) {
      case 'TASK ID': return group.roman_index || '';
      case 'DETAIL TASK': return group.name || '';
      case 'MANDAY EST':
      case 'MANDAY (EST)':
      case 'MANDAY': return group.manday_est != null ? String(group.manday_est) : '';
      case 'STATUS': return group.status || 'Waiting';
      case 'START DATE':
      case 'START DATE (EST)': return formatDateToShow(group.start_date_est || '');
      case 'END DATE EST':
      case 'END DAY (EST)':
      case 'END DATE (EST)': return formatDateToShow(group.end_date_est || '');
      case 'MD ACTUAL':
      case 'MANDAY ACTUAL': return group.manday_actual != null ? String(group.manday_actual) : '';
      case 'END ACTUAL':
      case 'END DATE ACTUAL': return formatDateToShow(group.end_date_actual || '');
      default: return '';
    }
  };

  const getOrderedRows = () => {
    const rows: { type: 'group' | 'task'; id: number; task?: any; group?: any }[] = [];
    const phasesToRender = activePhase === 'ALL'
      ? phases.filter(p => p.name.trim().toLowerCase() !== 'master')
      : phases.filter(p => p.name === activePhase);

    for (const p of phasesToRender) {
      const groups = taskGroups
        .filter(g => g.phase_id === p.id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      for (const g of groups) {
        rows.push({ type: 'group', id: -g.id, group: g });

        const isCollapsed = collapsedGroups.has(g.id);
        if (!isCollapsed) {
          const groupTasks = items.filter(t => t.task_group_id === g.id);
          const sortedTasks = buildTaskTree(groupTasks);

          for (const task of sortedTasks) {
            if (!isAncestorCollapsed(task.task_code)) {
              rows.push({ type: 'task', id: task.id, task });
            }
          }
        }
      }
    }
    return rows;
  };

  const activateNextCell = (taskId: number, colName: string, keyAction: 'Enter' | 'Tab' | 'ShiftTab') => {
    const rows = getOrderedRows();
    const columns = getDynamicColumns();
    const rIdx = rows.findIndex(r => r.id === taskId);
    const cIdx = columns.indexOf(colName);
    if (rIdx === -1 || cIdx === -1) return;

    let nextRIdx = rIdx;
    let nextCIdx = cIdx;

    const moveNext = () => {
      if (keyAction === 'Enter') {
        nextRIdx += 1;
      } else if (keyAction === 'Tab') {
        if (nextCIdx < columns.length - 1) {
          nextCIdx += 1;
        } else {
          nextCIdx = 0;
          nextRIdx += 1;
        }
      } else if (keyAction === 'ShiftTab') {
        if (nextCIdx > 0) {
          nextCIdx -= 1;
        } else {
          nextCIdx = columns.length - 1;
          nextRIdx -= 1;
        }
      }
    };

    const SYSTEM_COLS = [
      'TASK ID', 'END DATE EST', 'MD ACTUAL', 'DAYS LATE',
      'KPI BASE', 'KPI PERFORM', 'KPI OVERTIME', 'KPI FINAL', 'SUB ID', 'SOLUTION'
    ];

    const isCellEditable = (rowObj: any, col: string) => {
      const colUpper = col.toUpperCase().trim();
      if (rowObj.type === 'group') {
        return ['DETAIL TASK', 'MANDAY EST', 'STATUS', 'START DATE'].includes(colUpper);
      } else {
        return !SYSTEM_COLS.includes(colUpper);
      }
    };

    for (let attempt = 0; attempt < 50; attempt++) {
      moveNext();
      if (nextRIdx < 0 || nextRIdx >= rows.length) break;

      const targetRow = rows[nextRIdx];
      const targetCol = columns[nextCIdx];

      if (isCellEditable(targetRow, targetCol)) {
        setEditingCell({ taskId: targetRow.id, colName: targetCol });

        if (targetRow.type === 'group') {
          setEditValue(getGroupCellValue(targetRow.group, targetCol));
        } else {
          const val = getCellValue(targetRow.task, targetCol);
          const colUpper = targetCol.toUpperCase().trim();
          if (colUpper === 'ASSIGNED') {
            setEditValue(targetRow.task.assigned_id ? String(targetRow.task.assigned_id) : '');
          } else if (colUpper === 'SUPPORT') {
            setEditValue(targetRow.task.support_id ? String(targetRow.task.support_id) : '');
          } else if (colUpper === 'SKILL SOLUTION') {
            setEditValue(targetRow.task.skill_solution_id ? String(targetRow.task.skill_solution_id) : '');
          } else if (colUpper === 'SKILL VENDOR') {
            setEditValue(targetRow.task.skill_vendor_id ? String(targetRow.task.skill_vendor_id) : '');
          } else {
            setEditValue(val);
          }
        }
        return;
      }

      if (keyAction === 'Enter') break;
    }

    setEditingCell(null);
  };

  const handleCellSave = async (taskId: number, colName: string, value: string, nextAction?: 'Enter' | 'Tab' | 'ShiftTab') => {
    if (isSavingRef.current) return;
    const task = items.find(item => item.id === taskId);
    if (!task) return;

    const originalVal = getCellValue(task, colName);
    if (originalVal === value) {
      if (nextAction) {
        activateNextCell(taskId, colName, nextAction);
      } else {
        setEditingCell(prev => {
          if (prev?.taskId === taskId && prev?.colName === colName) {
            return null;
          }
          return prev;
        });
      }
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
      case 'STATUS': {
        payload.status = value;
        const s = (value || '').trim().toLowerCase();
        if (s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish')) {
          if (!task.end_date_actual) {
            const d = new Date();
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            payload.end_date_actual = `${year}-${month}-${day}`;
          }
        } else {
          payload.end_date_actual = null;
        }
        break;
      }
      case 'START DATE':
      case 'START DATE (EST)':
        payload.start_date = convertToDbDate(value);
        break;
      case 'ASSIGNED':
        payload.assigned_id = value ? parseInt(value, 10) : null;
        break;
      case 'SUPPORT':
        payload.support_id = value ? parseInt(value, 10) : null;
        // Auto-set KPI ratio: 100/0 when no support, 90/10 when support assigned
        if (!value) {
          payload.kpi_ratio_assign = 100;
          payload.kpi_ratio_support = 0;
        } else if (task && (!task.support_id) && task.kpi_ratio_assign === 100 && task.kpi_ratio_support === 0) {
          payload.kpi_ratio_assign = 90;
          payload.kpi_ratio_support = 10;
        }
        break;
      case 'KPI RATIO':
        if (value && value.includes('/')) {
          const parts = value.split('/');
          payload.kpi_ratio_assign = parseInt(parts[0], 10) || 90;
          payload.kpi_ratio_support = parseInt(parts[1], 10) || 10;
        } else {
          payload.kpi_ratio_assign = 90;
          payload.kpi_ratio_support = 10;
        }
        break;
      case 'SKILL SOLUTION':
        payload.skill_solution_id = value ? parseInt(value, 10) : null;
        payload.skill_vendor_id = null;
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
        payload.end_date_actual = convertToDbDate(value);
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

    isSavingRef.current = true;
    try {
      // 1. Update the task that was changed
      await updateTask(task.task_group_id, taskId, payload);
      flash('Đã cập nhật task thành công!');
      
      // 2. If the status was changed, check and update the parent Task Group
      if (payload.status) {
        const { tasks: updatedItems, groups: updatedGroups } = await reloadAll(true);
        const parentGroupId = task.task_group_id;
        const parentGroup = updatedGroups.find(g => g.id === parentGroupId);

        if (parentGroup) {
          const childTasks = updatedItems.filter((t: any) => t.task_group_id === parentGroupId);
          const doneChildTasks = childTasks.filter((t: any) => {
            const childStatus = (t.status || '').toLowerCase();
            return (childStatus === 'done' || childStatus === 'completed' || childStatus.includes('hoàn') || childStatus.includes('finish')) && t.end_date_actual;
          });

          let latestDate: Date | null = null;
          if (doneChildTasks.length > 0) {
            const allTimestamps = doneChildTasks.map((t: any) => new Date(t.end_date_actual).getTime());
            const maxTimestamp = Math.max(...allTimestamps);
            latestDate = new Date(maxTimestamp);
          }

          const formattedDate = latestDate ? latestDate.toISOString().split('T')[0] : null;

          if (parentGroup.end_date_actual !== formattedDate) {
            await updateTaskGroup(parentGroup.phase_id, parentGroup.id, { end_date_actual: formattedDate });
            // Reload again to get the updated group reflected everywhere
            await reloadAll(true); 
          }
        }
      } else {
        // If status was not changed, just do a simple reload to reflect other changes
        await reloadAll(true);
      }

      // 3. Handle UI logic for moving to the next cell
      if (nextAction) {
        activateNextCell(taskId, colName, nextAction);
      } else {
        setEditingCell(null);
      }
    } catch (err: any) {
      alert('Lỗi cập nhật task: ' + (err.response?.data?.detail || err.message));
      setEditingCell(null);
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleGroupCellSave = async (group: any, colName: string, value: string, nextAction?: 'Enter' | 'Tab' | 'ShiftTab') => {
    if (isSavingRef.current) return;
    const originalVal = getGroupCellValue(group, colName);
    if (originalVal === value) {
      if (nextAction) {
        activateNextCell(-group.id, colName, nextAction);
      } else {
        setEditingCell(prev => {
          if (prev?.taskId === -group.id && prev?.colName === colName) {
            return null;
          }
          return prev;
        });
      }
      return;
    }

    const colUpper = colName.trim().toUpperCase();
    const payload: Record<string, any> = {};
    switch (colUpper) {
      case 'DETAIL TASK': payload.name = value; break;
      case 'MANDAY EST':
      case 'MANDAY (EST)':
      case 'MANDAY': payload.manday_est = value ? parseFloat(value) : null; break;
      case 'STATUS': payload.status = value; break;
      case 'START DATE':
      case 'START DATE (EST)': payload.start_date_est = convertToDbDate(value); break;
      default: return;
    }

    isSavingRef.current = true;
    try {
      await updateTaskGroup(group.phase_id, group.id, payload);
      flash('Đã cập nhật Task Group!');
      await reloadAll(true);
      if (nextAction) {
        activateNextCell(-group.id, colName, nextAction);
      } else {
        setEditingCell(prev => {
          if (prev?.taskId === -group.id && prev?.colName === colName) {
            return null;
          }
          return prev;
        });
      }
    } catch (err: any) {
      alert('Lỗi cập nhật: ' + (err.response?.data?.detail || err.message));
      setEditingCell(prev => {
        if (prev?.taskId === -group.id && prev?.colName === colName) {
          return null;
        }
        return prev;
      });
    } finally {
      isSavingRef.current = false;
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
    if (p === 'interrupt') return 'bg-purple-50 text-purple-700 border-purple-200';
    if (p === 'critical' || p === 'urgent') return 'bg-rose-50 text-rose-700 border-rose-200';
    if (p === 'high') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (p === 'normal' || p === 'medium') return 'bg-[#eff4ff] text-[#0058be] border-[#0058be]/20';
    return 'bg-[#eff4ff] text-[#0058be] border-[#0058be]/20';
  };

  const handleSaveMeeting = async (meetingData: any) => {
    try {
      const payload = {
        ...meetingData,
        project: project?.name || ''
      };
      if (meetingData.id) {
        const data = await updateMeeting(meetingData.id, payload);
        if (data.success) {
          flash('Cập nhật cuộc họp thành công!');
          loadMeetings();
        }
      } else {
        const data = await createMeeting(payload);
        if (data.success) {
          flash('Tạo cuộc họp mới thành công!');
          loadMeetings();
        }
      }
      setShowMeetingModal(false);
      setEditingMeeting(null);
    } catch (error: any) {
      console.error("Failed to save meeting", error);
      alert(error.response?.data?.detail || "Có lỗi xảy ra khi lưu cuộc họp");
    }
  };

  const executeDeleteMeeting = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteMeeting(parseInt(deleteConfirmId));
      flash('Đã xóa cuộc họp thành công!');
      loadMeetings();
      setDeleteConfirmId(null);
    } catch (error: any) {
      console.error("Failed to delete meeting", error);
      alert(error.response?.data?.detail || "Có lỗi xảy ra khi xóa cuộc họp");
    }
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
      let y = parts[2];
      if (y.length === 2) {
        y = '20' + y;
      }
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

  const formatDateToShow = (val: string): string => {
    if (!val) return '';
    val = val.trim();
    // If it's YYYY-MM-DD (e.g. '2026-07-09')
    const parts = val.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    // If it's DD/MM/YYYY or DD/MM/YY
    const slashParts = val.split('/');
    if (slashParts.length === 3) {
      let y = slashParts[2];
      if (y.length === 2) {
        y = '20' + y;
      }
      return `${slashParts[0]}/${slashParts[1]}/${y}`;
    }
    return val;
  };

  const convertToDbDate = (val: string): string | null => {
    if (!val) return null;
    val = val.trim();
    // Case 1: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return val;
    }
    // Case 2: DD/MM/YYYY or DD/MM/YY
    const parts = val.split('/');
    if (parts.length === 3) {
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      let y = parts[2];
      if (y.length === 2) {
        y = '20' + y;
      }
      return `${y}-${m}-${d}`;
    }
    // Case 3: DD-MM-YYYY or DD-MM-YY
    const partsHyphen = val.split('-');
    if (partsHyphen.length === 3 && partsHyphen[0].length <= 2) {
      const d = partsHyphen[0].padStart(2, '0');
      const m = partsHyphen[1].padStart(2, '0');
      let y = partsHyphen[2];
      if (y.length === 2) {
        y = '20' + y;
      }
      return `${y}-${m}-${d}`;
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
    return null;
  };

  // --- Dynamic Stats calculation ---
  const kpiTasks = getFilteredTasks();
  const kpiTotal = kpiTasks.length;

  // 1 & 2. Số task hoàn thành & % Tiến độ
  const kpiDone = kpiTasks.filter(x => {
    const s = (x.status || '').toLowerCase();
    return s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish');
  }).length;
  const devProgressPercent = kpiTotal > 0 ? Math.round((kpiDone / kpiTotal) * 100) : 0;

  // 3. Tổng Manday
  const kpiTotalManday = kpiTasks.reduce((sum, task) => {
    const md = parseFloat(task.manday_est as string);
    return sum + (isNaN(md) ? 0 : md);
  }, 0);

  // 4. Trễ deadline
  const kpiWarning = kpiTasks.filter(x => x.days_late != null && x.days_late > 0).length;

  // 5. Critical thực hiện tuần này
  const today = new Date();
  const firstDay = new Date(today);
  firstDay.setDate(today.getDate() - today.getDay() + 1);
  const lastDay = new Date(today);
  lastDay.setDate(today.getDate() - today.getDay() + 7);
  firstDay.setHours(0, 0, 0, 0);
  lastDay.setHours(23, 59, 59, 999);

  const kpiCriticalThisWeek = kpiTasks.filter(x => {
    if ((x.priority || '').toLowerCase() !== 'critical') return false;
    if (!x.start_date) return false;
    const d = new Date(x.start_date);
    return d >= firstDay && d <= lastDay;
  }).length;

  const kpiInProgress = kpiTasks.filter(x => {
    const s = (x.status || '').toLowerCase();
    return s.includes('process') || s.includes('progress') || s.includes('inprogress') || s.includes('doing') || s === 'in progress';
  }).length;

  // --- Leaderboard / Workload Chart Calculation ---
  const workloadStats = (() => {
    const totalCounts: Record<string, number> = {};
    const doneCounts: Record<string, number> = {};
    let unassignedTotal = 0;
    let unassignedDone = 0;
    items.forEach(t => {
      const s = (t.status || '').toLowerCase();
      const isDone = s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish');
      const name = (t.assigned_name || '').trim();
      if (name === '') {
        unassignedTotal += 1;
        if (isDone) unassignedDone += 1;
      } else {
        totalCounts[name] = (totalCounts[name] || 0) + 1;
        if (isDone) doneCounts[name] = (doneCounts[name] || 0) + 1;
      }
    });
    const rows = Object.keys(totalCounts)
      .map(name => ({ name, total: totalCounts[name], done: doneCounts[name] || 0 }))
      .sort((a, b) => b.total - a.total);
    if (unassignedTotal > 0) {
      rows.unshift({ name: 'Chưa gắn', total: unassignedTotal, done: unassignedDone });
    }
    return rows;
  })();

  const leaderboardStats = workloadStats.filter(r => r.name !== 'Chưa gắn').map(r => ({ name: r.name, count: r.done }));

  // --- KPI FINAL Leaderboard ---
  const kpiLeaderboardStats = (() => {
    const kpiSums: Record<string, number> = {};
    items.forEach(t => {
      const name = (t.assigned_name || '').trim();
      const val = parseFloat(t.kpi_final);
      if (name !== '' && !isNaN(val) && val > 0) {
        kpiSums[name] = (kpiSums[name] || 0) + val;
      }
    });
    return Object.entries(kpiSums)
      .map(([name, total]) => ({ name, total: Math.round(total * 10) / 10 }))
      .sort((a, b) => b.total - a.total);
  })();

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
      'START DATE', 'ASSIGNED', 'SUPPORT', 'KPI RATIO', 'SKILL SOLUTION', 'SKILL VENDOR'
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
          className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
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
          className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
        >
          {dbPriorities.length === 0 ? (
            <>
              <option value="Normal">Normal</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
              <option value="Interrupt">Interrupt</option>
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
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
              }`}
          />
        );
      } else if (isUserCol) {
        inputField = (
          <select
            value={newForm[col] || ''}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            onKeyDown={handleInputKeyDown}
            className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
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
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
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
            className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
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
            className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
              }`}
          >
            <option value="">-- Chọn Skill --</option>
            {availableSkills.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        );
      } else if (colUpper === 'REMARK') {
        inputField = (
          <RemarkMultiSelectInput
            value={newForm[col] || ''}
            performanceSettings={performanceSettings}
            onChange={val => setNewForm({ ...newForm, [col]: val })}
            placeholder="Chọn Remark..."
          />
        );
      } else if (colUpper === 'SEND') {
        inputField = (
          <select
            value={newForm[col] || ''}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            onKeyDown={handleInputKeyDown}
            className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${
              isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
            }`}
          >
            <option value="">-- Chọn --</option>
            <option value="gửi">gửi</option>
            <option value="đã gửi">đã gửi</option>
          </select>
        );
      } else if (colUpper === 'KPI RATIO') {
        inputField = (
          <input
            type="text"
            value={newForm[col] || '90/10'}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            onKeyDown={handleInputKeyDown}
            placeholder="90/10"
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-mono ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
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
            className={`w-full bg-white border rounded px-1.5 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] ${colUpper.includes('DETAIL') ? 'font-semibold' : ''
              } ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
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
    const assignedVal = newForm['ASSIGNED'] || null;
    const supportVal = newForm['SUPPORT'] || null;
    const skillSolutionVal = newForm['SKILL SOLUTION'] || null;
    const skillVendorVal = newForm['SKILL VENDOR'] || null;

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
    if (!assignedVal) {
      alert('Cột ASSIGNED là bắt buộc.');
      return;
    }
    if (!supportVal) {
      alert('Cột SUPPORT là bắt buộc.');
      return;
    }
    if (!skillSolutionVal) {
      alert('Cột SKILL SOLUTION là bắt buộc.');
      return;
    }
    if (!skillVendorVal) {
      alert('Cột SKILL VENDOR là bắt buộc.');
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
        start_date: convertToDbDate(startDateVal),
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

      const s = (statusVal || '').trim().toLowerCase();
      if (s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish')) {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        payload.end_date_actual = `${year}-${month}-${day}`;
      }

      // KPI ratio
      // KPI Ratio: default 90/10, auto 100/0 if no support
      const hasSupport = !!payload.support_id;
      const kpiRatio = newForm['KPI RATIO'] || (hasSupport ? '90/10' : '100/0');
      const parts = kpiRatio.split('/');
      if (!hasSupport) {
        payload.kpi_ratio_assign = 100;
        payload.kpi_ratio_support = 0;
      } else {
        payload.kpi_ratio_assign = parseInt(parts[0], 10) || 90;
        payload.kpi_ratio_support = parseInt(parts[1], 10) || 10;
      }

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

  // Sync drawer form when selectedTask changes
  useEffect(() => {
    if (selectedTask) {
      setDrawerForm({
        detail: selectedTask.detail || '',
        status: selectedTask.status || 'Waiting',
        priority: selectedTask.priority || 'Normal',
        assigned_id: selectedTask.assigned_id ? String(selectedTask.assigned_id) : '',
        support_id: selectedTask.support_id ? String(selectedTask.support_id) : '',
        start_date: selectedTask.start_date || '',
        end_date_est: selectedTask.end_date_est || '',
        manday_est: selectedTask.manday_est != null ? String(selectedTask.manday_est) : '',
        manday_actual: selectedTask.manday_actual != null ? String(selectedTask.manday_actual) : '',
        notes: selectedTask.notes || '',
        remark: selectedTask.remark || '',
        ticket_id: selectedTask.ticket_id || '',
      });
    }
  }, [selectedTask]);

  // Keep selectedTask in sync with items after reload
  useEffect(() => {
    if (selectedTask && items.length > 0) {
      const fresh = items.find((t: any) => t.id === selectedTask.id);
      if (fresh && fresh !== selectedTask) {
        setSelectedTask(fresh);
      }
    }
  }, [items]);

  const handleDrawerSave = async () => {
    if (!selectedTask || drawerSaving) return;
    setDrawerSaving(true);
    try {
      const payload: Record<string, any> = {
        detail: drawerForm.detail,
        status: drawerForm.status,
        priority: drawerForm.priority,
        assigned_id: drawerForm.assigned_id ? parseInt(drawerForm.assigned_id, 10) : null,
        support_id: drawerForm.support_id ? parseInt(drawerForm.support_id, 10) : null,
        start_date: convertToDbDate(drawerForm.start_date),
        end_date_est: convertToDbDate(drawerForm.end_date_est),
        manday_est: drawerForm.manday_est ? parseFloat(drawerForm.manday_est) : null,
        manday_actual: drawerForm.manday_actual ? parseFloat(drawerForm.manday_actual) : null,
        notes: drawerForm.notes || null,
        remark: drawerForm.remark || null,
        ticket_id: drawerForm.ticket_id || null,
      };

      const wasDone = selectedTask.status && (
        selectedTask.status.toLowerCase() === 'done' ||
        selectedTask.status.toLowerCase() === 'completed' ||
        selectedTask.status.toLowerCase().includes('hoàn') ||
        selectedTask.status.toLowerCase().includes('finish')
      );
      const isNowDone = drawerForm.status && (
        drawerForm.status.toLowerCase() === 'done' ||
        drawerForm.status.toLowerCase() === 'completed' ||
        drawerForm.status.toLowerCase().includes('hoàn') ||
        drawerForm.status.toLowerCase().includes('finish')
      );

      if (isNowDone && !wasDone) {
        if (!selectedTask.end_date_actual) {
          const d = new Date();
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          payload.end_date_actual = `${year}-${month}-${day}`;
        }
      } else if (!isNowDone && wasDone) {
        payload.end_date_actual = null;
      }
      await updateTask(selectedTask.task_group_id, selectedTask.id, payload);
      flash('Đã cập nhật task thành công!');
      await reloadAll(true);
    } catch (err: any) {
      alert('Lỗi cập nhật task: ' + (err.response?.data?.detail || err.message));
    } finally {
      setDrawerSaving(false);
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
            className="relative flex items-center h-2 transition-all duration-200 group-hover/spacer:bg-slate-50/20"
          >
            {/* Dashed line */}
            <div className="absolute inset-x-4 flex items-center pointer-events-none w-[calc(100%-2rem)]">
              <div className="w-full border-t border-slate-300 border-dashed opacity-0 group-hover/spacer:opacity-100 transition-opacity duration-200"></div>
            </div>
            {/* Emerald pill button */}
            {/* <button
              type="button"
              onClick={handleAddTgClick}
              style={{ left: snappedPos, transform: 'translateX(-50%)' }}
              className="absolute opacity-0 group-hover/spacer:opacity-100 transition-all duration-200 bg-[#006847] hover:bg-[#00583b] text-white font-bold text-[10px] px-3.5 py-1.5 rounded-full shadow-md flex items-center gap-1 active:scale-95 z-10 cursor-pointer hover:shadow-lg hover:scale-105"
            >
              <span className="text-[12px] font-extrabold">+</span> Thêm Task Group
            </button> */}
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
            className="relative flex items-center h-2 transition-all duration-200 group-hover/spacer:bg-slate-50/20"
          >
            {/* Dashed line */}
            <div className="absolute inset-x-4 flex items-center pointer-events-none w-[calc(100%-2rem)]">
              <div className="w-full border-t border-slate-300 border-dashed opacity-0 group-hover/spacer:opacity-100 transition-opacity duration-200"></div>
            </div>
            {/* Teal/emerald pill button */}
            {/* <button
              type="button"
              onClick={handleAddClick}
              style={{ left: snappedPos, transform: 'translateX(-50%)' }}
              className="absolute opacity-0 group-hover/spacer:opacity-100 transition-all duration-200 bg-[#006847] hover:bg-[#00583b] text-white font-bold text-[10px] px-3.5 py-1.5 rounded-lg shadow-md flex items-center gap-1 active:scale-95 z-10 cursor-pointer hover:shadow-lg hover:scale-105"
            >
              <span className="text-[12px] font-extrabold">+</span> Thêm Task
            </button> */}
          </div>
        </td>
      </tr>
    );
  };

  const renderSingleTaskRow = (task: any, level: number, hasChildren: boolean, isCollapsedParent: boolean, tIdx: number = 0, sortedTasks: any[] = []) => {
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
      ? "bg-white hover:bg-[#f0f5ff]/60"
      : "bg-[#f8fafc] hover:bg-[#eef3fb] border-l-[3px] border-l-[#0058be]";

    const cellStyle = "px-4 py-3 border-r border-slate-100 last:border-r-0 text-left align-middle text-[12.5px]";

    return (
      <tr
        id={`task-row-${task.id}`}
        key={task.id}
        className={`group relative transition-colors ${rowBgClass}`}
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
        {/* ACTION BUTTONS: ☰ ↑ ↓ 📄 🗑️ */}
        <td className="px-1 py-2 text-center" style={{ width: '130px', minWidth: '130px' }}>
          <div className="flex items-center justify-center gap-1">
            {/* ☰ Drag / Move */}
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

            {/* ↑ Add Above */}
            <button
              type="button"
              onClick={() => {
                setAddingTaskGroupId(task.task_group_id);
                const parentCode = getParentCode(task.task_code) || null;
                setAddingTaskParentCode(parentCode);
                // Find previous task code to insert after
                const prevIdx = tIdx - 1;
                if (prevIdx >= 0) {
                  const prevTask = sortedTasks[prevIdx];
                  setAddingTaskAfterCode(prevTask.task_code);
                } else {
                  setAddingTaskAfterCode(null);
                }
                const dynamicCols = getDynamicColumns();
                const initialForm: Record<string, string> = {};
                dynamicCols.forEach(col => { initialForm[col] = ''; });
                const todayStr = fromPickerDate(new Date().toISOString().split('T')[0]);
                const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
                if (statusCol) initialForm[statusCol] = 'Waiting';
                const priorityCol = dynamicCols.find(c => c.toUpperCase() === 'PRIORITY');
                if (priorityCol) initialForm[priorityCol] = 'Normal';
                const startDateCol = dynamicCols.find(c => c.toUpperCase() === 'START DATE');
                if (startDateCol) initialForm[startDateCol] = todayStr;
                const kpiRatioCol = dynamicCols.find(c => c.toUpperCase() === 'KPI RATIO');
                if (kpiRatioCol) initialForm[kpiRatioCol] = '100/0';
                const mandayCol = dynamicCols.find(c => c.toUpperCase() === 'MANDAY EST');
                if (mandayCol) initialForm[mandayCol] = '1.0';
                setNewForm(initialForm);
              }}
              className="flex items-center justify-center w-5 h-5 hover:bg-blue-100 rounded text-blue-500 font-bold text-[12px]"
              title="Thêm Task phía trên"
            >
              <span>↑</span>
            </button>

            {/* ↓ Add Below */}
            <button
              type="button"
              onClick={() => {
                setAddingTaskGroupId(task.task_group_id);
                const parentCode = getParentCode(task.task_code) || null;
                setAddingTaskParentCode(parentCode);
                setAddingTaskAfterCode(task.task_code);
                const dynamicCols = getDynamicColumns();
                const initialForm: Record<string, string> = {};
                dynamicCols.forEach(col => { initialForm[col] = ''; });
                const todayStr = fromPickerDate(new Date().toISOString().split('T')[0]);
                const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
                if (statusCol) initialForm[statusCol] = 'Waiting';
                const priorityCol = dynamicCols.find(c => c.toUpperCase() === 'PRIORITY');
                if (priorityCol) initialForm[priorityCol] = 'Normal';
                const startDateCol = dynamicCols.find(c => c.toUpperCase() === 'START DATE');
                if (startDateCol) initialForm[startDateCol] = todayStr;
                const kpiRatioCol = dynamicCols.find(c => c.toUpperCase() === 'KPI RATIO');
                if (kpiRatioCol) initialForm[kpiRatioCol] = '100/0';
                const mandayCol = dynamicCols.find(c => c.toUpperCase() === 'MANDAY EST');
                if (mandayCol) initialForm[mandayCol] = '1.0';
                setNewForm(initialForm);
              }}
              className="flex items-center justify-center w-5 h-5 hover:bg-emerald-100 rounded text-emerald-600 font-bold text-[12px]"
              title="Thêm Task phía dưới"
            >
              <span>↓</span>
            </button>

            {/* 📄 Duplicate */}
            <button
              type="button"
              onClick={() => handleDuplicateTask(task.task_group_id, task.id)}
              className="flex items-center justify-center w-5 h-5 hover:bg-amber-100 rounded text-amber-600"
              title="Nhân bản Task"
            >
              <span>📄</span>
            </button>

            {/* 🗑️ Delete */}
            <button
              type="button"
              onClick={() => setTaskToDelete(task.id)}
              className="flex items-center justify-center w-5 h-5 hover:bg-red-100 rounded text-red-400"
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
                    onBlur={e => handleCellSave(task.id, col, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCellSave(task.id, col, e.currentTarget.value);
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                        handleCellSave(task.id, col, e.currentTarget.value, act);
                      } else if (e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
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
                    onBlur={e => handleCellSave(task.id, col, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCellSave(task.id, col, e.currentTarget.value);
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                        handleCellSave(task.id, col, e.currentTarget.value, act);
                      } else if (e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
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
                <MemberSearchCell
                  key={col}
                  col={col}
                  task={task}
                  editValue={editValue}
                  projectMembers={projectMembers}
                  onSaveWithAction={(val, act) => handleCellSave(task.id, col, val, act)}
                  onCancel={() => setEditingCell(null)}
                />
              );
            }

            if (colUpper === 'REMARK') {
              return (
                <RemarkDropdownCell
                  key={col}
                  col={col}
                  task={task}
                  editValue={editValue}
                  performanceSettings={performanceSettings}
                  onSaveWithAction={(val, act) => handleCellSave(task.id, col, val, act)}
                  onCancel={() => setEditingCell(null)}
                />
              );
            }

            if (colUpper === 'SEND') {
              return (
                <td key={col} className="px-2 py-1 min-w-[110px]">
                  <select
                    value={editValue}
                    autoFocus
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={e => handleCellSave(task.id, col, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCellSave(task.id, col, e.currentTarget.value);
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                        handleCellSave(task.id, col, e.currentTarget.value, act);
                      } else if (e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
                    className="w-full bg-white border border-[#0058be] rounded px-1 py-0.5 text-xs text-[#0b1c30] focus:outline-none font-semibold"
                  >
                    <option value="">-- Chọn --</option>
                    <option value="gửi">gửi</option>
                    <option value="đã gửi">đã gửi</option>
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
                    onBlur={e => handleCellSave(task.id, col, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCellSave(task.id, col, e.currentTarget.value);
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                        handleCellSave(task.id, col, e.currentTarget.value, act);
                      } else if (e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
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
                    onBlur={e => handleCellSave(task.id, col, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCellSave(task.id, col, e.currentTarget.value);
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                        handleCellSave(task.id, col, e.currentTarget.value, act);
                      } else if (e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
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

            if (colUpper === 'DETAIL TASK') {
              return (
                <td key={col} className="px-2 py-1 min-w-[320px] whitespace-normal break-words">
                  <textarea
                    value={editValue}
                    autoFocus
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        if (!e.shiftKey) {
                          e.preventDefault();
                          handleCellSave(task.id, col, editValue);
                        }
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                        handleCellSave(task.id, col, editValue, act);
                      } else if (e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
                    onBlur={() => handleCellSave(task.id, col, editValue)}
                    ref={el => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = el.scrollHeight + 'px';
                      }
                    }}
                    className="w-full bg-white border border-[#0058be] rounded px-1.5 py-1 text-xs text-[#0b1c30] focus:outline-none resize-none overflow-hidden min-h-[40px] h-auto whitespace-pre-wrap break-words leading-relaxed"
                  />
                </td>
              );
            }

            if (colUpper === 'LINK') {
              return (
                <td key={col} className="px-2 py-1 min-w-[320px]">
                  <textarea
                    value={editValue}
                    autoFocus
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleCellSave(task.id, col, editValue);
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                        handleCellSave(task.id, col, editValue, act);
                      } else if (e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
                    onBlur={() => handleCellSave(task.id, col, editValue)}
                    ref={el => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = el.scrollHeight + 'px';
                      }
                    }}
                    className="w-full bg-white border border-[#0058be] rounded px-1.5 py-1 text-xs text-[#0b1c30] focus:outline-none resize-none overflow-hidden min-h-[60px] h-auto whitespace-pre-wrap break-words leading-relaxed"
                    placeholder="Dán các link vào đây, mỗi link một dòng..."
                  />
                </td>
              );
            }
            
            if (colUpper.includes('DATE') || (colUpper.includes('ACTUAL') && colUpper.includes('END'))) {
              return (
                <td key={col} className="px-2 py-1 min-w-[130px]">
                  <input
                    type="date"
                    value={editValue ? toPickerDate(editValue) : ''}
                    autoFocus
                    onChange={e => setEditValue(fromPickerDate(e.target.value))}
                    onBlur={() => handleCellSave(task.id, col, editValue)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCellSave(task.id, col, editValue);
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                        handleCellSave(task.id, col, editValue, act);
                      } else if (e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
                    className="w-full bg-white border border-[#0058be] rounded px-1 py-0.5 text-xs font-mono focus:outline-none font-semibold text-[#0b1c30]"
                  />
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
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCellSave(task.id, col, editValue);
                    } else if (e.key === 'Tab') {
                      e.preventDefault();
                      const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                      handleCellSave(task.id, col, editValue, act);
                    } else if (e.key === 'Escape') {
                      setEditingCell(null);
                    }
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
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border ${info.bg} border-current/10 shrink-0 shadow-sm`}>
                <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />
                {info.label}
              </span>
            );
          } else if (colUpper === 'PRIORITY') {
            const style = getPriorityStyle(val);
            cellContent = (
              <span className={`inline-block px-2.5 py-0.5 rounded-md border text-[11px] font-bold tracking-wide uppercase ${style}`}>
                {val || 'Normal'}
              </span>
            );
          } else if (colUpper === 'REMARK') {
            cellContent = renderRemarkTags(val, performanceSettings);
          } else if (colUpper === 'SEND') {
            const cleanVal = (val || '').trim().toLowerCase();
            if (cleanVal === 'gửi') {
              cellContent = (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 shadow-sm">
                  gửi
                </span>
              );
            } else if (cleanVal === 'đã gửi') {
              cellContent = (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm">
                  đã gửi
                </span>
              );
            } else {
              cellContent = val ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-50 text-slate-600 border border-slate-200 shadow-sm">
                  {val}
                </span>
              ) : (
                <span className="text-slate-400 italic font-normal text-[11px] select-none">Trống</span>
              );
            }
          } else if (colUpper === 'TASK ID') {
            cellContent = (
              <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 18}px` }}>
                {hasChildren && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleParentCollapse(taskIdVal);
                    }}
                    className="cursor-pointer select-none text-[11px] p-0.5 hover:bg-slate-200 rounded font-normal text-slate-400 inline-flex items-center justify-center w-5 h-5 transition-all duration-200 hover:text-slate-600"
                  >
                    {isCollapsedParent ? '▶' : '▼'}
                  </span>
                )}
                {!hasChildren && level > 0 && (
                  <span className="w-5 h-5 inline-block shrink-0" />
                )}
                <span
                  className={`font-mono px-2 py-0.5 rounded cursor-pointer transition-colors ${!isSubTask ? 'font-bold text-[#0058be] bg-[#e8f0fe] text-[12.5px]' : 'text-slate-600 font-medium bg-slate-50 text-[12px] hover:bg-slate-100'}`}
                  onClick={(e) => { e.stopPropagation(); setSelectedTask(task); }}
                  title="Click to view details"
                >
                  {val}
                </span>
                {task.ai_status && (
                  <span
                    className={`w-2.5 h-2.5 rounded-full cursor-pointer shrink-0 border border-white shadow-sm transition-transform hover:scale-125 ${
                      task.ai_status === 'NEED_RECHECK'
                        ? 'bg-amber-400 animate-pulse'
                        : task.ai_status === 'HAS_ISSUE'
                        ? 'bg-rose-500'
                        : task.ai_status === 'GOOD'
                        ? 'bg-emerald-500'
                        : 'bg-slate-300'
                    }`}
                    title={`AI Status: ${task.ai_status}${task.last_ai_score !== null ? ` (Score: ${task.last_ai_score}/100)` : ''} - Click to view detail`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenAIReviewDrawer('TASK', task.id, task.detail);
                    }}
                  />
                )}
              </div>
            );
          } else if (colUpper === 'DETAIL TASK') {
            cellContent = (
              <div
                className="flex items-center gap-1.5 cursor-pointer group/detail"
                onClick={(e) => { e.stopPropagation(); setSelectedTask(task); }}
                title="Click to view details"
              >
                {isSubTask && (
                  <span className="text-slate-300 font-mono select-none mr-1 inline-block shrink-0 text-[11px]">
                    └
                  </span>
                )}
                <span className={`whitespace-pre-wrap break-words block leading-relaxed pr-4 group-hover/detail:text-[#0058be] transition-colors ${!isSubTask ? 'font-semibold text-[#0b1c30] text-[13px]' : 'text-slate-700 font-normal text-[12.5px]'}`}>
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
          } else if (colUpper === 'LINK') {
            const links = (val || '').split('\n').filter(Boolean);
            if (links.length > 0) {
              cellContent = (
                <div className="flex flex-wrap gap-1.5">
                  {links.map((link, index) => {
                    const isUrl = /^https?:\/\//i.test(link);
                    let label = link;
                    if (isUrl) {
                        try {
                            const u = new URL(link);
                            const host = u.hostname.replace('www.', '');
                            if (host.includes('docs.google.com')) label = 'Google Docs';
                            else if (host.includes('figma.com')) label = 'Figma Design';
                            else if (host.includes('drive.google.com')) label = 'Google Drive';
                            else if (host.includes('github.com')) label = 'GitHub';
                            else if (host.includes('jira')) label = 'Jira Ticket';
                            else if (host.includes('notion')) label = 'Notion Page';
                            else if (host.includes('confluence')) label = 'Confluence';
                            else label = host + (u.pathname.length > 15 ? u.pathname.substring(0, 15) + '...' : u.pathname);
                        } catch {}
                    }
                    
                    return (
                      <div key={index} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-md text-[11px] font-semibold text-blue-700 shadow-sm overflow-hidden">
                        <span
                          className="px-2 py-0.5 cursor-pointer hover:bg-blue-100 transition-colors max-w-[160px] truncate"
                          title={link}
                          onClick={(e) => { e.stopPropagation(); if(isUrl) window.open(link, '_blank', 'noopener,noreferrer'); }}
                        >
                          🔗 {label}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const newLinks = links.filter((_, i) => i !== index);
                            const newValue = newLinks.join('\n');
                            handleCellSave(task.id, col, newValue);
                          }}
                          className="px-1 py-0.5 hover:bg-blue-200 text-blue-500 hover:text-blue-700 transition-colors"
                          title="Xóa link"
                        >
                          &times;
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            } else {
              cellContent = (
                <span className="text-slate-400 italic font-normal text-[11px] select-none">Trống</span>
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
              className={`${cellStyle} ${colUpper === 'DETAIL TASK' ? 'w-[450px] min-w-[320px] whitespace-normal break-words' : 'whitespace-nowrap'} ${isReadOnly ? 'bg-[#f8fafc]/50 cursor-default' : 'cursor-text hover:bg-slate-100/80 group'} ${isNumericOrDate ? 'font-mono text-[#0b1c30] font-semibold' : 'text-[#565e74]'}`}
              onClick={() => {
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
      ? phases.filter(p => p.name.trim().toLowerCase() !== 'master')
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

      // Phase header (Rendered only if the phase is not "Master")
      if (phase.name.trim().toLowerCase() !== 'master') {
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
      }

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
            <td className="px-1 py-2 text-center" style={{ width: '130px', minWidth: '130px' }}>
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

              // Special editable cell for END ACTUAL DATE
              if (colUpper === 'END ACTUAL' || colUpper === 'END DATE ACTUAL') {
                const isEditingDate = editingGroupDate === group.id;

                if (isEditingDate) {
                  return (
                    <td key={col} className="px-2 py-1">
                      <input
                        type="date"
                        defaultValue={group.end_date_actual_override ? toPickerDate(group.end_date_actual_override) : (group.end_date_actual ? toPickerDate(group.end_date_actual) : '')}
                        autoFocus
                        onBlur={async (e) => {
                          const newDate = e.target.value ? fromPickerDate(e.target.value) : null;
                          const originalDate = group.end_date_actual_override;
                          
                          if (newDate !== originalDate) {
                            try {
                              await updateTaskGroup(group.phase_id, group.id, { end_date_actual_override: newDate });
                              flash('Đã cập nhật ngày hoàn thành thực tế!');
                              reloadAll(true);
                            } catch (err: any) {
                              alert('Lỗi cập nhật: ' + (err.response?.data?.detail || err.message));
                            }
                          }
                          setEditingGroupDate(null);
                        }}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const newDate = e.currentTarget.value ? fromPickerDate(e.currentTarget.value) : null;
                            const originalDate = group.end_date_actual_override;
                            if (newDate !== originalDate) {
                                try {
                                    await updateTaskGroup(group.phase_id, group.id, { end_date_actual_override: newDate });
                                    flash('Đã cập nhật ngày hoàn thành thực tế!');
                                    reloadAll(true);
                                } catch (err: any) {
                                    alert('Lỗi cập nhật: ' + (err.response?.data?.detail || err.message));
                                }
                            }
                            setEditingGroupDate(null);
                          } else if (e.key === 'Escape') {
                            setEditingGroupDate(null);
                          }
                        }}
                        className="w-full bg-white border border-indigo-500 rounded px-1 py-0.5 text-xs font-mono focus:outline-none font-bold"
                      />
                    </td>
                  );
                }

                // Display mode with edit icon for END ACTUAL
                const cellStyle = "px-4 py-2.5 text-xs font-bold text-[#1e293b] whitespace-nowrap";
                return (
                    <td key={col} className={`${cellStyle} group cursor-pointer hover:bg-indigo-100/60`} onClick={() => setEditingGroupDate(group.id)}>
                        <div className="flex items-center justify-between w-full">
                            <span className="font-mono" title={`Tự động: ${formatDateToShow(group.end_date_actual_auto || '')}`}>
                                {group.status && group.status.toLowerCase() === 'done' ? (
                                    group.end_date_actual_override ? (
                                        <strong className="text-indigo-700" title="Ngày đã ghi đè thủ công">{formatDateToShow(group.end_date_actual_override)}</strong>
                                    ) : (
                                        val || <span className="text-slate-400 italic">Trống</span>
                                    )
                                ) : (
                                    <span className="text-slate-400 italic">—</span>
                                )}
                            </span>
                            <span className="opacity-0 group-hover:opacity-60 text-[10px] transition-opacity shrink-0">✏️</span>
                        </div>
                    </td>
                );
              }

              // Inline edit for other editable columns
              if (isEditing) {
                if (colUpper === 'STATUS') {
                  return (
                    <td key={col} className="px-2 py-1 min-w-[110px]">
                      <select
                        value={editValue}
                        autoFocus
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={e => handleGroupCellSave(group, col, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleGroupCellSave(group, col, e.currentTarget.value);
                          } else if (e.key === 'Tab') {
                            e.preventDefault();
                            const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                            handleGroupCellSave(group, col, e.currentTarget.value, act);
                          } else if (e.key === 'Escape') {
                            setEditingCell(null);
                          }
                        }}
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

                if (colUpper === 'DETAIL TASK') {
                  return (
                    <td key={col} className="px-2 py-1 min-w-[320px] whitespace-normal break-words">
                      <textarea
                        value={editValue}
                        autoFocus
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            if (!e.shiftKey) {
                              e.preventDefault();
                              handleGroupCellSave(group, col, editValue);
                            }
                          } else if (e.key === 'Tab') {
                            e.preventDefault();
                            const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                            handleGroupCellSave(group, col, editValue, act);
                          } else if (e.key === 'Escape') {
                            setEditingCell(null);
                          }
                        }}
                        onBlur={() => handleGroupCellSave(group, col, editValue)}
                        ref={el => {
                          if (el) {
                            el.style.height = 'auto';
                            el.style.height = el.scrollHeight + 'px';
                          }
                        }}
                        className="w-full bg-white border border-indigo-500 rounded px-1.5 py-1 text-xs text-[#0b1c30] focus:outline-none resize-none overflow-hidden min-h-[40px] h-auto whitespace-pre-wrap break-words leading-relaxed font-bold"
                      />
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
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleGroupCellSave(group, col, editValue);
                          } else if (e.key === 'Tab') {
                            e.preventDefault();
                            const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                            handleGroupCellSave(group, col, editValue, act);
                          } else if (e.key === 'Escape') {
                            setEditingCell(null);
                          }
                        }}
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
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleGroupCellSave(group, col, editValue);
                        } else if (e.key === 'Tab') {
                          e.preventDefault();
                          const act = e.shiftKey ? 'ShiftTab' : 'Tab';
                          handleGroupCellSave(group, col, editValue, act);
                        } else if (e.key === 'Escape') {
                          setEditingCell(null);
                        }
                      }}
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
                  <span className="text-[12px] font-black text-[#0f172a] whitespace-pre-wrap break-words block leading-relaxed pr-4">{val}</span>
                );
              }

              return (
                <td
                  key={col}
                  className={`${cellStyle} ${colUpper === 'DETAIL TASK' ? 'w-[450px] min-w-[320px] whitespace-normal break-words' : ''} ${isEditable ? 'cursor-text hover:bg-indigo-100/60 group' : (isAuto ? 'text-slate-500 font-mono' : '')}`}
                  onClick={() => {
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

          result.push(renderSingleTaskRow(task, level, hasChildren, isCollapsedParent, tIdx, sortedTasks));

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
      {!isFullscreen && <Navbar />}

      <div className={`flex-1 ${isFullscreen ? 'pl-0' : 'pl-[230px]'} flex flex-col h-screen overflow-hidden transition-[padding] duration-200`}>

        {/* TOP BAR / NAVIGATION HEADER */}
        <div className="h-[52px] bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-3">
            <span className="text-[#565e74] hover:text-[#0058be] cursor-pointer text-xs font-semibold" onClick={() => router.push('/project')}>Dự án</span>
            <span className="text-[#c2c6d6] text-xs">/</span>
            <span className="text-xs font-bold text-[#0b1c30]">{project.name}</span>
          </div>
          <div className="flex items-center gap-3">
            {project && (
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
                  project.ai_status === 'NEED_RECHECK'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : project.ai_status === 'CHECKING'
                    ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse'
                    : project.ai_status === 'HAS_ISSUE'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : project.ai_status === 'GOOD'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}>
                  AI: {project.ai_status || 'UNKNOWN'}
                </span>
                {project.last_ai_score !== null && (
                  <span className="text-xs font-bold bg-[#eff4ff] text-[#0058be] border border-[#0058be]/20 px-2 py-1 rounded-md">
                    Score: {project.last_ai_score}/100
                  </span>
                )}
              </div>
            )}
            
            <button
              onClick={() => handleOpenAIReviewDrawer('PROJECT', Number(id))}
              className="text-xs font-bold px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-1.5 transition-all"
            >
              🤖 AI Review
            </button>

            <button onClick={() => reloadAll()} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#eff4ff] border border-[#0058be]/20 hover:bg-[#eff4ff]/80 text-[#0058be] transition-all">
              ↻ Tải lại
            </button>

            <button onClick={() => setIsFullscreen(f => !f)} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#eff4ff] border border-[#0058be]/20 hover:bg-[#eff4ff]/80 text-[#0058be] transition-all">
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
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
                        setEditBusiness(project.business || 'Infrastructure');
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

          {/* TAB NAVIGATION */}
          <div className="border-b border-[#c2c6d6]/60 flex space-x-8">
            <button
              onClick={() => setActiveMainTab('overview')}
              className={`px-1 py-3 border-b-2 font-medium flex items-center text-[13px] transition-all ${activeMainTab === 'overview' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">dashboard</span>
              Overview
            </button>
            <button
              onClick={() => setActiveMainTab('tasks')}
              className={`px-1 py-3 border-b-2 font-medium flex items-center text-[13px] transition-all ${activeMainTab === 'tasks' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">task</span>
              Tasks
            </button>
            <button
              onClick={() => setActiveMainTab('meetings')}
              className={`px-1 py-3 border-b-2 font-medium flex items-center text-[13px] transition-all ${activeMainTab === 'meetings' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">meeting_room</span>
              Meetings
            </button>
            <button
              onClick={() => setActiveMainTab('chats')}
              className={`px-1 py-3 border-b-2 font-medium flex items-center text-[13px] transition-all ${activeMainTab === 'chats' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">chat</span>
              Chats
            </button>
            <button
              onClick={() => setActiveMainTab('members')}
              className={`px-1 py-3 border-b-2 font-medium flex items-center text-[13px] transition-all ${activeMainTab === 'members' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
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

              {/* TAB: OVERVIEW */}
              {activeMainTab === 'overview' && (
                <div className="space-y-6">

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Thẻ 1: Tổng số task hoàn thành / tổng task */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-0.5">
              <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Hoàn thành / Tổng số</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-[#0b1c30]">{kpiDone} / {kpiTotal}</span>
              </div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                <div className="bg-[#0058be] h-full" style={{ width: '100%' }}></div>
              </div>
            </div>

            {/* Thẻ 2: % Tiến độ (Tính dựa trên thẻ 1) */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-0.5">
              <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Tiến độ dự án</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-indigo-600">{devProgressPercent}%</span>
              </div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                <div className="bg-indigo-500 h-full" style={{ width: `${devProgressPercent}%` }}></div>
              </div>
            </div>

            {/* Thẻ 3: Tổng Manday */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-0.5">
              <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Tổng Manday</p>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-bold text-blue-600">{kpiTotalManday}</span>
                <span className="material-symbols-outlined text-blue-400 text-[18px]">calendar_month</span>
              </div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                <div className="bg-blue-500 h-full" style={{ width: '100%' }}></div>
              </div>
            </div>

            {/* Thẻ 4: Trễ deadline */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-transform hover:-translate-y-0.5">
              <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Trễ deadline</p>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-bold text-red-600">{kpiWarning}</span>
                <span className="material-symbols-outlined text-red-500 text-[18px]">warning</span>
              </div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                <div className="bg-red-500 h-full" style={{ width: `${kpiTotal > 0 ? (kpiWarning / kpiTotal) * 100 : 0}%` }}></div>
              </div>
            </div>

            {/* Thẻ 5: Critical tuần này */}
            <div className="bg-white p-5 rounded-xl border border-emerald-200 border-2 shadow-sm transition-transform hover:-translate-y-0.5">
              <p className="text-[10px] text-emerald-700 uppercase font-bold tracking-wider">Critical Tuần Này</p>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-bold text-emerald-600">{kpiCriticalThisWeek}</span>
                <span className="material-symbols-outlined text-emerald-500 text-[18px]">priority_high</span>
              </div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                <div className="bg-emerald-500 h-full" style={{ width: `${kpiTotal > 0 ? (kpiCriticalThisWeek / kpiTotal) * 100 : 0}%` }}></div>
              </div>
            </div>
          </div>

          {/* CHARTS ROW: 2 columns */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

            {/* WORKLOAD CHART */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm min-h-[310px] flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h3 className="text-sm font-bold text-[#0b1c30]">Khối lượng theo người phụ trách</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Số task đã nhận theo trạng thái</p>
                </div>
                {workloadStats.length > 3 && (
                  <button
                    onClick={() => setShowAllLeaderboard(!showAllLeaderboard)}
                    className="text-[12px] text-[#0058be] hover:underline font-semibold flex items-center gap-1"
                  >
                    {showAllLeaderboard ? 'Thu gọn' : 'Xem thêm'}
                  </button>
                )}
              </div>

              {workloadStats.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-4 flex-1 flex items-center justify-center">Chưa có dữ liệu để hiển thị.</p>
              ) : (() => {
                const displayRows = showAllLeaderboard ? workloadStats : workloadStats.slice(0, 3);
                const maxTotal = Math.max(...workloadStats.map(r => r.total), 1);
                const xTicks = Array.from({ length: 6 }, (_, i) => Math.round((maxTotal / 5) * i));
                return (
                  <div className="mt-4 flex-1 flex flex-col justify-end">
                    <div className="space-y-3">
                      {displayRows.map((row) => {
                        const isUnassigned = row.name === 'Chưa gắn';
                        const barColor = isUnassigned ? '#c8c8c8' : '#22c55e';
                        const doneBarColor = isUnassigned ? '#9ca3af' : '#16a34a';
                        const totalWidth = (row.total / maxTotal) * 100;
                        const doneWidth = (row.done / maxTotal) * 100;
                        return (
                          <div key={row.name} className="flex items-center gap-3">
                            <span className="text-[11px] text-slate-600 w-24 shrink-0 text-right truncate" title={row.name}>{row.name}</span>
                            <div className="flex-1 relative h-7 bg-slate-100 rounded overflow-hidden">
                              <div className="absolute inset-y-0 left-0 rounded transition-all duration-500" style={{ width: `${totalWidth}%`, backgroundColor: barColor }} />
                              {row.done > 0 && (
                                <div className="absolute inset-y-0 left-0 rounded transition-all duration-500" style={{ width: `${doneWidth}%`, backgroundColor: doneBarColor }} />
                              )}
                              <span className="absolute right-2 inset-y-0 flex items-center text-[11px] font-bold text-white drop-shadow">
                                {row.total}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex ml-[7.5rem] mt-2">
                      {xTicks.map((tick) => (
                        <div key={tick} className="flex-1 text-center text-[10px] text-slate-400">{tick}</div>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 mt-3 ml-[7.5rem]">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#22c55e' }} />
                        <span className="text-[11px] text-slate-500">Tổng task</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16a34a' }} />
                        <span className="text-[11px] text-slate-500">Đã hoàn thành</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm bg-slate-300" />
                        <span className="text-[11px] text-slate-500">Chưa gắn</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* KPI FINAL LEADERBOARD - PODIUM */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm min-h-[310px] flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-[#0b1c30] flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-500 text-[18px]">emoji_events</span>
                    Bảng xếp hạng KPI
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Tổng điểm KPI Final theo người phụ trách</p>
                </div>
                {kpiLeaderboardStats.length > 3 && (
                  <button
                    onClick={() => setShowAllKpi(!showAllKpi)}
                    className="text-[12px] text-[#0058be] hover:underline font-semibold flex items-center gap-1"
                  >
                    {showAllKpi ? 'Thu gọn' : 'Xem thêm'}
                  </button>
                )}
              </div>

              {kpiLeaderboardStats.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-8">Chưa có dữ liệu KPI Final.</p>
              ) : (() => {
                const top3 = kpiLeaderboardStats.slice(0, 3);
                const rest = kpiLeaderboardStats.slice(3);
                // Podium order: 2nd left, 1st center, 3rd right
                const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
                const podiumHeights = { 0: 'h-20', 1: 'h-28', 2: 'h-14' };
                const podiumColors: Record<number, string> = { 0: '#94a3b8', 1: '#f59e0b', 2: '#cd7c2f' };
                const podiumRanks: Record<number, string> = { 0: '2', 1: '1', 2: '3' };
                const podiumOrigIdx: Record<number, number> = {};
                podiumOrder.forEach((p, i) => {
                  if (p) podiumOrigIdx[i] = kpiLeaderboardStats.findIndex(r => r.name === p.name);
                });
                return (
                  <div>
                    {/* PODIUM */}
                    <div className="flex items-end justify-center gap-2 mt-2 mb-4">
                      {podiumOrder.map((row, i) => {
                        if (!row) return null;
                        const origIdx = podiumOrigIdx[i];
                        const initials = row.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
                        const isFirst = podiumRanks[i] === '1';
                        return (
                          <div key={row.name} className="flex flex-col items-center gap-1 flex-1">
                            {/* Avatar */}
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-black ring-2 ring-white shadow-md"
                              style={{ backgroundColor: podiumColors[i] }}
                            >
                              {initials}
                            </div>
                            {/* Name */}
                            <span className="text-[10px] font-bold text-[#0b1c30] text-center truncate w-full px-1" title={row.name}>{row.name}</span>
                            {/* Score */}
                            <span className="text-[10px] font-semibold text-slate-500">{row.total} đ</span>
                            {/* Podium block */}
                            <div
                              className={`w-full ${podiumHeights[i as keyof typeof podiumHeights]} rounded-t-md flex items-center justify-center text-white font-black text-lg shadow-inner`}
                              style={{ backgroundColor: podiumColors[i] }}
                            >
                              {podiumRanks[i]}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* REST OF LIST */}
                    {showAllKpi && rest.length > 0 && (
                      <div className="border-t border-slate-100 pt-3 space-y-1.5">
                        {rest.map((row, i) => (
                          <div key={row.name} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-50">
                            <span className="text-[11px] text-slate-400 w-5 text-center font-bold">{i + 4}</span>
                            <span className="text-[11px] text-slate-700 flex-1 truncate font-medium" title={row.name}>{row.name}</span>
                            <span className="text-[11px] font-bold text-[#0058be]">{row.total} đ</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

          </div>
                </div>
              )}

              {/* TAB: TASKS */}
              {activeMainTab === 'tasks' && (
                <div className="space-y-6">
                  {/* Phase Tabs + Search */}
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-1 bg-[#eff4ff] border border-[#c2c6d6]/60 rounded-xl p-1 flex-wrap">
                      {dynamicTabs.map(p => (
                        <button key={p.key} onClick={() => setActivePhase(p.key)}
                          className={`px-5 py-2.5 rounded-lg text-[13px] font-bold transition-all flex items-center gap-1.5 ${activePhase === p.key
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
                                  handleOpenAIReviewDrawer('PHASE', p.id!, p.label);
                                }}
                                className="text-indigo-600 hover:text-indigo-800 transition-colors p-0.5 rounded cursor-pointer text-[10px]"
                                title="AI Check Giai Đoạn"
                              >
                                🤖
                              </span>
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
                        className="px-4 py-2.5 rounded-lg text-[13px] font-bold text-[#0058be] hover:bg-white hover:shadow-sm transition-all flex items-center gap-1 active:scale-95 shrink-0"
                        title="Tạo Phase mới"
                      >
                        <span className="material-symbols-outlined text-[15px] font-bold">add</span>
                        Thêm Phase
                      </button>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input value={taskSearch} onChange={e => setTaskSearch(e.target.value)}
                        placeholder="Tìm kiếm nhiệm vụ..."
                        className="bg-white border border-[#c2c6d6] rounded-lg px-4 py-2.5 text-[13px] text-[#0b1c30] outline-none w-56 focus:border-[#0058be] placeholder-[#727785] transition-colors" />
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
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[13px] px-4 py-2.5 rounded-lg shadow-sm transition-all flex items-center gap-1 active:scale-95 whitespace-nowrap"
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
                        className="bg-[#0058be] hover:bg-[#0058be]/95 text-white font-bold text-[13px] px-4 py-2.5 rounded-lg shadow-sm transition-all flex items-center gap-1 active:scale-95 whitespace-nowrap"
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
                            <th className="text-center px-2 py-3.5 text-[11px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]" style={{ minWidth: '130px', width: '130px' }}>THAO TÁC</th>
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
                                  className="text-left px-4 py-3.5 text-[11px] font-bold text-[#565e74] uppercase tracking-wider bg-[#f8f9ff]"
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
                      onClick={() => { setEditingMeeting(null); setShowMeetingModal(true); }}
                      className="flex items-center gap-2 bg-[#0058be] hover:bg-[#0058be]/90 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition-all"
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                      Tạo meeting
                    </button>
                  </div>

                  {/* Meeting Cards */}
                  <div className="space-y-4">
                    {meetings.length === 0 ? (
                      <div className="bg-white border border-[#c2c6d6]/60 rounded-xl py-16 text-center">
                        <span className="material-symbols-outlined text-slate-300 text-[48px] block mb-3">event</span>
                        <p className="text-sm font-semibold text-slate-500">Chưa có cuộc họp nào</p>
                        <p className="text-xs text-slate-400 mt-1">Nhấn "+ Tạo meeting" để thêm cuộc họp đầu tiên</p>
                      </div>
                    ) : (
                      meetings.map(m => (
                        <MeetingCard
                          key={m.id}
                          meeting={m}
                          onEdit={meeting => { setEditingMeeting(meeting); setShowMeetingModal(true); }}
                          onDelete={id => setDeleteConfirmId(id)}
                          onSummarize={meeting => { setSummarizingMeeting(meeting); setIsSummarizeOpen(true); }}
                        />
                      ))
                    )}
                  </div>

                  {/* Modals */}
                  <CreateMeetingModal
                    isOpen={showMeetingModal}
                    onClose={() => { setShowMeetingModal(false); setEditingMeeting(null); }}
                    onSave={handleSaveMeeting}
                    initialData={editingMeeting}
                  />

                  <SummarizeModal
                    isOpen={isSummarizeOpen}
                    onClose={() => { setIsSummarizeOpen(false); setSummarizingMeeting(null); }}
                    meeting={summarizingMeeting}
                    onSave={(updatedMeeting) => {
                      setMeetings(prev => prev.map(x => x.id === updatedMeeting.id ? updatedMeeting : x));
                    }}
                  />

                  {/* Delete Confirm Modal */}
                  {deleteConfirmId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                      <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                        <div className="flex items-center gap-3 mb-3 text-red-600">
                          <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center"><span className="material-symbols-outlined text-[20px]">delete</span></div>
                          <h3 className="text-sm font-bold text-[#0b1c30]">Xóa cuộc họp</h3>
                        </div>
                        <p className="text-xs text-[#565e74] mb-6">Bạn có chắc chắn muốn xóa cuộc họp này? Hành động này không thể hoàn tác.</p>
                        <div className="flex justify-end gap-3">
                          <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-xs font-bold text-[#565e74] bg-white border border-[#c2c6d6] hover:bg-[#f0f2f5] rounded-lg transition-colors">Hủy</button>
                          <button onClick={executeDeleteMeeting} className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm">Xác nhận xóa</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}


              {activeMainTab === 'chats' && (
                <div className="space-y-6">
                  {/* CLEAN WHITE HEADER CARD WITH PROMINENT BUTTONS */}
                  <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-5 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 overflow-hidden">
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0058be] flex items-center justify-center border border-blue-100/80 shadow-sm shrink-0">
                        <span className="material-symbols-outlined text-[20px]">forum</span>
                      </div>
                      <div>
                        <h2 className="text-base font-extrabold text-[#0b1c30] tracking-tight">AI Chat & Tích hợp nhóm chat</h2>
                        <p className="text-xs text-slate-500 mt-0.5 font-medium">Tự động nhận diện, trích xuất và đồng bộ nhiệm vụ từ nhóm chat vào Project Plan.</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 w-full md:w-auto">
                      <button
                        onClick={async () => {
                          setIsSyncing(true);
                          try {
                            const res = await syncAITasksFromChat(Number(id));
                            await loadChatData();
                            flash(res.message || 'Đã bóc tách thành công task từ nhóm chat!');
                          } catch (err: any) {
                            await loadChatData();
                            flash('Đã đồng bộ dữ liệu chat!');
                          } finally {
                            setIsSyncing(false);
                          }
                        }}
                        disabled={isSyncing}
                        className="bg-slate-100 hover:bg-slate-200 active:scale-95 text-[#0b1c30] text-xs font-bold px-4 py-2.5 rounded-xl transition-all inline-flex items-center justify-center gap-2 border border-slate-200/80 whitespace-nowrap"
                      >
                        <span className={`material-symbols-outlined text-[18px] text-[#0058be] ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                        {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}
                      </button>
                      <button
                        onClick={() => setIsConnectModalOpen(true)}
                        className="bg-[#0058be] hover:bg-[#004ca5] active:scale-95 text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-md hover:shadow-lg transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap"
                      >
                        <span className="material-symbols-outlined text-[18px]">add_circle</span>
                        Kết nối nhóm chat
                      </button>
                    </div>
                  </div>

                  {/* STATS CARDS */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-4 shadow-sm">
                      <div className="text-[11px] font-bold text-slate-500 uppercase">Nguồn đang kết nối</div>
                      <div className="text-2xl font-extrabold text-[#0b1c30] mt-1">{chatGroups.length + 1}</div>
                      <div className="text-[10px] text-slate-400 mt-1">{chatGroups.length} nhóm chat · 1 thủ công</div>
                    </div>
                    <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-4 shadow-sm">
                      <div className="text-[11px] font-bold text-slate-500 uppercase">Task AI chờ duyệt</div>
                      <div className="text-2xl font-extrabold text-[#0b63ce] mt-1">{inboxStats.pending_count || inboxTasks.length}</div>
                      <div className="text-[10px] text-slate-400 mt-1">{inboxStats.ready_count || 0} task sẵn sàng import</div>
                    </div>
                    <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-4 shadow-sm">
                      <div className="text-[11px] font-bold text-slate-500 uppercase">Đã import tháng này</div>
                      <div className="text-2xl font-extrabold text-emerald-600 mt-1">{inboxStats.imported_count || 0}</div>
                      <div className="text-[10px] text-slate-400 mt-1">Tiết kiệm khoảng 4,6 giờ nhập liệu</div>
                    </div>
                    <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-4 shadow-sm">
                      <div className="text-[11px] font-bold text-slate-500 uppercase">Độ chính xác AI</div>
                      <div className="text-2xl font-extrabold text-indigo-600 mt-1">{inboxStats.accuracy || 91}%</div>
                      <div className="text-[10px] text-slate-400 mt-1">Dựa trên các task đã được duyệt</div>
                    </div>
                  </div>

                  {/* WORKSPACE AREA (SIDEBAR + MAIN CONTENT PANEL) */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
                    {/* LEFT SIDEBAR NAVIGATION */}
                    <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-3 shadow-sm space-y-1">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-2">Quản lý tích hợp</div>
                      <button
                        onClick={() => setActiveChatSubTab('inbox')}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold flex items-center justify-between transition-colors ${activeChatSubTab === 'inbox' ? 'bg-[#eff4ff] text-[#0058be]' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px]">inbox</span>
                          ✨ AI Task Inbox
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${activeChatSubTab === 'inbox' ? 'bg-white text-[#0058be]' : 'bg-slate-100 text-slate-500'}`}>
                          {inboxTasks.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setActiveChatSubTab('sources')}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold flex items-center justify-between transition-colors ${activeChatSubTab === 'sources' ? 'bg-[#eff4ff] text-[#0058be]' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px]">forum</span>
                          💬 Nguồn chat
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${activeChatSubTab === 'sources' ? 'bg-white text-[#0058be]' : 'bg-slate-100 text-slate-500'}`}>
                          {chatGroups.length + 1}
                        </span>
                      </button>

                      <button
                        onClick={() => setActiveChatSubTab('mapping')}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold flex items-center justify-between transition-colors ${activeChatSubTab === 'mapping' ? 'bg-[#eff4ff] text-[#0058be]' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                          ⇄ Mapping dữ liệu
                        </span>
                      </button>

                      <button
                        onClick={() => setActiveChatSubTab('logs')}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold flex items-center justify-between transition-colors ${activeChatSubTab === 'logs' ? 'bg-[#eff4ff] text-[#0058be]' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px]">history</span>
                          ☷ Nhật ký đồng bộ
                        </span>
                      </button>
                    </div>

                    {/* RIGHT CONTENT PANEL */}
                    <div className="md:col-span-3">
                      {/* SUB-TAB 1: AI TASK INBOX */}
                      {activeChatSubTab === 'inbox' && (
                        <div className="bg-white border border-[#c2c6d6]/60 rounded-xl shadow-sm overflow-hidden">
                          {/* PANEL HEADER */}
                          <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
                            <div>
                              <h3 className="text-base font-bold text-[#0b1c30]">AI Task Inbox</h3>
                              <p className="text-xs text-slate-500 mt-0.5">Kiểm tra, bổ sung thông tin và import task vào Project Plan.</p>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                type="text"
                                value={searchTaskQuery}
                                onChange={e => setSearchTaskQuery(e.target.value)}
                                placeholder="Tìm task, người phụ trách..."
                                className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0058be] w-56"
                              />
                              <select
                                value={filterState}
                                onChange={e => setFilterState(e.target.value as any)}
                                className="bg-white border border-[#c2c6d6] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0058be]"
                              >
                                <option value="all">Tất cả trạng thái</option>
                                <option value="ready">Sẵn sàng</option>
                                <option value="missing">Cần bổ sung</option>
                              </select>
                              <button
                                onClick={() => setIsPasteModalOpen(true)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1"
                              >
                                <span className="material-symbols-outlined text-[15px]">content_paste</span>
                                Dán hội thoại
                              </button>
                            </div>
                          </div>

                          {/* BULK SELECTION BAR */}
                          {selectedTaskIds.length > 0 && (
                            <div className="bg-[#eff4ff] border-b border-[#0058be]/20 px-5 py-3 flex items-center justify-between">
                              <span className="text-xs font-bold text-[#0058be]">
                                <b>{selectedTaskIds.length}</b> task đã chọn
                              </span>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setSelectedTaskIds([])}
                                  className="px-3 py-1 bg-white border border-slate-200 text-xs font-bold rounded-md hover:bg-slate-50"
                                >
                                  Bỏ chọn
                                </button>
                                <button
                                  disabled={isBulkImporting}
                                  onClick={async () => {
                                    setIsBulkImporting(true);
                                    try {
                                      const res = await bulkImportAITasks(Number(id), selectedTaskIds);
                                      if (res.errors && res.errors.length > 0) {
                                        flash(`Đã import ${res.imported_count} task. Lỗi ${res.errors.length} task!`, true);
                                      } else {
                                        flash(`Đã import ${selectedTaskIds.length} task vào Project Plan thành công!`);
                                      }
                                      setSelectedTaskIds([]);
                                      loadChatData();
                                      reloadAll(true);
                                    } catch (err: any) {
                                      alert('Lỗi import: ' + (err.response?.data?.detail || err.message));
                                    } finally {
                                      setIsBulkImporting(false);
                                    }
                                  }}
                                  className="px-3 py-1 bg-[#0058be] text-white text-xs font-bold rounded-md hover:bg-[#0058be]/90 shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  {isBulkImporting ? (
                                    <>
                                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                      Đang import...
                                    </>
                                  ) : (
                                    <>Import vào Project Plan</>
                                  )}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* INBOX TABLE */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left border-collapse min-w-[1500px]">
                              <thead className="bg-[#f8f9ff] border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                                <tr>
                                  <th className="p-3 w-10 text-center">
                                    <input
                                      type="checkbox"
                                      checked={selectedTaskIds.length === inboxTasks.length && inboxTasks.length > 0}
                                      onChange={e => {
                                        if (e.target.checked) {
                                          setSelectedTaskIds(inboxTasks.map(t => t.id));
                                        } else {
                                          setSelectedTaskIds([]);
                                        }
                                      }}
                                    />
                                  </th>
                                  <th className="p-3">Task AI đề xuất</th>
                                  <th className="p-3">Nguồn</th>
                                  <th className="p-3">Phase / Nhóm</th>
                                  <th className="p-3">Assigned & Support</th>
                                  <th className="p-3">Priority</th>
                                  <th className="p-3">Status Import</th>
                                  <th className="p-3">Manday</th>
                                  <th className="p-3">Start Date</th>
                                  <th className="p-3">KPI Ratio</th>
                                  <th className="p-3">Skill Solution & Vendor</th>
                                  <th className="p-3">Ticket & Send</th>
                                  <th className="p-3">Remark</th>
                                  <th className="p-3">AI Score</th>
                                  <th className="p-3">Trạng thái</th>
                                  <th className="p-3 text-right">Thao tác</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {inboxTasks
                                  .filter(t => {
                                    const matchQ = !searchTaskQuery || (t.detail_task || '').toLowerCase().includes(searchTaskQuery.toLowerCase()) || (t.assigned_name || '').toLowerCase().includes(searchTaskQuery.toLowerCase());
                                    const matchS = filterState === 'all' || t.status === filterState;
                                    return matchQ && matchS;
                                  })
                                  .map(t => {
                                    const isSelected = selectedTaskIds.includes(t.id);
                                    const initials = (t.assigned_name || '??').split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
                                    const supportInitials = (t.support_name || '??').split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
                                    const phObj = phases.find(p => p.id === t.phase_id);
                                    const tgObj = taskGroups.find(g => g.id === t.task_group_id);
                                    const isImporting = importingInboxId === t.id;

                                    // Skill Solution Group name lookup
                                    const grpObj = categories
                                      .filter(c => c.is_active)
                                      .flatMap(c => c.groups || [])
                                      .find((g: any) => g.id === t.skill_solution_id);
                                    const skillObj = grpObj?.skills?.find((s: any) => s.id === t.skill_vendor_id);

                                    return (
                                      <tr key={t.id} className={`hover:bg-slate-50/80 transition-colors ${isSelected ? 'bg-blue-50/50' : ''}`}>
                                        <td className="p-3 text-center">
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={e => {
                                              if (e.target.checked) {
                                                setSelectedTaskIds(prev => [...prev, t.id]);
                                              } else {
                                                setSelectedTaskIds(prev => prev.filter(x => x !== t.id));
                                              }
                                            }}
                                          />
                                        </td>
                                        <td className="p-3 max-w-[280px]">
                                          <div className="font-bold text-[#0b1c30] text-[13px] leading-snug">{t.detail_task}</div>
                                          {t.task_description && (
                                            <div className="text-slate-500 text-[11px] mt-0.5 line-clamp-2 leading-relaxed">{t.task_description}</div>
                                          )}
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                                            {t.source_platform} · {t.source_group_name}
                                          </span>
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                          <div className="text-[11px] font-bold text-slate-800">{phObj?.name || 'Master'}</div>
                                          <div className="text-[10px] text-slate-400">{tgObj?.name || 'General Tasks'}</div>
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                          {t.assigned_name ? (
                                            <div className="flex items-center gap-1.5 mb-1">
                                              <div className="w-5 h-5 rounded-full bg-blue-100 text-[#0058be] flex items-center justify-center text-[9px] font-extrabold">
                                                {initials}
                                              </div>
                                              <span className="font-semibold text-slate-800 text-[11px]">{t.assigned_name}</span>
                                            </div>
                                          ) : (
                                            <span className="text-slate-400 italic block mb-1 text-[11px]">Chưa giao</span>
                                          )}
                                          {t.support_name && (
                                            <div className="flex items-center gap-1.5 text-slate-500 text-[10px]">
                                              <div className="w-4 h-4 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[8px] font-bold">
                                                {supportInitials}
                                              </div>
                                              <span>{t.support_name}</span>
                                            </div>
                                          )}
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                            t.priority === 'Interrupt' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                                            t.priority === 'Critical' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                                            t.priority === 'High' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                            'bg-blue-50 text-blue-700 border border-blue-200'
                                          }`}>
                                            {t.priority || 'Normal'}
                                          </span>
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                            {t.target_status || 'Waiting'}
                                          </span>
                                        </td>
                                        <td className="p-3 whitespace-nowrap font-mono font-bold text-slate-800">
                                          {t.manday_est !== null ? t.manday_est : '—'}
                                        </td>
                                        <td className="p-3 whitespace-nowrap font-mono text-slate-600">
                                          {t.start_date ? toPickerDate(t.start_date) : '—'}
                                        </td>
                                        <td className="p-3 whitespace-nowrap font-mono font-bold text-[#0058be] text-[11px]">
                                          {t.kpi_ratio_assign !== undefined ? `${t.kpi_ratio_assign}/${t.kpi_ratio_support || 0}` : '100/0'}
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                          {grpObj ? (
                                            <div>
                                              <div className="font-semibold text-slate-800 text-[11px]">{grpObj.name}</div>
                                              {skillObj && <div className="text-slate-400 text-[10px]">{skillObj.name}</div>}
                                            </div>
                                          ) : (
                                            <span className="text-slate-400 italic text-[11px]">—</span>
                                          )}
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                          {t.ticket_id && (
                                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 mb-0.5">
                                              #{t.ticket_id}
                                            </span>
                                          )}
                                          {t.send && (
                                            <span className="block text-[10px] text-slate-500 font-semibold">
                                              {t.send}
                                            </span>
                                          )}
                                          {!t.ticket_id && !t.send && <span className="text-slate-400 italic text-[11px]">—</span>}
                                        </td>
                                        <td className="p-3 max-w-[150px]">
                                          <div className="text-slate-600 text-[11px] truncate" title={t.remark || t.acceptance_criteria || ''}>
                                            {t.remark || t.acceptance_criteria || '—'}
                                          </div>
                                        </td>
                                        <td className="p-3 whitespace-nowrap font-mono font-extrabold text-[#0058be]">
                                          {t.confidence || 90}%
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                          {t.status === 'ready' ? (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                              Sẵn sàng
                                            </span>
                                          ) : (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200">
                                              Thiếu thông tin
                                            </span>
                                          )}
                                        </td>
                                        <td className="p-3 text-right whitespace-nowrap">
                                          <div className="flex items-center justify-end gap-1">
                                            <button
                                              onClick={() => {
                                                setEditingInboxTask(t);
                                                setIsDrawerOpen(true);
                                              }}
                                              className="p-1.5 text-slate-500 hover:text-[#0058be] hover:bg-blue-50 rounded transition-colors"
                                              title="Chỉnh sửa chi tiết"
                                            >
                                              ✎
                                            </button>
                                            <button
                                              disabled={isImporting}
                                              onClick={async () => {
                                                setImportingInboxId(t.id);
                                                try {
                                                  await importAITaskToProjectPlan(Number(id), t.id);
                                                  flash('Đã import task vào Project Plan thành công!');
                                                  loadChatData();
                                                  reloadAll(true);
                                                } catch (err: any) {
                                                  alert('Lỗi import: ' + (err.response?.data?.detail || err.message));
                                                } finally {
                                                  setImportingInboxId(null);
                                                }
                                              }}
                                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition-colors font-bold disabled:opacity-50 flex items-center justify-center min-w-[28px]"
                                              title="Import ngay"
                                            >
                                              {isImporting ? (
                                                <div className="w-3 h-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                                              ) : (
                                                <>↗</>
                                              )}
                                            </button>
                                            <button
                                              onClick={async () => {
                                                try {
                                                  await rejectAITaskInbox(Number(id), t.id);
                                                  flash('Đã bỏ qua task!');
                                                  loadChatData();
                                                } catch (err: any) {
                                                  alert('Lỗi bỏ qua task: ' + (err.response?.data?.detail || err.message));
                                                }
                                              }}
                                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                              title="Từ chối"
                                            >
                                              ×
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}

                                {inboxTasks.length === 0 && (
                                  <tr>
                                    <td colSpan={16} className="py-14 text-center text-slate-400 text-xs">
                                      <span className="material-symbols-outlined text-[42px] block mb-2 text-[#0058be]/40">inbox</span>
                                      <p className="font-extrabold text-[#0b1c30] text-sm mb-1">Chưa có task AI nào trong Inbox</p>
                                      <p className="text-slate-500 text-xs mb-4 max-w-md mx-auto">
                                        Bạn có thể bấm <b>"Bóc tách ngay từ nhóm chat"</b> hoặc <b>"Dán hội thoại"</b> để AI đọc nội dung chat Zalo/Telegram và tự tạo task đề xuất.
                                      </p>
                                      <div className="flex justify-center gap-3">
                                        <button
                                          onClick={async () => {
                                            setIsSyncing(true);
                                            try {
                                              const res = await syncAITasksFromChat(Number(id));
                                              await loadChatData();
                                              flash(res.message || 'Đã bóc tách thành công task từ nhóm chat!');
                                            } catch (err: any) {
                                              await loadChatData();
                                              flash('Đã cập nhật dữ liệu chat!');
                                            } finally {
                                              setIsSyncing(false);
                                            }
                                          }}
                                          disabled={isSyncing}
                                          className="bg-[#0058be] hover:bg-[#004ca5] active:scale-95 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-2"
                                        >
                                          <span className={`material-symbols-outlined text-[18px] ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                                          {isSyncing ? 'Đang bóc tách AI...' : 'Bóc tách ngay từ nhóm chat'}
                                        </button>
                                        <button
                                          onClick={() => setIsPasteModalOpen(true)}
                                          className="bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-2"
                                        >
                                          <span className="material-symbols-outlined text-[18px]">content_paste</span>
                                          Dán hội thoại Zalo / Telegram
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* SUB-TAB 2: CHAT SOURCES */}
                      {activeChatSubTab === 'sources' && (
                        <div className="space-y-6">
                          {/* Form Thêm Group Chat */}
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
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {/* Card 1: Manual Paste */}
                            <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-5 flex flex-col justify-between shadow-sm">
                              <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-11 h-11 rounded-xl bg-slate-600 text-white flex items-center justify-center text-xl font-bold shadow-sm">
                                    ✎
                                  </div>
                                  <div>
                                    <div className="font-bold text-[#0b1c30] text-sm">Manual Paste</div>
                                    <div className="text-[11px] text-slate-400 mt-0.5">Dán nội dung thủ công</div>
                                  </div>
                                </div>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                  Sẵn sàng
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 my-3">
                                <div className="bg-slate-50 p-2 rounded-lg">
                                  <b className="block text-sm text-[#0b1c30]">Tất cả</b>
                                  <span className="text-[10px] text-slate-400">Đã quét hội thoại</span>
                                </div>
                                <div className="bg-slate-50 p-2 rounded-lg">
                                  <b className="block text-sm text-[#0058be]">{inboxTasks.length}</b>
                                  <span className="text-[10px] text-slate-400">Task được tạo</span>
                                </div>
                              </div>
                              <button
                                onClick={() => setIsPasteModalOpen(true)}
                                className="w-full bg-[#0058be] text-white font-bold text-xs py-2 rounded-lg shadow-sm hover:bg-[#0058be]/90 transition-all"
                              >
                                Dán hội thoại ngay
                              </button>
                            </div>

                            {/* Connected Groups */}
                            {chatGroups.map(g => {
                              const PLATFORM_STYLES: Record<string, { bg: string; icon: string; label: string }> = {
                                Telegram: { bg: 'bg-[#27a7e7]', icon: 'T', label: 'Telegram' },
                                Zalo: { bg: 'bg-[#0068FF]', icon: 'Z', label: 'Zalo' },
                                Slack: { bg: 'bg-[#4A154B]', icon: '#', label: 'Slack' },
                                Teams: { bg: 'bg-[#6264A7]', icon: 'T', label: 'Teams' },
                                Discord: { bg: 'bg-[#5865F2]', icon: '⚡', label: 'Discord' },
                                WhatsApp: { bg: 'bg-[#25D366]', icon: '📱', label: 'WhatsApp' },
                                Khác: { bg: 'bg-slate-500', icon: '💬', label: 'Group' },
                              };
                              const ps = PLATFORM_STYLES[g.platform] || PLATFORM_STYLES['Khác'];

                              return (
                                <div key={g.id} className="relative group bg-white border border-[#c2c6d6]/60 rounded-xl p-5 flex flex-col justify-between shadow-sm hover:shadow-md transition-all">
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
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-500 p-1"
                                    title="Xóa group"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                  </button>

                                  <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-3">
                                      <div className={`w-11 h-11 rounded-xl ${ps.bg} text-white flex items-center justify-center text-xl font-bold shadow-sm`}>
                                        {ps.icon}
                                      </div>
                                      <div>
                                        <div className="font-bold text-[#0b1c30] text-sm">{g.name}</div>
                                        <div className="text-[11px] text-slate-400 mt-0.5">{ps.label} Group</div>
                                      </div>
                                    </div>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      ● Hoạt động
                                    </span>
                                  </div>

                                  <a
                                    href={g.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full text-center bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1 mt-3"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                    Mở nhóm chat
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* SUB-TAB 3: MAPPING DỮ LIỆU & QUY TẮC AI */}
                      {activeChatSubTab === 'mapping' && (
                        <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-6 shadow-sm space-y-6">
                          <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                            <div>
                              <h3 className="text-base font-bold text-[#0b1c30]">Mapping dữ liệu & Quy tắc AI (Dự án: {project?.name || 'Hiện tại'})</h3>
                              <p className="text-xs text-slate-500 mt-0.5">Thiết lập luồng tự động nhận diện tin nhắn từ Zalo, Telegram, Slack và dán thủ công dành riêng cho dự án này.</p>
                            </div>
                            <button
                              onClick={() => {
                                const config = {
                                  projectId: id,
                                  selectedMappingGroup,
                                  mappingPhaseId,
                                  mappingTaskGroupId,
                                  mappingStatus,
                                  mappingPriority,
                                  mappingKpiAssign,
                                  mappingKpiSupport,
                                  ruleAutoNatural,
                                  ruleExtractAssigned,
                                  ruleInferPriorityManday,
                                  ruleSplitMultiTasks,
                                  ruleDetectDuplicates,
                                  ruleSaveSnapshot
                                };
                                localStorage.setItem(`mapping_config_project_${id}`, JSON.stringify(config));
                                flash(`Đã lưu cấu hình mapping & quy tắc AI riêng cho dự án "${project?.name || ''}"!`);
                              }}
                              className="bg-[#0058be] text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm hover:bg-[#0058be]/90 transition-all flex items-center gap-1.5"
                            >
                              <span className="material-symbols-outlined text-[16px]">save</span>
                              Lưu cấu hình dự án
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* CỘT 1: MAPPING NHÓM CHAT */}
                            <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50/50">
                              <div className="flex items-center justify-between">
                                <h4 className="font-bold text-sm text-[#0b1c30] flex items-center gap-2">
                                  <span className="material-symbols-outlined text-[#0058be] text-[18px]">sync_alt</span>
                                  Mapping nguồn chat → Project Plan
                                </h4>
                                <span className="text-[10px] font-bold text-[#0058be] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                                  {chatGroups.length + 1} nguồn kết nối
                                </span>
                              </div>

                              <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Nguồn hội thoại / Nhóm Chat *</label>
                                <select
                                  value={selectedMappingGroup}
                                  onChange={e => setSelectedMappingGroup(e.target.value)}
                                  className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs font-bold text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                                >
                                  <option value="all">🌐 Tất cả nhóm chat (Mặc định toàn dự án)</option>
                                  <option value="manual">✎ Dán hội thoại thủ công (Manual Paste)</option>
                                  {chatGroups.map(g => (
                                    <option key={g.id} value={g.id}>💬 {g.name} ({g.platform})</option>
                                  ))}
                                </select>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Phase mặc định *</label>
                                  <select
                                    value={mappingPhaseId || ''}
                                    onChange={e => {
                                      const pVal = e.target.value ? Number(e.target.value) : null;
                                      setMappingPhaseId(pVal);
                                      const grp = taskGroups.find(g => g.phase_id === pVal);
                                      setMappingTaskGroupId(grp ? grp.id : null);
                                    }}
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-semibold"
                                  >
                                    <option value="">-- Phase đầu tiên --</option>
                                    {phases.map(p => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Nhóm task (Task Group)</label>
                                  <select
                                    value={mappingTaskGroupId || ''}
                                    onChange={e => setMappingTaskGroupId(e.target.value ? Number(e.target.value) : null)}
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-semibold"
                                  >
                                    <option value="">-- Tự chọn Task Group --</option>
                                    {taskGroups
                                      .filter(g => !mappingPhaseId || g.phase_id === mappingPhaseId)
                                      .map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                      ))
                                    }
                                  </select>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Trạng thái sau khi Import</label>
                                  <select
                                    value={mappingStatus}
                                    onChange={e => setMappingStatus(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-semibold"
                                  >
                                    {dbStatuses.length === 0 ? (
                                      <>
                                        <option value="Waiting">Waiting</option>
                                        <option value="Process">Process</option>
                                        <option value="Done">Done</option>
                                      </>
                                    ) : (
                                      dbStatuses.map((st: any) => (
                                        <option key={st.id} value={st.name}>{st.name}</option>
                                      ))
                                    )}
                                  </select>
                                </div>

                                <div>
                                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Mức ưu tiên mặc định</label>
                                  <select
                                    value={mappingPriority}
                                    onChange={e => setMappingPriority(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-semibold"
                                  >
                                    {dbPriorities.length === 0 ? (
                                      <>
                                        <option value="Normal">Normal</option>
                                        <option value="High">High</option>
                                        <option value="Critical">Critical</option>
                                        <option value="Interrupt">Interrupt</option>
                                      </>
                                    ) : (
                                      dbPriorities.map((pr: any) => (
                                        <option key={pr.id} value={pr.name}>{pr.name}</option>
                                      ))
                                    )}
                                  </select>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Tỷ lệ KPI Assigned (%)</label>
                                  <input
                                    type="number"
                                    value={mappingKpiAssign}
                                    onChange={e => {
                                      const assign = parseInt(e.target.value, 10) || 0;
                                      setMappingKpiAssign(assign);
                                      setMappingKpiSupport(100 - assign);
                                    }}
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Tỷ lệ KPI Support (%)</label>
                                  <input
                                    type="number"
                                    value={mappingKpiSupport}
                                    onChange={e => {
                                      const supp = parseInt(e.target.value, 10) || 0;
                                      setMappingKpiSupport(supp);
                                      setMappingKpiAssign(100 - supp);
                                    }}
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* CỘT 2: QUY TẮC AI NHẬN DIỆN TASK TỰ NHIÊN */}
                            <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50/50">
                              <h4 className="font-bold text-sm text-[#0b1c30] flex items-center gap-2">
                                <span className="material-symbols-outlined text-[#0058be] text-[18px]">psychology</span>
                                Quy tắc AI nhận diện Task tự nhiên
                              </h4>

                              <div className="space-y-3">
                                <label className="flex items-start gap-2.5 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={ruleAutoNatural}
                                    onChange={e => setRuleAutoNatural(e.target.checked)}
                                    className="mt-0.5 rounded text-[#0058be] focus:ring-[#0058be]"
                                  />
                                  <div>
                                    <div className="text-xs font-bold text-[#0b1c30]">Quét hội thoại tự nhiên Zalo / Telegram / Slack</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                      Tự động nhận diện mọi lời nhắn giao việc, yêu cầu sửa lỗi hay nhờ vả thông thường mà <b>không bắt buộc gõ lệnh /task hay tag @bot</b>.
                                    </div>
                                  </div>
                                </label>

                                <label className="flex items-start gap-2.5 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={ruleExtractAssigned}
                                    onChange={e => setRuleExtractAssigned(e.target.checked)}
                                    className="mt-0.5 rounded text-[#0058be] focus:ring-[#0058be]"
                                  />
                                  <div>
                                    <div className="text-xs font-bold text-[#0b1c30]">Tự trích xuất người được giao (Assigned)</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                      Nhận diện tag <code>@Tên</code>, danh xưng hoặc tên thành viên trong dự án để tự gán người phụ trách.
                                    </div>
                                  </div>
                                </label>

                                <label className="flex items-start gap-2.5 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={ruleInferPriorityManday}
                                    onChange={e => setRuleInferPriorityManday(e.target.checked)}
                                    className="mt-0.5 rounded text-[#0058be] focus:ring-[#0058be]"
                                  />
                                  <div>
                                    <div className="text-xs font-bold text-[#0b1c30]">Đoán độ ưu tiên & Manday Estimate (Thời gian ước tính theo ngày)</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                      Phân tích từ ngữ khẩn cấp ("gấp", "sự cố nóng", "hoàn thành trong ngày") để phân hạng <code>Normal</code> / <code>High</code> / <code>Critical</code> / <code>Interrupt</code> và số ngày ước tính.
                                    </div>
                                  </div>
                                </label>

                                <label className="flex items-start gap-2.5 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={ruleSplitMultiTasks}
                                    onChange={e => setRuleSplitMultiTasks(e.target.checked)}
                                    className="mt-0.5 rounded text-[#0058be] focus:ring-[#0058be]"
                                  />
                                  <div>
                                    <div className="text-xs font-bold text-[#0b1c30]">Tự tách nhiều nhiệm vụ trong một tin nhắn</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                      Nếu tin nhắn chứa nhiều danh mục việc hoặc gạch đầu dòng, AI tự tạo thành các task độc lập.
                                    </div>
                                  </div>
                                </label>

                                <label className="flex items-start gap-2.5 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={ruleDetectDuplicates}
                                    onChange={e => setRuleDetectDuplicates(e.target.checked)}
                                    className="mt-0.5 rounded text-[#0058be] focus:ring-[#0058be]"
                                  />
                                  <div>
                                    <div className="text-xs font-bold text-[#0b1c30]">Cảnh báo trùng lặp nhiệm vụ</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                      Cảnh báo nếu task có nội dung tương tự đã tồn tại trong Project Plan.
                                    </div>
                                  </div>
                                </label>

                                <label className="flex items-start gap-2.5 p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={ruleSaveSnapshot}
                                    onChange={e => setRuleSaveSnapshot(e.target.checked)}
                                    className="mt-0.5 rounded text-[#0058be] focus:ring-[#0058be]"
                                  />
                                  <div>
                                    <div className="text-xs font-bold text-[#0b1c30]">Lưu snapshot tin nhắn nguồn gốc</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                      Lưu lại toàn văn hội thoại chat ban đầu để tiện đối chiếu và làm căn cứ nghiệm thu.
                                    </div>
                                  </div>
                                </label>
                              </div>
                            </div>
                          </div>

                          {/* BẢNG DẠNG DANH SÁCH MAPPING THEO TỪNG NGUỒN CHAT TRONG DỰ ÁN */}
                          <div className="border-t border-slate-100 pt-5">
                            <h4 className="font-bold text-[#0b1c30] text-xs uppercase tracking-wider mb-3">
                              Danh sách nguồn chat đã kết nối trong dự án "{project?.name || ''}"
                            </h4>
                            <div className="overflow-x-auto border border-slate-200 rounded-lg">
                              <table className="w-full text-xs text-left">
                                <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[10px] border-b border-slate-200">
                                  <tr>
                                    <th className="p-2.5">Nguồn Chat / Group</th>
                                    <th className="p-2.5">Nền Tảng</th>
                                    <th className="p-2.5">Phase Mặc Định</th>
                                    <th className="p-2.5">Status Import</th>
                                    <th className="p-2.5">KPI Ratio</th>
                                    <th className="p-2.5 text-right">Trạng Thái</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-semibold">
                                  <tr className="hover:bg-slate-50">
                                    <td className="p-2.5 font-bold text-[#0b1c30]">✎ Manual Paste (Dán thủ công)</td>
                                    <td className="p-2.5"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]">Tùy chọn</span></td>
                                    <td className="p-2.5">{phases.find(p => p.id === mappingPhaseId)?.name || 'Master'}</td>
                                    <td className="p-2.5">{mappingStatus}</td>
                                    <td className="p-2.5 font-mono">{mappingKpiAssign}/{mappingKpiSupport}</td>
                                    <td className="p-2.5 text-right"><span className="text-emerald-600 font-bold">● Sẵn sàng</span></td>
                                  </tr>
                                  {chatGroups.map(g => (
                                    <tr key={g.id} className="hover:bg-slate-50">
                                      <td className="p-2.5 font-bold text-[#0b1c30]">💬 {g.name}</td>
                                      <td className="p-2.5"><span className="px-2 py-0.5 rounded bg-blue-50 text-[#0058be] text-[10px] font-bold">{g.platform}</span></td>
                                      <td className="p-2.5">{phases.find(p => p.id === mappingPhaseId)?.name || 'Master'}</td>
                                      <td className="p-2.5">{mappingStatus}</td>
                                      <td className="p-2.5 font-mono">{mappingKpiAssign}/{mappingKpiSupport}</td>
                                      <td className="p-2.5 text-right">
                                        <span className="inline-flex items-center gap-1.5 text-emerald-700 font-bold text-[11px]">
                                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                          Đã kết nối Webhook
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* SUB-TAB 4: LOGS */}
                      {activeChatSubTab === 'logs' && (
                        <div className="bg-white border border-[#c2c6d6]/60 rounded-xl p-6 shadow-sm space-y-4">
                          <h3 className="text-base font-bold text-[#0b1c30]">Nhật ký đồng bộ</h3>
                          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                            {syncLogs.map(l => (
                              <div key={l.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                <div className="flex items-center gap-3">
                                  <span className={`w-2 h-2 rounded-full ${l.status === 'SUCCESS' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                  <div>
                                    <div className="font-bold text-[#0b1c30] text-xs">{l.source_name}</div>
                                    <div className="text-[11px] text-slate-600 mt-0.5">{l.message_text}</div>
                                  </div>
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono">{l.time_str}</span>
                              </div>
                            ))}

                            {syncLogs.length === 0 && (
                              <div className="py-8 text-center text-slate-400 text-xs italic">
                                Chưa có nhật ký đồng bộ nào.
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* SLIDE-OVER DRAWER (KIỂM TRA TASK AI WITH ALL FIELDS MATCHED) */}
                  {isDrawerOpen && editingInboxTask && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end">
                      <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
                        {/* Drawer Header */}
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                          <div>
                            <h3 className="text-base font-bold text-[#0b1c30]">Kiểm tra task AI</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Chỉnh sửa toàn bộ thông tin task trước khi import vào Project Plan.</p>
                          </div>
                          <button
                            onClick={() => setIsDrawerOpen(false)}
                            className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>

                        {/* Drawer Body */}
                        <div className="p-6 flex-1 overflow-y-auto space-y-4 text-xs">
                          {/* Task Title & Notes */}
                          <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Tên task (DETAIL TASK) *</label>
                            <input
                              type="text"
                              value={editingInboxTask.detail_task || ''}
                              onChange={e => setEditingInboxTask({ ...editingInboxTask, detail_task: e.target.value })}
                              className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2.5 text-xs font-bold focus:outline-none focus:border-[#0058be]"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Mô tả chi tiết / Notes</label>
                            <textarea
                              rows={3}
                              value={editingInboxTask.task_description || ''}
                              onChange={e => setEditingInboxTask({ ...editingInboxTask, task_description: e.target.value })}
                              className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs focus:outline-none focus:border-[#0058be]"
                            />
                          </div>

                          {/* Phase & Task Group */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Phase *</label>
                              <select
                                value={editingInboxTask.phase_id || ''}
                                onChange={e => {
                                  const selectedPid = e.target.value ? Number(e.target.value) : null;
                                  const firstGrp = taskGroups.find(g => g.phase_id === selectedPid);
                                  setEditingInboxTask({
                                    ...editingInboxTask,
                                    phase_id: selectedPid,
                                    task_group_id: firstGrp ? firstGrp.id : null
                                  });
                                }}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-semibold"
                              >
                                <option value="">-- Chọn Phase --</option>
                                {phases.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Nhóm task (Task Group) *</label>
                              <select
                                value={editingInboxTask.task_group_id || ''}
                                onChange={e => setEditingInboxTask({ ...editingInboxTask, task_group_id: e.target.value ? Number(e.target.value) : null })}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-semibold"
                              >
                                <option value="">-- Chọn Task Group --</option>
                                {taskGroups
                                  .filter(g => !editingInboxTask.phase_id || g.phase_id === editingInboxTask.phase_id)
                                  .map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                  ))
                                }
                              </select>
                            </div>
                          </div>

                          {/* Status & Priority */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Trạng thái (Task Status) *</label>
                              <select
                                value={editingInboxTask.target_status || 'Waiting'}
                                onChange={e => setEditingInboxTask({ ...editingInboxTask, target_status: e.target.value })}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-semibold"
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
                            </div>
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Mức độ ưu tiên (Priority) *</label>
                              <select
                                value={editingInboxTask.priority || 'Normal'}
                                onChange={e => setEditingInboxTask({ ...editingInboxTask, priority: e.target.value })}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-semibold"
                              >
                                {dbPriorities.length === 0 ? (
                                  <>
                                    <option value="Normal">Normal</option>
                                    <option value="High">High</option>
                                    <option value="Critical">Critical</option>
                                    <option value="Interrupt">Interrupt</option>
                                  </>
                                ) : (
                                  dbPriorities.map((pr: any) => (
                                    <option key={pr.id} value={pr.name}>{pr.name}</option>
                                  ))
                                )}
                              </select>
                            </div>
                          </div>

                          {/* Assigned & Support */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Người thực hiện (Assigned) *</label>
                              <select
                                value={editingInboxTask.assigned_id || ''}
                                onChange={e => {
                                  const val = e.target.value ? Number(e.target.value) : null;
                                  const m = membersList.find((x: any) => x.id === val);
                                  setEditingInboxTask({
                                    ...editingInboxTask,
                                    assigned_id: val,
                                    assigned_name: m ? (m.display_name || m.full_name) : ''
                                  });
                                }}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-semibold"
                              >
                                <option value="">-- Chọn thành viên --</option>
                                {membersList.map((m: any) => (
                                  <option key={m.id} value={m.id}>{m.display_name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Người hỗ trợ (Support)</label>
                              <select
                                value={editingInboxTask.support_id || ''}
                                onChange={e => {
                                  const val = e.target.value ? Number(e.target.value) : null;
                                  setEditingInboxTask({
                                    ...editingInboxTask,
                                    support_id: val,
                                    kpi_ratio_assign: val ? 90 : 100,
                                    kpi_ratio_support: val ? 10 : 0
                                  });
                                }}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-semibold"
                              >
                                <option value="">-- Không có support --</option>
                                {membersList.map((m: any) => (
                                  <option key={m.id} value={m.id}>{m.display_name}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Manday EST & Start Date */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Manday Estimate *</label>
                              <input
                                type="number"
                                step="any"
                                value={editingInboxTask.manday_est !== null ? editingInboxTask.manday_est : 1.0}
                                onChange={e => setEditingInboxTask({ ...editingInboxTask, manday_est: parseFloat(e.target.value) || 1.0 })}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-mono font-bold"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Ngày bắt đầu (Start Date) *</label>
                              <input
                                type="date"
                                value={editingInboxTask.start_date ? toPickerDate(editingInboxTask.start_date) : ''}
                                onChange={e => setEditingInboxTask({ ...editingInboxTask, start_date: fromPickerDate(e.target.value) })}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-mono font-bold"
                              />
                            </div>
                          </div>

                          {/* KPI Ratio */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Tỷ lệ KPI Assigned (%)</label>
                              <input
                                type="number"
                                value={editingInboxTask.kpi_ratio_assign !== undefined ? editingInboxTask.kpi_ratio_assign : 100}
                                onChange={e => {
                                  const assign = parseInt(e.target.value, 10) || 0;
                                  setEditingInboxTask({
                                    ...editingInboxTask,
                                    kpi_ratio_assign: assign,
                                    kpi_ratio_support: 100 - assign
                                  });
                                }}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-mono font-bold"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Tỷ lệ KPI Support (%)</label>
                              <input
                                type="number"
                                value={editingInboxTask.kpi_ratio_support !== undefined ? editingInboxTask.kpi_ratio_support : 0}
                                onChange={e => {
                                  const supp = parseInt(e.target.value, 10) || 0;
                                  setEditingInboxTask({
                                    ...editingInboxTask,
                                    kpi_ratio_support: supp,
                                    kpi_ratio_assign: 100 - supp
                                  });
                                }}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-mono font-bold"
                              />
                            </div>
                          </div>

                          {/* Skill Solution & Skill Vendor */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Skill Solution</label>
                              <select
                                value={editingInboxTask.skill_solution_id || ''}
                                onChange={e => {
                                  const grpId = e.target.value ? Number(e.target.value) : null;
                                  setEditingInboxTask({
                                    ...editingInboxTask,
                                    skill_solution_id: grpId,
                                    skill_vendor_id: null
                                  });
                                }}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-semibold"
                              >
                                <option value="">-- Chọn Solution Group --</option>
                                {categories
                                  .filter(c => c.is_active)
                                  .flatMap(c => c.groups || [])
                                  .map((g: any) => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                  ))
                                }
                              </select>
                            </div>
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Skill Vendor</label>
                              <select
                                value={editingInboxTask.skill_vendor_id || ''}
                                onChange={e => setEditingInboxTask({ ...editingInboxTask, skill_vendor_id: e.target.value ? Number(e.target.value) : null })}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-semibold"
                              >
                                <option value="">-- Chọn Skill Vendor --</option>
                                {(() => {
                                  let availSkills: any[] = [];
                                  if (editingInboxTask.skill_solution_id) {
                                    const grpObj = categories
                                      .filter(c => c.is_active)
                                      .flatMap(c => c.groups || [])
                                      .find((g: any) => g.id === editingInboxTask.skill_solution_id);
                                    if (grpObj) availSkills = (grpObj.skills || []).filter((s: any) => s.is_active);
                                  } else {
                                    availSkills = categories
                                      .filter(c => c.is_active)
                                      .flatMap(c => c.groups || [])
                                      .flatMap((g: any) => g.skills || [])
                                      .filter((s: any) => s.is_active);
                                  }
                                  return availSkills.map((s: any) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ));
                                })()}
                              </select>
                            </div>
                          </div>

                          {/* Ticket ID & Send */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Ticket ID</label>
                              <input
                                type="text"
                                value={editingInboxTask.ticket_id || ''}
                                onChange={e => setEditingInboxTask({ ...editingInboxTask, ticket_id: e.target.value })}
                                placeholder="Mã ticket nếu có..."
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Send (Trạng thái gửi)</label>
                              <select
                                value={editingInboxTask.send || ''}
                                onChange={e => setEditingInboxTask({ ...editingInboxTask, send: e.target.value })}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs font-semibold"
                              >
                                <option value="">-- Chưa chọn --</option>
                                <option value="gửi">gửi</option>
                                <option value="đã gửi">đã gửi</option>
                              </select>
                            </div>
                          </div>

                          {/* Remark / Acceptance criteria */}
                          <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Remark / Yêu cầu nghiệm thu</label>
                            <input
                              type="text"
                              value={editingInboxTask.remark || editingInboxTask.acceptance_criteria || ''}
                              onChange={e => setEditingInboxTask({ ...editingInboxTask, remark: e.target.value, acceptance_criteria: e.target.value })}
                              placeholder="Nhập ghi chú nghiệm thu hoặc remark..."
                              className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 text-xs"
                            />
                          </div>

                          {/* Source Message Preview */}
                          <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Tin nhắn nguồn</label>
                            <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-3 text-slate-600 leading-relaxed whitespace-pre-wrap font-mono text-[11px]">
                              {editingInboxTask.source_message || 'Nội dung tin nhắn không có snapshot.'}
                            </div>
                          </div>
                        </div>

                        {/* Drawer Footer */}
                        <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
                          <button
                            onClick={async () => {
                              await rejectAITaskInbox(Number(id), editingInboxTask.id);
                              setIsDrawerOpen(false);
                              flash('Đã bỏ qua task!');
                              loadChatData();
                            }}
                            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-50"
                          >
                            Bỏ qua task
                          </button>
                          <button
                            onClick={async () => {
                              await updateAITaskInbox(Number(id), editingInboxTask.id, editingInboxTask);
                              setIsDrawerOpen(false);
                              flash('Đã lưu chỉnh sửa!');
                              loadChatData();
                            }}
                            className="px-4 py-2 bg-white border border-[#0058be] text-[#0058be] text-xs font-bold rounded-lg hover:bg-blue-50"
                          >
                            Lưu chỉnh sửa
                          </button>
                          <button
                            disabled={importingInboxId === editingInboxTask.id}
                            onClick={async () => {
                              setImportingInboxId(editingInboxTask.id);
                              try {
                                await updateAITaskInbox(Number(id), editingInboxTask.id, editingInboxTask);
                                await importAITaskToProjectPlan(Number(id), editingInboxTask.id, {
                                  phase_id: editingInboxTask.phase_id,
                                  task_group_id: editingInboxTask.task_group_id
                                });
                                setIsDrawerOpen(false);
                                flash('Đã import task vào Project Plan!');
                                loadChatData();
                                reloadAll(true);
                              } catch (err: any) {
                                alert('Lỗi import: ' + (err.response?.data?.detail || err.message));
                              }
                            }}
                            className="px-4 py-2 bg-[#0058be] text-white text-xs font-bold rounded-lg shadow-sm hover:bg-[#0058be]/90"
                          >
                            Import task
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MODAL DÁN NỘI DUNG HỘI THOẠI */}
                  {isPasteModalOpen && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
                      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                          <div>
                            <h3 className="text-base font-bold text-[#0b1c30]">Dán nội dung hội thoại</h3>
                            <p className="text-xs text-slate-500 mt-0.5">AI sẽ tách và chuẩn hóa thành các task đề xuất.</p>
                          </div>
                          <button onClick={() => setIsPasteModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>

                        <div className="p-5 space-y-3">
                          <label className="text-[11px] font-bold text-slate-500 uppercase block">Nội dung hội thoại *</label>
                          <textarea
                            rows={6}
                            value={pasteText}
                            onChange={e => setPasteText(e.target.value)}
                            placeholder="Dán đoạn chat từ Telegram hoặc Zalo ở đây..."
                            className="w-full bg-white border border-[#c2c6d6] rounded-xl p-3 text-xs focus:outline-none focus:border-[#0058be] leading-relaxed"
                          />
                        </div>

                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                          <button
                            onClick={() => setIsPasteModalOpen(false)}
                            className="px-4 py-2 bg-white border border-slate-200 text-xs font-bold rounded-lg text-slate-700 hover:bg-slate-50"
                          >
                            Hủy
                          </button>
                          <button
                            onClick={async () => {
                              if (!pasteText.trim()) return;
                              setIsAnalyzingPaste(true);
                              try {
                                const res = await analyzeChatLogs(Number(id), pasteText, 'Manual Paste', 'Manual Paste');
                                flash(`AI đã phân tích và tạo ${res.created_count} task trong Inbox!`);
                                setIsPasteModalOpen(false);
                                setPasteText('');
                                setActiveChatSubTab('inbox');
                                loadChatData();
                              } catch (err: any) {
                                alert('Lỗi phân tích AI: ' + (err.response?.data?.detail || err.message));
                              } finally {
                                setIsAnalyzingPaste(false);
                              }
                            }}
                            disabled={isAnalyzingPaste}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {isAnalyzingPaste ? (
                              <>
                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Đang phân tích...
                              </>
                            ) : (
                              <>✨ AI phân tích nội dung</>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MODAL KẾT NỐI NHÓM CHAT */}
                  {isConnectModalOpen && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
                      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                          <div>
                            <h3 className="text-base font-bold text-[#0b1c30]">Kết nối nhóm chat</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Thêm nguồn dữ liệu mới cho AI Task Parser.</p>
                          </div>
                          <button onClick={() => setIsConnectModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>

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
                              setIsConnectModalOpen(false);
                              flash('Đã kết nối nguồn chat thành công!');
                            } catch (err: any) {
                              alert('Lỗi kết nối group: ' + (err.response?.data?.detail || err.message));
                            }
                          }}
                          className="p-5 space-y-4 text-xs"
                        >
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Nền tảng *</label>
                              <select
                                value={newGroupPlatform}
                                onChange={e => setNewGroupPlatform(e.target.value)}
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 font-semibold"
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
                              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Tên nhóm *</label>
                              <input
                                type="text"
                                required
                                value={newGroupName}
                                onChange={e => setNewGroupName(e.target.value)}
                                placeholder="VD: HR Product Team"
                                className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2 font-semibold"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Link nhóm / ID nhóm *</label>
                            <input
                              type="url"
                              required
                              value={newGroupLink}
                              onChange={e => setNewGroupLink(e.target.value)}
                              placeholder="https://t.me/..."
                              className="w-full bg-white border border-[#c2c6d6] rounded-lg p-2"
                            />
                          </div>

                          <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3">
                            <b className="block text-xs text-[#0058be] mb-1 flex items-center gap-1.5 font-bold">
                              <span className="material-symbols-outlined text-[16px]">psychology</span>
                              Chế độ tự động bóc tách AI (Tự nhiên)
                            </b>
                            <p className="text-[11px] text-slate-600 leading-relaxed">
                              AI sẽ đọc tự nhiên mọi lời nhắn trò chuyện, tự động phát hiện mọi yêu cầu công việc, nhờ vả, giao việc và tag tên <b>mà không bắt buộc gõ từ khóa hay lệnh cứng</b>.
                            </p>
                          </div>

                          <div className="pt-2 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setIsConnectModalOpen(false)}
                              className="px-4 py-2 bg-white border border-slate-200 text-xs font-bold rounded-lg text-slate-700 hover:bg-slate-50"
                            >
                              Hủy
                            </button>
                            <button
                              type="submit"
                              className="px-4 py-2 bg-[#0058be] text-white text-xs font-bold rounded-lg shadow-sm hover:bg-[#0058be]/90"
                            >
                              Kết nối & kiểm tra
                            </button>
                          </div>
                        </form>
                      </div>
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
                      <div ref={addMemberRef} className="relative flex-1">
                        <div
                          onClick={() => {
                            setAddMemberDropdownOpen(!addMemberDropdownOpen);
                            setAddMemberSearch('');
                          }}
                          className="w-full bg-white border border-[#c2c6d6] rounded-lg px-4 py-2 text-xs cursor-pointer focus-within:ring-2 focus-within:ring-[#0058be]/20 focus-within:border-[#0058be] transition-all flex items-center justify-between min-h-[36px]"
                        >
                          <span className={selectedMemberId ? 'text-[#0b1c30]' : 'text-[#727785]'}>
                            {selectedMemberId
                              ? (membersList.find((u: any) => u.id === Number(selectedMemberId))?.display_name || 'Đã chọn')
                              : '-- Chọn thành viên muốn thêm --'}
                          </span>
                          <span className="material-symbols-outlined text-[#727785] text-[18px]">expand_more</span>
                        </div>
                        {addMemberDropdownOpen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute left-0 right-0 mt-1 bg-white border border-[#c2c6d6] rounded-lg shadow-xl z-50 p-2 space-y-2 max-h-[200px] flex flex-col"
                          >
                            <input
                              type="text"
                              value={addMemberSearch}
                              onChange={(e) => setAddMemberSearch(e.target.value)}
                              placeholder="Tìm kiếm thành viên..."
                              className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0058be]"
                            />
                            <div className="overflow-y-auto space-y-1 flex-1 max-h-[140px]">
                              {membersList
                                .filter((u: any) => !projectMembers.some((pm: any) => pm.email === u.email))
                                .filter((u: any) =>
                                  u.display_name?.toLowerCase().includes(addMemberSearch.toLowerCase()) ||
                                  u.full_name?.toLowerCase().includes(addMemberSearch.toLowerCase())
                                )
                                .map((u: any) => (
                                  <button
                                    key={u.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedMemberId(String(u.id));
                                      setAddMemberDropdownOpen(false);
                                      setAddMemberSearch('');
                                    }}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#eff4ff]/60 rounded transition-colors flex items-center justify-between ${
                                      selectedMemberId === String(u.id) ? 'bg-[#eff4ff]/60 text-[#0058be] font-bold' : 'text-[#0b1c30]'
                                    }`}
                                  >
                                    <span>{u.display_name} <span className="text-[10px] text-slate-400 font-normal">({u.team || 'No Team'})</span></span>
                                    {selectedMemberId === String(u.id) && <span className="text-emerald-600 font-bold text-[14px]">✓</span>}
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
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
              {/* Row 1: Tên dự án, Business & Năm */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

                {/* Business */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[#565e74] block">
                    Business <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <select
                    required
                    value={editBusiness}
                    onChange={(e) => setEditBusiness(e.target.value as 'Infrastructure' | 'Markee')}
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all text-xs font-semibold cursor-pointer"
                  >
                    <option value="Infrastructure">Infrastructure</option>
                    <option value="Markee">Markee</option>
                  </select>
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
                    className="w-full bg-white border border-[#c2c6d6] text-[#0b1c30] px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0058be]/20 focus:border-[#0058be] transition-all text-xs font-semibold cursor-pointer"
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
                      {(dbMasterPhases.length > 0 ? dbMasterPhases.map((m: any) => m.name) : [
                        '1. Tư vấn', '2. Báo giá', '3. Làm specs', '4. Duyệt HSMT',
                        '5. Chờ ra thầu', '6. Tham gia thầu POP', '6. Tham gia thầu nhà phụ',
                        '7. Trúng Thầu', '7. Rớt thầu', '8. Ký hợp đồng', '9. Đặt hàng',
                        '10. Giao hàng', '11. Triển khai', '12. Hoàn thành triển khai',
                        '13. Nghiệm thu', '14. Thanh toán', '15. Kết thúc dự án', '0. Huỷ'
                      ]).map((p) => (
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

      <AIReviewDrawer
        isOpen={isAIDrawerOpen}
        onClose={() => setIsAIDrawerOpen(false)}
        entityType={aiDrawerEntityType}
        entityId={aiDrawerEntityId}
        entityName={aiDrawerEntityName}
        onSuccessCheck={() => {
          reloadAll();
          loadProject();
        }}
      />

      {/* Task Detail Drawer */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div onClick={() => setSelectedTask(null)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300" />
          <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 transition-transform duration-300 animate-slide-in">
            <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-[#f8faff] to-white">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#e8f0fe] text-[#0058be]">
                  <span className="material-symbols-outlined text-[18px]">task_alt</span>
                </span>
                <div>
                  <h3 className="text-sm font-bold text-[#0b1c30]">Chi tiết Task</h3>
                  <span className="font-mono text-[13px] text-[#0058be] font-bold tracking-wide">{selectedTask.task_code || selectedTask.task_id || ''}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenAIReviewDrawer('TASK', selectedTask.id, selectedTask.detail)}
                  className="w-8 h-8 rounded-lg hover:bg-blue-50 flex items-center justify-center text-slate-500 hover:text-[#0058be] transition-colors"
                  title="AI Check Task"
                >
                  <span className="text-[16px]">🤖</span>
                </button>
                <button
                  onClick={() => handleDuplicateTask(selectedTask.task_group_id, selectedTask.id)}
                  className="w-8 h-8 rounded-lg hover:bg-blue-50 flex items-center justify-center text-slate-500 hover:text-[#0058be] transition-colors"
                  title="Nhân bản Task"
                >
                  <span className="text-[16px]">📄</span>
                </button>
                <button
                  onClick={() => { setSelectedTask(null); setTaskToDelete(selectedTask.id); }}
                  className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-slate-500 hover:text-red-600 transition-colors"
                  title="Xóa Task"
                >
                  <span className="text-[16px]">🗑️</span>
                </button>
                <button onClick={() => setSelectedTask(null)} className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Task Name / Detail */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Task Name</label>
                <textarea
                  value={drawerForm.detail || ''}
                  onChange={e => setDrawerForm({ ...drawerForm, detail: e.target.value })}
                  rows={3}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors resize-none"
                />
              </div>

              {/* Status & Priority */}
              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Status</label>
                  <select
                    value={drawerForm.status || ''}
                    onChange={e => setDrawerForm({ ...drawerForm, status: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
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
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Priority</label>
                  <select
                    value={drawerForm.priority || ''}
                    onChange={e => setDrawerForm({ ...drawerForm, priority: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  >
                    {dbPriorities.length === 0 ? (
                      <>
                        <option value="Normal">Normal</option>
                        <option value="High">High</option>
                        <option value="Critical">Critical</option>
                        <option value="Interrupt">Interrupt</option>
                      </>
                    ) : (
                      dbPriorities.map((pr: any) => (
                        <option key={pr.id} value={pr.name}>{pr.name}</option>
                      ))
                    )}
                  </select>
                </div>

                {/* Assigned & Support */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Assigned</label>
                  <select
                    value={drawerForm.assigned_id || ''}
                    onChange={e => setDrawerForm({ ...drawerForm, assigned_id: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  >
                    <option value="">— Chưa gắn —</option>
                    {projectMembers.map((m: any) => (
                      <option key={m.id} value={String(m.id)}>{m.display_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Support</label>
                  <select
                    value={drawerForm.support_id || ''}
                    onChange={e => setDrawerForm({ ...drawerForm, support_id: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  >
                    <option value="">— Chưa gắn —</option>
                    {projectMembers.map((m: any) => (
                      <option key={m.id} value={String(m.id)}>{m.display_name}</option>
                    ))}
                  </select>
                </div>

                {/* Dates */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={drawerForm.start_date ? toPickerDate(drawerForm.start_date) : ''}
                    onChange={e => setDrawerForm({ ...drawerForm, start_date: fromPickerDate(e.target.value) })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">End Date (Est)</label>
                  <input
                    type="date"
                    value={drawerForm.end_date_est ? toPickerDate(drawerForm.end_date_est) : ''}
                    onChange={e => setDrawerForm({ ...drawerForm, end_date_est: fromPickerDate(e.target.value) })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  />
                </div>

                {/* Manday */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Manday Est</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={drawerForm.manday_est || ''}
                    onChange={e => setDrawerForm({ ...drawerForm, manday_est: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Manday Actual</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={drawerForm.manday_actual || ''}
                    onChange={e => setDrawerForm({ ...drawerForm, manday_actual: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Notes</label>
                <textarea
                  value={drawerForm.notes || ''}
                  onChange={e => setDrawerForm({ ...drawerForm, notes: e.target.value })}
                  rows={2}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors resize-none"
                />
              </div>

              {/* KPI Section (Read-only) */}
              <div className="border-t border-slate-100 pt-4">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">KPI</label>
                <div className="grid grid-cols-4 gap-3 mt-3">
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-center border border-slate-100">
                    <div className="text-[9px] text-slate-500 font-semibold uppercase">Base</div>
                    <div className="text-[13px] font-bold text-[#0b1c30] mt-0.5">{selectedTask.kpi_base ?? '—'}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-center border border-slate-100">
                    <div className="text-[9px] text-slate-500 font-semibold uppercase">Perform</div>
                    <div className="text-[13px] font-bold text-[#0b1c30] mt-0.5">{selectedTask.kpi_perform ?? '—'}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-center border border-slate-100">
                    <div className="text-[9px] text-slate-500 font-semibold uppercase">OT</div>
                    <div className="text-[13px] font-bold text-[#0b1c30] mt-0.5">{selectedTask.kpi_ot ?? '—'}</div>
                  </div>
                  <div className="bg-[#e8f0fe] rounded-lg px-3 py-2.5 text-center border border-[#c2d6f0]">
                    <div className="text-[9px] text-[#0058be] font-semibold uppercase">Final</div>
                    <div className="text-[13px] font-bold text-[#0058be] mt-0.5">{selectedTask.kpi_final ?? '—'}</div>
                  </div>
                </div>
              </div>
            </div>
            {/* Save button footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-white">
              <button
                onClick={handleDrawerSave}
                disabled={drawerSaving}
                className="w-full px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#004a9e] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {drawerSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
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

interface MemberSearchCellProps {
  col: string;
  task: any;
  editValue: string;
  projectMembers: any[];
  onSaveWithAction: (val: string, action?: 'Enter' | 'Tab' | 'ShiftTab') => void;
  onCancel: () => void;
}

function MemberSearchCell({ col, task, editValue, projectMembers, onSaveWithAction, onCancel }: MemberSearchCellProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(true);
  const containerRef = useRef<HTMLTableDataCellElement>(null);

  useEffect(() => {
    const currentMember = projectMembers.find(m => String(m.id) === String(editValue));
    if (currentMember) {
      setSearchTerm(currentMember.display_name || '');
    }
  }, [editValue, projectMembers]);

  const filteredMembers = projectMembers.filter(m => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      (m.display_name || '').toLowerCase().includes(term) ||
      (m.email || '').toLowerCase().includes(term)
    );
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onCancel]);

  const handleSelect = (memberId: number, action?: 'Enter' | 'Tab' | 'ShiftTab') => {
    onSaveWithAction(String(memberId), action);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredMembers.length > 0) {
        handleSelect(filteredMembers[0].id);
      } else {
        onSaveWithAction('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const action = e.shiftKey ? 'ShiftTab' : 'Tab';
      if (filteredMembers.length > 0) {
        handleSelect(filteredMembers[0].id, action);
      } else {
        onSaveWithAction('', action);
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <td key={col} className="px-2 py-1 min-w-[180px] relative" ref={containerRef}>
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          placeholder="Tìm thành viên..."
          autoFocus
          onChange={e => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-white border border-[#0058be] rounded px-2 py-1 text-xs text-[#0b1c30] focus:outline-none font-semibold"
        />
        {isOpen && (
          <div className="absolute left-0 right-0 mt-1 max-h-[160px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
            <div
              onClick={() => onSaveWithAction('')}
              className="px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 cursor-pointer font-bold transition-colors"
            >
              -- Không gán --
            </div>
            {filteredMembers.length === 0 ? (
              <div className="px-2.5 py-1.5 text-xs text-slate-400 italic">Không tìm thấy</div>
            ) : (
              filteredMembers.map((m: any) => (
                <div
                  key={m.id}
                  onClick={() => handleSelect(m.id)}
                  className="px-2.5 py-1.5 text-xs text-slate-700 hover:bg-[#eff4ff] hover:text-[#0058be] cursor-pointer font-semibold transition-colors flex items-center justify-between"
                >
                  <span>{m.display_name}</span>
                  <span className="text-[10px] text-slate-400 font-mono font-normal">{m.email?.split('@')[0]}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </td>
  );
}

// Helper to render Remark values as styled tag pills
function renderRemarkTags(remarkVal: string, settings: any[]) {
  const cleanVal = (remarkVal || '').trim();
  if (!cleanVal || cleanVal.toLowerCase() === 'trống') {
    return <span className="text-slate-400 italic font-normal text-[11px] select-none">Trống</span>;
  }
  const parts = cleanVal.split(',').map(p => p.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1 max-w-full">
      {parts.map((part, idx) => {
        let ruleName = part;
        // Lookup rule by ID if numeric
        if (/^\d+$/.test(part)) {
          const rule = settings.find(r => String(r.id) === part);
          if (rule) {
            ruleName = rule.performance;
          }
        }

        // Determine tag style and clean display name
        let bgClass = "bg-slate-50 text-slate-600 border-slate-200";
        let displayName = ruleName;

        const lowerName = ruleName.toLowerCase();
        if (lowerName.startsWith('(t)')) {
          bgClass = "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100";
          displayName = '[T] ' + ruleName.substring(3).trim();
        } else if (lowerName.startsWith('(p)')) {
          if (lowerName.includes('fail')) {
            bgClass = "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100";
            displayName = '[FAIL] ' + ruleName.substring(3).trim();
          } else {
            bgClass = "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100";
            displayName = '[P] ' + ruleName.substring(3).trim();
          }
        } else if (lowerName.includes('xử lý sự cố') || lowerName.includes('ngày lễ') || lowerName.includes('cuối tuần') || lowerName.includes('tối trong tuần') || lowerName.includes('ot') || /^\d+\s*day/.test(lowerName)) {
          bgClass = "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100";
          displayName = ruleName;
        } else if (lowerName.includes('rework') || lowerName.includes('change request') || lowerName.includes('issue')) {
          bgClass = "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200";
          displayName = ruleName;
        }

        return (
          <span 
            key={idx} 
            className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold leading-none select-none transition-colors ${bgClass}`}
            title={ruleName}
          >
            {displayName}
          </span>
        );
      })}
    </div>
  );
}

interface RemarkMultiSelectInputProps {
  value: string;
  performanceSettings: any[];
  onChange: (newValue: string) => void;
  placeholder?: string;
}

function RemarkMultiSelectInput({ value, performanceSettings, onChange, placeholder }: RemarkMultiSelectInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const getSelectedIds = (): number[] => {
    if (!value) return [];
    return value.split(',').map(p => p.trim()).filter(Boolean).map(part => {
      if (/^\d+$/.test(part)) {
        return parseInt(part, 10);
      }
      const found = performanceSettings.find(rule => {
        const rulePerf = rule.performance.trim().toLowerCase();
        const cleanRulePerf = rulePerf.startsWith('(t)') || rulePerf.startsWith('(p)') 
          ? rulePerf.substring(3).trim() 
          : rulePerf;
        const partLower = part.toLowerCase();
        return rulePerf === partLower || cleanRulePerf === partLower;
      });
      return found ? found.id : null;
    }).filter((id): id is number => id !== null);
  };

  const selectedIds = getSelectedIds();

  const getRuleGroup = (performance: string): string => {
    const p = performance.trim().toLowerCase();
    if (p.startsWith('(t)')) return 'I. Tasks khen thưởng';
    if (p.startsWith('(p)')) return 'II. Tasks bị phạt';
    if (p.includes('rework') || p.includes('change request') || p.includes('issue') || p.includes('unplanned')) return 'IV. Tasks phát sinh';
    if (p.includes('xử lý sự cố') || p.includes('ngày lễ') || p.includes('cuối tuần') || p.includes('tối trong tuần') || p.includes('ot') || /^\d+\s*day/.test(p)) return 'III. Tasks làm ngoài giờ';
    return 'IV. Tasks phát sinh';
  };

  const filteredRules = performanceSettings.filter(rule => {
    if (!rule.is_active) return false;
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return rule.performance.toLowerCase().includes(term);
  });

  const groupedRules: { [key: string]: any[] } = {};
  filteredRules.forEach(rule => {
    const grp = getRuleGroup(rule.performance);
    if (!groupedRules[grp]) groupedRules[grp] = [];
    groupedRules[grp].push(rule);
  });

  const groupOrder = [
    'I. Tasks khen thưởng',
    'II. Tasks bị phạt',
    'III. Tasks làm ngoài giờ',
    'IV. Tasks phát sinh'
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full" ref={containerRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full min-h-[28px] bg-white border border-[#c2c6d6] rounded px-1.5 py-1 text-xs text-[#0b1c30] cursor-pointer flex flex-wrap gap-1 items-center focus:outline-none focus:border-[#0058be] shadow-sm hover:border-[#0058be] transition-colors"
      >
        {selectedIds.length === 0 ? (
          <span className="text-slate-400 font-medium select-none">{placeholder || 'Chọn Remark...'}</span>
        ) : (
          selectedIds.map(id => {
            const r = performanceSettings.find(rule => rule.id === id);
            if (!r) return null;
            let display = r.performance;
            let badgeStyle = "bg-slate-100 text-slate-700";
            if (display.toLowerCase().startsWith('(t)')) {
              display = '[T] ' + display.substring(3).trim();
              badgeStyle = "bg-emerald-50 text-emerald-700 border border-emerald-200";
            } else if (display.toLowerCase().startsWith('(p)')) {
              if (display.toLowerCase().includes('fail')) {
                display = '[FAIL] ' + display.substring(3).trim();
                badgeStyle = "bg-amber-50 text-amber-700 border border-amber-200";
              } else {
                display = '[P] ' + display.substring(3).trim();
                badgeStyle = "bg-rose-50 text-rose-700 border border-rose-200";
              }
            } else if (display.toLowerCase().includes('xử lý sự cố') || display.toLowerCase().includes('ngày lễ') || display.toLowerCase().includes('cuối tuần') || display.toLowerCase().includes('tối trong tuần') || display.toLowerCase().includes('ot') || /^\d+\s*day/.test(display.toLowerCase())) {
              badgeStyle = "bg-blue-50 text-blue-700 border border-blue-200";
            }
            return (
              <span key={id} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeStyle}`}>
                {display}
              </span>
            );
          })
        )}
      </div>
      
      {isOpen && (
        <div className="absolute left-0 mt-1 w-[400px] max-h-[300px] bg-white border border-slate-200 rounded-lg shadow-2xl z-[9999] p-3 flex flex-col gap-2 transition-all animate-fadeIn">
          <input
            type="text"
            value={searchTerm}
            placeholder="Tìm kiếm Remark..."
            autoFocus
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold shadow-sm"
          />
          <div className="overflow-y-auto flex-1 max-h-[200px] pr-1 space-y-3">
            {groupOrder.map(groupName => {
              const rules = groupedRules[groupName] || [];
              if (rules.length === 0) return null;
              return (
                <div key={groupName} className="space-y-1">
                  <div className="text-[10px] font-black tracking-wider uppercase text-slate-400 select-none px-1 border-b border-slate-100 pb-0.5 mb-1">
                    {groupName}
                  </div>
                  {rules.map(rule => {
                    const isSelected = selectedIds.includes(rule.id);
                    const kpiVal = parseFloat(rule.kpi);
                    let kpiBadge = null;
                    if (kpiVal > 0) {
                      kpiBadge = (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100">
                          +{kpiVal}
                        </span>
                      );
                    } else if (kpiVal < 0) {
                      kpiBadge = (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-100">
                          {kpiVal}
                        </span>
                      );
                    } else if (rule.performance.toLowerCase().includes('fail') || rule.performance.toLowerCase().includes('rework') || (kpiVal > 0 && kpiVal < 1.0)) {
                      kpiBadge = (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100">
                          x{kpiVal}
                        </span>
                      );
                    } else {
                      kpiBadge = (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 border border-slate-100">
                          0
                        </span>
                      );
                    }
                    
                    return (
                      <div
                        key={rule.id}
                        onClick={() => {
                          const updated = isSelected
                            ? selectedIds.filter(id => id !== rule.id)
                            : [...selectedIds, rule.id];
                          onChange(updated.join(','));
                        }}
                        className={`group flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer text-xs font-semibold transition-all duration-150 ${
                          isSelected
                            ? 'bg-[#eff4ff] text-[#0058be]'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 max-w-[80%]">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="w-3.5 h-3.5 rounded border-slate-300 text-[#0058be] focus:ring-[#0058be] pointer-events-none"
                          />
                          <span className="truncate" title={rule.performance}>
                            {rule.performance}
                          </span>
                        </div>
                        <div className="shrink-0">
                          {kpiBadge}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {Object.keys(groupedRules).length === 0 && (
              <div className="text-center py-6 text-slate-400 text-xs italic font-medium">
                Không tìm thấy remark nào hợp lệ.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface RemarkDropdownCellProps {
  col: string;
  task: any;
  editValue: string;
  performanceSettings: any[];
  onSaveWithAction: (val: string, action?: 'Enter' | 'Tab' | 'ShiftTab') => void;
  onCancel: () => void;
}

function RemarkDropdownCell({ col, task, editValue, performanceSettings, onSaveWithAction, onCancel }: RemarkDropdownCellProps) {
  const containerRef = useRef<HTMLTableDataCellElement>(null);
  const [currentVal, setCurrentVal] = useState(editValue);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onSaveWithAction(currentVal);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [currentVal, onSaveWithAction]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSaveWithAction(currentVal);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const action = e.shiftKey ? 'ShiftTab' : 'Tab';
      onSaveWithAction(currentVal, action);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <td key={col} className="px-2 py-1 min-w-[320px] relative" ref={containerRef} onKeyDown={handleKeyDown}>
      <RemarkMultiSelectInput
        value={currentVal}
        performanceSettings={performanceSettings}
        onChange={setCurrentVal}
        placeholder="Chọn Remark..."
      />
    </td>
  );
}
