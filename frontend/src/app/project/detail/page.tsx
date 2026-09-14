'use client';
import { useEffect, useLayoutEffect, useState, useCallback, useRef, Fragment, Suspense, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';
import CreateMeetingModal from '@/components/meetings/CreateMeetingModal';
import MeetingDetailModal from '@/components/meetings/MeetingDetailModal';
import AIReviewDrawer from '@/components/AIReviewDrawer';
import AuditLogsTab from '@/components/AuditLogsTab';
import ProjectDocumentsTab from '@/components/ProjectDocumentsTab';
import ProjectPrototypeTab from '@/components/ProjectPrototypeTab';
import ProjectZaloSummaryTab from '@/components/ProjectZaloSummaryTab';
import SearchableSelect from '@/components/common/SearchableSelect';
import ProjectFormModal from '@/components/ProjectFormModal';
import ExportProjectTemplateModal from '@/components/ExportProjectTemplateModal';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import {
  getProjects, getProject, updateProject, deleteProject,
  getChatGroups, createChatGroup, updateChatGroup, deleteChatGroup,
  getAITaskInbox, analyzeChatLogs, updateAITaskInbox, rejectAITaskInbox, importAITaskToProjectPlan, bulkImportAITasks, getChatSyncLogs, syncAITasksFromChat,
  getProjectTemplates, applyProjectTemplate,
  getPhases, createPhase, updatePhase, deletePhase, reorderPhases, movePhaseToProject,
  getTaskGroups, createTaskGroup, updateTaskGroup, deleteTaskGroup,
  getAllProjectTasks, createTask, updateTask, deleteTask,
  getProjectMembers, addProjectMember, removeProjectMember,
  getMembers, getCategories, getPriorities, getStatuses, getPerformanceSettings, getParentRemarks,
  createGroup, createSkill,
  getWorkspaces, Workspace,
  duplicateTask, moveTask, moveTaskGroup, reorderTaskGroups, reorderTasks,
  approveTask, requestTaskChanges, requestTaskReview, blockTask, unblockTask,
  getReviewChecklist, createReviewChecklistItem, toggleReviewChecklistItem, deleteReviewChecklistItem, notifyReviewToLeader,
  getMeetings, createMeeting, updateMeeting, deleteMeeting,
  remindLeader, remindTaskGroup,
  getMe,
  getProjectAuditLogs,
  getApiErrorMessage
} from '@/lib/api';
import { isAdmin, isSuperAdmin, isMember, isMemberOrAbove, getEmail } from '@/lib/auth';
import { useSidebarCollapse, SIDEBAR_PAD_EXPANDED, SIDEBAR_PAD_COLLAPSED } from '@/lib/sidebarCollapse';
import {
  Search, Filter, Columns3, Plus, ChevronDown, ChevronRight, MoreHorizontal,
  Pencil, Trash2, Copy, RotateCcw, Lock, Expand, Minimize2, X,
  Bell, Sparkles, Building2, LayoutTemplate, FileOutput, FolderPlus, Pin, PinOff,
  Users, AlertTriangle, Layers, UserX, ArrowRight, ArrowRightLeft, Clock,
  ArrowUpRight, ArrowDownRight, Minus, Trophy, BarChart3,
  Ban, CheckCircle2,
} from 'lucide-react';
import { calculateDaysLate, parseDateString, getMondayToSundayRange, getWeekOfMonth, getWeekDateRange, checkTaskInPeriod } from '@/app/dashboard/constants';

// Format 1 real timestamp (Audit Log created_at) thành nhãn tương đối kiểu
// "2 phút trước" - không phải data giả, chỉ format lại 1 giá trị thời gian thật.
const formatTimeAgo = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'Vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} ngày trước`;
  return d.toLocaleDateString('vi-VN');
};

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

type TabKey = 'overview' | 'tasks' | 'meetings' | 'chats' | 'members' | 'audit_logs' | 'resources' | 'prototype';
const SLUG_TO_TAB: Record<string, TabKey> = {
  overview: 'overview',
  tasks: 'tasks',
  meetings: 'meetings',
  chats: 'chats',
  members: 'members',
  'audit-logs': 'audit_logs',
  resources: 'resources',
  prototype: 'prototype',
};
const TAB_TO_SLUG: Record<TabKey, string> = {
  overview: 'overview',
  tasks: 'tasks',
  meetings: 'meetings',
  chats: 'chats',
  members: 'members',
  audit_logs: 'audit-logs',
  resources: 'resources',
  prototype: 'prototype',
};

// Dropdown/popover được portal thẳng ra document.body và định vị bằng
// getBoundingClientRect() của trigger, để không bao giờ bị clip/tạo scrollbar
// bởi các container overflow-auto/overflow-x-auto (phase strip, table wrapper...).
// Đóng khi: click ra ngoài, Escape, scroll (bất kỳ ancestor nào, kể cả nested
// scroll container - dùng capture:true), hoặc resize window.
function FloatingDropdown({
  anchorEl,
  open,
  onClose,
  align = 'left',
  className = '',
  children,
}: {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  className?: string;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    setPos(align === 'right'
      ? { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) }
      : { top: rect.bottom + 4, left: rect.left });

    // 'scroll' không bubble nên phải nghe ở capture phase để bắt được scroll
    // của bất kỳ ancestor/scroll-container nào (phase strip, table wrapper...).
    // Nhưng capture phase cũng bắt luôn scroll NỘI BỘ của chính menu (vd. danh
    // sách cột dài) - phải loại trừ trường hợp đó, nếu không menu sẽ tự đóng
    // ngay khi user vừa mới lăn chuột để cuộn nó.
    const closeOnOutsideScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('scroll', closeOnOutsideScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', closeOnOutsideScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [open, anchorEl, align, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, onClose, anchorEl]);

  // Flip the menu to open ABOVE the trigger when opening below would push it
  // past the bottom of the viewport (e.g. the "⋮" row menu on a Group Task/
  // Task near the bottom of the table) — without this it renders off-screen,
  // looking like it's missing or covered by something.
  //
  // Also flip LEFT↔RIGHT so a menu anchored to the very edge of the viewport
  // (Task `...` next to the left side of a narrow window, or near the right
  // side) stays fully visible: the default `align="right"` opens the menu to
  // the LEFT of the button; if there isn't enough horizontal room there we
  // switch to opening to the RIGHT (`left: rect.right`), and vice-versa for
  // `align="left"`. The flip is symmetric and re-runs whenever the user
  // scrolls/resizes so a fresh re-position is always picked up.
  useLayoutEffect(() => {
    if (!open || !anchorEl || !pos || !menuRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const VIEWPORT_GAP = 8;
    let nextTop = pos.top;
    let nextLeft = pos.left;
    let nextRight = pos.right;

    // Vertical flip: bottom-overflow → above the anchor.
    if (menuRect.bottom > window.innerHeight - VIEWPORT_GAP) {
      const flippedTop = anchorRect.top - menuRect.height - 4;
      if (flippedTop >= 0) {
        nextTop = flippedTop;
      }
    }

    // Horizontal flip: when `align="right"` (menu extends LEFT from the
    // anchor's right edge) and the menu would clip past the left viewport
    // edge, switch to extending RIGHT from the anchor's right edge. When
    // `align="left"` and it would clip past the right edge, mirror-image.
    const overflowsLeft = menuRect.left < VIEWPORT_GAP;
    const overflowsRight = menuRect.right > window.innerWidth - VIEWPORT_GAP;
    if (align === 'right' && overflowsLeft) {
      // Menu opens to the right of the anchor (instead of left of it).
      nextLeft = anchorRect.right;
      nextRight = undefined;
    } else if (align === 'left' && overflowsRight) {
      // Menu opens to the left of the anchor (instead of right of it).
      nextRight = Math.max(VIEWPORT_GAP, window.innerWidth - anchorRect.left);
      nextLeft = undefined;
    }

    if (nextTop !== pos.top || nextLeft !== pos.left || nextRight !== pos.right) {
      setPos({ top: nextTop, left: nextLeft, right: nextRight });
    }
  }, [open, anchorEl, pos, align]);

  if (!open || !pos || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={menuRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 200, maxHeight: '70vh', overflowY: 'auto' }}
      className={`text-[#0b1c30] ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}

// Donut chart cho Overview > Tổng quan: có tổng số ở tâm + legend kèm số liệu
// từng phần (PieChartCard dùng chung cho /dashboard chỉ có Legend tên+màu,
// không có số - không sửa component đó vì các trang khác đang dùng, làm bản
// riêng cho Overview).
function OverviewDonutCard({
  title,
  data,
  centerLabel,
}: {
  title: string;
  data: { name: string; value: number; fill: string }[];
  centerLabel: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
      <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-2">{title}</h3>
      {total === 0 ? (
        <p className="text-xs text-slate-500 italic text-center py-10 flex-1 flex items-center justify-center">Chưa có dữ liệu để hiển thị.</p>
      ) : (
        <>
          <div className="relative flex-1 min-h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value">
                  {data.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} formatter={(value: any) => [value, '']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-bold text-[#0b1c30]">{total}</span>
              <span className="text-[10px] text-slate-400">{centerLabel}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
            {data.map(d => (
              <div key={d.name} className="flex items-center justify-between gap-2 text-[11px] min-w-0">
                <span className="flex items-center gap-1.5 text-slate-600 truncate min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.fill }} />
                  <span className="truncate">{d.name}</span>
                </span>
                <span className="font-bold text-[#0b1c30] shrink-0">{d.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { collapsed: sidebarCollapsed } = useSidebarCollapse();
  const id = searchParams.get('id') || '';
  // Drill-in from /kpi's "Dự án đang tham gia" list: pre-filter the Tasks
  // tab to just this one person's own tasks (assignee OR support) — ANDed
  // alongside the existing Assigned/Support dropdowns (which stay 'All' by
  // default), so it narrows the list without disabling manual re-filtering.
  const memberFilterParam = searchParams.get('member') || '';
  // Numeric Member.id for that same person — needed to scope an AI Review
  // to just them (assigned_id/support_id), since memberFilterParam only
  // carries their display name for string-based table filtering.
  const memberIdParam = searchParams.get('member_id') || '';
  const highlightTaskParam = searchParams.get('highlightTask') || '';
  // The tab lives in the URL PATH (/project/detail/tasks), not a query string —
  // next.config.js rewrites that path server-side to /project/detail?tab=tasks
  // purely to pick which page component to render; it does NOT change what the
  // browser/React see as the URL, so reading `tab` via useSearchParams() here
  // would always be null. usePathname() reflects the real client-side URL.
  const pathTabSlug = pathname.split('/').filter(Boolean).pop() || '';
  const activeMainTab: TabKey = SLUG_TO_TAB[pathTabSlug] || 'overview';

  useEffect(() => {
    if (!SLUG_TO_TAB[pathTabSlug] && id) {
      router.replace(`/project/detail/overview?id=${id}`);
    }
  }, [pathTabSlug, id]);

  const isSavingRef = useRef(false);

  // Task Table card height — measured directly instead of relying on the
  // flex-1/min-h-0 chain up to h-screen (which reads as correct on paper
  // but empirically still left the card sized to its own content: short on
  // a project with few Groups/Tasks, with a big block of plain grey page
  // showing below it instead of the card's own white background filling
  // the rest of the viewport). Sets an explicit pixel height = distance
  // from the card's own top to the bottom of the viewport, recomputed on
  // resize, so it fills exactly to the screen edge on any screen size.
  const taskTableCardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (activeMainTab !== 'tasks') return;
    const recompute = () => {
      const el = taskTableCardRef.current;
      // Bails out silently if the card hasn't mounted yet (e.g. still on a
      // loading screen) — the ResizeObserver below re-fires as soon as
      // project/task data finishes loading and the page's layout actually
      // changes size, so this recovers on its own without needing to know
      // exactly when that happens.
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const height = Math.max(240, window.innerHeight - top - 16);
      el.style.height = `${height}px`;
    };
    recompute();
    window.addEventListener('resize', recompute);
    const observer = new ResizeObserver(recompute);
    observer.observe(document.body);
    return () => {
      window.removeEventListener('resize', recompute);
      observer.disconnect();
    };
  }, [activeMainTab]);

  const [project, setProject] = useState<any>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const [addingTaskGroupId, setAddingTaskGroupId] = useState<number | null>(null);
  const [addingTaskParentCode, setAddingTaskParentCode] = useState<string | null>(null);
  const [addingTaskAfterCode, setAddingTaskAfterCode] = useState<string | null>(null);
  const [addingTaskBeforeCode, setAddingTaskBeforeCode] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [draggingTaskGroupId, setDraggingTaskGroupId] = useState<number | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<number | null>(null);
  // Task drag-and-drop: native HTML5 draggable/dragstart already enforces the
  // browser's own movement threshold before a drag begins, but once it does,
  // click never fires for that gesture — regardless of how small the actual
  // movement was. This ref + threshold guards the DROP side instead: any drop
  // whose total mouse movement stayed under 5px is treated as accidental
  // jitter during a click and is silently ignored (no API call), so a task
  // can never move unless the user clearly dragged it.
  const taskDragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const TASK_DRAG_THRESHOLD_PX = 5;
  const [dragOverGroupEndZoneId, setDragOverGroupEndZoneId] = useState<number | null>(null);

  // Task Group drag-and-drop — mirrors the Task drag pattern above (whole
  // row draggable, 5px drop-side threshold guard, insertion-line instead of
  // whole-row highlight), kept on its OWN refs/state so a Group drag never
  // interferes with a Task drag's bookkeeping (only one can be in flight at
  // a time, but they track independent "what's under the cursor" info).
  const [draggingGroupId, setDraggingGroupId] = useState<number | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null);
  const [dragOverPhaseEndZoneId, setDragOverPhaseEndZoneId] = useState<number | null>(null);
  const groupDragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const isBeyondGroupDragThreshold = (e: { clientX: number; clientY: number }) => {
    const start = groupDragStartPosRef.current;
    if (!start) return true;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    return Math.sqrt(dx * dx + dy * dy) >= TASK_DRAG_THRESHOLD_PX;
  };

  const isBeyondTaskDragThreshold = (e: { clientX: number; clientY: number }) => {
    const start = taskDragStartPosRef.current;
    if (!start) return true; // no recorded start — fail-open rather than block a legitimate drop
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    return Math.sqrt(dx * dx + dy * dy) >= TASK_DRAG_THRESHOLD_PX;
  };

  // Undo affordance for a cross-Group/cross-Phase drag — separate from the
  // generic flash() toast so it can carry its own action button. Kept alive
  // 8s, same idea as the generic toast's 4s but a little longer since it also
  // requires reading + deciding, not just reading.
  const [moveUndo, setMoveUndo] = useState<{
    message: string;
    taskId: number;
    taskDetail: string;
    currentGroupId: number;   // where the task is NOW (after the move) — the "from" for reversing
    originalGroupId: number;  // where it came from — the "to" for reversing
    originalInsertBeforeTaskId: number | null; // anchor to restore its exact original position; null = it was last
  } | null>(null);
  const moveUndoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getGroupPhaseLabel = (groupId: number) => {
    const g = taskGroups.find((tg: any) => tg.id === groupId);
    const p = g ? phases.find((ph: any) => ph.id === g.phase_id) : null;
    return { groupName: g?.name || '', phaseName: p?.name || '' };
  };

  // Shared by every cross-Group/cross-Phase drag drop target (Task row, Group
  // header, end-of-group zone) so the feedback message + undo capture stay
  // consistent no matter which of the 3 a Task was dropped onto.
  const performTaskCrossGroupMove = async (
    taskId: number,
    sourceGroupId: number,
    targetGroupId: number,
    position?: { insertBeforeTaskId?: number; insertAfterTaskId?: number }
  ) => {
    const taskDetail = items.find((t: any) => t.id === taskId)?.detail || 'Task';
    // Capture the task's original neighbor in its source group BEFORE moving,
    // so Undo can restore it to (as close as possible to) the exact same spot.
    const sourceSiblings = buildTaskTree(items.filter((t: any) => t.task_group_id === sourceGroupId));
    const originalIdx = sourceSiblings.findIndex((t: any) => t.id === taskId);
    const originalInsertBeforeTaskId = originalIdx !== -1 ? (sourceSiblings[originalIdx + 1]?.id ?? null) : null;

    await moveTask(sourceGroupId, taskId, targetGroupId, position);
    const { groupName, phaseName } = getGroupPhaseLabel(targetGroupId);
    if (moveUndoTimeoutRef.current) clearTimeout(moveUndoTimeoutRef.current);
    setMoveUndo({
      message: `Đã chuyển "${taskDetail}" → ${phaseName} / ${groupName}`,
      taskId, taskDetail, currentGroupId: targetGroupId, originalGroupId: sourceGroupId, originalInsertBeforeTaskId,
    });
    moveUndoTimeoutRef.current = setTimeout(() => setMoveUndo(null), 8000);
    reloadAll();
  };

  // Shared by a Task row's own onDrop AND the thin gap directly above it
  // (rendered by renderHoverSpacerRow while a Task is being dragged) —
  // dropping on the row IS "insert before this task", and the gap right
  // above it is just a wider, easier-to-hit hitbox for that exact same
  // target, so both funnel into one implementation instead of forking.
  const handleTaskDropOnTarget = async (e: React.DragEvent, targetTask: { id: number; task_group_id: number }) => {
    e.preventDefault();
    setDragOverTaskId(null);
    if (!isBeyondTaskDragThreshold(e)) return;
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.type !== "task") return;
      if (data.groupId === targetTask.task_group_id) {
        const groupTasks = items.filter((t: any) => t.task_group_id === targetTask.task_group_id);
        const sorted = buildTaskTree(groupTasks);
        const fromIdx = sorted.findIndex((t: any) => t.id === data.taskId);
        const toIdx = sorted.findIndex((t: any) => t.id === targetTask.id);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const reordered = [...sorted];
          const [removed] = reordered.splice(fromIdx, 1);
          reordered.splice(toIdx, 0, removed);
          await reorderTasks(targetTask.task_group_id, reordered.map((t: any) => t.id));
          flash("Đã đổi thứ tự Task thành công!");
          reloadAll();
        }
      } else {
        await performTaskCrossGroupMove(data.taskId, data.groupId, targetTask.task_group_id, { insertBeforeTaskId: targetTask.id });
      }
    } catch (err: any) {
      console.error(err);
      flash(getApiErrorMessage(err), true);
      await reloadAll();
    }
  };

  const handleUndoTaskMove = async () => {
    if (!moveUndo) return;
    const info = moveUndo;
    setMoveUndo(null);
    if (moveUndoTimeoutRef.current) clearTimeout(moveUndoTimeoutRef.current);
    try {
      await moveTask(
        info.currentGroupId,
        info.taskId,
        info.originalGroupId,
        info.originalInsertBeforeTaskId ? { insertBeforeTaskId: info.originalInsertBeforeTaskId } : undefined
      );
      flash(`Đã hoàn tác di chuyển "${info.taskDetail}"`);
      reloadAll();
    } catch (err: any) {
      flash('Hoàn tác thất bại: ' + getApiErrorMessage(err), true);
    }
  };

  const [movingTask, setMovingTask] = useState<any>(null);
  const [moveTargetPhaseId, setMoveTargetPhaseId] = useState<number | ''>('');
  const [moveTargetGroupId, setMoveTargetGroupId] = useState<number | ''>('');
  const [moveTargetPosition, setMoveTargetPosition] = useState<string>('end');
  const [savingMoveTask, setSavingMoveTask] = useState(false);

  // Move Task Group modal — mirrors the Task move modal above, but positions
  // are anchored to sibling GROUPS within a Phase, not sibling tasks within a
  // group. mode/anchor stay separate (not a single flat dropdown like Task's)
  // per the agreed UX: pick a position TYPE first, only then (for before/after)
  // pick which sibling Group anchors it.
  const [movingGroup, setMovingGroup] = useState<any>(null);
  const [moveGroupTargetPhaseId, setMoveGroupTargetPhaseId] = useState<number | ''>('');
  const [moveGroupPositionMode, setMoveGroupPositionMode] = useState<'start' | 'before' | 'after' | 'end'>('end');
  const [moveGroupAnchorId, setMoveGroupAnchorId] = useState<number | ''>('');
  const [savingMoveGroup, setSavingMoveGroup] = useState(false);

  const getGroupsOfPhase = (phaseId: number | '', excludeGroupId?: number) =>
    taskGroups
      .filter((g: any) => g.phase_id === phaseId && g.id !== excludeGroupId)
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

  const computeCurrentGroupPosition = (group: any): { mode: 'start' | 'after' | 'end'; anchorGroupId: number | '' } => {
    const siblings = taskGroups
      .filter((g: any) => g.phase_id === group.phase_id)
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = siblings.findIndex((g: any) => g.id === group.id);
    if (idx <= 0) return { mode: 'start', anchorGroupId: '' };
    if (idx === siblings.length - 1) return { mode: 'end', anchorGroupId: '' };
    return { mode: 'after', anchorGroupId: siblings[idx - 1].id };
  };

  const handleOpenMoveGroupModal = (group: any) => {
    setMovingGroup(group);
    setMoveGroupTargetPhaseId(group.phase_id);
    const current = computeCurrentGroupPosition(group);
    setMoveGroupPositionMode(current.mode);
    setMoveGroupAnchorId(current.anchorGroupId);
  };

  const moveGroupSiblingsInTargetPhase = movingGroup ? getGroupsOfPhase(moveGroupTargetPhaseId, movingGroup.id) : [];

  const moveGroupHasChanged = !!movingGroup && moveGroupTargetPhaseId !== '' && (() => {
    if (moveGroupTargetPhaseId !== movingGroup.phase_id) return true;
    if (moveGroupSiblingsInTargetPhase.length === 0) return false; // only Group in this Phase — nowhere else to put it
    const current = computeCurrentGroupPosition(movingGroup);
    if (moveGroupPositionMode !== current.mode) return true;
    if (moveGroupPositionMode === 'after' && moveGroupAnchorId !== current.anchorGroupId) return true;
    return false;
  })();

  const handleConfirmMoveGroup = async () => {
    if (!movingGroup || moveGroupTargetPhaseId === '' || !moveGroupHasChanged) return;
    if ((moveGroupPositionMode === 'before' || moveGroupPositionMode === 'after') && moveGroupAnchorId === '') return;
    setSavingMoveGroup(true);
    try {
      let position: { insertBeforeGroupId?: number; insertAfterGroupId?: number } | undefined;
      if (moveGroupPositionMode === 'start') {
        if (moveGroupSiblingsInTargetPhase[0]) position = { insertBeforeGroupId: moveGroupSiblingsInTargetPhase[0].id };
      } else if (moveGroupPositionMode === 'before') {
        position = { insertBeforeGroupId: moveGroupAnchorId as number };
      } else if (moveGroupPositionMode === 'after') {
        position = { insertAfterGroupId: moveGroupAnchorId as number };
      }
      // 'end' -> position stays undefined (append — matches backend default)
      const targetPhase = phases.find((p: any) => p.id === moveGroupTargetPhaseId);
      await moveTaskGroup(movingGroup.phase_id, movingGroup.id, moveGroupTargetPhaseId as number, position);
      flash(`Đã di chuyển Task Group "${movingGroup.name}" sang "${targetPhase?.name || ''}" thành công!`);
      setMovingGroup(null);
      reloadAll();
    } catch (err: any) {
      flash('Lỗi di chuyển Task Group: ' + getApiErrorMessage(err), true);
    } finally {
      setSavingMoveGroup(false);
    }
  };

  // Move Phase to a different Project — mirrors handleConfirmMoveGroup
  // above, one level up: same before/after/end position modeling, but the
  // "Phase đích" picker is a cross-project search (SearchableSelect over all
  // accessible projects) instead of a same-project <select>, and the
  // "Vị trí" picker's siblings come from a project the user isn't currently
  // viewing, so they're fetched on demand rather than read off local state.
  const [movingPhase, setMovingPhase] = useState<any>(null);
  const [movePhaseTargetProjectId, setMovePhaseTargetProjectId] = useState<number | ''>('');
  const [movePhasePositionMode, setMovePhasePositionMode] = useState<'start' | 'before' | 'after' | 'end'>('end');
  const [movePhaseAnchorId, setMovePhaseAnchorId] = useState<number | ''>('');
  const [savingMovePhase, setSavingMovePhase] = useState(false);
  const [moveProjectOptions, setMoveProjectOptions] = useState<any[]>([]);
  const [moveTargetPhases, setMoveTargetPhases] = useState<any[]>([]);
  const [moveTargetPhasesLoading, setMoveTargetPhasesLoading] = useState(false);

  const handleOpenMovePhaseModal = (phase: any) => {
    setMovingPhase(phase);
    setMovePhaseTargetProjectId('');
    setMovePhasePositionMode('end');
    setMovePhaseAnchorId('');
    setMoveTargetPhases([]);
    getProjects().then((res: any) => {
      const list = res?.data || res || [];
      setMoveProjectOptions(Array.isArray(list) ? list.filter((p: any) => p.id !== Number(id)) : []);
    }).catch(() => {});
  };

  // Fetch the destination project's Phase list whenever it changes, to
  // populate the Before/After anchor picker — this project's own `phases`
  // state only covers the CURRENTLY loaded project. Reset position back to
  // "end" on every target-project change since anchors from the previous
  // target no longer apply.
  useEffect(() => {
    setMovePhasePositionMode('end');
    setMovePhaseAnchorId('');
    if (movePhaseTargetProjectId === '') {
      setMoveTargetPhases([]);
      return;
    }
    let cancelled = false;
    setMoveTargetPhasesLoading(true);
    getPhases(movePhaseTargetProjectId as number)
      .then((res: any) => {
        if (cancelled) return;
        const list = res?.data || res || [];
        const realList = Array.isArray(list)
          ? list.filter((p: any) => !p.is_master && (p.name || '').toLowerCase() !== 'master')
          : [];
        setMoveTargetPhases(realList.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)));
      })
      .catch(() => { if (!cancelled) setMoveTargetPhases([]); })
      .finally(() => { if (!cancelled) setMoveTargetPhasesLoading(false); });
    return () => { cancelled = true; };
  }, [movePhaseTargetProjectId]);

  const handleConfirmMovePhase = async () => {
    if (!movingPhase || movePhaseTargetProjectId === '') return;
    if ((movePhasePositionMode === 'before' || movePhasePositionMode === 'after') && movePhaseAnchorId === '') return;
    setSavingMovePhase(true);
    try {
      let position: { insertBeforePhaseId?: number; insertAfterPhaseId?: number } | undefined;
      if (movePhasePositionMode === 'start') {
        if (moveTargetPhases[0]) position = { insertBeforePhaseId: moveTargetPhases[0].id };
      } else if (movePhasePositionMode === 'before') {
        position = { insertBeforePhaseId: movePhaseAnchorId as number };
      } else if (movePhasePositionMode === 'after') {
        position = { insertAfterPhaseId: movePhaseAnchorId as number };
      }
      const targetProject = moveProjectOptions.find((p: any) => p.id === movePhaseTargetProjectId);
      const result = await movePhaseToProject(Number(id), movingPhase.id, movePhaseTargetProjectId as number, position);
      const baseMsg = `Đã di chuyển Phase "${movingPhase.label}" sang project "${targetProject?.name || ''}" thành công!`;
      if (result?.warning_message) {
        flash(`${baseMsg} ⚠️ ${result.warning_message}`);
      } else {
        flash(baseMsg);
      }
      setMovingPhase(null);
      reloadAll();
    } catch (err: any) {
      flash('Lỗi di chuyển Phase: ' + getApiErrorMessage(err), true);
    } finally {
      setSavingMovePhase(false);
    }
  };

  // Cross-Phase Group drag drop — same-Phase drag reorder keeps using
  // reorderTaskGroups() (unchanged), this is only for when a Group is
  // dropped on a group/end-zone belonging to a DIFFERENT Phase.
  const performGroupCrossPhaseMove = async (
    groupId: number,
    sourcePhaseId: number,
    targetPhaseId: number,
    position?: { insertBeforeGroupId?: number; insertAfterGroupId?: number }
  ) => {
    const group = taskGroups.find((g: any) => g.id === groupId);
    const targetPhase = phases.find((p: any) => p.id === targetPhaseId);
    await moveTaskGroup(sourcePhaseId, groupId, targetPhaseId, position);
    flash(`Đã chuyển Task Group "${group?.name || ''}" sang Phase "${targetPhase?.name || ''}" thành công!`);
    reloadAll();
  };

  // Shared by every "landed inside some Group's territory" drop target for a
  // Group drag: the Group's own header row, PLUS its Task rows and the gaps
  // between them (via renderSingleTaskRow / renderHoverSpacerRow below).
  // A Group's Tasks physically sit BETWEEN its own header and the next
  // Group's header in the DOM, so dragging a Group up or down has to cross
  // through them — without this, those rows only knew how to handle a Task
  // drag (data.type === "task") and silently swallowed a Group drop, making
  // cross-group reorder work in whichever direction happened to have fewer
  // Task rows in the path and fail in the other.
  const handleGroupDropOnTarget = async (e: React.DragEvent, targetGroupId: number) => {
    e.preventDefault();
    setDragOverGroupId(null);
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.type !== "group") return;
      if (data.groupId === targetGroupId || !isBeyondGroupDragThreshold(e)) return;
      const targetGroup = taskGroups.find((g: any) => g.id === targetGroupId);
      if (!targetGroup) return;
      if (data.phaseId === targetGroup.phase_id) {
        const phaseGroups = taskGroups.filter((g: any) => g.phase_id === targetGroup.phase_id);
        const fromIdx = phaseGroups.findIndex((g: any) => g.id === data.groupId);
        const toIdx = phaseGroups.findIndex((g: any) => g.id === targetGroupId);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const reordered = [...phaseGroups];
          const [removed] = reordered.splice(fromIdx, 1);
          reordered.splice(toIdx, 0, removed);
          await reorderTaskGroups(targetGroup.phase_id, reordered.map((g: any) => g.id));
          flash("Đã đổi thứ tự Task Group thành công!");
          reloadAll();
        }
      } else {
        await performGroupCrossPhaseMove(data.groupId, data.phaseId, targetGroup.phase_id, { insertBeforeGroupId: targetGroupId });
      }
    } catch (err: any) {
      console.error(err);
      flash(getApiErrorMessage(err), true);
      await reloadAll();
    }
  };

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
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [priorityDropdownOpen, setPriorityDropdownOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [assignedFilter, setAssignedFilter] = useState('All');
  const [assignedDropdownOpen, setAssignedDropdownOpen] = useState(false);
  const [supportFilter, setSupportFilter] = useState('All');
  const [supportDropdownOpen, setSupportDropdownOpen] = useState(false);
  const [skillSolutionFilter, setSkillSolutionFilter] = useState('All');
  const [skillSolutionDropdownOpen, setSkillSolutionDropdownOpen] = useState(false);
  const [skillVendorFilter, setSkillVendorFilter] = useState('All');
  const [skillVendorDropdownOpen, setSkillVendorDropdownOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [rowDensity, setRowDensity] = useState<'compact' | 'normal' | 'spacious'>('compact');
  const [addTaskMenuOpen, setAddTaskMenuOpen] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [taskFocusMode, setTaskFocusMode] = useState(false);
  const [openHeaderMenu, setOpenHeaderMenu] = useState<string | null>(null);
  const [headerMenuAnchorEl, setHeaderMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [rowMenuAnchorEl, setRowMenuAnchorEl] = useState<HTMLElement | null>(null);
  const columnMenuBtnRef = useRef<HTMLButtonElement>(null);
  const addTaskMenuBtnRef = useRef<HTMLButtonElement>(null);
  const filterPopoverBtnRef = useRef<HTMLButtonElement>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [pinnedColumns, setPinnedColumns] = useState<string[]>([]);
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null);
  const resizingColumnRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  // Phase navigation: overflow-to-dropdown (never wrap, never horizontal scroll)
  // Trần số Phase hiển thị - thuật toán bên dưới (visiblePhaseCount) đo width
  // thật của container + từng tab và TỰ ĐỘNG chỉ hiện bấy nhiêu Phase vừa 1
  // hàng. "⋯"/"+ Task" sống NGOÀI container này (shrink-0, sibling của
  // container flex-1) nên trình duyệt tự trừ width của chúng qua flexbox -
  // không cần ước lượng/reserve thủ công cho 2 cái đó. "+" (Thêm Phase) thì
  // sống NGAY TRONG container (để luôn dính sát Phase cuối, không bị flex-1
  // đẩy ra mép phải hàng) nên cùng với Master và "Phase khác (N)" đều cần
  // hằng số ước lượng (PHASE_CHROME_WIDTHS) thay vì được flexbox tự trừ.
  // Tăng trần lên 8 để tận dụng khoảng trống bên phải khi có nhiều Phase
  // ngắn tên; khi phase dài/nhiều hơn 8, thuật toán tự co lại và đẩy phần dư
  // vào "Phase khác".
  const MAX_VISIBLE_REAL_PHASES = 8;
  // Kéo-thả đổi thứ tự Phase tab (chuột trái, HTML5 DnD) - Master không bao
  // giờ tham gia (không draggable, không phải drop target) vì nó không phải
  // Phase thật. reorderingPhaseId chỉ để disable tương tác trong lúc đang gọi
  // API, tránh double-drop.
  const [draggingPhaseId, setDraggingPhaseId] = useState<number | null>(null);
  const [phaseDropTarget, setPhaseDropTarget] = useState<{ id: number; side: 'before' | 'after' } | null>(null);
  const [phaseDropAtEnd, setPhaseDropAtEnd] = useState(false);
  const [reorderingPhaseId, setReorderingPhaseId] = useState<number | null>(null);
  const [pinnedPhaseIds, setPinnedPhaseIds] = useState<number[]>([]);
  const [phaseOverflowOpen, setPhaseOverflowOpen] = useState(false);
  const [phaseOverflowSearch, setPhaseOverflowSearch] = useState('');
  const phaseOverflowBtnRef = useRef<HTMLButtonElement>(null);
  const [phaseNavContainerWidth, setPhaseNavContainerWidth] = useState(9999);
  const phaseNavContainerRef = useRef<HTMLDivElement>(null);
  const [phaseTabWidths, setPhaseTabWidths] = useState<Record<string, number>>({});
  const phaseTabMeasureRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Width của Master / "Phase khác (N)" là text cố định (không phụ thuộc dữ
  // liệu user) nên dùng hằng số ước lượng rộng rãi thay vì đo DOM - chỉ label
  // Phase (tên do user đặt, có thể rất dài) mới cần đo thật.
  // "plus" = nút "+ Thêm Phase", giờ sống NGAY TRONG container (cùng hàng
  // flex-nowrap với Master/tab) nên phải được cộng vào budget dưới đây - nếu
  // không, overflow-hidden của container có thể cắt mất nút "+" khi Phase
  // dài tên/nhiều Phase lấp gần hết chỗ.
  const PHASE_CHROME_WIDTHS = { master: 76, overflow: 140, plus: 32 } as const;
  const [addingTaskBelowId, setAddingTaskBelowId] = useState<number | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e: boolean } | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showExportTemplateModal, setShowExportTemplateModal] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [applyingTemplateId, setApplyingTemplateId] = useState<number | null>(null);
  const [confirmApplyTemplateId, setConfirmApplyTemplateId] = useState<number | null>(null);

  // AI Review Drawer states
  const [isAIDrawerOpen, setIsAIDrawerOpen] = useState(false);
  const [aiDrawerEntityType, setAiDrawerEntityType] = useState<'PROJECT' | 'PHASE' | 'TASK' | 'MEMBER'>('PROJECT');
  const [aiDrawerEntityId, setAiDrawerEntityId] = useState<number>(0);
  const [aiDrawerEntityName, setAiDrawerEntityName] = useState<string>('');
  const [aiDrawerProjectId, setAiDrawerProjectId] = useState<number | undefined>(undefined);

  const handleOpenAIReviewDrawer = (entityType: 'PROJECT' | 'PHASE' | 'TASK' | 'MEMBER', entityId: number, name = '') => {
    setAiDrawerEntityType(entityType);
    setAiDrawerEntityId(entityId);
    setAiDrawerProjectId(entityType === 'MEMBER' ? Number(id) : undefined);

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
      } else if (entityType === 'MEMBER') {
        resolvedName = memberFilterParam || 'Thành viên';
      }
    }

    setAiDrawerEntityName(resolvedName);
    setIsAIDrawerOpen(true);
  };

  const handleOpenAIReviewDrawerForContext = () => {
    handleOpenAIReviewDrawer('PROJECT', Number(id));
  };

  const [activePhase, setActivePhase] = useState<string>('ALL');
  const [showPhaseModal, setShowPhaseModal] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [editingPhaseId, setEditingPhaseId] = useState<number | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [selectedFormPhase, setSelectedFormPhase] = useState<string>('');

  // Interactive Task Management additions
  const [editingCell, setEditingCell] = useState<{ taskId: number, colName: string } | null>(null);
  const [editingGroupDate, setEditingGroupDate] = useState<number | null>(null);
  const [editingGroupRemark, setEditingGroupRemark] = useState<number | null>(null);
  const [editingGroupPeople, setEditingGroupPeople] = useState<{ groupId: number; field: 'assigned_ids' | 'support_ids' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [taskToDelete, setTaskToDelete] = useState<number | null>(null);
  const [highlightTaskId, setHighlightTaskId] = useState<number | null>(null);

  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  // Leader Review panel (attention queue) - chỉ 1 state mở/đóng, không cần
  // persistence vì đây là workspace tạm thời, không phải preference dài hạn
  // như column/density.
  const [leaderReviewOpen, setLeaderReviewOpen] = useState(false);
  // Task đang mở trong Leader Review Detail Drawer (read-only, tách biệt khỏi
  // selectedTask/Task Edit Drawer - xem comment ở handleOpenAttentionTask).
  const [leaderReviewDetailTask, setLeaderReviewDetailTask] = useState<any>(null);
  const [leaderReviewMoreMenuOpen, setLeaderReviewMoreMenuOpen] = useState(false);
  const leaderReviewMoreMenuBtnRef = useRef<HTMLButtonElement>(null);
  // Selection state DÙNG CHUNG giữa Leader Review panel item và Task Table
  // row - sống sót qua việc đóng Detail drawer, chỉ clear khi chọn item khác
  // hoặc đóng hẳn panel (xem handleOpenAttentionTask/closeLeaderReviewPanel).
  const [selectedAttentionTaskId, setSelectedAttentionTaskId] = useState<number | null>(null);
  // Task Review workflow (Duyệt/Yêu cầu sửa) - state riêng cho drawer, không
  // đụng tới drawerForm/selectedTask (đó là Task Edit Drawer, tách biệt hoàn
  // toàn - xem approveTask/requestTaskChanges trong lib/api.ts).
  const [reviewActionBusy, setReviewActionBusy] = useState(false);
  const [confirmingApproveTask, setConfirmingApproveTask] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [changeRequestReason, setChangeRequestReason] = useState('');
  const [reviewDrawerTask, setReviewDrawerTask] = useState<any>(null);
  const [reviewChecklist, setReviewChecklist] = useState<any[]>([]);
  const [reviewChecklistLoading, setReviewChecklistLoading] = useState(false);
  const [newChecklistContent, setNewChecklistContent] = useState('');
  const [taskFilterMode, setTaskFilterMode] = useState<'all' | 'review' | 'my_tasks' | 'smart_priority'>('all');
  // Blocking workflow (Đánh dấu bị chặn/Gỡ chặn) - modal DÙNG CHUNG cho cả 3
  // nơi kích hoạt: nút trong Task Edit Drawer, nút trong Leader Review Detail
  // Drawer, và chọn thẳng 1 status chứa "block" từ dropdown Status (statusValue
  // có giá trị thì confirm sẽ lưu status đó trước khi gọi /block).
  const [blockActionBusy, setBlockActionBusy] = useState(false);
  const [blockPrompt, setBlockPrompt] = useState<{ taskId: number; statusValue?: string } | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blockDependencyTaskId, setBlockDependencyTaskId] = useState('');
  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false);
  const [showAllKpi, setShowAllKpi] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [drawerForm, setDrawerForm] = useState<Record<string, any>>({});
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerLinkDraft, setDrawerLinkDraft] = useState('');
  const [importingInboxId, setImportingInboxId] = useState<number | null>(null);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [pasteSelectedGroupId, setPasteSelectedGroupId] = useState<string>('manual');

  // Task Detail inline Skill creation (REUSES existing Settings Skill
  // architecture: POST /api/skills/groups and POST /api/skills/skills).
  // Two independent `+` buttons (SKILL AREA, SKILL) open a
  // lightweight modal. After successful creation, categories are re-
  // fetched and the new item is auto-selected. State is intentionally
  // kept here (not on the existing Settings page) so the existing
  // Settings Skill CRUD flow is not disturbed.
  const [showCreateSkillGroupModal, setShowCreateSkillGroupModal] = useState(false);
  const [showCreateSkillVendorModal, setShowCreateSkillVendorModal] = useState(false);
  const [creatingSkillGroup, setCreatingSkillGroup] = useState(false);
  const [creatingSkillVendor, setCreatingSkillVendor] = useState(false);
  const [newSkillGroupName, setNewSkillGroupName] = useState('');
  const [newSkillGroupCategoryId, setNewSkillGroupCategoryId] = useState<string>('');
  const [newSkillVendorName, setNewSkillVendorName] = useState('');
  // Which caller opened showCreateSkillGroupModal (Drawer's own "+" button,
  // or a table cell's quick-add) gets told the new Group's id once created -
  // every entry point now goes through this ONE modal (explicit Category
  // picker, same as the Drawer always had) instead of the table cell
  // silently defaulting to the first active Category with no user input.
  const [skillGroupCreatedCallback, setSkillGroupCreatedCallback] = useState<((groupId: number) => void) | null>(null);

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
  const [isTopicOnly, setIsTopicOnly] = useState<boolean>(false);

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

  // Leader Review panel -> mở Leader Review Detail Drawer (read/review-first,
  // KHÔNG mở thẳng Task Edit Drawer/selectedTask - 2 drawer tách biệt hoàn
  // toàn, xem JSX "Leader Review Detail Drawer" bên dưới). Vẫn chuyển về đúng
  // Phase + mở lại group đang collapse (nếu có) để task hiện ra trong bảng
  // phía sau, tận dụng state có sẵn (activePhase/collapsedGroups/highlightTaskId).
  const handleOpenAttentionTask = (task: any) => {
    if (task.phase_name && task.phase_name !== activePhase) setActivePhase(task.phase_name);
    if (task.task_group_id) {
      setCollapsedGroups(prev => {
        if (!prev.has(task.task_group_id)) return prev;
        const next = new Set(prev);
        next.delete(task.task_group_id);
        return next;
      });
    }
    // selectedAttentionTaskId (KHÔNG dùng highlightTaskId - state đó là flash
    // tạm thời cho "task vừa tạo", tự clear sau ~2s) là selection state DÙNG
    // CHUNG giữa panel item và table row, và PHẢI sống sót qua việc đóng
    // Leader Review Detail Drawer (chỉ clear khi chọn item khác / đóng panel).
    setSelectedAttentionTaskId(task.id);
    setLeaderReviewDetailTask(task);
    setConfirmingApproveTask(false);
    setRequestChangesOpen(false);
    setChangeRequestReason('');
  };

  // Đóng Leader Review panel -> clear luôn selection (yêu cầu: "user đóng
  // Leader Review panel" là 1 trong các điều kiện clear). KHÔNG clear khi chỉ
  // đóng Detail drawer (setLeaderReviewDetailTask(null) không đụng tới đây).
  const closeLeaderReviewPanel = () => {
    setLeaderReviewOpen(false);
    setSelectedAttentionTaskId(null);
  };

  // Task Review workflow - gọi API thật (approve/request-changes), KHÔNG
  // reload toàn page: cập nhật luôn task đang mở trong drawer từ response, và
  // refetchTasks() để table/panel/badge count đồng bộ theo (React Query cache,
  // không phải window.location.reload). Activity log của drawer cũng được
  // invalidate để "Hoạt động gần đây" phản ánh action vừa làm ngay.
  const handleApproveTask = async (task: any) => {
    if (reviewActionBusy) return;
    setReviewActionBusy(true);
    try {
      const updated = await approveTask(task.task_group_id, task.id);
      setLeaderReviewDetailTask(updated);
      setConfirmingApproveTask(false);
      flash('Đã duyệt task thành công!');
      refetchTasks();
      queryClient.invalidateQueries({ queryKey: ['task-audit-activity', task.id] });
    } catch (err: any) {
      flash(getApiErrorMessage(err, 'Lỗi khi duyệt task.'), true);
    } finally {
      setReviewActionBusy(false);
    }
  };

  const handleRequestTaskChanges = async (task: any) => {
    const reason = changeRequestReason.trim();
    if (reason.length < 5) {
      flash('Vui lòng nhập lý do yêu cầu sửa (tối thiểu 5 ký tự).', true);
      return;
    }
    if (reviewActionBusy) return;
    setReviewActionBusy(true);
    try {
      const updated = await requestTaskChanges(task.task_group_id, task.id, reason);
      setLeaderReviewDetailTask(updated);
      setRequestChangesOpen(false);
      setChangeRequestReason('');
      flash('Đã gửi yêu cầu sửa task!');
      refetchTasks();
      queryClient.invalidateQueries({ queryKey: ['task-audit-activity', task.id] });
    } catch (err: any) {
      flash(getApiErrorMessage(err, 'Lỗi khi gửi yêu cầu sửa.'), true);
    } finally {
      setReviewActionBusy(false);
    }
  };

  // Gửi lại review sau khi đã sửa - set thẳng review_status=pending, không
  // cần vòng qua đổi status ra rồi vào lại "Review" (update_task chỉ tự sync
  // trên EDGE chuyển status vào Review). Không xoá approved_at/change_request_
  // reason cũ - đó là lịch sử, vẫn hiển thị mờ trong drawer dù đang pending.
  const handleRequestTaskReview = async (task: any) => {
    if (reviewActionBusy) return;
    setReviewActionBusy(true);
    try {
      const updated = await requestTaskReview(task.task_group_id, task.id);
      setLeaderReviewDetailTask(updated);
      flash('Đã gửi task để review lại!');
      refetchTasks();
      queryClient.invalidateQueries({ queryKey: ['task-audit-activity', task.id] });
    } catch (err: any) {
      flash(getApiErrorMessage(err, 'Lỗi khi gửi review.'), true);
    } finally {
      setReviewActionBusy(false);
    }
  };

  const openReviewDrawer = async (task: any) => {
    setReviewDrawerTask(task);
    setReviewChecklistLoading(true);
    try {
      const items = await getReviewChecklist(task.task_group_id, task.id);
      setReviewChecklist(items);
    } catch { setReviewChecklist([]); }
    finally { setReviewChecklistLoading(false); }
  };

  const handleToggleChecklistItem = async (item: any) => {
    if (!reviewDrawerTask) return;
    try {
      const updated = await toggleReviewChecklistItem(reviewDrawerTask.task_group_id, reviewDrawerTask.id, item.id, !item.is_completed);
      setReviewChecklist(prev => prev.map(i => i.id === item.id ? updated : i));
    } catch (err: any) { flash(getApiErrorMessage(err, 'Lỗi khi cập nhật checklist.'), true); }
  };

  const handleAddChecklistItem = async () => {
    if (!reviewDrawerTask || !newChecklistContent.trim()) return;
    try {
      const item = await createReviewChecklistItem(reviewDrawerTask.task_group_id, reviewDrawerTask.id, newChecklistContent.trim());
      setReviewChecklist(prev => [...prev, item]);
      setNewChecklistContent('');
    } catch (err: any) { flash(getApiErrorMessage(err, 'Lỗi khi thêm checklist.'), true); }
  };

  const handleDeleteChecklistItem = async (itemId: number) => {
    if (!reviewDrawerTask) return;
    try {
      await deleteReviewChecklistItem(reviewDrawerTask.task_group_id, reviewDrawerTask.id, itemId);
      setReviewChecklist(prev => prev.filter(i => i.id !== itemId));
    } catch (err: any) { flash(getApiErrorMessage(err, 'Lỗi khi xóa checklist.'), true); }
  };

  const handleNotifyReviewToLeader = async () => {
    if (!reviewDrawerTask) return;
    try {
      await notifyReviewToLeader(reviewDrawerTask.task_group_id, reviewDrawerTask.id);
      flash('Đã thông báo review cho Leader!');
    } catch (err: any) { flash(getApiErrorMessage(err, 'Lỗi khi thông báo.'), true); }
  };

  const handleReviewDrawerApprove = async () => {
    if (!reviewDrawerTask || reviewActionBusy) return;
    setReviewActionBusy(true);
    try {
      const updated = await approveTask(reviewDrawerTask.task_group_id, reviewDrawerTask.id);
      flash('Đã duyệt task thành công!');
      setReviewDrawerTask(null);
      refetchTasks();
    } catch (err: any) { flash(getApiErrorMessage(err, 'Lỗi khi duyệt task.'), true); }
    finally { setReviewActionBusy(false); }
  };

  const handleReviewDrawerRequestChanges = async () => {
    if (!reviewDrawerTask || reviewActionBusy) return;
    const reason = changeRequestReason.trim();
    if (reason.length < 5) { flash('Vui lòng nhập lý do yêu cầu sửa (tối thiểu 5 ký tự).', true); return; }
    setReviewActionBusy(true);
    try {
      const updated = await requestTaskChanges(reviewDrawerTask.task_group_id, reviewDrawerTask.id, reason);
      setChangeRequestReason('');
      setRequestChangesOpen(false);
      flash('Đã gửi yêu cầu sửa task!');
      refetchTasks();
    } catch (err: any) { flash(getApiErrorMessage(err, 'Lỗi khi gửi yêu cầu sửa.'), true); }
    finally { setReviewActionBusy(false); }
  };

  // Blocking workflow - dùng chung cho cả Task Edit Drawer (selectedTask) và
  // Leader Review Detail Drawer (leaderReviewDetailTask); cập nhật state nào
  // đang mở khớp đúng task đó từ response, không reload toàn page.
  // Handler cho modal block DÙNG CHUNG (blockPrompt) - task lấy từ items theo
  // blockPrompt.taskId, không phải tham số riêng, vì modal có thể được mở từ
  // Task Edit Drawer, Leader Review Detail Drawer, hoặc dropdown Status (lúc
  // đó blockPrompt.statusValue có giá trị - lưu status đó TRƯỚC khi /block để
  // cell hiển thị đúng "Blocked" thay vì lý do placeholder chung chung).
  const handleConfirmBlockTask = async () => {
    if (!blockPrompt) return;
    const task = items.find((it: any) => it.id === blockPrompt.taskId);
    if (!task) { setBlockPrompt(null); return; }
    const reason = blockReason.trim();
    if (reason.length < 5) {
      flash('Vui lòng nhập lý do bị chặn (tối thiểu 5 ký tự).', true);
      return;
    }
    if (blockActionBusy) return;
    setBlockActionBusy(true);
    try {
      if (blockPrompt.statusValue) {
        await updateTask(task.task_group_id, task.id, { status: blockPrompt.statusValue });
      }
      const depId = blockDependencyTaskId ? Number(blockDependencyTaskId) : undefined;
      const updated = await blockTask(task.task_group_id, task.id, reason, depId);
      if (selectedTask && selectedTask.id === updated.id) setSelectedTask(updated);
      if (leaderReviewDetailTask && leaderReviewDetailTask.id === updated.id) setLeaderReviewDetailTask(updated);
      setBlockPrompt(null);
      setBlockReason('');
      setBlockDependencyTaskId('');
      flash('Đã đánh dấu task bị chặn!');
      refetchTasks();
      queryClient.invalidateQueries({ queryKey: ['task-audit-activity', task.id] });
    } catch (err: any) {
      flash(getApiErrorMessage(err, 'Lỗi khi đánh dấu bị chặn.'), true);
    } finally {
      setBlockActionBusy(false);
    }
  };

  const handleUnblockTask = async (task: any) => {
    if (blockActionBusy) return;
    setBlockActionBusy(true);
    try {
      const updated = await unblockTask(task.task_group_id, task.id);
      if (selectedTask && selectedTask.id === updated.id) setSelectedTask(updated);
      if (leaderReviewDetailTask && leaderReviewDetailTask.id === updated.id) setLeaderReviewDetailTask(updated);
      flash('Đã gỡ chặn task!');
      refetchTasks();
      queryClient.invalidateQueries({ queryKey: ['task-audit-activity', task.id] });
    } catch (err: any) {
      flash(getApiErrorMessage(err, 'Lỗi khi gỡ chặn.'), true);
    } finally {
      setBlockActionBusy(false);
    }
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
    if (savingTaskGroup) return;
    if (!tgName.trim()) {
      flash('Tên Task Group không được để trống!', true);
      return;
    }
    if (!tgPhaseId) {
      flash('Vui lòng chọn Phase cho Task Group!', true);
      return;
    }
    setSavingTaskGroup(true);
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
      flash('Lỗi lưu Task Group: ' + getApiErrorMessage(err), true);
    } finally {
      setSavingTaskGroup(false);
    }
  };

  const handleSaveInlineTaskGroup = async (phaseId: number) => {
    if (savingInlineTaskGroup) return;
    const name = newTgForm.name.trim();
    if (!name) {
      setAddingTaskGroupPhaseId(null);
      return;
    }
    const mandayRaw = newTgForm.manday_est.trim();
    if (!mandayRaw) {
      flash('MANDAY EST là bắt buộc!', true);
      return;
    }
    const manday_est = Number(mandayRaw);
    if (!Number.isFinite(manday_est) || !Number.isInteger(manday_est)) {
      flash('MANDAY EST phải là số nguyên, không được là số thập phân!', true);
      return;
    }
    if (manday_est < 1 || manday_est > 10) {
      flash('MANDAY EST phải là số nguyên từ 1 đến 10!', true);
      return;
    }
    setSavingInlineTaskGroup(true);
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
      flash('Lỗi tạo Task Group: ' + getApiErrorMessage(err), true);
    } finally {
      setSavingInlineTaskGroup(false);
    }
  };

  const handleDeleteTaskGroupClick = (group: any) => {
    setGroupToDelete({ id: group.id, phase_id: group.phase_id, name: group.name });
  };

  const getParentCode = (code: string): string => {
    if (!code) return '';
    const idx = code.lastIndexOf('.');
    if (idx === -1) return '';
    return code.substring(0, idx);
  };

  const ACTION_COL_WIDTH = 82;

  const TASK_COLUMNS = [
    "TASK ID", "DETAIL TASK", "PRIORITY", "MANDAY EST", "STATUS", "START DATE",
    "ASSIGNED", "SUPPORT", "KPI RATIO", "SKILL AREA", "SKILL", "LINK",
    "REMARK", "SEND", "END DATE EST", "DEADLINE", "MD ACTUAL", "END ACTUAL", "DAYS LATE",
    "HEALTH", "KPI BASE", "KPI PERFORM", "KPI OVERTIME", "KPI FINAL", "SUB ID", "ROOT TASKS",
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
      case 'LINK': return task.link || task.ticket_id || '';
      case 'SKILL AREA': return task.skill_solution_name || '';
      case 'SKILL': return task.skill_vendor_name || '';

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
      case 'DEADLINE': return formatDateToShow(task.end_date_est || '');
      case 'HEALTH': return '';
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

  // Các cột bắt buộc khi tạo task mới (xem handleSaveTask) - không cho ẩn vì
  // ô nhập tương ứng trong dòng "thêm task" cũng dựa theo getDynamicColumns().
  const LOCKED_COLUMNS = ['TASK ID', 'DETAIL TASK', 'MANDAY EST', 'START DATE', 'ASSIGNED', 'SUPPORT', 'SKILL AREA', 'SKILL', 'DEADLINE', 'HEALTH'];

  const MIN_COLUMN_WIDTH = 70;
  const DEFAULT_COLUMN_WIDTH: Record<string, number> = {};

  // Column metadata - single source of truth cho width/align theo LOẠI dữ
  // liệu (số/ngày/status/người/ID ngắn/text dài), thay vì rải rác nhiều nơi
  // hoặc chia đều mọi cột. defaultWidth chỉ áp dụng cho user MỚI/cột CHƯA có
  // width đã lưu (getColumnWidth ưu tiên columnWidths[col] trước) - không
  // đụng tới preference đã resize thủ công của user cũ.
  type ColumnAlign = 'left' | 'center' | 'right';
  const COLUMN_META: Record<string, { defaultWidth: number; minWidth: number; align: ColumnAlign }> = {
    'TASK ID':        { defaultWidth: 112, minWidth: 80,  align: 'left' },
    'DETAIL TASK':    { defaultWidth: 380, minWidth: 320, align: 'left' },
    'PRIORITY':       { defaultWidth: 90,  minWidth: 70,  align: 'center' },
    'MANDAY EST':     { defaultWidth: 72,  minWidth: 60,  align: 'center' },
    'STATUS':         { defaultWidth: 105, minWidth: 85,  align: 'center' },
    'START DATE':     { defaultWidth: 108, minWidth: 90,  align: 'center' },
    'ASSIGNED':       { defaultWidth: 128, minWidth: 90,  align: 'left' },
    'SUPPORT':        { defaultWidth: 128, minWidth: 90,  align: 'left' },
    'KPI RATIO':      { defaultWidth: 85,  minWidth: 70,  align: 'center' },
    'SKILL AREA': { defaultWidth: 160, minWidth: 110, align: 'left' },
    'SKILL':   { defaultWidth: 120, minWidth: 90,  align: 'left' },
    'LINK':           { defaultWidth: 90,  minWidth: 70,  align: 'left' },
    'REMARK':         { defaultWidth: 165, minWidth: 110, align: 'left' },
    'SEND':           { defaultWidth: 90,  minWidth: 70,  align: 'center' },
    'END DATE EST':   { defaultWidth: 108, minWidth: 90,  align: 'center' },
    'DEADLINE':       { defaultWidth: 108, minWidth: 90,  align: 'center' },
    'MD ACTUAL':      { defaultWidth: 72,  minWidth: 60,  align: 'center' },
    'END ACTUAL':     { defaultWidth: 108, minWidth: 90,  align: 'center' },
    'DAYS LATE':      { defaultWidth: 78,  minWidth: 60,  align: 'center' },
    'HEALTH':         { defaultWidth: 120, minWidth: 90,  align: 'center' },
    'KPI BASE':       { defaultWidth: 80,  minWidth: 64,  align: 'center' },
    'KPI PERFORM':    { defaultWidth: 80,  minWidth: 64,  align: 'center' },
    'KPI OVERTIME':   { defaultWidth: 80,  minWidth: 64,  align: 'center' },
    'KPI FINAL':      { defaultWidth: 80,  minWidth: 64,  align: 'center' },
    'SUB ID':         { defaultWidth: 85,  minWidth: 70,  align: 'left' },
    'ROOT TASKS':     { defaultWidth: 100, minWidth: 80,  align: 'left' },
    'NOTES':          { defaultWidth: 200, minWidth: 140, align: 'left' },
    'SOLUTION':       { defaultWidth: 200, minWidth: 140, align: 'left' },
  };

  const getColumnDefaultWidth = (col: string): number => COLUMN_META[col.toUpperCase()]?.defaultWidth ?? 130;
  const getColumnMinWidth = (col: string): number => COLUMN_META[col.toUpperCase()]?.minWidth ?? MIN_COLUMN_WIDTH;
  const getColumnAlign = (col: string): ColumnAlign => COLUMN_META[col.toUpperCase()]?.align ?? 'left';

  const getColumnWidth = (col: string): number => columnWidths[col] || getColumnDefaultWidth(col);

  const getDynamicColumns = () => {
    return columnOrder.filter(col => TASK_COLUMNS.includes(col) && !hiddenColumns.includes(col));
  };

  const toggleColumnVisibility = (col: string) => {
    if (LOCKED_COLUMNS.includes(col)) return;
    setHiddenColumns(prev => {
      const isHidden = prev.includes(col);
      if (!isHidden) {
        if (col === 'PRIORITY') setPriorityFilter('All');
        if (col === 'STATUS') setStatusFilter('All');
        return [...prev, col];
      }
      return prev.filter(c => c !== col);
    });
  };

  const resetColumnVisibility = () => {
    setHiddenColumns([]);
    setRowDensity('compact');
    setColumnOrder(TASK_COLUMNS);
    setColumnWidths({});
    setPinnedColumns([]);
  };

  const reorderColumn = (fromCol: string, toCol: string) => {
    if (fromCol === toCol) return;
    setColumnOrder(prev => {
      const arr = [...prev];
      const fromIdx = arr.indexOf(fromCol);
      const toIdx = arr.indexOf(toCol);
      if (fromIdx === -1 || toIdx === -1) return prev;
      arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, fromCol);
      return arr;
    });
  };

  const togglePinColumn = (col: string) => {
    setPinnedColumns(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  };

  const getPinTdStyle = (col: string): React.CSSProperties | undefined => {
    if (!pinnedColumns.includes(col)) return undefined;
    return { position: 'sticky', left: getPinnedLeftOffset(col), zIndex: 11, background: 'inherit' };
  };

  const getPinnedLeftOffset = (col: string): number => {
    if (!pinnedColumns.includes(col)) return 0;
    const renderedPinnedInOrder = getDynamicColumns().filter(c => pinnedColumns.includes(c));
    const idx = renderedPinnedInOrder.indexOf(col);
    if (idx === -1) return 0;
    let offset = ACTION_COL_WIDTH;
    for (let i = 0; i < idx; i++) {
      offset += getColumnWidth(renderedPinnedInOrder[i]);
    }
    return offset;
  };

  const ROW_PAD_Y: Record<'compact' | 'normal' | 'spacious', string> = {
    compact: 'py-2',
    normal: 'py-3.5',
    spacious: 'py-5',
  };
  const rowPadY = ROW_PAD_Y[rowDensity];

  // Phases/task groups/tasks now live in the React Query cache instead of
  // 3 separate useState — enabled:false because every fetch here has always
  // been driven explicitly by reloadAll() (33 call sites, on mount and after
  // every write), not by React's own mount/dependency tracking.
  const { data: taskQueryData, refetch: refetchTasks } = useQuery({
    queryKey: ['project-tasks', id],
    queryFn: async () => {
      let loadedTasks: any[] = [];
      let allGroups: any[] = [];
      let loadedPhases: any[] = [];
      let phs: any[] = [];
      try {
        phs = await getPhases(Number(id));
        loadedPhases = phs || [];
      } catch (err: any) {
        console.error('Lỗi khi tải danh sách Phase dự án:', err);
        flash('Lỗi tải danh sách Phase: ' + getApiErrorMessage(err), true);
      }

      // Every phase's task groups + the project's full task list are independent
      // of each other — fetch them all concurrently instead of one phase at a
      // time (was serial, so reloadAll() got slower the more phases a project
      // had; every write anywhere on this page calls reloadAll() afterward).
      const [groupResults, tsks] = await Promise.all([
        Promise.all((phs || []).map(p =>
          getTaskGroups(p.id).catch(e => {
            console.error(`Lỗi khi tải Task Group của Phase ${p.id}:`, e);
            return [];
          })
        )),
        getAllProjectTasks(Number(id)).catch(err => {
          console.error('Lỗi khi tải danh sách Task dự án:', err);
          flash('Lỗi tải danh sách Task: ' + getApiErrorMessage(err), true);
          return [];
        }),
      ]);
      allGroups = groupResults.flat();
      loadedTasks = tsks || [];

      return { phases: loadedPhases, groups: allGroups, tasks: loadedTasks };
    },
    enabled: false,
  });

  const phases: any[] = taskQueryData?.phases || [];
  const taskGroups: any[] = taskQueryData?.groups || [];
  const items: any[] = taskQueryData?.tasks || [];

  // Thin wrapper kept so all 33 existing call sites (on mount + after every
  // create/update/delete/move) don't need to change — same signature,
  // same loadingTasks behavior, same { tasks, groups } return shape.
  const reloadAll = useCallback(async (silent = false) => {
    if (!silent) {
      setLoadingTasks(true);
    }
    const result = await refetchTasks();
    if (!silent) {
      setLoadingTasks(false);
    }
    return { tasks: result.data?.tasks || [], groups: result.data?.groups || [] };
  }, [refetchTasks]);

  const dynamicTabs = [
    { key: 'ALL', label: 'Master', is_master: true, id: undefined as any },
    ...phases.filter(p => !p.is_master && p.name.toLowerCase() !== 'master').map(p => ({
      key: p.name,
      label: p.name,
      id: p.id,
      is_master: false
    }))
  ];

  // Phase thật, theo đúng thứ tự gốc (KHÔNG bao giờ sắp xếp lại) - bấm active
  // một Phase không được làm nó "nhảy" chỗ trên thanh (feedback: đứng chỗ nào
  // đứng luôn). Thứ tự ưu tiên (active trước, rồi pinned, rồi còn lại) CHỈ
  // dùng để quyết định Phase nào được CHỌN vào N slot hiển thị khi thiếu chỗ,
  // không dùng để sắp xếp lại vị trí hiển thị.
  const realPhases = useMemo(() => dynamicTabs.filter(t => !t.is_master), [phases]);

  const phaseSelectionPriorityOrder = useMemo(() => {
    const activeReal = realPhases.find(t => t.key === activePhase);
    const pinnedSet = new Set(pinnedPhaseIds);
    const ordered: typeof realPhases = [];
    const seen = new Set<string>();
    if (activeReal) { ordered.push(activeReal); seen.add(activeReal.key); }
    for (const t of realPhases) {
      if (seen.has(t.key)) continue;
      if (pinnedSet.has(t.id)) { ordered.push(t); seen.add(t.key); }
    }
    for (const t of realPhases) {
      if (seen.has(t.key)) continue;
      ordered.push(t); seen.add(t.key);
    }
    return ordered;
  }, [realPhases, activePhase, pinnedPhaseIds]);

  // Bao nhiêu Phase (không tính Master) thực sự vừa trên 1 hàng, đo bằng width
  // thật của từng tab (đo ẩn, xem lớp measurement bên dưới JSX) - đảm bảo
  // never-wrap/never-scroll ở mọi viewport, không hard-code theo số Phase.
  // "+ Thêm Phase" và "Áp dụng template" LUÔN hiện ngoài thanh (không rơi vào
  // dropdown) nên width của chúng luôn được reserve, bất kể có overflow hay không.
  const visiblePhaseCount = (() => {
    const total = phaseSelectionPriorityOrder.length;
    const cap = Math.min(MAX_VISIBLE_REAL_PHASES, total);
    const activeIsRealPhase = total > 0 && phaseSelectionPriorityOrder[0].key === activePhase;
    const minN = activeIsRealPhase ? 1 : 0;
    const GAP = 16;
    for (let n = cap; n >= minN; n--) {
      const hasOverflow = n < total;
      let width = PHASE_CHROME_WIDTHS.master + GAP + PHASE_CHROME_WIDTHS.plus + GAP;
      for (let i = 0; i < n; i++) {
        width += (phaseTabWidths[phaseSelectionPriorityOrder[i].key] || 90) + GAP;
      }
      if (hasOverflow) width += PHASE_CHROME_WIDTHS.overflow + GAP;
      if (n === minN || width <= phaseNavContainerWidth) return n;
    }
    return minN;
  })();
  const visiblePhaseKeys = new Set(phaseSelectionPriorityOrder.slice(0, visiblePhaseCount).map(t => t.key));
  const visibleRealPhaseTabs = realPhases.filter(t => visiblePhaseKeys.has(t.key));
  const overflowRealPhaseTabs = realPhases.filter(t => !visiblePhaseKeys.has(t.key));

  // Local state for meetings, chats
  const [meetings, setMeetings] = useState<any[]>([]);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailMeeting, setDetailMeeting] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);


  // Overview Time Filter States
  const [overviewYear, setOverviewYear] = useState<number | 'all'>('all');
  const [overviewMonth, setOverviewMonth] = useState<number | 'all'>('all');
  const [overviewWeek, setOverviewWeek] = useState<number | 'all'>('all');
  const [overviewQuickFilter, setOverviewQuickFilter] = useState<string | null>('all');

  // Overview sub-tab: "Tổng quan" (fast dashboard) vs "Chi tiết" (báo cáo sâu,
  // các block cũ dời qua nguyên vẹn). Local state, không route, không reset
  // hay refetch gì khi đổi qua lại (project-tasks query đã enabled:false).
  const [overviewSubTab, setOverviewSubTab] = useState<'summary' | 'detail'>('summary');
  const [showAllOverviewPhases, setShowAllOverviewPhases] = useState(false);
  const [showAllOverviewWorkload, setShowAllOverviewWorkload] = useState(false);
  const [showAllOverviewActivity, setShowAllOverviewActivity] = useState(false);

  const applyOverviewQuickFilter = (type: string) => {
    setOverviewQuickFilter(type);
    const now = new Date();
    if (type === 'Tuần trước') {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setOverviewYear(d.getFullYear()); setOverviewMonth(d.getMonth() + 1); setOverviewWeek(getWeekOfMonth(d));
    } else if (type === 'Tuần này') {
      setOverviewYear(now.getFullYear()); setOverviewMonth(now.getMonth() + 1); setOverviewWeek(getWeekOfMonth(now));
    } else if (type === 'Tuần tới') {
      const d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      setOverviewYear(d.getFullYear()); setOverviewMonth(d.getMonth() + 1); setOverviewWeek(getWeekOfMonth(d));
    } else if (type === 'Tháng trước') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      setOverviewYear(d.getFullYear()); setOverviewMonth(d.getMonth() + 1); setOverviewWeek('all');
    } else if (type === 'Tháng này') {
      setOverviewYear(now.getFullYear()); setOverviewMonth(now.getMonth() + 1); setOverviewWeek('all');
    } else if (type === 'Tháng tới') {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      setOverviewYear(d.getFullYear()); setOverviewMonth(d.getMonth() + 1); setOverviewWeek('all');
    } else if (type === 'all') {
      setOverviewYear('all'); setOverviewMonth('all'); setOverviewWeek('all');
    }
  };

  const [chats, setChats] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');

  // Group Chats & AI Task Inbox state
  const [chatGroups, setChatGroups] = useState<any[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupPlatform, setNewGroupPlatform] = useState('Telegram');
  const [newGroupLink, setNewGroupLink] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');

  // AI Task Inbox States
  const [activeChatSubTab, setActiveChatSubTab] = useState<'inbox' | 'sources' | 'mapping' | 'logs' | 'zalo_summary'>('inbox');
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
  const [hasClickedAddBot, setHasClickedAddBot] = useState(false);

  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);

  // Link edit state
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [addChannelKey, setAddChannelKey] = useState('');
  const [addChannelValue, setAddChannelValue] = useState('');

  // Double-submit guards for create/save/delete flows that don't already
  // have one — each disables its trigger button while the request is in
  // flight so a double-click can't fire the request twice.
  const [savingTaskGroup, setSavingTaskGroup] = useState(false);
  const [savingInlineTaskGroup, setSavingInlineTaskGroup] = useState(false);
  const [savingPhase, setSavingPhase] = useState(false);
  const [duplicatingTaskId, setDuplicatingTaskId] = useState<number | null>(null);
  const [deletingMeeting, setDeletingMeeting] = useState(false);
  const [savingGroupChat, setSavingGroupChat] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);

  const [newForm, setNewForm] = useState<any>({});

  // Edit Project Modal — form fields/dropdowns now live inside the shared
  // <ProjectFormModal>; this page only tracks open/closed.
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  const [projectMembers, setProjectMembers] = useState<any[]>([]);
  const [myMemberId, setMyMemberId] = useState<number | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myWorkspaceIds, setMyWorkspaceIds] = useState<string[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [categories, setCategories] = useState<any[]>([]);
  const [dbPriorities, setDbPriorities] = useState<any[]>([]);
  const [dbStatuses, setDbStatuses] = useState<any[]>([]);
  const [performanceSettings, setPerformanceSettings] = useState<any[]>([]);
  const [parentRemarks, setParentRemarks] = useState<any[]>([]);

  const [membersList, setMembersList] = useState<any[]>([]);

  const priorityFilterRef = useRef<HTMLDivElement>(null);
  const statusFilterRef = useRef<HTMLDivElement>(null);
  const assignedFilterRef = useRef<HTMLDivElement>(null);
  const supportFilterRef = useRef<HTMLDivElement>(null);
  const skillSolutionFilterRef = useRef<HTMLDivElement>(null);
  const skillVendorFilterRef = useRef<HTMLDivElement>(null);
  const [addMemberDropdownOpen, setAddMemberDropdownOpen] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const addMemberRef = useRef<HTMLDivElement>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Delete Phase modal — replaces the native confirm()/alert() combo.
  // Backend cascade-deletes the Phase + all its Task Groups + all Tasks/
  // Sub-tasks in one transaction (see delete_phase() in
  // backend/app/routers/projects.py), so the modal just previews the counts.
  const [phaseToDelete, setPhaseToDelete] = useState<{ id: number; name: string } | null>(null);
  const [deletingPhase, setDeletingPhase] = useState(false);

  // Delete Task Group modal — same cascade pattern (see delete_task_group()
  // in backend/app/routers/task_groups.py).
  const [groupToDelete, setGroupToDelete] = useState<{ id: number; phase_id: number; name: string } | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);

  const flash = (t: string, e = false) => {
    setMsg({ t, e });
    setTimeout(() => setMsg(null), 4000);
  };

  const loadTemplates = useCallback(async () => {
    try {
      setLoadingTemplates(true);
      const data = await getProjectTemplates();
      setTemplates(data || []);
    } catch (err: any) {
      console.error('Không thể tải danh sách template:', err);
      flash('Không thể tải danh sách template', true);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const handleOpenTemplateModal = async () => {
    setShowTemplateModal(true);
    await loadTemplates();
  };

  const handleApplyTemplate = async (templateId: number) => {
    if (!id) return;
    setApplyingTemplateId(templateId);
    try {
      const result = await applyProjectTemplate(templateId, Number(id));
      flash(`Áp dụng template thành công: ${result?.created_phase_count ?? 0} phase, ${result?.created_group_count ?? 0} task group, ${result?.created_task_count ?? 0} task.`);
      setShowTemplateModal(false);
      setConfirmApplyTemplateId(null);
      reloadAll();
    } catch (err: any) {
      flash('Áp dụng template thất bại: ' + getApiErrorMessage(err), true);
    } finally {
      setApplyingTemplateId(null);
    }
  };

  const handleDeleteSheet = async () => {
    try {
      await deleteProject(Number(id));
      flash('Xóa dự án thành công!');
      router.push('/project-hub');
    } catch (err: any) {
      flash('Xóa dự án thất bại: ' + getApiErrorMessage(err), true);
    }
  };

  const [weekOffset, setWeekOffset] = useState(0);

  const loadMeetings = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getMeetings({ project_id: Number(id) });
      if (data && data.success && Array.isArray(data.data)) {
        setMeetings(data.data);
      } else if (Array.isArray(data)) {
        setMeetings(data);
      }
    } catch (err) {
      console.error('Lỗi khi tải danh sách cuộc họp dự án:', err);
    }
  }, [id]);

  const currentWeekInfo = useMemo(() => {
    const now = new Date();
    const currentDay = now.getDay();
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday + weekOffset * 7);

    const days = [];
    const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);

      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      const formattedDate = `${dd}/${mm}`;
      const isoDate = `${yyyy}-${mm}-${dd}`;

      days.push({
        label: `${dayNames[i]} · ${formattedDate}`,
        formattedDate,
        isoDate,
        dayNum: dd,
        yearNum: yyyy,
        fullDate: d,
        isWeekend: i >= 5
      });
    }

    const startFormatted = days[0].formattedDate;
    const endFormatted = days[6].formattedDate;
    const weekTitle = `LỊCH HỌP DỰ ÁN TUẦN ${startFormatted}–${endFormatted}`;

    return { days, weekTitle, startFormatted, endFormatted };
  }, [weekOffset]);

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


  const loadChatData = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getChatGroups(Number(id));
      setChatGroups(data ? [...data] : []);

      const inboxRes = await getAITaskInbox(Number(id));
      if (inboxRes && inboxRes.items) {
        setInboxTasks([...inboxRes.items]);
        if (inboxRes.stats) {
          setInboxStats({ ...inboxRes.stats });
        }
      }

      const logs = await getChatSyncLogs(Number(id));
      if (logs) {
        setSyncLogs([...logs]);
      }
    } catch {
      // Silent catch on background polling
    }
  }, [id]);

  useEffect(() => {
    // Chỉ poll khi đang ở tab Chat — trước đây poll suốt thời gian mở trang
    // dự án dù chưa từng mở tab Chat.
    if (activeMainTab !== 'chats') return;

    loadChatData();
    const timer = setInterval(() => {
      // Không poll khi tab trình duyệt đang ở nền.
      if (document.visibilityState === 'visible') {
        loadChatData();
      }
    }, 20000); // 20s thay cho 5s
    return () => clearInterval(timer);
  }, [id, loadChatData, activeMainTab]);

  // Cột hiển thị + mật độ hàng của bảng Task - lưu riêng theo từng dự án và từng user
  // (khoá cũ pm_task_hidden_columns dùng chung cho mọi dự án/user trên máy - vẫn đọc
  // 1 lần để migrate cho user cũ chưa có prefs mới).
  const TASK_HIDDEN_COLUMNS_LEGACY_KEY = 'pm_task_hidden_columns';
  const taskTablePrefsKey = (projectId: any, email: string) => `pm_task_table_prefs:${projectId}:${email || 'anon'}`;

  useEffect(() => {
    if (!id) return;
    try {
      const key = taskTablePrefsKey(id, getEmail() || '');
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        // v1 blob = {hiddenColumns, density}, no `version` field - still supported.
        if (Array.isArray(parsed.hiddenColumns)) setHiddenColumns(parsed.hiddenColumns);
        if (parsed.density === 'compact' || parsed.density === 'normal' || parsed.density === 'spacious') {
          setRowDensity(parsed.density);
        }
        // Ensure DEADLINE and HEALTH are always visible for users with saved preferences
        let savedOrder = Array.isArray(parsed.columnOrder) && parsed.columnOrder.length ? parsed.columnOrder : TASK_COLUMNS;
        // SKILL SOLUTION/SKILL VENDOR were renamed to SKILL AREA/SKILL. Any
        // column order saved before that rename shipped still has the old
        // names, which no longer match anything in TASK_COLUMNS — silently
        // dropping these two LOCKED_COLUMNS from view for every returning
        // user (this hit production: worked for a fresh browser with no
        // saved prefs, broke for real accounts with an existing saved
        // order). Remap in place first so position/pin/width are kept,
        // then fall back to inserting if somehow still missing.
        savedOrder = savedOrder.map((c: string) => (c === 'SKILL SOLUTION' ? 'SKILL AREA' : c === 'SKILL VENDOR' ? 'SKILL' : c));
        if (!savedOrder.includes('SKILL AREA')) savedOrder = [...savedOrder.slice(0, savedOrder.indexOf('SUPPORT') >= 0 ? savedOrder.indexOf('SUPPORT') + 1 : savedOrder.length), 'SKILL AREA', ...savedOrder.slice(savedOrder.indexOf('SUPPORT') >= 0 ? savedOrder.indexOf('SUPPORT') + 1 : savedOrder.length)];
        if (!savedOrder.includes('SKILL')) savedOrder = [...savedOrder.slice(0, savedOrder.indexOf('SKILL AREA') >= 0 ? savedOrder.indexOf('SKILL AREA') + 1 : savedOrder.length), 'SKILL', ...savedOrder.slice(savedOrder.indexOf('SKILL AREA') >= 0 ? savedOrder.indexOf('SKILL AREA') + 1 : savedOrder.length)];
        if (!savedOrder.includes('DEADLINE')) savedOrder = [...savedOrder.slice(0, savedOrder.indexOf('MD ACTUAL') >= 0 ? savedOrder.indexOf('MD ACTUAL') : savedOrder.length), 'DEADLINE', ...savedOrder.slice(savedOrder.indexOf('MD ACTUAL') >= 0 ? savedOrder.indexOf('MD ACTUAL') : savedOrder.length)];
        if (!savedOrder.includes('HEALTH')) savedOrder = [...savedOrder.slice(0, savedOrder.indexOf('KPI BASE') >= 0 ? savedOrder.indexOf('KPI BASE') : savedOrder.length), 'HEALTH', ...savedOrder.slice(savedOrder.indexOf('KPI BASE') >= 0 ? savedOrder.indexOf('KPI BASE') : savedOrder.length)];
        setColumnOrder(savedOrder);
        setColumnWidths(parsed.columnWidths && typeof parsed.columnWidths === 'object' ? parsed.columnWidths : {});
        setPinnedColumns(Array.isArray(parsed.pinnedColumns) ? parsed.pinnedColumns : []);
      } else {
        const legacy = localStorage.getItem(TASK_HIDDEN_COLUMNS_LEGACY_KEY);
        if (legacy) {
          setHiddenColumns(JSON.parse(legacy));
        } else {
          // Mặc định là hiện ĐỦ cột cho mọi user/project chưa từng lưu
          // preference - ẩn/ghim cột là lựa chọn riêng của từng người, không
          // áp default ẩn sẵn lên người khác chưa từng đụng vào.
          setHiddenColumns([]);
        }
        setColumnOrder(TASK_COLUMNS);
        setColumnWidths({});
        setPinnedColumns([]);
      }
    } catch {}
  }, [id]);

  useEffect(() => {
    if (!id) return;
    try {
      const key = taskTablePrefsKey(id, getEmail() || '');
      localStorage.setItem(key, JSON.stringify({
        version: 2,
        hiddenColumns,
        density: rowDensity,
        columnOrder,
        columnWidths,
        pinnedColumns,
      }));
    } catch {}
  }, [id, hiddenColumns, rowDensity, columnOrder, columnWidths, pinnedColumns]);

  // Pin Phase trên thanh navigation - lưu riêng theo dự án + user, giống pattern
  // pm_task_table_prefs ở trên.
  const phasePinsKey = (projectId: any, email: string) => `pm_phase_pins:${projectId}:${email || 'anon'}`;

  useEffect(() => {
    if (!id) return;
    try {
      const saved = localStorage.getItem(phasePinsKey(id, getEmail() || ''));
      setPinnedPhaseIds(saved ? JSON.parse(saved) : []);
    } catch {
      setPinnedPhaseIds([]);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(phasePinsKey(id, getEmail() || ''), JSON.stringify(pinnedPhaseIds));
    } catch {}
  }, [id, pinnedPhaseIds]);

  // Ghim nhiều hơn số slot hiển thị trên thanh là vô nghĩa (phase ghim dư vẫn
  // rơi vào "Phase khác"), nên khoá chung với MAX_VISIBLE_REAL_PHASES thay vì
  // một con số tách rời - đổi 1 chỗ là đồng bộ cả 2.
  const MAX_PINNED_PHASES = MAX_VISIBLE_REAL_PHASES;
  const togglePinPhase = (phaseId: number) => {
    setPinnedPhaseIds(prev => {
      if (prev.includes(phaseId)) return prev.filter(x => x !== phaseId);
      if (prev.length >= MAX_PINNED_PHASES) {
        flash(`Chỉ được ghim tối đa ${MAX_PINNED_PHASES} Phase. Hãy bỏ ghim bớt 1 Phase trước khi ghim thêm.`, true);
        return prev;
      }
      return [...prev, phaseId];
    });
  };

  // Theo dõi width thật của khu vực Phase-nav (co giãn theo viewport, vd 1280px
  // laptop) để tính lại visiblePhaseCount ở trên mỗi khi resize.
  useEffect(() => {
    const el = phaseNavContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setPhaseNavContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setPhaseNavContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Đo width thật (ẩn, không ảnh hưởng layout) của từng Phase tab + các control
  // cố định (Master, "Phase khác (N)", "+ Thêm Phase", "Áp dụng template") mỗi
  // khi danh sách/tên Phase thay đổi.
  useLayoutEffect(() => {
    const widths: Record<string, number> = {};
    realPhases.forEach(t => {
      const el = phaseTabMeasureRefs.current[t.key];
      if (el) widths[t.key] = el.offsetWidth;
    });
    setPhaseTabWidths(widths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realPhases.map(t => t.key + ':' + t.label).join('|')]);

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
    loadMeetings();
  }, [id, loadProject, reloadAll, loadChatData, loadProjectMembers, loadMeetings]);

  useEffect(() => {
    getMe().then(me => {
      setMyMemberId(me?.member_id ?? null);
      setMyRole((me?.role || '').toLowerCase() || null);
      // workspace_ids already covers multi-Workspace Leaders correctly (not
      // just their single primary data_scope) — see GET /me in users.py.
      setMyWorkspaceIds((me?.workspace_ids || []).map((w: string) => (w || '').toLowerCase()));
    }).catch(() => {
      setMyMemberId(null);
      setMyRole(null);
      setMyWorkspaceIds([]);
    });
  }, []);

  // Full project-management rights: global admin (super_admin/leader), OR this
  // project's own member_id assigned project-role PM/Leader in project_members
  // (mirrors backend has_full_project_access in backend/app/utils/access.py).
  const isProjectManager = useMemo(() => {
    if (isAdmin()) return true;
    if (myMemberId == null) return false;
    return projectMembers.some(
      (m: any) => (m.role === 'PM' || m.role === 'Leader') && Number(m.id) === Number(myMemberId)
    );
  }, [myMemberId, projectMembers]);

  // Shared 4-tier rule — Admin, OR a Leader whose Workspace access actually
  // covers this project (NOT a blanket "role === leader" pass — that's what
  // isProjectManager/isAdmin() do, and is exactly the gap this exists to
  // close), OR this project's own PM/Leader. Mirrors the backend's dedicated
  // can_apply_project_template() (backend/app/utils/access.py). Kept as
  // separately-NAMED call sites below (not exported directly) so a future
  // rule change for just one action doesn't ripple to the others — frontend
  // gating is UX only, the backend re-checks independently either way.
  const hasProjectManagementAccess = (project: any): boolean => {
    if (!project) return false;
    if (myRole === 'super_admin') return true;
    if (myRole === 'leader') {
      const scope = (project.data_scope || '').toLowerCase();
      if (myWorkspaceIds.includes('all') || myWorkspaceIds.includes(scope) || project.business === 'All') {
        return true;
      }
    }
    if (myMemberId == null) return false;
    return projectMembers.some(
      (m: any) => (m.role === 'PM' || m.role === 'Leader') && Number(m.id) === Number(myMemberId)
    );
  };

  const canApplyProjectTemplate = (project: any): boolean => hasProjectManagementAccess(project);

  // Phase CRUD, Task Group CRUD/Move — require_route_project_access requires
  // this same PM/Leader-or-above tier for these paths (they don't match the
  // broader _is_task_write allowance plain Task actions get, see below).
  const canManageProjectStructure = (project: any): boolean => hasProjectManagementAccess(project);

  // Task CRUD/Move — backend allows ANY assigned project member, not just
  // PM/Leader (_is_task_write in backend/app/utils/access.py). Named per
  // action per the agreed convention; all 3 delegate to the same check today
  // so a future rule change for just one doesn't require touching the others.
  const isAssignedProjectMember = (): boolean => {
    if (myMemberId == null) return false;
    return projectMembers.some((m: any) => Number(m.id) === Number(myMemberId));
  };
  const canManageTasks = (project: any): boolean => hasProjectManagementAccess(project) || isAssignedProjectMember();
  const canEditTask = (project: any): boolean => canManageTasks(project);
  const canMoveTask = (project: any): boolean => canManageTasks(project);
  const canDeleteTask = (project: any): boolean => canManageTasks(project);

  // Load members, customers and categories
  useEffect(() => {
    getMembers()
      .then((data) => {
        setMembersList(data || []);
      })
      .catch((err) => {
        console.error('Error fetching members:', err);
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

    getParentRemarks()
      .then((data) => {
        setParentRemarks(data || []);
      })
      .catch((err) => {
        console.error('Error fetching parent remarks:', err);
      });

    getWorkspaces()
      .then((data) => {
        setWorkspaces(data || []);
      })
      .catch((err) => {
        console.error('Error fetching workspaces:', err);
      });
  }, []);

  // Lưu ý: columnMenuOpen / addTaskMenuOpen / filterPopoverOpen / openRowMenu /
  // openHeaderMenu / 6 per-column filter dropdown KHÔNG xử lý outside-click/Escape
  // ở đây nữa - dropdown của chúng được portal ra document.body qua
  // <FloatingDropdown>, tự đóng khi click ngoài/Escape/scroll/resize (xem component
  // FloatingDropdown ở đầu file). Giữ chúng ở effect này sẽ sai vì target bên trong
  // portal không còn nằm trong subtree DOM gốc để `.contains()`/`closest()` nhận ra.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (addMemberDropdownOpen && addMemberRef.current && !addMemberRef.current.contains(target)) {
        setAddMemberDropdownOpen(false);
        setAddMemberSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [addMemberDropdownOpen]);

  // Escape thoát Task Focus Mode (các menu/popover portal tự xử lý Escape riêng)
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && taskFocusMode) setTaskFocusMode(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [taskFocusMode]);

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
      flash('Lỗi cập nhật liên kết: ' + getApiErrorMessage(err), true);
    } finally {
      setIsSavingLink(false);
    }
  };

  const handleCreatePhase = async () => {
    if (savingPhase) return;
    const name = newPhaseName.trim();
    if (!name) {
      flash('Tên Phase không được để trống!', true);
      return;
    }
    if (name.toLowerCase() === 'master') {
      flash('Tên "Master" là dành riêng cho Phase mặc định!', true);
      return;
    }
    if (name.length >= 20) {
      flash('Tên Phase quá dài! Chỉ được tối đa 19 ký tự.', true);
      return;
    }
    const dup = phases.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      flash('Phase này đã tồn tại trong dự án!', true);
      return;
    }
    setSavingPhase(true);
    try {
      await createPhase(Number(id), { name });
      flash('Tạo Phase mới thành công!');
      setShowPhaseModal(false);
      setNewPhaseName('');
      reloadAll();
    } catch (err: any) {
      flash('Lỗi tạo phase: ' + getApiErrorMessage(err), true);
      reloadAll();
    } finally {
      setSavingPhase(false);
    }
  };

  const handleRenamePhase = async () => {
    if (savingPhase) return;
    const name = editingPhaseName.trim();
    if (!name) {
      flash('Tên Phase không được để trống!', true);
      return;
    }
    if (name.toLowerCase() === 'master') {
      flash('Tên "Master" là dành riêng cho Phase mặc định!', true);
      return;
    }
    if (name.length >= 20) {
      flash('Tên Phase quá dài! Chỉ được tối đa 19 ký tự.', true);
      return;
    }
    const dup = phases.some(p => p.id !== editingPhaseId && p.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      flash('Phase này đã tồn tại trong dự án!', true);
      return;
    }
    if (editingPhaseId === null) return;
    setSavingPhase(true);
    try {
      await updatePhase(Number(id), editingPhaseId, { name });
      flash('Đổi tên Phase thành công!');
      setShowRenameModal(false);
      setEditingPhaseId(null);
      setEditingPhaseName('');
      reloadAll();
    } catch (err: any) {
      flash('Lỗi đổi tên phase: ' + getApiErrorMessage(err), true);
    } finally {
      setSavingPhase(false);
    }
  };

  const handleDeletePhase = (pid: number, pname: string) => {
    if (pname.toLowerCase() === 'master') {
      flash('Không thể xóa Phase Master!', true);
      return;
    }
    setPhaseToDelete({ id: pid, name: pname });
  };

  const handleConfirmDeletePhase = async () => {
    if (!phaseToDelete || deletingPhase) return;
    setDeletingPhase(true);
    try {
      const result = await deletePhase(Number(id), phaseToDelete.id);
      const groupCount = result?.deleted_group_count ?? 0;
      const taskCount = result?.deleted_task_count ?? 0;
      flash(`Đã xóa Phase "${phaseToDelete.name}" cùng ${groupCount} Task Group và ${taskCount} Task!`);
      if (activePhase === phaseToDelete.name) {
        setActivePhase('ALL');
      }
      setPhaseToDelete(null);
      reloadAll();
    } catch (err: any) {
      flash(getApiErrorMessage(err), true);
    } finally {
      setDeletingPhase(false);
    }
  };

  // Kéo-thả đổi thứ tự Phase. `realPhases` giữ đúng thứ tự sort_order hiện
  // tại (never re-sorted for display priority - xem comment ở khai báo
  // realPhases), nên tính order mới dựa thẳng trên nó là đủ, không cần lo
  // lệch với Phase đang bị ẩn vào "Phase khác" (chúng vẫn có mặt trong
  // realPhases, chỉ không hiện thành tab). Gửi lên FULL danh sách vì backend
  // từ chối reorder thiếu Phase.
  const commitPhaseReorder = async (draggedId: number, targetId: number | 'end', side?: 'before' | 'after') => {
    if (targetId !== 'end' && draggedId === targetId) return;
    const currentOrder = realPhases.map((p: any) => p.id as number);
    const withoutDragged = currentOrder.filter((pid: number) => pid !== draggedId);
    let insertAt: number;
    if (targetId === 'end') {
      insertAt = withoutDragged.length;
    } else {
      const targetIdx = withoutDragged.indexOf(targetId);
      insertAt = side === 'before' ? targetIdx : targetIdx + 1;
    }
    const newOrder = [...withoutDragged.slice(0, insertAt), draggedId, ...withoutDragged.slice(insertAt)];
    setReorderingPhaseId(draggedId);
    try {
      await reorderPhases(Number(id), newOrder.map((phaseId: number, idx: number) => ({ phase_id: phaseId, sort_order: idx })));
      await reloadAll(true);
    } catch (err: any) {
      flash('Lỗi sắp xếp Phase: ' + getApiErrorMessage(err), true);
    } finally {
      setReorderingPhaseId(null);
    }
  };

  const handleConfirmDeleteGroup = async () => {
    if (!groupToDelete || deletingGroup) return;
    setDeletingGroup(true);
    try {
      const result = await deleteTaskGroup(groupToDelete.phase_id, groupToDelete.id);
      const taskCount = result?.deleted_task_count ?? 0;
      flash(`Đã xóa Task Group "${groupToDelete.name}" cùng ${taskCount} Task!`);
      setGroupToDelete(null);
      reloadAll();
    } catch (err: any) {
      flash(getApiErrorMessage(err), true);
    } finally {
      setDeletingGroup(false);
    }
  };

  const getTaskPhaseId = (task: any): number | null => {
    const group = taskGroups.find(g => g.id === task.task_group_id);
    return group ? group.phase_id : null;
  };

  const getTaskHealthStatus = (task: any): string => {
    const sl = (task.status || '').toLowerCase();
    const isDone = sl === 'done' || sl === 'completed';
    const isReview = sl.includes('review');
    const isBlocked = sl.includes('block') || task.is_blocked;
    if (isReview) return 'review';
    if (isBlocked) return 'blocked';
    if (!isDone && task.end_date_est) {
      const deadline = new Date(task.end_date_est);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      deadline.setHours(0, 0, 0, 0);
      const daysLate = Math.floor((now.getTime() - deadline.getTime()) / 86400000);
      if (daysLate >= 3) return 'risk_high';
      if (daysLate === 2) return 'risk_medium';
      if (daysLate === 1) return 'risk_low';
      return 'on_track';
    }
    if (isDone) return 'done';
    return 'unknown';
  };

  const filteredItems = useMemo(() => {
    const searchLower = taskSearch.toLowerCase();
    const reviewFilter = taskFilterMode === 'review';
    const myTasksFilter = taskFilterMode === 'my_tasks';
    const smartPriorityFilter = taskFilterMode === 'smart_priority';
    const hasActiveFilter = priorityFilter !== 'All' || statusFilter !== 'All'
      || assignedFilter !== 'All' || supportFilter !== 'All'
      || skillSolutionFilter !== 'All' || skillVendorFilter !== 'All'
      || !!searchLower || !!memberFilterParam || reviewFilter || myTasksFilter || smartPriorityFilter;
    if (!hasActiveFilter) {
      return items;
    }

    let baseItems = items;
    if (reviewFilter) {
      baseItems = items.filter(item => (item.status || '').toLowerCase().includes('review'));
    } else if (myTasksFilter) {
      baseItems = items.filter(item => item.assigned_id != null && myMemberId != null && Number(item.assigned_id) === Number(myMemberId));
    } else if (smartPriorityFilter) {
      baseItems = items.filter(item => {
        const health = getTaskHealthStatus(item);
        return health === 'risk_low' || health === 'risk_medium' || health === 'risk_high';
      });
    }

    if (!searchLower && priorityFilter === 'All' && statusFilter === 'All'
      && assignedFilter === 'All' && supportFilter === 'All'
      && skillSolutionFilter === 'All' && skillVendorFilter === 'All'
      && !memberFilterParam) {
      return baseItems;
    }

    // 1. Find tasks that match ALL active filters directly
    const matchingTasks = baseItems.filter(item => {
      const matchSearch = !searchLower
        || (item.detail || '').toLowerCase().includes(searchLower)
        || (item.task_code || '').toLowerCase().includes(searchLower)
        || (item.assigned_name || '').toLowerCase().includes(searchLower)
        || (item.support_name || '').toLowerCase().includes(searchLower);
      const matchPriority = priorityFilter === 'All' || item.priority === priorityFilter;
      const matchStatus = statusFilter === 'All' || item.status === statusFilter;
      const matchAssigned = assignedFilter === 'All' || (item.assigned_name || '') === assignedFilter;
      const matchSupport = supportFilter === 'All' || (item.support_name || '') === supportFilter;
      // Match theo ID, không phải tên hiển thị — 2 Skill Area (Group) khác
      // Category vẫn có thể trùng tên nhau, match theo tên sẽ gộp nhầm task
      // của 2 Group khác nhau vào chung 1 kết quả filter.
      const matchSkillSolution = skillSolutionFilter === 'All' || String(item.skill_solution_id || '') === skillSolutionFilter;
      const matchSkillVendor = skillVendorFilter === 'All' || String(item.skill_vendor_id || '') === skillVendorFilter;
      const matchMember = !memberFilterParam || (item.assigned_name || '') === memberFilterParam || (item.support_name || '') === memberFilterParam;
      return matchSearch && matchPriority && matchStatus && matchAssigned && matchSupport && matchSkillSolution && matchSkillVendor && matchMember;
    });

    const onlySearch = !priorityFilter.match(/^All$/) === false && !statusFilter.match(/^All$/) === false
      && assignedFilter === 'All' && supportFilter === 'All'
      && skillSolutionFilter === 'All' && skillVendorFilter === 'All'
      && priorityFilter === 'All' && statusFilter === 'All';
    if (onlySearch) {
      return matchingTasks;
    }

    // Build lookup maps using task_code (hierarchy defined by task_code, NOT parent_id)
    const itemsByCode = new Map(baseItems.map(item => [item.task_code, item]));
    const matchingCodes = new Set(matchingTasks.map(t => t.task_code));

    const allTasksToShow = new Set(matchingTasks);

    // 2. For each matching task, walk up ancestors via task_code to preserve hierarchy
    matchingTasks.forEach(task => {
      let code = task.task_code || '';
      while (code) {
        const parentCode = getParentCode(code);
        if (!parentCode) break;
        const parent = itemsByCode.get(parentCode);
        if (parent && !allTasksToShow.has(parent)) {
          allTasksToShow.add(parent);
        }
        code = parentCode;
      }
    });

    // 3. Also include all descendant tasks of matching tasks (subtree expansion)
    baseItems.forEach(item => {
      const code = item.task_code || '';
      if (!code) return;
      for (const matchCode of Array.from(matchingCodes)) {
        if (matchCode && code.startsWith(matchCode + '.')) {
          allTasksToShow.add(item);
          break;
        }
      }
    });

    // 4. Return in original order
    return baseItems.filter(item => allTasksToShow.has(item));
  }, [items, taskSearch, priorityFilter, statusFilter, assignedFilter, supportFilter, skillSolutionFilter, skillVendorFilter, taskFilterMode, myMemberId]);

  // Skill Area/Skill filter dropdown options - value is the real ID (never
  // the display name, which is NOT unique across Categories/Groups), label
  // gets a disambiguating "(parent name)" suffix only when 2+ distinct IDs
  // in the current task list happen to share the same display name.
  const buildSkillAreaFilterOptions = () => {
    const nameById = new Map<number, string>();
    items.forEach((t: any) => { if (t.skill_solution_id) nameById.set(t.skill_solution_id, t.skill_solution_name || ''); });
    const nameCounts = new Map<string, number>();
    nameById.forEach(name => nameCounts.set(name, (nameCounts.get(name) || 0) + 1));
    const categoryNameByGroupId = new Map<number, string>();
    categories.forEach((c: any) => (c.groups || []).forEach((g: any) => categoryNameByGroupId.set(g.id, c.name)));
    return [
      { value: 'All', label: 'All' },
      ...Array.from(nameById.entries())
        .map(([id, name]) => {
          const dup = (nameCounts.get(name) || 0) > 1;
          const catName = categoryNameByGroupId.get(id);
          return { value: String(id), label: dup && catName ? `${name} (${catName})` : name };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  };

  const buildSkillFilterOptions = () => {
    const nameById = new Map<number, string>();
    items.forEach((t: any) => { if (t.skill_vendor_id) nameById.set(t.skill_vendor_id, t.skill_vendor_name || ''); });
    const nameCounts = new Map<string, number>();
    nameById.forEach(name => nameCounts.set(name, (nameCounts.get(name) || 0) + 1));
    const groupNameBySkillId = new Map<number, string>();
    categories.forEach((c: any) => (c.groups || []).forEach((g: any) => (g.skills || []).forEach((s: any) => groupNameBySkillId.set(s.id, g.name))));
    return [
      { value: 'All', label: 'All' },
      ...Array.from(nameById.entries())
        .map(([id, name]) => {
          const dup = (nameCounts.get(name) || 0) > 1;
          const grpName = groupNameBySkillId.get(id);
          return { value: String(id), label: dup && grpName ? `${name} (${grpName})` : name };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  };

  const getFilteredTasks = () => {
    if (activePhase === 'ALL') {
      return filteredItems;
    }
    const currentPhaseObj = phases.find(p => p.name === activePhase);
    if (!currentPhaseObj) return [];
    return filteredItems.filter(t => getTaskPhaseId(t) === currentPhaseObj.id);
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
      case 'ASSIGNED': return (group.assigned_names || []).join(', ');
      case 'SUPPORT': return (group.support_names || []).join(', ');
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
        const groupTasks = filteredItems.filter(t => t.task_group_id === g.id);

        if (groupTasks.length > 0 || (priorityFilter === 'All' && taskSearch === '')) {
          rows.push({ type: 'group', id: -g.id, group: g });

          const isCollapsed = collapsedGroups.has(g.id);
          if (!isCollapsed) {
            const sortedTasks = buildTaskTree(groupTasks);

            for (const task of sortedTasks) {
              if (!isAncestorCollapsed(task.task_code)) {
                rows.push({ type: 'task', id: task.id, task });
              }
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
          } else if (colUpper === 'SKILL AREA') {
            setEditValue(targetRow.task.skill_solution_id ? String(targetRow.task.skill_solution_id) : '');
          } else if (colUpper === 'SKILL') {
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
        // Chọn 1 status chứa "block" (khác status hiện tại) - bắt nhập lý do
        // THẬT trước khi lưu, thay vì để backend tự set lý do placeholder
        // chung chung. Chặn lại save ở đây, mở modal riêng, chỉ lưu status +
        // gọi /block với lý do thật sau khi user xác nhận.
        {
          const sBlockCheck = (value || '').trim().toLowerCase();
          const wasBlocked = task.is_blocked || (task.status || '').trim().toLowerCase().includes('block');
          if (sBlockCheck.includes('block') && !wasBlocked) {
            setEditingCell(null);
            setBlockReason('');
            setBlockDependencyTaskId('');
            setBlockPrompt({ taskId, statusValue: value });
            return;
          }
        }
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
      case 'SKILL AREA':
        payload.skill_solution_id = value ? parseInt(value, 10) : null;
        payload.skill_vendor_id = null;
        break;
      case 'SKILL':
        payload.skill_vendor_id = value ? parseInt(value, 10) : null;
        break;
      case 'TICKET ID':
      case 'LINK':
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
      flash('Lỗi cập nhật task: ' + getApiErrorMessage(err), true);
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
      case 'MANDAY': {
        const trimmed = (value || '').trim();
        if (!trimmed) {
          flash('MANDAY EST của Task Group là bắt buộc, không được để trống!', true);
          return;
        }
        const manday = Number(trimmed);
        if (!Number.isFinite(manday) || !Number.isInteger(manday)) {
          flash('MANDAY EST của Task Group phải là số nguyên, không được là số thập phân!', true);
          return;
        }
        if (manday < 1 || manday > 10) {
          flash('MANDAY EST của Task Group phải là số nguyên từ 1 đến 10!', true);
          return;
        }
        payload.manday_est = manday;
        break;
      }
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
      flash('Lỗi cập nhật: ' + getApiErrorMessage(err), true);
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

  const handleSaveGroupPeople = async (group: any, field: 'assigned_ids' | 'support_ids', ids: (string | number)[]) => {
    try {
      await updateTaskGroup(group.phase_id, group.id, { [field]: ids.map(Number) });
      await reloadAll(true);
    } catch (err: any) {
      flash('Lỗi cập nhật: ' + getApiErrorMessage(err), true);
    }
  };

  const handleSyncRemarkToChildren = async (groupId: number, remarkValue: string) => {
    if (isSavingRef.current) return;
    const childTasks = items.filter(t => t.task_group_id === groupId);
    if (childTasks.length === 0) {
      setEditingGroupRemark(null);
      return;
    }
    isSavingRef.current = true;
    try {
      await Promise.all(childTasks.map(task => updateTask(groupId, task.id, { remark: remarkValue })));
      flash(`Đã đồng bộ Remark cho ${childTasks.length} task con!`);
      await reloadAll(true);
    } catch (err: any) {
      flash('Lỗi đồng bộ Remark: ' + getApiErrorMessage(err), true);
    } finally {
      isSavingRef.current = false;
      setEditingGroupRemark(null);
    }
  };

  const handleDeleteTaskConfirm = async () => {
    if (taskToDelete === null) return;
    const task = items.find(item => item.id === taskToDelete);
    if (!task) return;
    try {
      await deleteTask(task.task_group_id, taskToDelete);
      flash('Đã xóa nhiệm vụ thành công!');
      reloadAll(true);
    } catch (err: any) {
      flash('Lỗi xóa task: ' + getApiErrorMessage(err), true);
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
    if (s.includes('block')) return { label: status || 'Blocked', dot: 'bg-rose-500', text: 'text-rose-700', bg: 'bg-rose-50 text-rose-700' };
    if (s === 'pending') return { label: 'Pending', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-100 text-slate-700' };
    return { label: status || 'Todo', dot: 'bg-slate-500', text: 'text-slate-600', bg: 'bg-slate-100 text-slate-700' };
  };

  const getAvailableStatuses = () => {
    const baseStatuses = dbStatuses.length === 0
      ? [
          { id: 1, name: 'Todo' },
          { id: 2, name: 'Waiting' },
          { id: 3, name: 'Process' },
          { id: 4, name: 'Done' },
          { id: 5, name: 'Cancel' },
        ]
      : dbStatuses;
    // Review is optional, not mandatory — a Member can set Done directly
    // themself, same as a Leader (see backend update_task), so Done/Hoàn
    // thành/etc. is no longer filtered out of their Status options.
    return baseStatuses;
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
      flash(getApiErrorMessage(error, "Có lỗi xảy ra khi lưu cuộc họp"), true);
    }
  };

  const executeDeleteMeeting = async () => {
    if (!deleteConfirmId || deletingMeeting) return;
    setDeletingMeeting(true);
    try {
      await deleteMeeting(parseInt(deleteConfirmId));
      flash('Đã xóa cuộc họp thành công!');
      loadMeetings();
      setDeleteConfirmId(null);
    } catch (error: any) {
      console.error("Failed to delete meeting", error);
      flash(getApiErrorMessage(error, "Có lỗi xảy ra khi xóa cuộc họp"), true);
    } finally {
      setDeletingMeeting(false);
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
      flash('Không thể thêm thành viên: ' + getApiErrorMessage(err), true);
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

  // --- Overview Filtered Tasks & Summary Stats ---
  const overviewTasksInPeriod = useMemo(() => {
    if (overviewYear === 'all' && overviewMonth === 'all' && overviewWeek === 'all' && (overviewQuickFilter === 'all' || !overviewQuickFilter)) {
      return items;
    }
    return items.filter(t => checkTaskInPeriod(t, overviewYear, overviewMonth, overviewWeek, overviewQuickFilter));
  }, [items, overviewYear, overviewMonth, overviewWeek, overviewQuickFilter]);

  const summaryProjectStats = useMemo(() => {
    const isMaintenance = (t: any) => {
      const n = (t.phase_name || t.group_name || t.phase || '').toLowerCase();
      return n.includes('ma') || n.includes('bảo trì') || n.includes('maintenance') || n.startsWith('4.');
    };

    const impTasks = overviewTasksInPeriod.filter(t => !isMaintenance(t));
    const mainTasks = overviewTasksInPeriod.filter(t => isMaintenance(t));

    const calcDurationDays = (tList: any[], useActual = false) => {
      if (!tList || tList.length === 0) return 0;
      let minDate: Date | null = null;
      let maxDate: Date | null = null;

      tList.forEach(t => {
        const startStr = t.start_date || t.created_at;
        const endStr = useActual ? (t.end_date_actual || t.end_date_est) : (t.end_date_est || t.end_date_actual);
        const sD = parseDateString(startStr);
        const eD = parseDateString(endStr);

        if (sD) {
          if (!minDate || sD < (minDate as Date)) minDate = sD;
        }
        if (eD) {
          if (!maxDate || eD > (maxDate as Date)) maxDate = eD;
        }
      });

      if (!minDate || !maxDate) return 0;
      const minMs = (minDate as Date).getTime();
      const maxMs = (maxDate as Date).getTime();
      if (maxMs < minMs) return 0;
      const diffTime = Math.abs(maxMs - minMs);
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    const calcMandayEst = (tList: any[]) => tList.reduce((acc, t) => acc + (parseFloat(t.manday_est) || 0), 0);
    const calcMandayAct = (tList: any[]) => tList.reduce((acc, t) => acc + (parseFloat(t.manday_actual != null ? t.manday_actual : t.manday_est) || 0), 0);
    const calcOverdueDays = (tList: any[]) => tList.reduce((acc, t) => acc + calculateDaysLate(t), 0);
    const getOverdueTasks = (tList: any[]) => tList.filter(t => calculateDaysLate(t) > 0);
    const calcKpi = (tList: any[]) => tList.reduce((acc, t) => {
      const isDone = (t.status || '').toLowerCase() === 'done' || (t.status || '').toLowerCase() === 'completed';
      return acc + (isDone ? (parseFloat(t.kpi_base) || 0) : 0);
    }, 0);

    const countPrio = (tList: any[], prio: string) => tList.filter(t => (t.priority || '').toLowerCase() === prio.toLowerCase()).length;

    const impOverdue = getOverdueTasks(impTasks);
    const mainOverdue = getOverdueTasks(mainTasks);
    const totalOverdue = getOverdueTasks(overviewTasksInPeriod);

    return {
      durationEst: { total: calcDurationDays(overviewTasksInPeriod, false), imp: calcDurationDays(impTasks, false), main: calcDurationDays(mainTasks, false) },
      durationAct: { total: calcDurationDays(overviewTasksInPeriod, true), imp: calcDurationDays(impTasks, true), main: calcDurationDays(mainTasks, true) },
      mandayEst: { total: Math.round(calcMandayEst(overviewTasksInPeriod) * 10) / 10, imp: Math.round(calcMandayEst(impTasks) * 10) / 10, main: Math.round(calcMandayEst(mainTasks) * 10) / 10 },
      mandayAct: { total: Math.round(calcMandayAct(overviewTasksInPeriod) * 10) / 10, imp: Math.round(calcMandayAct(impTasks) * 10) / 10, main: Math.round(calcMandayAct(mainTasks) * 10) / 10 },
      overdueDays: { total: calcOverdueDays(overviewTasksInPeriod), imp: calcOverdueDays(impTasks), main: calcOverdueDays(mainTasks) },
      overdueTasksCount: { total: totalOverdue.length, imp: impOverdue.length, main: mainOverdue.length },
      overdueNotesList: totalOverdue.map((t: any, i: number) => `${t.task_code || t.id}. ${t.detail_task || t.name || 'Task trễ'}`),
      kpi: { total: Math.round(calcKpi(overviewTasksInPeriod) * 10) / 10, imp: Math.round(calcKpi(impTasks) * 10) / 10, main: Math.round(calcKpi(mainTasks) * 10) / 10 },
      totalTasksCount: { total: overviewTasksInPeriod.length, imp: impTasks.length, main: mainTasks.length },
      criticalCount: { total: countPrio(overviewTasksInPeriod, 'critical'), imp: countPrio(impTasks, 'critical'), main: countPrio(mainTasks, 'critical') },
      highCount: { total: countPrio(overviewTasksInPeriod, 'high'), imp: countPrio(impTasks, 'high'), main: countPrio(mainTasks, 'high') },
      normalCount: { total: countPrio(overviewTasksInPeriod, 'normal'), imp: countPrio(impTasks, 'normal'), main: countPrio(mainTasks, 'normal') },
    };
  }, [overviewTasksInPeriod]);

  // --- Dynamic Stats calculation ---
  const kpiTasks = activeMainTab === 'overview' ? overviewTasksInPeriod : getFilteredTasks();
  const kpiTotal = kpiTasks.length;

  // 1 & 2. Số task hoàn thành & % Tiến độ
  const kpiDone = kpiTasks.filter(x => {
    const s = (x.status || '').toLowerCase();
    return s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish');
  }).length;
  // Issue 3 — Project Progress from Settings → Master Phases (single source
  // of truth). Falls back to 0 when the backend hasn't populated it yet.
  const devProgressPercent = (project && typeof project.progress_pct === 'number')
    ? Math.round(project.progress_pct)
    : 0;
  // Task-completion percentage is preserved as a separate metric for any
  // surface that intentionally shows it.
  const kpiTaskCompletionPct = kpiTotal > 0 ? Math.round((kpiDone / kpiTotal) * 100) : 0;

  // 3. Tổng Manday
  const kpiTotalManday = Math.round(kpiTasks.reduce((sum, task) => {
    const rawMd = task.manday_actual != null ? task.manday_actual : task.manday_est;
    const md = parseFloat(rawMd as string);
    return sum + (isNaN(md) ? 0 : md);
  }, 0) * 10) / 10;

  // 4. Trễ deadline (Chưa hoàn thành và quá hạn)
  const overdueTasksList = kpiTasks.filter(x => {
    return calculateDaysLate(x) > 0;
  });
  const kpiWarning = overdueTasksList.length;

  // Leader Review - attention queue: tổng hợp task cần leader chú ý từ CHÍNH
  // `items` (toàn bộ task của project, getAllProjectTasks không phân trang -
  // xem định nghĩa `items` phía trên) nên count là tổng project thật, không
  // giới hạn theo Phase/trang đang xem. 4 điều kiện dựa 100% trên field/status
  // thật đã có sẵn (không field/API mới):
  //   - Overdue      : calculateDaysLate(task) > 0 (cùng hàm dùng cho cột
  //                     "Days Late" và overdueTasksList ở trên - đã tự loại
  //                     Done/Cancel).
  //   - Blocked       : task.is_blocked === true (layer blocking THẬT, riêng
  //                     với status - xem backend models/task.py). Fallback
  //                     status chứa "block" CHỈ khi is_blocked chưa từng được
  //                     set (legacy trước khi có cột is_blocked/backfill).
  //   - Review pending: task.review_status === 'pending' (layer review THẬT,
  //                     riêng với status - xem backend models/task.py). Fallback
  //                     status chứa "review" CHỈ khi review_status chưa có giá
  //                     trị (null/undefined) - dữ liệu legacy trước khi có cột
  //                     review_status/migration backfill chạy.
  //   - Unassigned    : task.assigned_name rỗng VÀ task chưa Done/Cancel
  //                     (task xong việc mà không có người phụ trách không có
  //                     giá trị cảnh báo).
  // 1 task match nhiều điều kiện vẫn chỉ 1 phần tử (dedupe tự nhiên vì đây là
  // 1 pass duy nhất trên `items`, không union nhiều mảng con). Sau khi
  // approve/request-changes, review_status không còn 'pending' nữa nên
  // needReview tự động false ở lần recompute kế tiếp (refetchTasks) - task chỉ
  // biến mất khỏi queue nếu KHÔNG còn reason nào khác (overdue/blocked/unassigned).
  const attentionTasks = useMemo(() => {
    const rows = items.map((t: any) => {
      const statusL = (t.status || '').trim().toLowerCase();
      const isDoneOrCancel = statusL === 'done' || statusL === 'completed' || statusL === 'cancel' || statusL.includes('hoàn') || statusL.includes('finish') || statusL.includes('hủy');
      const daysLate = calculateDaysLate(t);
      const overdue = daysLate > 0;
      const blocked = t.is_blocked === true || (!t.is_blocked && statusL.includes('block'));
      const blockedDays = blocked && t.blocked_at ? Math.max(0, Math.floor((Date.now() - new Date(t.blocked_at).getTime()) / 86400000)) : 0;
      const needReview = t.review_status === 'pending' || (!t.review_status && statusL.includes('review'));
      const unassigned = !isDoneOrCancel && !(t.assigned_name && t.assigned_name.trim());
      if (!overdue && !blocked && !needReview && !unassigned) return null;

      // Rank ưu tiên xử lý theo yêu cầu: Overdue+Blocked > Overdue+Review >
      // Blocked > Overdue > Review > Unassigned-only.
      let rank = 6;
      if (overdue && blocked) rank = 1;
      else if (overdue && needReview) rank = 2;
      else if (blocked) rank = 3;
      else if (overdue) rank = 4;
      else if (needReview) rank = 5;

      const priorityL = (t.priority || '').trim().toLowerCase();
      const priorityWeight = priorityL === 'interrupt' ? 0
        : (priorityL === 'critical' || priorityL === 'urgent') ? 1
        : priorityL === 'high' ? 2
        : (priorityL === 'normal' || priorityL === 'medium') ? 3
        : 4;

      return { task: t, daysLate, overdue, blocked, blockedDays, needReview, unassigned, rank, priorityWeight };
    }).filter(Boolean) as Array<{ task: any; daysLate: number; overdue: boolean; blocked: boolean; blockedDays: number; needReview: boolean; unassigned: boolean; rank: number; priorityWeight: number }>;

    rows.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.priorityWeight !== b.priorityWeight) return a.priorityWeight - b.priorityWeight;
      return b.daysLate - a.daysLate; // trễ nhiều hơn ưu tiên trước
    });
    return rows;
  }, [items]);

  const attentionOverdueCount = attentionTasks.filter(a => a.overdue).length;
  const attentionBlockedCount = attentionTasks.filter(a => a.blocked).length;
  const attentionUnassignedCount = attentionTasks.filter(a => a.unassigned).length;
  const attentionReviewCount = attentionTasks.filter(a => a.needReview).length;

  // 5. Critical thực hiện tuần này (Xác định Thứ 2 00:00:00 -> Chủ nhật 23:59:59)
  const { monday: thisWeekMon, sunday: thisWeekSun } = getMondayToSundayRange(new Date());

  const kpiCriticalThisWeek = kpiTasks.filter(x => {
    if ((x.priority || '').toLowerCase() !== 'critical') return false;
    const dateStr = x.end_date_est || x.end_date_actual || x.end_date || x.deadline || x.created_at;
    if (!dateStr) return false;
    const d = parseDateString(dateStr);
    if (!d) return false;
    return d >= thisWeekMon && d <= thisWeekSun;
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
    overviewTasksInPeriod.forEach(t => {
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
    overviewTasksInPeriod.forEach(t => {
      const s = (t.status || '').toLowerCase();
      const isDone = s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish');
      if (!isDone) return;
      const name = (t.assigned_name || '').trim();
      if (!name) return;
      const kpiVal = parseFloat(t.kpi_base as string) || 0;
      kpiSums[name] = (kpiSums[name] || 0) + kpiVal;
    });
    return Object.keys(kpiSums)
      .map(name => {
        const val = Math.round(kpiSums[name] * 10) / 10;
        return { name, total: val, kpi: val };
      })
      .sort((a, b) => b.total - a.total);
  })();

  // ============================================================
  // TỔNG QUAN (dashboard) - toàn bộ derived từ items/taskGroups/phases đã có
  // sẵn (query project-tasks), cùng kỳ lọc overviewTasksInPeriod/kpiTasks với
  // 5 KPI card phía trên - không gọi thêm API nào ngoài activity feed.
  // ============================================================

  // Tiến độ theo Phase - không có field % theo phase từ backend, tính lại từ
  // task/group/phase đã load sẵn (cùng cách summaryProjectStats/overdueTasksList
  // đã tự tính từ items).
  const overviewPhaseProgress = (() => {
    const realPhases = phases.filter(p => !p.is_master && p.name.toLowerCase() !== 'master');
    return realPhases.map(phase => {
      const groupIds = new Set(taskGroups.filter(g => g.phase_id === phase.id).map(g => g.id));
      const tasksInPhase = overviewTasksInPeriod.filter(t => groupIds.has(t.task_group_id));
      const doneInPhase = tasksInPhase.filter(t => {
        const s = (t.status || '').toLowerCase();
        return s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish');
      }).length;
      const total = tasksInPhase.length;
      return { id: phase.id, name: phase.name, done: doneInPhase, total, percent: total > 0 ? Math.round((doneInPhase / total) * 100) : 0 };
    });
  })();

  // Phân bổ task theo trạng thái - 4 nhóm loại trừ lẫn nhau (cộng lại = kpiTotal):
  // Hoàn thành trước, còn lại nếu trễ hạn thì tính Trễ hạn (không tính lại vào
  // Đang thực hiện/Chờ xử lý), phần còn lại mới xét status text.
  const overviewStatusDistribution = (() => {
    let done = 0, overdue = 0, inProgress = 0, waiting = 0;
    kpiTasks.forEach((t: any) => {
      const s = (t.status || '').toLowerCase();
      const isDone = s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish');
      if (isDone) { done++; return; }
      if (calculateDaysLate(t) > 0) { overdue++; return; }
      const isInProgress = s.includes('process') || s.includes('progress') || s.includes('inprogress') || s.includes('doing') || s === 'in progress';
      if (isInProgress) inProgress++; else waiting++;
    });
    return { done, inProgress, waiting, overdue };
  })();

  // Task theo Priority - giá trị priority thật trong hệ thống là
  // Normal/High/Critical/Interrupt (không có "Low" - không hard-code nhãn mockup
  // không khớp business data thật).
  const overviewPriorityDistribution = (() => {
    const counts: Record<string, number> = { Critical: 0, High: 0, Normal: 0, Interrupt: 0 };
    kpiTasks.forEach((t: any) => {
      const p = (t.priority || 'Normal');
      const key = (['Critical', 'High', 'Normal', 'Interrupt'] as const).find(k => k.toLowerCase() === String(p).toLowerCase()) || 'Normal';
      counts[key] += 1;
    });
    return counts;
  })();

  // Task theo loại - dùng skill_solution_name (field thật, đã dùng cho filter
  // cột Skill Area ở Tasks tab), không invent category mới.
  const overviewSkillDistribution = (() => {
    const counts: Record<string, number> = {};
    kpiTasks.forEach((t: any) => {
      const name = (t.skill_solution_name || '').trim();
      if (!name) return;
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  })();

  // Khối lượng công việc theo thành viên - bản đầy đủ hơn workloadStats (có
  // thêm cột Đang làm/Trễ hạn), vẫn key theo assigned_name như workloadStats
  // đã làm (field thật trên task, không phải FK sang projectMembers).
  const overviewMemberWorkload = (() => {
    const map: Record<string, { name: string; total: number; done: number; inProgress: number; overdue: number }> = {};
    // Seed từ TOÀN BỘ member đang tham gia project (kể cả chưa có task nào
    // trong kỳ đang lọc) - khớp với "Đội ngũ phát triển dự án" bên dưới, để
    // member không có việc vẫn hiện dòng 0 thay vì biến mất hoàn toàn khỏi bảng.
    projectMembers.forEach((m: any) => {
      const name = (m.display_name || '').trim();
      if (name && !map[name]) map[name] = { name, total: 0, done: 0, inProgress: 0, overdue: 0 };
    });
    kpiTasks.forEach((t: any) => {
      const name = (t.assigned_name || '').trim();
      if (!name) return;
      if (!map[name]) map[name] = { name, total: 0, done: 0, inProgress: 0, overdue: 0 };
      map[name].total += 1;
      const s = (t.status || '').toLowerCase();
      const isDone = s === 'done' || s === 'completed' || s.includes('hoàn') || s.includes('finish');
      if (isDone) map[name].done += 1;
      else if (calculateDaysLate(t) > 0) map[name].overdue += 1;
      else if (s.includes('process') || s.includes('progress') || s.includes('inprogress') || s.includes('doing') || s === 'in progress') map[name].inProgress += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  })();

  // "Cần chú ý" - toàn bộ là aggregate trên data đã có, không thêm nguồn mới.
  const overviewUnassignedCount = kpiTasks.filter((t: any) => !(t.assigned_name || '').trim()).length;
  const overviewMembersWithOverdue = new Set(overdueTasksList.map((t: any) => (t.assigned_name || '').trim()).filter(Boolean)).size;

  // Task gần đây - KHÔNG có field last-updated ở task nào cả (đã audit), nên
  // dùng id giảm dần làm proxy "gần thêm gần đây nhất", không fake timestamp.
  const overviewRecentTasks = [...kpiTasks].sort((a: any, b: any) => (b.id || 0) - (a.id || 0)).slice(0, 8);

  // Hoạt động gần đây - gọi lại đúng API Audit Logs hiện có (getProjectAuditLogs),
  // chỉ khi đang thực sự đứng ở Overview > Tổng quan để tránh fetch thừa.
  const { data: overviewActivityData } = useQuery({
    queryKey: ['overview-activity', id],
    queryFn: () => getProjectAuditLogs(Number(id), { page: 1, page_size: 8 }),
    enabled: !!id && activeMainTab === 'overview' && overviewSubTab === 'summary',
  });
  const overviewActivityItems = overviewActivityData?.items || [];

  // Leader Review Detail Drawer - "Cập nhật lần cuối" + "Hoạt động gần đây"
  // của 1 task. Không có endpoint lọc theo entity_id (getProjectAuditLogs chỉ
  // nhận module/action/user_id/search/date - xem backend routers/projects.py),
  // nên tái sử dụng NGUYÊN endpoint đó với module='Task' (giá trị module thật
  // được ghi khi task được sửa - xem task_groups.py) rồi lọc client-side theo
  // entity_id === task.id. Giới hạn: chỉ soi trong page_size log "Task" gần
  // nhất của CẢ project, nên task rất lâu không đổi mà project có nhiều hoạt
  // động Task khác có thể không tìm thấy log nào - khi đó không hiện dòng
  // "Cập nhật lần cuối" thay vì fake. Endpoint yêu cầu quyền Manager
  // (require_manager) nên chỉ gọi khi isAdmin().
  const { data: taskActivityData } = useQuery({
    queryKey: ['task-audit-activity', leaderReviewDetailTask?.id],
    queryFn: () => getProjectAuditLogs(Number(id), { module: 'Task', page: 1, page_size: 40 }),
    enabled: !!leaderReviewDetailTask && isAdmin(),
  });
  const taskActivityLogs = (taskActivityData?.items || []).filter(
    (l: any) => leaderReviewDetailTask && String(l.entity_id) === String(leaderReviewDetailTask.id)
  );

  const getGroupIndex = (groupId: number) => {
    const group = taskGroups.find(g => g.id === groupId);
    if (!group) return 1;
    const groupsInPhase = taskGroups
      .filter(g => g.phase_id === group.phase_id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = groupsInPhase.findIndex(g => g.id === groupId);
    return idx >= 0 ? idx + 1 : 1;
  };

  // Best-effort preview only — the backend recomputes the real task_code
  // authoritatively at save time (see resolve_insert_seq in task_groups.py),
  // shifting siblings to make room when inserting mid-list. Mirrors that
  // same logic so the preview matches what will actually be saved.
  const getTaskIdPreview = (groupId: number, parentCode: string | null) => {
    const groupIdx = getGroupIndex(groupId);
    const levelPrefix = parentCode ? `${parentCode}.` : `${groupIdx}.`;
    const seqAtLevel = (code: string | null | undefined): number | null => {
      if (!code || !code.startsWith(levelPrefix)) return null;
      const rest = code.substring(levelPrefix.length);
      if (rest.includes('.')) return null;
      const n = parseInt(rest, 10);
      return isNaN(n) ? null : n;
    };

    if (addingTaskBeforeCode) {
      return `${levelPrefix}${seqAtLevel(addingTaskBeforeCode) ?? 1}`;
    }
    if (addingTaskAfterCode) {
      const s = seqAtLevel(addingTaskAfterCode);
      return `${levelPrefix}${s !== null ? s + 1 : 1}`;
    }
    const maxSeq = items.reduce((max, t) => {
      const n = seqAtLevel(t.task_code);
      return n !== null && n > max ? n : max;
    }, 0);
    return `${levelPrefix}${maxSeq + 1}`;
  };





  // --- Hierarchical Tree Table Processing ---
  const renderFormCell = (col: string, cIdx: number, groupId: number, parentCode: string | null, level: number) => {
    const colUpper = col.toUpperCase().trim();

    // TASK ID - automatically generated preview
    if (colUpper === 'TASK ID' || colUpper === 'TASKID' || colUpper === 'ID') {
      const generatedId = getTaskIdPreview(groupId, parentCode);
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
      'START DATE', 'ASSIGNED', 'SUPPORT', 'KPI RATIO', 'SKILL AREA', 'SKILL'
    ];
    const isRequired = REQUIRED_COLS.includes(colUpper);

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveTask();
      } else if (e.key === 'Escape') {
        setAddingTaskGroupId(null);
        setAddingTaskParentCode(null);
        setAddingTaskAfterCode(null);
        setAddingTaskBeforeCode(null);
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
                    {getAvailableStatuses().length === 0 ? (
                      <>
                        <option value="Todo">Todo</option>
                        <option value="Waiting">Waiting</option>
                        <option value="Process">Process</option>
                        <option value="Done">Done</option>
                        <option value="Cancel">Cancel</option>
                      </>
                    ) : (
                      getAvailableStatuses().map((st: any) => (
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
          <SearchableSelect
            label="thành viên"
            icon=""
            options={projectMembers.map((m: any) => ({ id: m.id, name: m.display_name }))}
            value={newForm[col] || ''}
            onChange={(val: any) => setNewForm({ ...newForm, [col]: val === 'all' ? '' : val })}
            placeholder="Tìm thành viên..."
            className="w-full text-[11px]"
            usePortal
          />
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
      } else if (colUpper === 'SKILL AREA') {
        // Same rich picker (title/badge/context line/quick-add form/catalog
        // browser) as editing an existing task's cell, not the plain
        // SearchableSelect — this row is a brand-new task, but "which
        // Skill Area" is the exact same question with the exact same
        // answer set, so it should look and behave identically.
        const activeGroups = categories
          .filter(c => c.is_active)
          .flatMap(c => c.groups || []);
        const catalogAreas = activeGroups.map((g: any) => ({
          id: g.id, name: g.name,
          skills: (g.skills || []).filter((s: any) => s.is_active),
        }));

        return (
          <CategorySearchCell
            key={col}
            col={col}
            kind="area"
            // This row's SKILL AREA and SKILL cells mount together (they're
            // both part of the same "add new task" form) — autofocusing
            // either would pop its panel open with nothing clicked.
            autoFocus={false}
            items={activeGroups.map((g: any) => ({ id: g.id, name: g.name, meta: `${(g.skills || []).filter((s: any) => s.is_active).length} skills` }))}
            editValue={newForm[col] || ''}
            placeholder="Tìm Skill Area..."
            catalogAreas={catalogAreas}
            onSaveWithAction={(val) => {
              const selectedGrpId = val === 'all' ? '' : val;
              const vendorCol = getDynamicColumns().find(c => c.toUpperCase().trim() === 'SKILL') || 'SKILL';
              setNewForm({
                ...newForm,
                [col]: selectedGrpId,
                [vendorCol]: ''
              });
            }}
            onCancel={() => {}}
            onRequestAreaCreate={(name) => {
              const vendorCol = getDynamicColumns().find(c => c.toUpperCase().trim() === 'SKILL') || 'SKILL';
              openSkillGroupCreateModal(name, newForm[col], (groupId) => {
                setNewForm((prev: any) => ({ ...prev, [col]: String(groupId), [vendorCol]: '' }));
                flash(`Đã tạo Skill Area "${name}"!`);
              });
            }}
          />
        );
      } else if (colUpper === 'SKILL') {
        const solCol = getDynamicColumns().find(c => c.toUpperCase().trim() === 'SKILL AREA') || 'SKILL AREA';
        const selectedGroupId = newForm[solCol] || '';
        const allActiveGroups = categories
          .filter(c => c.is_active)
          .flatMap(c => c.groups || []);
        const currentGroupObj = selectedGroupId ? allActiveGroups.find((g: any) => String(g.id) === String(selectedGroupId)) : null;
        let availableSkills: any[] = [];
        if (currentGroupObj) {
          availableSkills = (currentGroupObj.skills || []).filter((s: any) => s.is_active).map((s: any) => ({ id: s.id, name: s.name }));
        } else {
          availableSkills = allActiveGroups
            .flatMap((g: any) => (g.skills || []).filter((s: any) => s.is_active).map((s: any) => ({ id: s.id, name: s.name, meta: g.name })));
        }
        const catalogAreas = allActiveGroups.map((g: any) => ({
          id: g.id, name: g.name,
          skills: (g.skills || []).filter((s: any) => s.is_active),
        }));

        return (
          <CategorySearchCell
            key={col}
            col={col}
            kind="skill"
            autoFocus={false}
            items={availableSkills}
            editValue={newForm[col] || ''}
            placeholder="Tìm Skill..."
            contextAreaName={currentGroupObj?.name || ''}
            catalogAreas={catalogAreas}
            onSaveWithAction={(val) => setNewForm((prev: any) => ({ ...prev, [col]: val === 'all' ? '' : val }))}
            onCancel={() => {}}
            onQuickCreate={async (name, areaIdOverride) => {
              const groupId = areaIdOverride ?? (selectedGroupId ? parseInt(String(selectedGroupId), 10) : null);
              if (!groupId) return null;
              try {
                await createSkill({ name, group_id: groupId });
                const fresh = await refetchCategories();
                const created = fresh
                  .flatMap((c: any) => c.groups || [])
                  .flatMap((g: any) => g.skills || [])
                  .find((s: any) => s.name === name && Number(s.group_id) === groupId);
                if (created) {
                  flash(`Đã tạo Skill "${name}"!`);
                  // Skill luôn thuộc một Skill Area cụ thể (vd. tạo qua "⚙
                  // Quản lý danh mục" ở một Area khác) — đồng bộ luôn ô
                  // SKILL AREA theo Area cha để tránh lệch cặp Area/Skill.
                  if (String(selectedGroupId || '') !== String(groupId)) {
                    setNewForm((prev: any) => ({ ...prev, [solCol]: String(groupId) }));
                  }
                }
                return created ? { id: created.id } : null;
              } catch (err: any) {
                flash('Lỗi tạo Skill: ' + getApiErrorMessage(err), true);
                return null;
              }
            }}
          />
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
            className={`w-full bg-white border rounded px-1 py-1 text-[11px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
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
      } else if (colUpper === 'DETAIL TASK') {
        // UX (Task 1): the single-line input is too narrow for typing a real
        // task name/description. Render a multi-line <textarea> that auto-
        // grows with content; the wider column default (380 / min 320) +
        // larger cell padding below give the input a more comfortable
        // horizontal footprint, while still fitting a single-line name when
        // the user has only a short title. No field, value, validation or
        // creation API change — purely a sizing/layout upgrade.
        const autoGrow = (e: React.FormEvent<HTMLTextAreaElement>) => {
          const el = e.currentTarget;
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        };
        inputField = (
          <textarea
            value={newForm[col] || ''}
            onChange={e => setNewForm({ ...newForm, [col]: e.target.value })}
            onInput={autoGrow}
            onFocus={autoGrow}
            onKeyDown={handleInputKeyDown}
            rows={1}
            className={`w-full bg-white border rounded px-2 py-1.5 text-[12px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] font-semibold resize-none overflow-hidden min-h-[30px] leading-snug ${isRequired ? 'border-[#0058be] ring-1 ring-[#0058be]/20' : 'border-[#c2c6d6]'
              }`}
            placeholder={col + (isRequired ? ' *' : '')}
            autoFocus={cIdx === 1}
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

    // UX (Task 1): give the DETAIL TASK form cell a little more padding
    // so the wider textarea above has visual breathing room without
    // affecting the other narrow columns (which keep the original p-1 to
    // stay aligned with their display-row siblings).
    const isDetailTaskCol = colUpper === 'DETAIL TASK';
    return (
      <td key={col} className={isDetailTaskCol ? 'p-1.5' : 'p-1'}>
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
    const skillSolutionVal = newForm['SKILL AREA'] || null;
    const skillVendorVal = newForm['SKILL'] || null;

    if (!detailVal) {
      flash('Tên nhiệm vụ (DETAIL TASK) không được để trống!', true);
      return;
    }
    if (isNaN(mandayEstVal) || mandayEstVal <= 0) {
      flash('MANDAY EST phải là số lớn hơn 0!', true);
      return;
    }
    if (!startDateVal) {
      flash('Ngày bắt đầu (START DATE) không được để trống!', true);
      return;
    }
    if (!assignedVal) {
      flash('Cột ASSIGNED là bắt buộc.', true);
      return;
    }
    if (!supportVal) {
      flash('Cột SUPPORT là bắt buộc.', true);
      return;
    }
    if (!skillSolutionVal) {
      flash('Cột SKILL AREA là bắt buộc.', true);
      return;
    }
    if (!skillVendorVal) {
      flash('Cột SKILL là bắt buộc.', true);
      return;
    }

    setSavingTask(true);
    try {
      // task_code is now assigned server-side from these positional hints —
      // the backend inserts at the exact spot (not always at the end) and
      // shifts existing siblings to make room, so numbering never drifts.
      const payload: any = {
        parent_code: addingTaskParentCode,
        insert_after_code: addingTaskAfterCode,
        insert_before_code: addingTaskBeforeCode,
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
        skill_solution_id: newForm['SKILL AREA'] ? parseInt(newForm['SKILL AREA'], 10) : null,
        skill_vendor_id: newForm['SKILL'] ? parseInt(newForm['SKILL'], 10) : null,
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
      const kpiRatio = newForm['KPI RATIO'] || '90/10';
      const parts = kpiRatio.split('/');
      payload.kpi_ratio_assign = parseInt(parts[0], 10) || 90;
      payload.kpi_ratio_support = parseInt(parts[1], 10) || 10;

      await createTask(addingTaskGroupId, payload);
      setAddingTaskGroupId(null);
      setAddingTaskParentCode(null);
      setAddingTaskAfterCode(null);
      setAddingTaskBeforeCode(null);
      setNewForm({});
      reloadAll(true);
      flash('Đã thêm nhiệm vụ thành công!');
    } catch (err: any) {
      flash('Lỗi thêm task: ' + getApiErrorMessage(err), true);
    } finally {
      setSavingTask(false);
    }
  };

  const handleDuplicateTask = async (groupId: number, taskId: number) => {
    if (duplicatingTaskId !== null) return;
    setDuplicatingTaskId(taskId);
    try {
      const newTask = await duplicateTask(groupId, taskId);
      flash('Đã nhân bản task thành công!');
      await reloadAll(true);
      if (newTask?.id) {
        setHighlightTaskId(newTask.id);
        setTimeout(() => {
          setHighlightTaskId(prev => (prev === newTask.id ? null : prev));
        }, 2000);
      }
    } catch (err: any) {
      flash('Lỗi nhân bản task: ' + getApiErrorMessage(err), true);
    } finally {
      setDuplicatingTaskId(null);
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
        ticket_id: selectedTask.link || selectedTask.ticket_id || '',
        send: selectedTask.send || '',
        kpi_ratio: selectedTask.kpi_ratio_assign !== undefined ? `${selectedTask.kpi_ratio_assign}/${selectedTask.kpi_ratio_support || 0}` : '90/10',
        skill_solution_id: selectedTask.skill_solution_id ? String(selectedTask.skill_solution_id) : '',
        skill_vendor_id: selectedTask.skill_vendor_id ? String(selectedTask.skill_vendor_id) : '',
      });
      // Ô nhập link mới trong Drawer là state cục bộ (giống editValue của
      // bảng) - reset mỗi khi mở task khác để không dính draft của task cũ.
      setDrawerLinkDraft('');
    }
  }, [selectedTask]);

  useEffect(() => {
    if (highlightTaskParam && items.length > 0) {
      const taskId = parseInt(highlightTaskParam);
      if (!taskId) return;
      const task = items.find((t: any) => t.id === taskId);
      if (task) {
        setHighlightTaskId(taskId);
        setTimeout(() => {
          const el = document.getElementById(`task-row-${taskId}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
        setTimeout(() => setHighlightTaskId(prev => prev === taskId ? null : prev), 4000);
      }
    }
  }, [highlightTaskParam, items]);

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

    // Đổi Status sang giá trị chứa "block" (task chưa bị chặn) phải đi qua
    // cùng modal bắt lý do thật như ở bảng (xem handleCellSave/STATUS) -
    // không cho PATCH thẳng status, tránh né workflow blockTask/lý do thật.
    const sBlockCheck = (drawerForm.status || '').trim().toLowerCase();
    const wasBlockedStatus = selectedTask.is_blocked || (selectedTask.status || '').trim().toLowerCase().includes('block');
    const enteringBlockStatus = sBlockCheck.includes('block') && !wasBlockedStatus && drawerForm.status !== selectedTask.status;

    setDrawerSaving(true);
    try {
      // Nếu đang chuyển sang status "block", giữ nguyên status cũ ở lần lưu
      // này - status "block" thật sẽ được set sau khi xác nhận lý do (bên
      // dưới), để không mất các field khác đang chỉnh trong drawer.
      const statusToSave = enteringBlockStatus ? selectedTask.status : drawerForm.status;

      const payload: Record<string, any> = {
        detail: drawerForm.detail,
        status: statusToSave,
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
        send: drawerForm.send || null,
      };

      const kpiRatio = drawerForm.kpi_ratio || '90/10';
      const kpiParts = kpiRatio.split('/');
      payload.kpi_ratio_assign = parseInt(kpiParts[0], 10) || 90;
      payload.kpi_ratio_support = parseInt(kpiParts[1], 10) || 10;
      payload.skill_solution_id = drawerForm.skill_solution_id ? parseInt(drawerForm.skill_solution_id, 10) : null;
      payload.skill_vendor_id = drawerForm.skill_vendor_id ? parseInt(drawerForm.skill_vendor_id, 10) : null;

      // Support đổi mà KPI Ratio chưa bị chỉnh tay trong phiên này thì
      // auto-set giống hệt bảng (100/0 khi bỏ Support, 90/10 khi gán Support
      // từ baseline 100/0) - tránh 2 nơi cho ra 2 kết quả KPI khác nhau.
      const supportChanged = (drawerForm.support_id || '') !== (selectedTask.support_id ? String(selectedTask.support_id) : '');
      const originalKpiRatio = selectedTask.kpi_ratio_assign !== undefined
        ? `${selectedTask.kpi_ratio_assign}/${selectedTask.kpi_ratio_support || 0}`
        : '90/10';
      if (supportChanged && kpiRatio === originalKpiRatio) {
        if (!drawerForm.support_id) {
          payload.kpi_ratio_assign = 100;
          payload.kpi_ratio_support = 0;
        } else if (!selectedTask.support_id && selectedTask.kpi_ratio_assign === 100 && selectedTask.kpi_ratio_support === 0) {
          payload.kpi_ratio_assign = 90;
          payload.kpi_ratio_support = 10;
        }
      }

      const wasDone = selectedTask.status && (
        selectedTask.status.toLowerCase() === 'done' ||
        selectedTask.status.toLowerCase() === 'completed' ||
        selectedTask.status.toLowerCase().includes('hoàn') ||
        selectedTask.status.toLowerCase().includes('finish')
      );
      const isNowDone = statusToSave && (
        statusToSave.toLowerCase() === 'done' ||
        statusToSave.toLowerCase() === 'completed' ||
        statusToSave.toLowerCase().includes('hoàn') ||
        statusToSave.toLowerCase().includes('finish')
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

      if (enteringBlockStatus) {
        // Các field khác đã lưu xong; giờ bắt lý do rồi mới set status
        // "block" thật qua đúng blockTask API (không đóng drawer, chờ xác
        // nhận - giống hệt luồng "Đánh dấu bị chặn" và cột STATUS trên bảng).
        setBlockReason('');
        setBlockDependencyTaskId('');
        setBlockPrompt({ taskId: selectedTask.id, statusValue: drawerForm.status });
      } else {
        setSelectedTask(null);
      }
    } catch (err: any) {
      flash('Lỗi cập nhật task: ' + getApiErrorMessage(err), true);
    } finally {
      setDrawerSaving(false);
    }
  };

  // Refetch the categories/groups/skills tree from the same endpoint
  // Settings uses (GET /api/skills/categories) and update the local
  // `categories` state so the Skill Area / Vendor dropdowns in this
  // Task Detail drawer reflect the newly created item without a full
  // page reload. Reused by the SKILL AREA `+` and SKILL `+`
  // handlers below.
  const refetchCategories = async (): Promise<any[]> => {
    try {
      const data = await getCategories();
      const fresh = data || [];
      setCategories(fresh);
      return fresh;
    } catch (err) {
      console.error('Error refetching categories:', err);
      return categories;
    }
  };

  // SKILL AREA `+` handler: creates a new Group under the user-
  // chosen Category using the existing POST /api/skills/groups endpoint.
  // Reuses the existing validation + audit pipeline. After success,
  // refreshes the categories tree and auto-selects the new Group as
  // the SKILL AREA (cascading-clear of the SKILL follows
  // the existing onChange contract).
  const handleCreateSkillGroupFromDrawer = async () => {
    const name = newSkillGroupName.trim();
    const categoryId = newSkillGroupCategoryId ? parseInt(newSkillGroupCategoryId, 10) : null;
    if (!name) {
      flash('Tên Group không được để trống!', true);
      return;
    }
    if (!categoryId) {
      flash('Vui lòng chọn Category!', true);
      return;
    }
    setCreatingSkillGroup(true);
    try {
      await createGroup({ name, category_id: categoryId });
      const fresh = await refetchCategories();
      const created = fresh
        .flatMap((c: any) => c.groups || [])
        .find((g: any) => g.name === name && Number(g.category_id) === categoryId);
      if (created) {
        skillGroupCreatedCallback?.(created.id);
      }
      flash('Đã tạo Group mới!');
      setShowCreateSkillGroupModal(false);
      setNewSkillGroupName('');
      setNewSkillGroupCategoryId('');
      setSkillGroupCreatedCallback(null);
    } catch (err: any) {
      flash('Lỗi tạo Group: ' + getApiErrorMessage(err), true);
    } finally {
      setCreatingSkillGroup(false);
    }
  };

  // Shared opener for showCreateSkillGroupModal - every entry point (Drawer's
  // "+" button, table cell quick-add on an existing row, table quick-add on
  // the "add new task" row) calls this so the Category picker + pre-fill
  // logic lives in exactly one place. `onCreated` receives the new Group's
  // id once the modal's Save succeeds.
  const openSkillGroupCreateModal = (prefillName: string, currentSkillSolutionId: string | number | null | undefined, onCreated: (groupId: number) => void) => {
    setNewSkillGroupName(prefillName);
    const currentCatId = currentSkillSolutionId
      ? (categories
          .flatMap((c: any) => c.groups || [])
          .find((g: any) => String(g.id) === String(currentSkillSolutionId)) as any)?.category_id
      : null;
    const fallback = (categories.find((c: any) => c.is_active) as any)?.id;
    setNewSkillGroupCategoryId(currentCatId ? String(currentCatId) : (fallback ? String(fallback) : ''));
    setSkillGroupCreatedCallback(() => onCreated);
    setShowCreateSkillGroupModal(true);
  };

  // SKILL `+` handler: creates a new Skill under the currently
  // selected SKILL AREA (Group) using the existing POST
  // /api/skills/skills endpoint. If no Solution is selected, the UI
  // is responsible for not opening this modal — but the backend would
  // also reject the request (400 "Group ID is required"). After
  // success, refreshes the categories tree and auto-selects the new
  // Skill as the SKILL.
  const handleCreateSkillVendorFromDrawer = async () => {
    const name = newSkillVendorName.trim();
    const solutionId = drawerForm.skill_solution_id ? parseInt(String(drawerForm.skill_solution_id), 10) : null;
    if (!name) {
      flash('Tên Skill không được để trống!', true);
      return;
    }
    if (!solutionId) {
      flash('Vui lòng chọn SKILL AREA trước!', true);
      return;
    }
    setCreatingSkillVendor(true);
    try {
      await createSkill({ name, group_id: solutionId });
      const fresh = await refetchCategories();
      const created = fresh
        .flatMap((c: any) => c.groups || [])
        .flatMap((g: any) => g.skills || [])
        .find((s: any) => s.name === name && Number(s.group_id) === solutionId);
      if (created) {
        setDrawerForm((prev: any) => ({
          ...prev,
          skill_vendor_id: String(created.id),
        }));
      }
      flash('Đã tạo Skill mới!');
      setShowCreateSkillVendorModal(false);
      setNewSkillVendorName('');
    } catch (err: any) {
      flash('Lỗi tạo Skill: ' + getApiErrorMessage(err), true);
    } finally {
      setCreatingSkillVendor(false);
    }
  };

  // Root-level tasks of a group, in display order, optionally excluding one
  // task (the one being moved — irrelevant as a "Sau X" reference point when
  // the target group is its own current group). Feeds the "Vị trí" dropdown.
  const getRootTasksOfGroup = (groupId: number | '', excludeTaskId?: number) => {
    if (groupId === '') return [];
    return items
      .filter(t => t.task_group_id === groupId && !getParentCode(t.task_code) && t.id !== excludeTaskId)
      .sort((a, b) => {
        const na = parseInt((a.task_code || '').split('.')[1] || '0', 10);
        const nb = parseInt((b.task_code || '').split('.')[1] || '0', 10);
        return na - nb;
      });
  };

  // Encodes a task's CURRENT position the same way the "Vị trí" dropdown
  // encodes its options ('start' | `after:${id}`) — lets the modal default to
  // (and detect no-op reselection of) exactly where the task already is.
  const computeCurrentPositionValue = (task: any) => {
    const siblingsIncludingSelf = getRootTasksOfGroup(task.task_group_id);
    const idx = siblingsIncludingSelf.findIndex(t => t.id === task.id);
    if (idx <= 0) return 'start';
    return `after:${siblingsIncludingSelf[idx - 1].id}`;
  };

  const handleOpenMoveModal = (task: any) => {
    const currentGroup = taskGroups.find(g => g.id === task.task_group_id);
    setMovingTask(task);
    setMoveTargetPhaseId(currentGroup?.phase_id ?? '');
    setMoveTargetGroupId(task.task_group_id);
    setMoveTargetPosition(computeCurrentPositionValue(task));
  };

  const moveHasChanged = !!movingTask && (
    moveTargetGroupId !== movingTask.task_group_id ||
    moveTargetPosition !== computeCurrentPositionValue(movingTask)
  );

  const handleConfirmMoveTask = async () => {
    if (!movingTask || moveTargetGroupId === '' || !moveHasChanged) return;
    setSavingMoveTask(true);
    try {
      let position: { insertBeforeTaskId?: number; insertAfterTaskId?: number } | undefined;
      if (moveTargetPosition === 'start') {
        const first = getRootTasksOfGroup(moveTargetGroupId, movingTask.id)[0];
        if (first) position = { insertBeforeTaskId: first.id };
      } else if (moveTargetPosition.startsWith('after:')) {
        position = { insertAfterTaskId: parseInt(moveTargetPosition.slice('after:'.length), 10) };
      }
      const targetGroup = taskGroups.find(g => g.id === moveTargetGroupId);
      await moveTask(movingTask.task_group_id, movingTask.id, moveTargetGroupId as number, position);
      flash(`Đã di chuyển task sang "${targetGroup?.name || ''}" thành công!`);
      setMovingTask(null);
      reloadAll();
    } catch (err: any) {
      flash('Lỗi di chuyển task: ' + getApiErrorMessage(err), true);
    } finally {
      setSavingMoveTask(false);
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
        <td className="p-1 text-center sticky left-0 bg-[#f0fdf4] z-10" style={{ width: `${ACTION_COL_WIDTH}px`, minWidth: `${ACTION_COL_WIDTH}px` }}>
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
                setAddingTaskBeforeCode(null);
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

  const renderHoverTgSpacerRow = (phaseId: number) => {
    const dynamicCols = getDynamicColumns();
    const spacerId = `spacer-tg-${phaseId}`;

    return (
      <tr
        key={spacerId}
        className="group/spacer border-none bg-transparent"
      >
        <td colSpan={dynamicCols.length + 1} className="p-0 border-none bg-transparent relative">
          <div className="relative flex items-center h-2 transition-all duration-200 group-hover/spacer:bg-slate-50/20">
            {/* Dashed line */}
            <div className="absolute inset-x-4 flex items-center pointer-events-none w-[calc(100%-2rem)]">
              <div className="w-full border-t border-slate-300 border-dashed opacity-0 group-hover/spacer:opacity-100 transition-opacity duration-200"></div>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  // End-of-phase drop target — mirrors renderGroupEndDropZone but for Task
  // Groups: reuses the plain hover spacer when no Group is being dragged,
  // otherwise shows a visible "Thả Task Group vào đây" zone. This exact call
  // site already runs once per Phase regardless of group count (empty-Phase
  // and end-of-non-empty-Phase both fall through to it), so both cases are
  // covered without extra branching.
  const renderPhaseEndDropZone = (phaseId: number) => {
    if (draggingGroupId === null) {
      return renderHoverTgSpacerRow(phaseId);
    }
    const isOver = dragOverPhaseEndZoneId === phaseId;
    return (
      <tr key={`phase-end-drop-${phaseId}`} className="border-none bg-transparent">
        <td colSpan={getDynamicColumns().length + 1} className="p-1.5 border-none bg-transparent">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOverPhaseEndZoneId !== phaseId) setDragOverPhaseEndZoneId(phaseId);
            }}
            onDragLeave={() => {
              setDragOverPhaseEndZoneId(prev => (prev === phaseId ? null : prev));
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOverPhaseEndZoneId(null);
              if (!isBeyondGroupDragThreshold(e)) return;
              try {
                const raw = e.dataTransfer.getData("application/json");
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data.type !== "group") return;
                if (data.phaseId === phaseId) {
                  const phaseGroups = taskGroups.filter((g: any) => g.phase_id === phaseId);
                  const fromIdx = phaseGroups.findIndex((g: any) => g.id === data.groupId);
                  if (fromIdx !== -1 && fromIdx !== phaseGroups.length - 1) {
                    const reordered = [...phaseGroups];
                    const [removed] = reordered.splice(fromIdx, 1);
                    reordered.push(removed);
                    await reorderTaskGroups(phaseId, reordered.map((g: any) => g.id));
                    flash("Đã đổi thứ tự Task Group thành công!");
                    reloadAll();
                  }
                } else {
                  await performGroupCrossPhaseMove(data.groupId, data.phaseId, phaseId);
                }
              } catch (err: any) {
                console.error(err);
                flash(getApiErrorMessage(err), true);
                await reloadAll();
              }
            }}
            className={`flex items-center justify-center h-9 rounded-lg border-2 border-dashed text-[11.5px] font-semibold transition-colors ${isOver ? 'border-[#0058be] bg-[#eff4ff] text-[#0058be]' : 'border-slate-300 text-slate-400'}`}
          >
            Thả Task Group vào đây
          </div>
        </td>
      </tr>
    );
  };

  const renderHoverSpacerRow = (groupId: number, afterCode: string | null, level: number, isLast: boolean, nextTaskId?: number) => {
    const dynamicCols = getDynamicColumns();
    const spacerId = `spacer-${groupId}-${afterCode || 'root'}-${isLast ? 'last' : 'mid'}`;

    // While a Task is actively being dragged, the thin gap between two rows
    // becomes a real drop target too — not just a visual divider — so a drop
    // aimed at "between task A and task B" (the natural gesture for
    // inserting) actually lands somewhere, instead of the row body being the
    // ONLY functional target and this gap silently swallowing the drop.
    if (!isLast && draggingTaskId !== null && nextTaskId != null) {
      const isOver = dragOverTaskId === nextTaskId;
      return (
        <tr key={spacerId} className="border-none bg-transparent">
          <td colSpan={dynamicCols.length + 1} className="p-0 border-none bg-transparent">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverTaskId !== nextTaskId) setDragOverTaskId(nextTaskId);
              }}
              onDragLeave={() => {
                setDragOverTaskId(prev => (prev === nextTaskId ? null : prev));
              }}
              onDrop={(e) => handleTaskDropOnTarget(e, { id: nextTaskId, task_group_id: groupId })}
              className={`h-2 transition-colors ${isOver ? 'border-t-2 border-[#0058be] bg-[#eff4ff]/60' : ''}`}
            />
          </td>
        </tr>
      );
    }

    // Mirror of the above for a Group drag: every gap between this Group's
    // own Task rows (mid-list AND the one at the very end, right before the
    // next Group's header) is still territory belonging to this Group, so
    // dropping anywhere in it reorders relative to it — same as dropping
    // directly on its header row.
    if (draggingGroupId !== null) {
      const isOver = dragOverGroupId === groupId;
      return (
        <tr key={spacerId} className="border-none bg-transparent">
          <td colSpan={dynamicCols.length + 1} className="p-0 border-none bg-transparent">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverGroupId !== groupId) setDragOverGroupId(groupId);
              }}
              onDragLeave={() => {
                setDragOverGroupId(prev => (prev === groupId ? null : prev));
              }}
              onDrop={(e) => handleGroupDropOnTarget(e, groupId)}
              className={`h-2 transition-colors ${isOver ? 'border-t-2 border-[#0058be] bg-[#eff4ff]/60' : ''}`}
            />
          </td>
        </tr>
      );
    }

    // UX (Task 2): Quick-Add `+` shortcut — exposes the same "thêm task ở đây"
    // action as the ⋮ row menu's "Thêm task phía trên" entry but as a hover
    // affordance directly on the gap between two tasks (or at the end of
    // the group when `afterCode` is null). The existing inline form, sort
    // logic, validation, API, and field shape are reused — only the trigger
    // surface is new. Respects `canEditTask(project)` so the same permission
    // gate the ⋮ menu uses still applies. Gated behind `canEditTask` AND
    // `addingTaskGroupId === null` so it disappears the moment the user has
    // any inline form open (the form is the new focus, no clutter).
    const showQuickAdd = canEditTask(project) && addingTaskGroupId === null;

    return (
      <tr
        key={spacerId}
        className="group/spacer border-none bg-transparent"
      >
        <td colSpan={dynamicCols.length + 1} className="p-0 border-none bg-transparent relative">
          <div className="relative flex items-center h-5 transition-all duration-200 group-hover/spacer:bg-slate-50/20">
            {/* Dashed line (existing) */}
            <div className="absolute inset-x-4 flex items-center pointer-events-none w-[calc(100%-2rem)]">
              <div className="w-full border-t border-slate-300 border-dashed opacity-0 group-hover/spacer:opacity-100 transition-opacity duration-200"></div>
            </div>
            {/* Quick-Add `+` (new) — appears on hover; clicking it opens the
                existing inline-add form positioned BELOW the upper task
                (or at the end of the group when `afterCode` is null), so the
                new Task lands exactly at the gap the user clicked on. The
                button itself is non-selectable so the user can copy text
                from a Task without picking up the `+` accidentally. */}
            {showQuickAdd && (
              <button
                type="button"
                aria-label="Thêm task tại vị trí này"
                title="Thêm task tại vị trí này"
                onClick={(e) => {
                  e.stopPropagation();
                  // Reuse the exact same state-mutation pattern the ⋮ menu's
                  // "Thêm task phía dưới" handler uses (see the existing
                  // handler around line 4184 in this file), so the new Task
                  // goes through the same createTask() + sort_order path.
                  setAddingTaskGroupId(groupId);
                  setAddingTaskParentCode(getParentCode(afterCode || '') || null);
                  setAddingTaskAfterCode(afterCode);
                  setAddingTaskBeforeCode(null);
                  const dynamicColsLocal = getDynamicColumns();
                  const initialForm: Record<string, string> = {};
                  dynamicColsLocal.forEach(c => { initialForm[c] = ''; });
                  const todayStr = toPickerDate(new Date().toISOString());
                  const statusCol = dynamicColsLocal.find(c => c.toUpperCase() === 'STATUS');
                  if (statusCol) initialForm[statusCol] = 'Waiting';
                  const priorityCol = dynamicColsLocal.find(c => c.toUpperCase() === 'PRIORITY');
                  if (priorityCol) initialForm[priorityCol] = 'Normal';
                  const startDateCol = dynamicColsLocal.find(c => c.toUpperCase() === 'START DATE');
                  if (startDateCol) initialForm[startDateCol] = todayStr;
                  const kpiRatioCol = dynamicColsLocal.find(c => c.toUpperCase() === 'KPI RATIO');
                  if (kpiRatioCol) initialForm[kpiRatioCol] = '90/10';
                  const mandayCol = dynamicColsLocal.find(c => c.toUpperCase() === 'MANDAY EST');
                  if (mandayCol) initialForm[mandayCol] = '1.0';
                  setNewForm(initialForm);
                }}
                className="relative z-[1] inline-flex items-center justify-center h-5 px-2.5 ml-3 rounded-full border border-dashed border-slate-300 bg-white text-slate-400 opacity-0 group-hover/spacer:opacity-100 hover:opacity-100 hover:border-[#0058be] hover:bg-[#0058be] hover:text-white hover:scale-105 hover:shadow-sm transition-all duration-150 cursor-pointer select-none gap-1 text-[10.5px] font-semibold whitespace-nowrap"
              >
                <Plus size={12} strokeWidth={2.5} />
                <span>Tạo task mới</span>
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // End-of-group drop target — reuses the plain hover spacer when no Task is
  // being dragged (unchanged existing look), but while a Task drag IS active
  // it renders a visible "Thả Task vào đây" zone so a Task can be appended to
  // the end of ANY group via drag, including an empty one (this same call
  // site already runs once per group regardless of task count, so no extra
  // branching is needed for the empty-group case).
  const renderGroupEndDropZone = (groupId: number) => {
    if (draggingTaskId === null) {
      return renderHoverSpacerRow(groupId, null, 0, true);
    }
    const isOver = dragOverGroupEndZoneId === groupId;
    return (
      <tr key={`group-end-drop-${groupId}`} className="border-none bg-transparent">
        <td colSpan={getDynamicColumns().length + 1} className="p-1.5 border-none bg-transparent">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOverGroupEndZoneId !== groupId) setDragOverGroupEndZoneId(groupId);
            }}
            onDragLeave={() => {
              setDragOverGroupEndZoneId(prev => (prev === groupId ? null : prev));
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOverGroupEndZoneId(null);
              if (!isBeyondTaskDragThreshold(e)) return;
              try {
                const raw = e.dataTransfer.getData("application/json");
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data.type !== "task") return;
                if (data.groupId === groupId) {
                  const groupTasks = items.filter(t => t.task_group_id === groupId);
                  const sorted = buildTaskTree(groupTasks);
                  const fromIdx = sorted.findIndex(t => t.id === data.taskId);
                  if (fromIdx !== -1 && fromIdx !== sorted.length - 1) {
                    const reordered = [...sorted];
                    const [removed] = reordered.splice(fromIdx, 1);
                    reordered.push(removed);
                    await reorderTasks(groupId, reordered.map(t => t.id));
                    flash("Đã đổi thứ tự Task thành công!");
                    reloadAll();
                  }
                } else {
                  await performTaskCrossGroupMove(data.taskId, data.groupId, groupId);
                }
              } catch (err: any) {
                console.error(err);
                flash(getApiErrorMessage(err), true);
                await reloadAll();
              }
            }}
            className={`flex items-center justify-center h-9 rounded-lg border-2 border-dashed text-[11.5px] font-semibold transition-colors ${isOver ? 'border-[#0058be] bg-[#eff4ff] text-[#0058be]' : 'border-slate-300 text-slate-400'}`}
          >
            Thả Task vào đây
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
      } else if (colUpper === 'SKILL AREA') {
        setEditValue(task.skill_solution_id ? String(task.skill_solution_id) : '');
      } else if (colUpper === 'SKILL') {
        setEditValue(task.skill_vendor_id ? String(task.skill_vendor_id) : '');
      } else if (colUpper === 'LINK') {
        setEditValue('');
      } else {
        setEditValue(currentVal);
      }
    };

    const isHighlighted = task.id === highlightTaskId;
    // selectedAttentionTaskId: vị trí task tương ứng với item đang chọn ở
    // Leader Review panel - amber NHẠT cố định (#FFFBEB/#F59E0B), KHÔNG pulse
    // (khác isHighlighted, vốn là flash tạm thời cho task vừa tạo). Không
    // dùng đỏ cho selection - đỏ chỉ dành cho overdue/critical (semantic).
    const isAttentionSelected = task.id === selectedAttentionTaskId;
    const rowBgClass = isHighlighted
      ? "bg-amber-100 ring-2 ring-inset ring-amber-400 animate-pulse"
      : isAttentionSelected
        ? "bg-[#FFFBEB] border-l-[3px] border-l-[#F59E0B]"
        : isSubTask
          ? "bg-white hover:bg-[#f0f5ff]/60"
          : "bg-[#f8fafc] hover:bg-[#eef3fb] border-l-[3px] border-l-[#0058be]";

    const cellStyle = `px-2 ${rowPadY} border-r border-slate-100/70 last:border-r-0 align-middle text-[12.5px]`;

    const isDragging = draggingTaskId === task.id;
    const isDragOver = dragOverTaskId === task.id;
    const isCrossGroupTarget = isDragOver && draggingTaskGroupId !== null && draggingTaskGroupId !== task.task_group_id;

    return (
      <tr
        id={`task-row-${task.id}`}
        key={task.id}
        draggable={canMoveTask(project)}
        className={`group relative transition-colors cursor-grab active:cursor-grabbing border-t-2 ${rowBgClass} ${isDragging ? 'opacity-40' : ''} ${isCrossGroupTarget ? 'border-t-emerald-500' : isDragOver ? 'border-t-[#0058be]' : 'border-t-transparent'}`}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/json", JSON.stringify({ type: "task", taskId: task.id, groupId: task.task_group_id }));
          // Recorded here (not on mousedown) so the distance check at drop time
          // measures actual drag travel — used to silently ignore drops that
          // resulted from a near-stationary click accidentally starting a
          // native drag, instead of letting a task move by accident.
          taskDragStartPosRef.current = { x: e.clientX, y: e.clientY };
          // Deferred to the next tick — setting this state SYNCHRONOUSLY here
          // triggers an immediate reflow (every spacer/end-zone across the
          // whole table resizes to become an active drop target) WHILE
          // Chromium is still establishing the native drag session. That
          // reflow can silently break dragover/drop delivery for the rest of
          // the gesture — confirmed via diagnostic logging: onDragStart and
          // onDragEnd both fired, but onDragOver/onDrop never did, for a Task
          // near the bottom of the scrollable table body. Pushing the state
          // update past the current tick lets the browser finish locking in
          // the drag session before the DOM/layout changes underneath it.
          setTimeout(() => {
            setDraggingTaskId(task.id);
            setDraggingTaskGroupId(task.task_group_id);
          }, 0);
        }}
        onDragEnd={() => {
          taskDragStartPosRef.current = null;
          setDraggingTaskId(null);
          setDraggingTaskGroupId(null);
          setDragOverTaskId(null);
          setDragOverGroupEndZoneId(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (dragOverTaskId !== task.id) setDragOverTaskId(task.id);
        }}
        onDragLeave={() => {
          setDragOverTaskId(prev => (prev === task.id ? null : prev));
        }}
        onDrop={(e) => {
          return draggingGroupId !== null
            ? handleGroupDropOnTarget(e, task.task_group_id)
            : handleTaskDropOnTarget(e, { id: task.id, task_group_id: task.task_group_id });
        }}
      >
        {/* Action cell: cả dòng đều kéo-thả được (giữ chuột trái bất kỳ đâu trên Task) */}
        <td className="px-1 py-2 text-center sticky left-0 z-[11] bg-white" style={{ width: `${ACTION_COL_WIDTH}px`, minWidth: `${ACTION_COL_WIDTH}px` }}>
          <div className="flex items-center justify-center gap-1">
            {/* More actions menu */}
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  const key = `task-${task.id}`;
                  setRowMenuAnchorEl(e.currentTarget);
                  setOpenRowMenu(openRowMenu === key ? null : key);
                }}
                className="flex items-center justify-center w-6 h-6 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700 transition-opacity data-[open=true]:opacity-100 data-[open=true]:bg-slate-200"
                data-open={openRowMenu === `task-${task.id}`}
                title="Thao tác khác"
              >
                <MoreHorizontal size={15} />
              </button>
              <FloatingDropdown
                anchorEl={rowMenuAnchorEl}
                open={openRowMenu === `task-${task.id}`}
                onClose={() => setOpenRowMenu(null)}
                align="right"
                className="bg-white border border-slate-200 rounded-lg shadow-lg w-[190px] py-1 text-left"
              >
                  {canEditTask(project) && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRowMenu(null);
                      setAddingTaskGroupId(task.task_group_id);
                      const parentCode = getParentCode(task.task_code) || null;
                      setAddingTaskParentCode(parentCode);
                      // "Insert above" this task — pin it by this task's own
                      // code (not the row above), which stays correct even
                      // when this is the first child of a parent (the row
                      // above would be the parent itself, at a different
                      // nesting level, not an actual sibling).
                      setAddingTaskAfterCode(null);
                      setAddingTaskBeforeCode(task.task_code);
                      const dynamicCols = getDynamicColumns();
                      const initialForm: Record<string, string> = {};
                      dynamicCols.forEach(col => { initialForm[col] = ''; });
                      const todayStr = toPickerDate(new Date().toISOString());
                      const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
                      if (statusCol) initialForm[statusCol] = 'Waiting';
                      const priorityCol = dynamicCols.find(c => c.toUpperCase() === 'PRIORITY');
                      if (priorityCol) initialForm[priorityCol] = 'Normal';
                      const startDateCol = dynamicCols.find(c => c.toUpperCase() === 'START DATE');
                      if (startDateCol) initialForm[startDateCol] = todayStr;
                      const kpiRatioCol = dynamicCols.find(c => c.toUpperCase() === 'KPI RATIO');
                      if (kpiRatioCol) initialForm[kpiRatioCol] = '90/10';
                      const mandayCol = dynamicCols.find(c => c.toUpperCase() === 'MANDAY EST');
                      if (mandayCol) initialForm[mandayCol] = '1.0';
                      setNewForm(initialForm);
                    }}
                    className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                  >
                    <Plus size={15} className="text-blue-500" />
                    Thêm task phía trên
                  </button>
                  )}
                  {canEditTask(project) && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRowMenu(null);
                      setAddingTaskGroupId(task.task_group_id);
                      const parentCode = getParentCode(task.task_code) || null;
                      setAddingTaskParentCode(parentCode);
                      setAddingTaskAfterCode(task.task_code);
                      setAddingTaskBeforeCode(null);
                      const dynamicCols = getDynamicColumns();
                      const initialForm: Record<string, string> = {};
                      dynamicCols.forEach(col => { initialForm[col] = ''; });
                      const todayStr = toPickerDate(new Date().toISOString());
                      const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
                      if (statusCol) initialForm[statusCol] = 'Waiting';
                      const priorityCol = dynamicCols.find(c => c.toUpperCase() === 'PRIORITY');
                      if (priorityCol) initialForm[priorityCol] = 'Normal';
                      const startDateCol = dynamicCols.find(c => c.toUpperCase() === 'START DATE');
                      if (startDateCol) initialForm[startDateCol] = todayStr;
                      const kpiRatioCol = dynamicCols.find(c => c.toUpperCase() === 'KPI RATIO');
                      if (kpiRatioCol) initialForm[kpiRatioCol] = '90/10';
                      const mandayCol = dynamicCols.find(c => c.toUpperCase() === 'MANDAY EST');
                      if (mandayCol) initialForm[mandayCol] = '1.0';
                      setNewForm(initialForm);
                    }}
                    className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                  >
                    <Plus size={15} className="text-emerald-600" />
                    Thêm task phía dưới
                  </button>
                  )}
                  {canEditTask(project) && (
                  <button
                    type="button"
                    onClick={() => { setOpenRowMenu(null); handleDuplicateTask(task.task_group_id, task.id); }}
                    className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                  >
                    <Copy size={15} className="text-amber-600" />
                    Nhân bản
                  </button>
                  )}
                  {canMoveTask(project) && (
                  <button
                    type="button"
                    onClick={() => { setOpenRowMenu(null); handleOpenMoveModal(task); }}
                    className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                  >
                    <ArrowRightLeft size={15} className="text-[#0058be]" />
                    Di chuyển
                  </button>
                  )}
                  {canDeleteTask(project) && <div className="my-1 border-t border-slate-100" />}
                  {canDeleteTask(project) && (
                  <button
                    type="button"
                    onClick={() => { setOpenRowMenu(null); setTaskToDelete(task.id); }}
                    className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={15} />
                    Xóa
                  </button>
                  )}
              </FloatingDropdown>
            </div>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openReviewDrawer(task); }}
              className="flex items-center justify-center w-6 h-6 rounded text-blue-500 opacity-0 group-hover:opacity-100 hover:bg-blue-100 hover:text-blue-700 transition-opacity shrink-0"
              title="Mở Review"
            >
              <ArrowUpRight size={15} />
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

            if (colUpper === 'SKILL AREA') {
              const activeGroups = categories
                .filter(c => c.is_active)
                .flatMap(c => c.groups || []);
              const catalogAreas = activeGroups.map((g: any) => ({
                id: g.id, name: g.name,
                skills: (g.skills || []).filter((s: any) => s.is_active),
              }));

              return (
                <CategorySearchCell
                  key={col}
                  col={col}
                  kind="area"
                  items={activeGroups.map((g: any) => ({ id: g.id, name: g.name, meta: `${(g.skills || []).filter((s: any) => s.is_active).length} skills` }))}
                  editValue={editValue}
                  placeholder="Tìm Skill Area..."
                  catalogAreas={catalogAreas}
                  onSaveWithAction={(val, act) => handleCellSave(task.id, col, val, act)}
                  onCancel={() => setEditingCell(null)}
                  onRequestAreaCreate={(name) => {
                    // Category picker is mandatory here too now, same modal
                    // the Task Detail Drawer's "+" button uses - no more
                    // silently defaulting to the first active Category.
                    openSkillGroupCreateModal(name, task.skill_solution_id, (groupId) => {
                      handleCellSave(task.id, col, String(groupId));
                      flash(`Đã tạo Skill Area "${name}"!`);
                    });
                  }}
                />
              );
            }

            if (colUpper === 'SKILL') {
              const currentGroupId = task.skill_solution_id;
              const allActiveGroups = categories
                .filter(c => c.is_active)
                .flatMap(c => c.groups || []);
              const currentGroupObj = currentGroupId ? allActiveGroups.find((g: any) => g.id === currentGroupId) : null;
              let availableSkills: any[] = [];
              if (currentGroupObj) {
                availableSkills = (currentGroupObj.skills || []).filter((s: any) => s.is_active).map((s: any) => ({ id: s.id, name: s.name }));
              } else {
                availableSkills = allActiveGroups
                  .flatMap((g: any) => (g.skills || []).filter((s: any) => s.is_active).map((s: any) => ({ id: s.id, name: s.name, meta: g.name })));
              }
              const catalogAreas = allActiveGroups.map((g: any) => ({
                id: g.id, name: g.name,
                skills: (g.skills || []).filter((s: any) => s.is_active),
              }));

              return (
                <CategorySearchCell
                  key={col}
                  col={col}
                  kind="skill"
                  items={availableSkills}
                  editValue={editValue}
                  placeholder="Tìm Skill..."
                  contextAreaName={currentGroupObj?.name || ''}
                  catalogAreas={catalogAreas}
                  onSaveWithAction={(val, act) => handleCellSave(task.id, col, val, act)}
                  onCancel={() => setEditingCell(null)}
                  // areaIdOverride lets the "⚙ Quản lý danh mục" panel add a
                  // Skill under ANY area (not just the task's current one) —
                  // the normal quick-add (no override) still requires the
                  // task to already have a Skill Area chosen, same
                  // "SKILL AREA trước" gate the drawer's + button uses.
                  onQuickCreate={async (name, areaIdOverride) => {
                    const groupId = areaIdOverride ?? currentGroupId;
                    if (!groupId) return null;
                    try {
                      await createSkill({ name, group_id: groupId });
                      const fresh = await refetchCategories();
                      const created = fresh
                        .flatMap((c: any) => c.groups || [])
                        .flatMap((g: any) => g.skills || [])
                        .find((s: any) => s.name === name && Number(s.group_id) === groupId);
                      if (created) {
                        flash(`Đã tạo Skill "${name}"!`);
                        // Skill luôn thuộc một Skill Area cụ thể (vd. tạo qua
                        // "⚙ Quản lý danh mục" ở một Area khác) — đồng bộ
                        // luôn ô SKILL AREA của task theo Area cha để tránh
                        // lệch cặp Area/Skill.
                        if (Number(currentGroupId) !== Number(groupId)) {
                          const areaCol = getDynamicColumns().find(c => c.toUpperCase().trim() === 'SKILL AREA') || 'SKILL AREA';
                          handleCellSave(task.id, areaCol, String(groupId));
                        }
                      }
                      return created ? { id: created.id } : null;
                    } catch (err: any) {
                      flash('Lỗi tạo Skill: ' + getApiErrorMessage(err), true);
                      return null;
                    }
                  }}
                />
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
              const commitLink = (raw: string) => {
                if (!raw.trim()) {
                  setEditingCell(null);
                  return;
                }
                handleCellSave(task.id, col, appendLinkValue(task.link || task.ticket_id || '', raw));
              };

              return (
                <td key={col} className="px-2 py-1 min-w-[320px]">
                  <LinkChipsEditor
                    value={task.link || task.ticket_id || ''}
                    onChange={(next) => handleCellSave(task.id, col, next)}
                    inputValue={editValue}
                    onInputChange={setEditValue}
                    autoFocus
                    onInputKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitLink(editValue);
                      } else if (e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
                    onInputBlur={() => commitLink(editValue)}
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
                <span className="text-slate-300 font-normal text-[11px] select-none">—</span>
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
                    className="cursor-pointer select-none p-0.5 hover:bg-slate-200 rounded font-normal text-slate-400 inline-flex items-center justify-center w-5 h-5 transition-all duration-200 hover:text-slate-600"
                  >
                    {isCollapsedParent ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
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
                    className={`w-2.5 h-2.5 rounded-full cursor-pointer shrink-0 border border-white shadow-sm transition-transform hover:scale-125 ${task.ai_status === 'NEED_RECHECK'
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
                <span
                  className={`whitespace-pre-wrap break-words block leading-relaxed pr-4 line-clamp-2 group-hover/detail:text-[#0058be] transition-colors ${!isSubTask ? 'font-semibold text-[#0b1c30] text-[13px]' : 'text-slate-700 font-normal text-[12.5px]'}`}
                  title={val}
                >
                  {val}
                </span>
              </div>
            );
          } else if (colUpper === 'DEADLINE') {
            const ede = task.end_date_est;
            if (ede) {
              const deadline = new Date(ede);
              const now = new Date();
              now.setHours(0,0,0,0);
              deadline.setHours(0,0,0,0);
              const sl = (task.status || '').toLowerCase();
              const isDone = sl === 'done' || sl === 'completed';
              const isReview = sl.includes('review');
              let cls = 'text-slate-500';
              if (!isDone) {
                const diff = Math.floor((now.getTime() - deadline.getTime()) / 86400000);
                if (diff > 0) cls = 'text-rose-600 font-semibold';
                else if (diff === 0) cls = 'text-amber-600 font-medium';
              }
              cellContent = <span className={`text-[12px] ${cls}`}>{formatDateToShow(ede)}</span>;
            } else {
              cellContent = <span className="text-slate-300 text-[11px]">—</span>;
            }
          } else if (colUpper === 'HEALTH') {
            const sl = (task.status || '').toLowerCase();
            const isDone = sl === 'done' || sl === 'completed';
            const isReview = sl.includes('review');
            const isBlocked = sl.includes('block') || task.is_blocked;
            if (isReview) {
              cellContent = <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Cần Review</span>;
            } else if (isBlocked) {
              cellContent = <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">! Lưu ý</span>;
            } else if (!isDone && task.end_date_est) {
              const deadline = new Date(task.end_date_est);
              const now = new Date();
              now.setHours(0,0,0,0);
              deadline.setHours(0,0,0,0);
              const daysLate = Math.floor((now.getTime() - deadline.getTime()) / 86400000);
              if (daysLate >= 3) {
                cellContent = <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">! Rủi ro cao</span>;
              } else if (daysLate === 2) {
                cellContent = <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">! Rủi ro T.Bình</span>;
              } else if (daysLate === 1) {
                cellContent = <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-50 text-yellow-700 border border-yellow-200">! Rủi ro Thấp</span>;
              } else {
                cellContent = <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">On track</span>;
              }
            } else if (isDone) {
              cellContent = <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">✓ Done</span>;
            } else {
              cellContent = <span className="text-slate-300 text-[11px]">—</span>;
            }
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
          } else if (colUpper === 'LINK' || colUpper === 'TICKET ID') {
            const linkValue = task.link || task.ticket_id || val || '';
            const links = (linkValue || '').split('\n').filter(Boolean);
            if (links.length > 0) {
              cellContent = (
                <div className="flex flex-wrap gap-1.5">
                  {links.map((link: string, index: number) => {
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
                      } catch { }
                    }

                    return (
                      <div key={index} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-md text-[11px] font-semibold text-blue-700 shadow-sm overflow-hidden">
                        <span
                          className="px-2 py-0.5 cursor-pointer hover:bg-blue-100 transition-colors max-w-[160px] truncate"
                          title={link}
                          onClick={(e) => { e.stopPropagation(); if (isUrl) window.open(link, '_blank', 'noopener,noreferrer'); }}
                        >
                          🔗 {label}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const newLinks = links.filter((_: string, i: number) => i !== index);
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
                <span className="text-slate-300 font-normal text-[11px] select-none">—</span>
              );
            }
          }

          const isNumericOrDate = colUpper.includes('MANDAY') || colUpper.includes('DATE') || colUpper.includes('RATIO') || colUpper.includes('ID');

          const SYSTEM_COLS = [
            'TASK ID', 'END DATE EST', 'MD ACTUAL', 'DAYS LATE',
            'KPI BASE', 'KPI PERFORM', 'KPI OVERTIME', 'KPI FINAL', 'SUB ID', 'SOLUTION',
            // DEADLINE chỉ là alias hiển thị của END DATE EST (đã read-only ở
            // trên); HEALTH chưa có field/logic backing (getCellValue luôn trả
            // rỗng) - cả 2 trước đây vẫn cho click sửa nhưng handleCellSave
            // không có case xử lý nên PATCH đi với payload rỗng, vẫn báo
            // "thành công" dù không lưu gì - đánh dấu read-only cho đúng thực tế.
            'DEADLINE', 'HEALTH'
          ];
          const isReadOnly = SYSTEM_COLS.includes(colUpper);

          const align = getColumnAlign(col);
          const alignClass = align === 'center' ? 'text-center justify-center' : align === 'right' ? 'text-right justify-end' : 'text-left';
          return (
            <td
              key={col}
              className={`${cellStyle} ${colUpper === 'DETAIL TASK' ? 'whitespace-normal break-words' : 'whitespace-nowrap'} ${isReadOnly || !canEditTask(project) ? 'bg-[#f8fafc]/50 cursor-default' : 'cursor-text hover:bg-slate-100/80 group'} ${isNumericOrDate ? 'font-mono text-[#0b1c30] font-semibold' : 'text-[#565e74]'} ${colUpper !== 'DETAIL TASK' ? alignClass : ''}`}
              style={{ width: getColumnWidth(col), ...getPinTdStyle(col) }}
              onClick={() => {
                if (!isReadOnly && canEditTask(project)) handleStartEdit(col, val);
              }}
            >
              <div className={`flex items-center gap-1 w-full min-w-0 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}>
                {colUpper === 'DETAIL TASK' ? cellContent : (
                  <span className="truncate min-w-0" title={typeof cellContent === 'string' && cellContent ? cellContent : undefined}>{cellContent}</span>
                )}
                {!isReadOnly && (
                  <Pencil size={11} className="opacity-0 group-hover:opacity-40 transition-opacity shrink-0 text-slate-500" />
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
      'PRIORITY', 'KPI RATIO', 'SKILL AREA', 'SKILL',
      'TICKET ID', 'SEND', 'KPI BASE', 'KPI PERFORM', 'KPI OVERTIME', 'KPI FINAL',
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
          <td className={`px-1 ${rowPadY} text-center`} style={{ width: `${ACTION_COL_WIDTH}px`, minWidth: `${ACTION_COL_WIDTH}px` }}>
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
                    type="number"
                    required
                    min={1}
                    max={10}
                    step={1}
                    value={newTgForm.manday_est}
                    onChange={e => setNewTgForm(prev => ({ ...prev, manday_est: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    placeholder="EST Manday (1-10, Bắt buộc)..."
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
                <td key={col} className={`px-3 ${rowPadY} text-slate-400 font-mono text-center bg-slate-50/20 text-[10px]`}>
                  Auto
                </td>
              );
            }

            // Other columns not applicable to Task Group
            return (
              <td key={col} className={`px-3 ${rowPadY} bg-slate-100/40 text-slate-300 text-center select-none`}>
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
            className="bg-[#F7F9FC] border-b border-[#E3E7EE] transition-colors duration-150"
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
                if (data.type === "group" && data.phaseId !== phase.id && isBeyondGroupDragThreshold(e)) {
                  await performGroupCrossPhaseMove(data.groupId, data.phaseId, phase.id);
                }
              } catch (err: any) {
                console.error(err);
                flash(getApiErrorMessage(err), true);
                await reloadAll();
              }
            }}
          >
            <td className="px-2 py-2 text-center"></td>
            <td colSpan={getDynamicColumns().length} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-[#334155] uppercase tracking-wide">
                  {phase.name}
                </span>
                <span className="text-[10.5px] font-normal text-[#b0b6c2] normal-case tracking-normal">
                  {groupsInPhase.reduce((sum, g) => sum + (g.task_count || 0), 0)} tasks • {groupsInPhase.reduce((sum, g) => sum + (Number(g.manday_est) || 0), 0)} MD
                </span>
              </div>
            </td>
          </tr>
        );
      }

      if (groupsInPhase.length === 0) {
        if (addingTaskGroupPhaseId === phase.id) {
          result.push(renderInlineAddGroupRow(phase.id, 'I'));
        } else {
          result.push(renderPhaseEndDropZone(phase.id));
        }
        return;
      }

      groupsInPhase.forEach((group, gIdx) => {
        const isCollapsed = collapsedGroups.has(group.id);
        // `filteredItems` already applies taskSearch (plus every other active
        // filter) AND deliberately keeps a matched task's ancestor/descendant
        // rows for hierarchy context (see its own comments) — re-filtering by
        // taskSearch again here undid exactly that: a child task matching
        // the search kept showing, but its own parent Group/Task row (whose
        // own detail/task_code text doesn't match) got filtered back out,
        // leaving orphaned rows with no parent context and reads as search
        // "returning the wrong/incomplete results".
        const filteredTasks = filteredItems.filter(t => t.task_group_id === group.id);
        const dynamicCols = getDynamicColumns();

        // ═══ TASK GROUP ROW (rendered as table row) ═══
        const isDraggingThisGroup = draggingGroupId === group.id;
        const isGroupDragOverThis = dragOverGroupId === group.id;
        // Insertion line (Group being dragged) vs the older "drop a Task into
        // this Group" highlight — only one kind of drag can be in flight at
        // a time, so which state is non-null tells us which to show.
        const showGroupInsertionLine = draggingGroupId !== null && isGroupDragOverThis;
        const showTaskDropHighlight = draggingTaskId !== null && isGroupDragOverThis;
        result.push(
          <tr
            id={`tg-row-${group.id}`}
            key={`tg-row-${group.id}`}
            draggable={canManageProjectStructure(project)}
            className={`border-t-2 ${showGroupInsertionLine ? 'border-t-[#0058be]' : 'border-t-transparent'} ${showTaskDropHighlight ? 'bg-indigo-100' : 'bg-indigo-50/50 hover:bg-indigo-50'} border-b border-[#E3E7EE] border-l-[3px] border-l-indigo-400 group transition-colors ${isDraggingThisGroup ? 'opacity-40' : ''}`}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/json", JSON.stringify({ type: "group", groupId: group.id, phaseId: group.phase_id }));
              groupDragStartPosRef.current = { x: e.clientX, y: e.clientY };
              // Deferred to the next tick — see the matching comment on the
              // Task row's onDragStart: setting this synchronously reflows
              // every spacer/end-zone in the table while Chromium is still
              // establishing the native drag session, which can silently
              // break dragover/drop delivery for the rest of the gesture.
              setTimeout(() => setDraggingGroupId(group.id), 0);
            }}
            onDragEnd={() => {
              groupDragStartPosRef.current = null;
              setDraggingGroupId(null);
              setDragOverGroupId(null);
              setDragOverPhaseEndZoneId(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOverGroupId !== group.id) setDragOverGroupId(group.id);
            }}
            onDragLeave={() => {
              setDragOverGroupId(prev => (prev === group.id ? null : prev));
            }}
            onDrop={async (e) => {
              if (draggingGroupId !== null) {
                await handleGroupDropOnTarget(e, group.id);
                return;
              }
              e.preventDefault();
              setDragOverGroupId(null);
              try {
                const raw = e.dataTransfer.getData("application/json");
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data.type === "task") {
                  if (data.groupId !== group.id && isBeyondTaskDragThreshold(e)) {
                    await performTaskCrossGroupMove(data.taskId, data.groupId, group.id);
                  }
                }
              } catch (err: any) {
                console.error(err);
                flash(getApiErrorMessage(err), true);
                await reloadAll();
              }
            }}
          >
            {/* Actions column */}
            <td className={`px-1 ${rowPadY} text-center sticky left-0 z-[11] bg-white`} style={{ width: `${ACTION_COL_WIDTH}px`, minWidth: `${ACTION_COL_WIDTH}px` }}>
              <div className="flex items-center justify-center gap-1.5 select-none">
                {/* 1. Toggle Expand/Collapse (Always visible) */}
                <button
                  type="button"
                  onClick={() => toggleGroupCollapse(group.id)}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-indigo-200 text-indigo-700"
                  title={isCollapsed ? 'Mở rộng' : 'Thu gọn'}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>

                {/* 2. More actions (hover visible): add task / edit name / delete /
                    move — whole row is draggable, no separate grip icon needed. */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      const key = `group-${group.id}`;
                      setRowMenuAnchorEl(e.currentTarget);
                      setOpenRowMenu(openRowMenu === key ? null : key);
                    }}
                    className="flex items-center justify-center w-6 h-6 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-indigo-200 hover:text-slate-700 transition-opacity data-[open=true]:opacity-100 data-[open=true]:bg-indigo-200"
                    data-open={openRowMenu === `group-${group.id}`}
                    title="Thao tác khác"
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  <FloatingDropdown
                    anchorEl={rowMenuAnchorEl}
                    open={openRowMenu === `group-${group.id}`}
                    onClose={() => setOpenRowMenu(null)}
                    align="right"
                    className="bg-white border border-slate-200 rounded-lg shadow-lg w-[190px] py-1 text-left"
                  >
                      {canEditTask(project) && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenRowMenu(null);
                          setAddingTaskGroupId(group.id);
                          setAddingTaskParentCode(null);
                          setAddingTaskAfterCode(null);
                          setAddingTaskBeforeCode(null);
                          const initialForm: Record<string, string> = {};
                          dynamicCols.forEach(col => { initialForm[col] = ''; });
                          if (dynamicCols.find(c => c.toUpperCase() === 'STATUS')) {
                            initialForm['STATUS'] = 'Waiting';
                          }
                          setNewForm(initialForm);
                        }}
                        className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                      >
                        <Plus size={15} className="text-[#0058be]" />
                        Thêm task
                      </button>
                      )}
                      {canManageProjectStructure(project) && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenRowMenu(null);
                          const detailCol = dynamicCols.find(c => ['DETAIL TASK', 'TASK', 'DESCRIPTION'].includes(c.toUpperCase().trim())) || 'Detail Task';
                          const groupVal = getGroupCellValue(group, detailCol.toUpperCase().trim());
                          setEditingCell({ taskId: -group.id, colName: detailCol });
                          setEditValue(groupVal);
                        }}
                        className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                      >
                        <Pencil size={15} className="text-slate-500" />
                        Đổi tên nhóm
                      </button>
                      )}
                      {canManageProjectStructure(project) && (
                      <button
                        type="button"
                        onClick={() => { setOpenRowMenu(null); handleOpenMoveGroupModal(group); }}
                        className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                      >
                        <ArrowRightLeft size={15} className="text-[#0058be]" />
                        Di chuyển
                      </button>
                      )}
                      {canManageProjectStructure(project) && <div className="my-1 border-t border-slate-100" />}
                      {canManageProjectStructure(project) && (
                      <button
                        type="button"
                        onClick={() => { setOpenRowMenu(null); handleDeleteTaskGroupClick(group); }}
                        className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={15} />
                        Xóa nhóm
                      </button>
                      )}
                  </FloatingDropdown>
                </div>
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
                  <td key={col} className="px-4 py-2.5 text-[13px] font-bold text-indigo-600 whitespace-nowrap" style={{ width: getColumnWidth(col), ...getPinTdStyle(col) }}>
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

              // ASSIGNED (người thực hiện) on a Group row is fixed to
              // whoever created it — read-only here, backend silently
              // ignores any attempt to change it via PATCH. SUPPORT (SP)
              // stays a freely-editable multi-select roster, additive-
              // synced from child Tasks, same as before.
              if (colUpper === 'ASSIGNED') {
                const names: string[] = group.assigned_names || [];
                return (
                  <td key={col} className="px-2 py-2 text-xs" title="Người thực hiện Group = người tạo, không thể chỉnh sửa">
                    <span className="truncate min-w-0 font-semibold text-[#1e293b]">
                      {names.length > 0 ? names.join(', ') : <span className="text-slate-300 font-normal">—</span>}
                    </span>
                  </td>
                );
              }
              if (colUpper === 'SUPPORT') {
                const field: 'assigned_ids' | 'support_ids' = 'support_ids';
                const names: string[] = group.support_names || [];
                const ids: number[] = group.support_ids || [];
                const isEditingPeople = editingGroupPeople?.groupId === group.id && editingGroupPeople?.field === field;

                if (isEditingPeople) {
                  return (
                    <td key={col} className="px-1 py-1 min-w-[180px]" onBlur={(e) => {
                      const currentTarget = e.currentTarget;
                      setTimeout(() => {
                        if (!currentTarget.contains(document.activeElement)) {
                          setEditingGroupPeople(null);
                        }
                      }, 150);
                    }}>
                      <SearchableSelect
                        label="thành viên"
                        icon=""
                        isMulti
                        options={projectMembers.map((m: any) => ({ id: String(m.id), name: m.display_name }))}
                        value={ids.map(String)}
                        onChange={(vals: any) => handleSaveGroupPeople(group, field, vals)}
                        placeholder="Tìm thành viên..."
                        className="w-full"
                        usePortal
                      />
                    </td>
                  );
                }

                return (
                  <td
                    key={col}
                    className="px-2 py-2 text-xs cursor-pointer hover:bg-indigo-100/60 group"
                    onClick={() => setEditingGroupPeople({ groupId: group.id, field })}
                  >
                    <div className="flex items-center gap-1 w-full min-w-0">
                      <span className="truncate min-w-0 font-semibold text-[#1e293b]" title={names.join(', ')}>
                        {names.length > 0 ? names.join(', ') : <span className="text-slate-300 font-normal">—</span>}
                      </span>
                      <Pencil size={11} className="opacity-0 group-hover:opacity-40 transition-opacity shrink-0 text-slate-500" />
                    </div>
                  </td>
                );
              }

              // Special editable cell for REMARK
              if (colUpper === 'REMARK') {
                if (editingGroupRemark === group.id) {
                  return (
                    <ParentRemarkSelectCell
                      key={col}
                      col={col}
                      parentRemarks={parentRemarks}
                      onSelect={(val) => handleSyncRemarkToChildren(group.id, val)}
                      onCancel={() => setEditingGroupRemark(null)}
                      onClear={() => handleSyncRemarkToChildren(group.id, '')} // Huỷ REMARK CHA hiện tại: xoá trống remark cho tất cả task con
                    />
                  );
                }
                return (
                  <td key={col} className="px-4 py-2.5 text-center text-xs">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingGroupRemark(group.id); }}
                      className="text-[10.5px] text-emerald-600 hover:bg-emerald-100 bg-emerald-50 px-2 py-1 rounded font-bold border border-emerald-200 transition-colors shadow-sm whitespace-nowrap"
                    >
                      Chọn Remark
                    </button>
                  </td>
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
                              flash('Lỗi cập nhật: ' + getApiErrorMessage(err), true);
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
                                flash('Lỗi cập nhật: ' + getApiErrorMessage(err), true);
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
                const cellStyle = `px-2 ${rowPadY} text-xs font-bold text-[#1e293b] whitespace-nowrap text-center`;
                return (
                  <td key={col} className={`${cellStyle} group cursor-pointer hover:bg-indigo-100/60`} onClick={() => setEditingGroupDate(group.id)}>
                    <div className="flex items-center justify-between w-full">
                      <span className="font-mono" title={`Tự động: ${formatDateToShow(group.end_date_actual_auto || '')}`}>
                        {group.status && group.status.toLowerCase() === 'done' ? (
                          group.end_date_actual_override ? (
                            <strong className="text-indigo-700" title="Ngày đã ghi đè thủ công">{formatDateToShow(group.end_date_actual_override)}</strong>
                          ) : (
                            val || <span className="text-slate-300">—</span>
                          )
                        ) : (
                          <span className="text-slate-400 italic">—</span>
                        )}
                      </span>
                      <Pencil size={11} className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0 text-slate-500" />
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
                        {getAvailableStatuses().length === 0 ? (
                          <>
                            <option value="Waiting">Waiting</option>
                            <option value="Process">Process</option>
                            <option value="Done">Done</option>
                            <option value="Cancel">Cancel</option>
                          </>
                        ) : (
                          getAvailableStatuses().map((st: any) => (
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
                      step={colUpper.includes('MANDAY') ? 1 : undefined}
                      min={colUpper.includes('MANDAY') ? 1 : undefined}
                      max={colUpper.includes('MANDAY') ? 10 : undefined}
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
              const cellStyle = `px-2 ${rowPadY} text-xs font-bold text-[#1e293b] whitespace-nowrap`;
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

              // Detail Task — bold with group icon and Remind Leader button
              if (colUpper === 'DETAIL TASK') {
                const childTasks = items.filter(t => t.task_group_id === group.id);
                const allDone = childTasks.length > 0 && childTasks.every(t => (t.status || '').toLowerCase() === 'done');
                displayContent = (
                  <div className="flex items-center justify-between w-full pr-2 gap-2">
                    <span className="text-[12.5px] font-semibold text-[#1e293b] whitespace-pre-wrap break-words block leading-relaxed pr-2 pl-3">{val}</span>
                    {isMember() && (group.status.toLowerCase() !== 'done') && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!allDone) {
                            flash('Tất cả task con phải ở trạng thái Done mới được phép gửi thông báo!', true);
                            return;
                          }
                          try {
                            await remindTaskGroup(group.id);
                            flash('Đã gửi thông báo nhắc Leader duyệt Task Cha thành công!');
                          } catch (err: any) {
                            flash(getApiErrorMessage(err, 'Lỗi khi gửi thông báo nhắc duyệt!'), true);
                          }
                        }}
                        className={`px-2 py-0.5 rounded text-[10.5px] font-bold flex items-center gap-1 transition-all shrink-0 ${allDone
                            ? 'bg-amber-100 hover:bg-amber-200 text-amber-700 border border-amber-300 shadow-sm cursor-pointer animate-pulse'
                            : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-pointer hover:bg-slate-200'
                          }`}
                        title={allDone ? "Nhắc Leader duyệt Task Cha này" : "Phải hoàn thành tất cả task con (Done) mới được gửi thông báo"}
                      >
                        <Bell size={11} />
                        <span>Nhắc Leader</span>
                      </button>
                    )}
                  </div>
                );
              }

              const groupAlign = getColumnAlign(col);
              const groupAlignClass = groupAlign === 'center' ? 'text-center' : groupAlign === 'right' ? 'text-right' : 'text-left';
              return (
                <td
                  key={col}
                  className={`${cellStyle} ${colUpper === 'DETAIL TASK' ? 'whitespace-normal break-words' : ''} ${isEditable ? 'cursor-text hover:bg-indigo-100/60 group' : (isAuto ? 'text-slate-500 font-mono' : '')} ${colUpper !== 'DETAIL TASK' ? groupAlignClass : ''}`}
                  style={{ width: getColumnWidth(col), ...getPinTdStyle(col) }}
                  onClick={() => {
                    if (isEditable) {
                      setEditingCell({ taskId: -group.id, colName: col });
                      setEditValue(val);
                    }
                  }}
                >
                  <div className={`flex items-center gap-1 w-full min-w-0 ${groupAlign === 'center' ? 'justify-center' : groupAlign === 'right' ? 'justify-end' : ''}`}>
                    {colUpper === 'DETAIL TASK' ? displayContent : (
                      <span className="truncate min-w-0" title={typeof displayContent === 'string' && displayContent ? displayContent : undefined}>{displayContent}</span>
                    )}
                    {isEditable && colUpper !== 'DETAIL TASK' && (
                      <Pencil size={11} className="opacity-0 group-hover:opacity-40 transition-opacity shrink-0 text-slate-500" />
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

        // Tracks whether "Thêm task phía trên" (addingTaskBeforeCode) actually
        // found its anchor task and rendered the form right above it — if the
        // anchor task is hidden (its ancestor got collapsed mid-flow), this
        // stays false and the group-end fallback below still shows the form
        // (better than it vanishing entirely).
        let beforeRowRendered = false;

        sortedTasks.forEach((task, tIdx) => {
          if (isAncestorCollapsed(task.task_code)) {
            return;
          }

          const hasChildren = sortedTasks.some(t => getParentCode(t.task_code) === task.task_code);
          const isCollapsedParent = collapsedParents.has(task.task_code);
          const dotCount = (task.task_code || '').split('.').length - 1;
          const level = Math.max(0, dotCount);

          // 0. Render inline add row BEFORE this task if inserting above it
          // ("Thêm task phía trên" from the actions menu) — must be pushed
          // ahead of the task's own row, otherwise there's no render branch
          // that ever places it here and it silently falls through to the
          // group-end fallback instead, appearing at the bottom of the list
          // no matter which task "phía trên" was clicked on.
          // Guard every comparison below with `task.task_code` being non-
          // empty: a handful of seed/legacy tasks can have a blank task_code
          // (data bug, not a normal creation path — the server always
          // computes a real code), and addingTaskBeforeCode/AfterCode/
          // ParentCode get set directly from a clicked task's OWN task_code
          // (see the ⋮ row menu and hover "+" handlers). Without this guard,
          // a blank code on one task matched EVERY other task sharing that
          // same blank code, rendering one inline add-row per match instead
          // of exactly one.
          if (addingTaskGroupId === group.id && Boolean(addingTaskBeforeCode) && addingTaskBeforeCode === task.task_code) {
            result.push(renderInlineAddRow(group.id, addingTaskParentCode, level));
            beforeRowRendered = true;
          }

          result.push(renderSingleTaskRow(task, level, hasChildren, isCollapsedParent, tIdx, sortedTasks));

          // 1. Render inline add row at hover position if adding after this task
          if (addingTaskGroupId === group.id && Boolean(addingTaskAfterCode) && addingTaskAfterCode === task.task_code) {
            result.push(renderInlineAddRow(group.id, addingTaskParentCode, level));
          }

          // 2. Render sub-task inline add row if triggered from actions menu
          if (addingTaskGroupId === group.id && Boolean(addingTaskParentCode) && addingTaskParentCode === task.task_code && addingTaskAfterCode !== task.task_code) {
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
            result.push(renderHoverSpacerRow(group.id, task.task_code, level, false, nextVisibleTask.id));
          }
        });

        if (addingTaskGroupId === group.id && addingTaskParentCode === null && addingTaskAfterCode === null && !beforeRowRendered) {
          result.push(renderInlineAddRow(group.id, null, 0));
        } else if (addingTaskGroupId !== group.id || addingTaskParentCode !== null || addingTaskAfterCode !== null || beforeRowRendered) {
          result.push(renderGroupEndDropZone(group.id));
        }
      });

      // Inline adding or hover add trigger at the end of the phase
      if (groupsInPhase.length > 0) {
        if (addingTaskGroupPhaseId === phase.id) {
          const nextIndex = to_roman(groupsInPhase.length + 1);
          result.push(renderInlineAddGroupRow(phase.id, nextIndex));
        } else {
          result.push(renderPhaseEndDropZone(phase.id));
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
      {!isFullscreen && !taskFocusMode && <Navbar />}

      <div className={`flex-1 min-w-0 ${(isFullscreen || taskFocusMode) ? 'pl-0 pt-0' : `pl-0 ${sidebarCollapsed ? SIDEBAR_PAD_COLLAPSED : SIDEBAR_PAD_EXPANDED} pt-14 md:pt-0`} flex flex-col h-screen overflow-hidden transition-[padding] duration-200`}>

        {taskFocusMode ? (
          /* Task Focus Mode: minimal breadcrumb only, table gets the rest of the viewport */
          <div className="min-h-[44px] bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between gap-2 px-4 shrink-0 z-30">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[#565e74]">Dự án</span>
              <span className="text-[#c2c6d6]">/</span>
              <span className="font-bold text-[#0b1c30]">{project.name}</span>
              {activePhase !== 'ALL' && (
                <>
                  <span className="text-[#c2c6d6]">/</span>
                  <span className="text-[#0058be] font-semibold">{activePhase}</span>
                </>
              )}
            </div>
            <button
              onClick={() => setTaskFocusMode(false)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#eff4ff] border border-[#0058be]/20 hover:bg-[#eff4ff]/80 text-[#0058be] transition-all flex items-center gap-1.5"
            >
              <Minimize2 size={13} /> Thu nhỏ
            </button>
          </div>
        ) : (
        <>
        {/* TOP BAR / NAVIGATION HEADER - project identity (name/badges) sống duy nhất ở đây, không lặp lại bên dưới */}
        <div className="min-h-[52px] bg-white border-b border-[#c2c6d6]/60 flex flex-wrap items-center justify-between gap-2 px-4 md:px-8 py-2 md:py-0 shrink-0 z-30">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <span className="text-[#565e74] hover:text-[#0058be] cursor-pointer text-xs font-semibold shrink-0" onClick={() => router.push('/project-hub')}>Dự án</span>
            <span className="text-[#c2c6d6] text-xs shrink-0">/</span>
            <span className="text-sm font-bold text-[#0b1c30] truncate">{project.name}</span>
            {project.customer_name && (
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold border border-slate-200 flex items-center gap-1.5 shadow-xs shrink-0">
                <Building2 size={12} /> {project.customer_name}
              </span>
            )}
            <span className="px-2.5 py-0.5 rounded-full bg-[#eff4ff] text-[#1d4ed8] text-[10px] font-bold uppercase border border-[#0058be]/10 shrink-0">
              Phase {project.current_phase || '1. Tư vấn'}
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-slate-50 text-[#565e74] text-[10px] font-semibold border border-slate-200 shrink-0">
              Năm: {project.project_code || 'Chưa cấu hình'}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap shrink-0">
            {project && (
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${project.ai_status === 'NEED_RECHECK'
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
              onClick={handleOpenAIReviewDrawerForContext}
              className="text-xs font-bold px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-1.5 transition-all"
            >
              <Sparkles size={14} /> AI Review
            </button>

            <button onClick={() => reloadAll()} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#eff4ff] border border-[#0058be]/20 hover:bg-[#eff4ff]/80 text-[#0058be] transition-all flex items-center gap-1.5">
              <RotateCcw size={14} /> Tải lại
            </button>

            <button onClick={() => setIsFullscreen(f => !f)} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#eff4ff] border border-[#0058be]/20 hover:bg-[#eff4ff]/80 text-[#0058be] transition-all">
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>

            {isProjectManager && (
              <button
                onClick={() => setShowEditProjectModal(true)}
                className="text-xs font-bold px-4 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 shadow-sm transition-all flex items-center gap-1.5"
              >
                <Pencil size={14} />
                Chỉnh sửa dự án
              </button>
            )}
          </div>
        </div>
        </>
        )}

        {/* MAIN CONTAINER — non-Task tabs use overflow-y-auto here for normal
            whole-panel page scrolling. The Tasks tab is the exception: this
            container must NOT scroll itself (no overflow-y-auto, min-h-0 +
            overflow-hidden instead) so it stays exactly h-screen-bounded and
            delegates ALL scrolling to the innermost task-table-scroll region
            further down - otherwise this div (which spans nearly the full
            viewport below the header) becomes its own competing scrollbar,
            dragging Tab Navigation + Phase toolbar along with it instead of
            keeping them pinned. */}
        <div className={`flex-1 min-w-0 p-4 md:p-6 ${activeMainTab === 'tasks' ? 'flex flex-col overflow-hidden min-h-0 space-y-0' : 'overflow-y-auto space-y-6'}`}>
          {msg && (
            // z-[1000] - PHẢI cao hơn mọi drawer full-screen (Task Edit/Leader
            // Review Detail/AI Review đều z-50) VÀ mọi modal (z-[999], vd
            // Xóa Phase/Task Group, Thêm/Sửa Task Group...) để toast không
            // bao giờ bị đè khuất phía sau khi 1 drawer/modal đang mở lúc
            // flash() được gọi (vd validate lỗi hoặc save thành công mà
            // drawer/modal vẫn ở lại mở).
            <div className={`fixed top-4 right-4 z-[1000] p-3 rounded-lg text-xs font-semibold shadow-xl border ${msg.e ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
              {msg.t}
            </div>
          )}

          {moveUndo && (
            <div className="fixed top-20 right-4 z-[100] p-3 rounded-lg text-xs font-semibold shadow-xl border bg-white text-[#0b1c30] border-slate-200 flex items-center gap-3">
              <span>{moveUndo.message}</span>
              <button onClick={handleUndoTaskMove} className="text-[#0058be] font-bold hover:underline shrink-0">
                Hoàn tác
              </button>
            </div>
          )}

          {!taskFocusMode && (
          <>

          {/* TAB NAVIGATION - khi ở Tasks, gộp luôn Search/Bộ lọc/Cột/+Thêm task vào
              cùng hàng này (bên phải) cho gọn, thay vì có riêng 1 hàng ngay dưới. */}
          <div className={`border-b border-[#c2c6d6]/60 flex items-center justify-between gap-3 ${activeMainTab === 'tasks' ? 'shrink-0' : ''}`}>
          <div className="flex space-x-4 sm:space-x-8 overflow-x-auto">
            <button
              onClick={() => router.push(`/project/detail/overview?id=${id}`)}
              className={`px-1 py-2 border-b-2 font-medium flex items-center text-[13px] transition-all whitespace-nowrap shrink-0 ${activeMainTab === 'overview' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">dashboard</span>
              Overview
            </button>
            <button
              onClick={() => router.push(`/project/detail/tasks?id=${id}`)}
              className={`px-1 py-2 border-b-2 font-medium flex items-center text-[13px] transition-all whitespace-nowrap shrink-0 ${activeMainTab === 'tasks' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">task</span>
              Tasks
            </button>
            <button
              onClick={() => router.push(`/project/detail/meetings?id=${id}`)}
              className={`px-1 py-2 border-b-2 font-medium flex items-center text-[13px] transition-all whitespace-nowrap shrink-0 ${activeMainTab === 'meetings' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">meeting_room</span>
              Meetings
            </button>
            <button
              onClick={() => router.push(`/project/detail/chats?id=${id}`)}
              className={`px-1 py-2 border-b-2 font-medium flex items-center text-[13px] transition-all whitespace-nowrap shrink-0 ${activeMainTab === 'chats' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">chat</span>
              Chats
            </button>
            <button
              onClick={() => router.push(`/project/detail/members?id=${id}`)}
              className={`px-1 py-2 border-b-2 font-medium flex items-center text-[13px] transition-all whitespace-nowrap shrink-0 ${activeMainTab === 'members' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">groups</span>
              Members
            </button>
            {isAdmin() && (
              <button
                onClick={() => router.push(`/project/detail/audit-logs?id=${id}`)}
                className={`px-1 py-2 border-b-2 font-medium flex items-center text-[13px] transition-all whitespace-nowrap shrink-0 ${activeMainTab === 'audit_logs' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                  }`}
              >
                <span className="material-symbols-outlined mr-2 text-[18px]">history</span>
                Audit Logs
              </button>
            )}
            <button
              onClick={() => router.push(`/project/detail/resources?id=${id}`)}
              className={`px-1 py-2 border-b-2 font-medium flex items-center text-[13px] transition-all whitespace-nowrap shrink-0 ${activeMainTab === 'resources' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">folder_open</span>
              Resources
            </button>
            <button
              onClick={() => router.push(`/project/detail/prototype?id=${id}`)}
              className={`px-1 py-2 border-b-2 font-medium flex items-center text-[13px] transition-all whitespace-nowrap shrink-0 ${activeMainTab === 'prototype' ? 'border-[#0058be] text-[#0058be]' : 'border-transparent text-[#565e74] hover:text-[#0b1c30]'
                }`}
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">science</span>
              Prototype
            </button>
          </div>

          {activeMainTab === 'tasks' && (
          <div className="flex gap-2 items-center shrink-0 pb-1.5">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8b93a3] pointer-events-none" />
              <input value={taskSearch} onChange={e => setTaskSearch(e.target.value)}
                placeholder="Tìm kiếm..."
                className="bg-white border border-[#D9DEE7] rounded-[8px] h-9 pl-8 pr-3 text-[12.5px] text-[#0b1c30] outline-none w-[220px] focus:border-[#0058be] placeholder:text-[12px] placeholder-[#8b93a3] transition-colors" />
            </div>
            {taskSearch && (
              <button onClick={() => setTaskSearch('')} className="text-red-600 text-xs hover:underline mr-1">Xóa</button>
            )}
            {memberFilterParam && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-lg text-[11px] font-bold text-blue-700 shrink-0">
                Đang lọc: {memberFilterParam}
                <button
                  onClick={() => router.push(`/project/detail/tasks?id=${id}`)}
                  className="text-blue-400 hover:text-blue-700 cursor-pointer"
                  title="Bỏ lọc, xem tất cả task"
                >
                  ✕
                </button>
              </span>
            )}

            {/* Bộ lọc - primary filter UX, dùng chung state với per-column filter */}
            <div className="relative">
              {(() => {
                const activeFilterCount = [priorityFilter, statusFilter, assignedFilter, supportFilter, skillSolutionFilter, skillVendorFilter].filter(f => f !== 'All').length;
                return (
                  <button
                    ref={filterPopoverBtnRef}
                    onClick={() => setFilterPopoverOpen(!filterPopoverOpen)}
                    className={`h-9 px-3 rounded-[8px] text-[13px] font-semibold border transition-all flex items-center gap-1.5 active:scale-95 whitespace-nowrap ${
                      activeFilterCount > 0
                        ? 'bg-blue-50 border-blue-200 text-[#0058be]'
                        : 'bg-white border-[#D9DEE7] text-[#565e74] hover:bg-slate-50'
                    }`}
                    title="Bộ lọc"
                  >
                    <Filter size={15} />
                    Bộ lọc
                    {activeFilterCount > 0 && (
                      <span className="bg-[#0058be] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>
                    )}
                  </button>
                );
              })()}
              <FloatingDropdown
                anchorEl={filterPopoverBtnRef.current}
                open={filterPopoverOpen}
                onClose={() => setFilterPopoverOpen(false)}
                align="right"
                className="bg-white border border-slate-200 rounded-lg shadow-lg w-[280px] py-2.5"
              >
                <div className="px-3.5 pb-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bộ lọc</span>
                </div>
                {[
                  { label: 'Priority', value: priorityFilter, set: setPriorityFilter, options: ['All', 'Normal', 'High', 'Critical', 'Interrupt'] },
                  { label: 'Status', value: statusFilter, set: setStatusFilter, options: ['All', 'Waiting', 'Process', 'Done', 'Rework', 'Cancel'] },
                  { label: 'Assigned', value: assignedFilter, set: setAssignedFilter, options: ['All', ...Array.from(new Set(items.map(t => t.assigned_name).filter(Boolean))).sort()] },
                  { label: 'Support', value: supportFilter, set: setSupportFilter, options: ['All', ...Array.from(new Set(items.map(t => t.support_name).filter(Boolean))).sort()] },
                  { label: 'Skill Area', value: skillSolutionFilter, set: setSkillSolutionFilter, options: buildSkillAreaFilterOptions() },
                  { label: 'Skill', value: skillVendorFilter, set: setSkillVendorFilter, options: buildSkillFilterOptions() },
                ].map(f => (
                  <div key={f.label} className="px-3.5 py-1.5 flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-[#0b1c30]">{f.label}</span>
                    <select
                      value={f.value}
                      onChange={e => f.set(e.target.value)}
                      className="text-[12px] border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-[#0058be] bg-white text-[#0b1c30] max-w-[140px]"
                    >
                      {f.options.map(opt => {
                        const o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
                        return <option key={o.value} value={o.value}>{o.label}</option>;
                      })}
                    </select>
                  </div>
                ))}
                <div className="px-3.5 pt-1.5 mt-1 border-t border-slate-100">
                  <button
                    onClick={() => {
                      setPriorityFilter('All'); setStatusFilter('All'); setAssignedFilter('All');
                      setSupportFilter('All'); setSkillSolutionFilter('All'); setSkillVendorFilter('All');
                    }}
                    className="text-[11px] font-semibold text-[#0058be] hover:underline flex items-center gap-1 pt-1"
                  >
                    <RotateCcw size={13} />
                    Đặt lại
                  </button>
                </div>
              </FloatingDropdown>
            </div>

            {/* Cột (cột hiển thị + thứ tự + độ rộng + ghim + mật độ hàng) */}
            <div className="relative">
              <button
                ref={columnMenuBtnRef}
                onClick={() => setColumnMenuOpen(!columnMenuOpen)}
                className={`h-9 px-3 rounded-[8px] text-[13px] font-semibold border transition-all flex items-center gap-1 active:scale-95 whitespace-nowrap ${
                  hiddenColumns.length > 0
                    ? 'bg-blue-50 border-blue-200 text-[#0058be]'
                    : 'bg-white border-[#D9DEE7] text-[#565e74] hover:bg-slate-50'
                }`}
                title="Tuỳ chỉnh cột của bảng"
              >
                <Columns3 size={15} />
                Cột
                {hiddenColumns.length > 0 && (
                  <span className="bg-[#0058be] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{hiddenColumns.length}</span>
                )}
                <ChevronDown size={15} />
              </button>
              <FloatingDropdown
                anchorEl={columnMenuBtnRef.current}
                open={columnMenuOpen}
                onClose={() => setColumnMenuOpen(false)}
                align="right"
                className="bg-white border border-slate-200 rounded-lg shadow-lg w-[300px] max-h-[28rem] overflow-auto"
              >
                  <div className="px-3.5 pt-3 pb-2.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cột hiển thị</span>
                    <div className="relative mt-2">
                      <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={columnSearch}
                        onChange={e => setColumnSearch(e.target.value)}
                        placeholder="Tìm cột..."
                        className="w-full h-[34px] pl-7 pr-2 text-[12px] border border-slate-200 rounded-md outline-none focus:border-[#0058be]"
                      />
                    </div>
                  </div>
                  <div className="py-1 border-t border-slate-100">
                    {TASK_COLUMNS.filter(col => col.toLowerCase().includes(columnSearch.trim().toLowerCase())).map(col => {
                      const locked = LOCKED_COLUMNS.includes(col);
                      const checked = !hiddenColumns.includes(col);
                      return (
                        <label
                          key={col}
                          className={`flex items-center gap-2.5 px-3.5 h-8 text-[12px] ${locked ? 'text-slate-400 cursor-not-allowed' : 'text-[#0b1c30] hover:bg-slate-50 cursor-pointer'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={() => toggleColumnVisibility(col)}
                            className="accent-[#0058be]"
                          />
                          {col}
                          {locked && <Lock size={11} className="text-slate-300 ml-auto" />}
                        </label>
                      );
                    })}
                  </div>
                  <div className="px-3.5 py-3 border-t border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mật độ hàng</span>
                    <div className="flex items-center gap-0.5 mt-2 bg-slate-100 rounded-[8px] p-0.5">
                      {([['compact', 'Gọn'], ['normal', 'Vừa'], ['spacious', 'Rộng']] as const).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setRowDensity(val)}
                          className={`flex-1 h-7 rounded-[6px] text-[12px] font-medium transition-all ${rowDensity === val ? 'bg-white text-[#0058be] font-semibold shadow-sm' : 'text-[#565e74] hover:text-[#0b1c30]'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-3.5 py-2.5 border-t border-slate-100">
                    <button
                      onClick={resetColumnVisibility}
                      className="text-[11px] font-semibold text-[#0058be] hover:underline flex items-center gap-1"
                    >
                      <RotateCcw size={13} />
                      Khôi phục mặc định
                    </button>
                  </div>
              </FloatingDropdown>
            </div>

            {/* Leader Review - attention queue (overdue/blocked/unassigned/need
                review), mở panel Leader Review bên phải. Chỉ Super Admin / Leader
                mới thấy. Chuyển lên toolbar phía trên (hàng Tab Navigation) thay vì
                nằm trong hàng Phase - "+ Tạo task mới" dời xuống cuối hàng Phase
                để đổi chỗ, xem block đó bên dưới. */}
            {!isMember() && (
            <button
              onClick={() => {
                if (leaderReviewOpen) closeLeaderReviewPanel();
                else setLeaderReviewOpen(true);
              }}
              className={`h-9 px-3 rounded-[8px] text-[13px] font-semibold border transition-all flex items-center gap-1.5 active:scale-95 whitespace-nowrap shrink-0 ${
                leaderReviewOpen
                  ? 'bg-amber-100 border-amber-300 text-amber-800'
                  : attentionTasks.length > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                    : 'bg-white border-[#D9DEE7] text-[#8b93a3] hover:bg-slate-50'
              }`}
              title="Leader Review - việc cần chú ý"
            >
              <AlertTriangle size={15} />
              Leader Review
              {attentionTasks.length > 0 && (
                <span className="bg-amber-600 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                  {attentionTasks.length}
                </span>
              )}
            </button>
            )}
          </div>
          )}
          </div>
          </>
          )}

          {/* MAIN TABS CONTENT AREA */}
          <div className="w-full">

            {/* LEFT COLUMN: ACTIVE TAB WORKSPACE */}
            <div className="space-y-6">

              {/* TAB: OVERVIEW */}
              {activeMainTab === 'overview' && (
                <div className="space-y-6">

                  {/* TIME FILTER BAR (Identical to Dashboard) */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#0058be] text-xl">filter_alt</span>
                      <span className="text-sm font-bold text-slate-800">Bộ lọc thời gian dự án:</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Dropdown Năm */}
                      <select
                        value={overviewYear}
                        onChange={(e) => setOverviewYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                        className="bg-slate-50 border border-slate-300 text-slate-700 text-xs rounded-lg px-2.5 py-1.5 font-medium focus:ring-1 focus:ring-blue-500 outline-none"
                      >
                        <option value="all">Tất cả các năm</option>
                        <option value={2024}>Năm 2024</option>
                        <option value={2025}>Năm 2025</option>
                        <option value={2026}>Năm 2026</option>
                      </select>

                      {/* Dropdown Tháng */}
                      <select
                        value={overviewMonth}
                        onChange={(e) => setOverviewMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                        className="bg-slate-50 border border-slate-300 text-slate-700 text-xs rounded-lg px-2.5 py-1.5 font-medium focus:ring-1 focus:ring-blue-500 outline-none"
                      >
                        <option value="all">Tất cả các tháng</option>
                        {Array.from({ length: 12 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>
                        ))}
                      </select>

                      {/* Dropdown Tuần */}
                      <select
                        value={overviewWeek}
                        onChange={(e) => setOverviewWeek(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                        className="bg-slate-50 border border-slate-300 text-slate-700 text-xs rounded-lg px-2.5 py-1.5 font-medium focus:ring-1 focus:ring-blue-500 outline-none"
                      >
                        <option value="all">Tất cả các tuần</option>
                        <option value={1}>Tuần 1</option>
                        <option value={2}>Tuần 2</option>
                        <option value={3}>Tuần 3</option>
                        <option value={4}>Tuần 4</option>
                        <option value={5}>Tuần 5</option>
                      </select>

                      <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block"></div>

                      {/* Nút lọc nhanh */}
                      <div className="flex items-center gap-1">
                        {[
                          { key: 'all', label: 'Tất cả' },
                          { key: 'Tuần trước', label: 'Tuần trước' },
                          { key: 'Tuần này', label: 'Tuần này' },
                          { key: 'Tuần tới', label: 'Tuần tới' },
                          { key: 'Tháng trước', label: 'Tháng trước' },
                          { key: 'Tháng này', label: 'Tháng này' },
                          { key: 'Tháng tới', label: 'Tháng tới' },
                        ].map((btn) => {
                          const isActive = overviewQuickFilter === btn.key;
                          return (
                            <button
                              key={btn.key}
                              onClick={() => applyOverviewQuickFilter(btn.key)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                isActive
                                  ? 'bg-[#0058be] text-white shadow-sm'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {btn.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* SUB-TAB: Tổng quan / Chi tiết */}
                  <div className="border-b border-slate-200 flex items-center gap-6">
                    <button
                      onClick={() => setOverviewSubTab('summary')}
                      className={`h-9 text-[13px] transition-all whitespace-nowrap border-b-2 ${overviewSubTab === 'summary'
                        ? 'text-[#0058be] font-semibold border-[#0058be]'
                        : 'text-[#565e74] font-medium border-transparent hover:text-[#0b1c30]'
                        }`}
                    >
                      Tổng quan
                    </button>
                    <button
                      onClick={() => setOverviewSubTab('detail')}
                      className={`h-9 text-[13px] transition-all whitespace-nowrap border-b-2 ${overviewSubTab === 'detail'
                        ? 'text-[#0058be] font-semibold border-[#0058be]'
                        : 'text-[#565e74] font-medium border-transparent hover:text-[#0b1c30]'
                        }`}
                    >
                      Chi tiết
                    </button>
                  </div>

                  {overviewSubTab === 'summary' && (
                  <>
                  {/* 5 METRIC CARDS */}
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

                    {/* Thẻ 5: Critical trong kỳ */}
                    <div className="bg-white p-5 rounded-xl border border-emerald-200 border-2 shadow-sm transition-transform hover:-translate-y-0.5">
                      <p className="text-[10px] text-emerald-700 uppercase font-bold tracking-wider">Critical Trong Kỳ</p>
                      <div className="flex items-baseline justify-between mt-1">
                        <span className="text-2xl font-bold text-emerald-600">{kpiCriticalThisWeek}</span>
                        <span className="material-symbols-outlined text-emerald-500 text-[18px]">priority_high</span>
                      </div>
                      <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden">
                        <div className="bg-emerald-500 h-full" style={{ width: `${kpiTotal > 0 ? (kpiCriticalThisWeek / kpiTotal) * 100 : 0}%` }}></div>
                      </div>
                    </div>
                  </div>

                  {/* ROW: Tiến độ theo Phase | Phân bổ task theo trạng thái | Khối lượng theo thành viên */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
                    {/* TIẾN ĐỘ THEO PHASE */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider flex items-center gap-2">
                          <Layers size={14} className="text-[#0058be]" />
                          Tiến độ theo Phase
                        </h3>
                        {overviewPhaseProgress.length > 8 && (
                          <button onClick={() => setShowAllOverviewPhases(!showAllOverviewPhases)} className="text-[11px] text-[#0058be] hover:underline font-semibold">
                            {showAllOverviewPhases ? 'Thu gọn' : 'Xem tất cả'}
                          </button>
                        )}
                      </div>
                      {overviewPhaseProgress.length === 0 ? (
                        <p className="text-xs text-slate-500 italic text-center py-6">Chưa có Phase nào.</p>
                      ) : (
                        <div className="space-y-3">
                          {(showAllOverviewPhases ? overviewPhaseProgress : overviewPhaseProgress.slice(0, 8)).map(ph => (
                            <div key={ph.id}>
                              <div className="flex items-center justify-between text-[12px] mb-1">
                                <span className="font-semibold text-[#0b1c30] truncate max-w-[55%]" title={ph.name}>{ph.name}</span>
                                <span className="text-slate-500 shrink-0">{ph.done}/{ph.total} · {ph.percent}%</span>
                              </div>
                              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${ph.percent === 100 ? 'bg-emerald-500' : 'bg-[#0058be]'}`} style={{ width: `${ph.percent}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* PHÂN BỔ TASK THEO TRẠNG THÁI */}
                    <OverviewDonutCard
                      title="Phân bổ task theo trạng thái"
                      centerLabel="Tasks"
                      data={[
                        { name: 'Hoàn thành', value: overviewStatusDistribution.done, fill: '#10b981' },
                        { name: 'Đang thực hiện', value: overviewStatusDistribution.inProgress, fill: '#3b82f6' },
                        { name: 'Chờ xử lý', value: overviewStatusDistribution.waiting, fill: '#cbd5e1' },
                        { name: 'Trễ hạn', value: overviewStatusDistribution.overdue, fill: '#ef4444' },
                      ]}
                    />

                    {/* KHỐI LƯỢNG CÔNG VIỆC THEO THÀNH VIÊN */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider flex items-center gap-2">
                          <Users size={14} className="text-[#0058be]" />
                          Khối lượng công việc theo thành viên
                        </h3>
                        {overviewMemberWorkload.length > 8 && (
                          <button onClick={() => setShowAllOverviewWorkload(!showAllOverviewWorkload)} className="text-[11px] text-[#0058be] hover:underline font-semibold">
                            {showAllOverviewWorkload ? 'Thu gọn' : 'Xem tất cả'}
                          </button>
                        )}
                      </div>
                      {overviewMemberWorkload.length === 0 ? (
                        <p className="text-xs text-slate-500 italic text-center py-6">Chưa có thành viên nào được giao task.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[12px] text-left border-collapse">
                            <thead>
                              <tr className="text-slate-400 uppercase text-[9px] font-extrabold tracking-wider border-b border-slate-100">
                                <th className="py-1.5 pr-2">Thành viên</th>
                                <th className="py-1.5 px-2 text-center">Tổng</th>
                                <th className="py-1.5 px-2 text-center">Hoàn thành</th>
                                <th className="py-1.5 px-2 text-center">Đang làm</th>
                                <th className="py-1.5 pl-2 text-center">Trễ hạn</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {(showAllOverviewWorkload ? overviewMemberWorkload : overviewMemberWorkload.slice(0, 8)).map(m => {
                                const initials = m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                                return (
                                  <tr key={m.name}>
                                    <td className="py-2 pr-2">
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-5 h-5 rounded-full bg-blue-100 text-[#0058be] flex items-center justify-center text-[9px] font-extrabold shrink-0">{initials}</div>
                                        <span className="font-semibold text-[#0b1c30] truncate max-w-[110px]" title={m.name}>{m.name}</span>
                                      </div>
                                    </td>
                                    <td className="py-2 px-2 text-center font-bold text-[#0b1c30]">{m.total}</td>
                                    <td className="py-2 px-2 text-center text-emerald-600 font-semibold">{m.done}</td>
                                    <td className="py-2 px-2 text-center text-blue-600 font-semibold">{m.inProgress}</td>
                                    <td className="py-2 pl-2 text-center text-red-600 font-semibold">{m.overdue}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ROW: Task theo Priority | Task theo loại | Hoạt động gần đây | Cần chú ý */}
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-stretch">
                    <OverviewDonutCard
                      title="Task theo Priority"
                      centerLabel="Tasks"
                      data={[
                        { name: 'Critical', value: overviewPriorityDistribution.Critical, fill: '#a855f7' },
                        { name: 'High', value: overviewPriorityDistribution.High, fill: '#f97316' },
                        { name: 'Normal', value: overviewPriorityDistribution.Normal, fill: '#3b82f6' },
                        { name: 'Interrupt', value: overviewPriorityDistribution.Interrupt, fill: '#6366f1' },
                      ]}
                    />

                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
                      <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-3">Task theo loại</h3>
                      {overviewSkillDistribution.length === 0 ? (
                        <p className="text-xs text-slate-500 italic text-center py-6 flex-1 flex items-center justify-center">Chưa có dữ liệu Skill Area.</p>
                      ) : (
                        <div className="space-y-2.5">
                          {overviewSkillDistribution.map(s => {
                            const max = overviewSkillDistribution[0]?.value || 1;
                            return (
                              <div key={s.name} className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-600 w-20 shrink-0 truncate" title={s.name}>{s.name}</span>
                                <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
                                  <div className="h-full bg-[#0058be] rounded" style={{ width: `${(s.value / max) * 100}%` }} />
                                </div>
                                <span className="text-[11px] font-bold text-[#0b1c30] w-6 text-right shrink-0">{s.value}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* HOẠT ĐỘNG GẦN ĐÂY */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Hoạt động gần đây</h3>
                        {overviewActivityItems.length > 0 && (
                          <button
                            onClick={() => router.push(`/project/detail/audit-logs?id=${id}`)}
                            className="text-[11px] text-[#0058be] hover:underline font-semibold"
                          >
                            Xem tất cả
                          </button>
                        )}
                      </div>
                      {overviewActivityItems.length === 0 ? (
                        <p className="text-xs text-slate-500 italic text-center py-6 flex-1 flex items-center justify-center">Chưa có hoạt động nào.</p>
                      ) : (
                        <div className="space-y-3">
                          {(showAllOverviewActivity ? overviewActivityItems : overviewActivityItems.slice(0, 4)).map(a => (
                            <div key={a.id} className="flex items-start gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[9px] font-extrabold shrink-0 mt-0.5">
                                {(a.user_name || '??').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[12px] text-[#0b1c30] leading-snug">
                                  <span className="font-semibold">{a.user_name}</span>{' '}
                                  <span className="text-slate-600">{a.description || a.action}</span>
                                </p>
                                <p className="text-[10.5px] text-slate-400 mt-0.5 flex items-center gap-1">
                                  <Clock size={10} /> {formatTimeAgo(a.created_at)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* CẦN CHÚ Ý */}
                    <div className="bg-white rounded-xl border border-red-100 shadow-sm p-5 h-full flex flex-col">
                      <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <AlertTriangle size={14} />
                        Cần chú ý
                      </h3>
                      <div className="space-y-1.5">
                        <button
                          onClick={() => setOverviewSubTab('detail')}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-red-50/40 hover:bg-red-50 transition-colors text-left"
                        >
                          <span className="text-[12px] text-[#0b1c30]">{kpiWarning} task trễ hạn</span>
                          <ArrowRight size={13} className="text-red-500 shrink-0" />
                        </button>
                        <button
                          onClick={() => setOverviewSubTab('detail')}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-red-50/40 hover:bg-red-50 transition-colors text-left"
                        >
                          <span className="text-[12px] text-[#0b1c30]">{kpiCriticalThisWeek} task critical trong kỳ</span>
                          <ArrowRight size={13} className="text-red-500 shrink-0" />
                        </button>
                        <div className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-red-50/40">
                          <span className="text-[12px] text-[#0b1c30]">{overviewUnassignedCount} task chưa assign</span>
                          <UserX size={13} className="text-red-500 shrink-0" />
                        </div>
                        <div className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-red-50/40">
                          <span className="text-[12px] text-[#0b1c30]">{overviewMembersWithOverdue} thành viên có task trễ</span>
                          <Users size={13} className="text-red-500 shrink-0" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* TASK GẦN ĐÂY */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                      <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Task gần đây</h3>
                      <button
                        onClick={() => router.push(`/project/detail/tasks?id=${id}`)}
                        className="text-[11px] text-[#0058be] hover:underline font-semibold flex items-center gap-1"
                      >
                        Xem tất cả <ArrowRight size={12} />
                      </button>
                    </div>
                    {overviewRecentTasks.length === 0 ? (
                      <p className="text-xs text-slate-500 italic text-center py-6">Chưa có task nào.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px] text-left border-collapse">
                          <thead>
                            <tr className="text-slate-400 uppercase text-[9px] font-extrabold tracking-wider bg-slate-50 border-b border-slate-100">
                              <th className="px-4 py-2">Task ID</th>
                              <th className="px-4 py-2">Tên task</th>
                              <th className="px-4 py-2">Priority</th>
                              <th className="px-4 py-2">Status</th>
                              <th className="px-4 py-2">Assigned</th>
                              <th className="px-4 py-2">Start date</th>
                              <th className="px-4 py-2">End date (est)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {overviewRecentTasks.map((t: any) => {
                              const prio = (t.priority || 'Normal').toUpperCase();
                              return (
                                <tr key={t.id} className="hover:bg-slate-50/60">
                                  <td className="px-4 py-2.5 font-mono text-[#0058be] font-semibold whitespace-nowrap">{t.task_code || t.id}</td>
                                  <td className="px-4 py-2.5 max-w-[280px] truncate" title={t.detail || t.detail_task}>{t.detail || t.detail_task}</td>
                                  <td className="px-4 py-2.5 whitespace-nowrap">
                                    <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase ${prio === 'CRITICAL' ? 'bg-purple-100 text-purple-700' :
                                      prio === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                        prio === 'INTERRUPT' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'
                                      }`}>{prio}</span>
                                  </td>
                                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{t.status || 'Waiting'}</td>
                                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">{t.assigned_name || <span className="text-slate-400 italic">Chưa giao</span>}</td>
                                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{t.start_date ? formatDateToShow(t.start_date) : '—'}</td>
                                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{t.end_date_est ? formatDateToShow(t.end_date_est) : '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  </>
                  )}

                  {overviewSubTab === 'detail' && (
                  <>
                  {/* HEADER Báo cáo chi tiết */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[#0b1c30] flex items-center gap-2">
                        <BarChart3 size={16} className="text-[#0058be]" />
                        Báo cáo chi tiết
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">Kế hoạch so với thực tế, phân tích Implement/Maintenance, nhân sự và các vấn đề cần xử lý</p>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                      Số liệu tự động lọc theo bộ lọc thời gian
                    </span>
                  </div>

                  {/* ROW: Thời gian | Manday | Task | KPI - kế hoạch vs thực tế */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
                    {(() => {
                      const durDelta = summaryProjectStats.durationAct.total - summaryProjectStats.durationEst.total;
                      const mdDelta = summaryProjectStats.mandayAct.total - summaryProjectStats.mandayEst.total;
                      const mdVariancePct = summaryProjectStats.mandayEst.total > 0
                        ? Math.round((mdDelta / summaryProjectStats.mandayEst.total) * 100)
                        : 0;
                      const DeltaLine = ({ delta, unit, goodIsNegative = true }: { delta: number; unit: string; goodIsNegative?: boolean }) => {
                        const isGood = goodIsNegative ? delta <= 0 : delta >= 0;
                        const Icon = delta === 0 ? Minus : (delta > 0 ? ArrowUpRight : ArrowDownRight);
                        return (
                          <div className={`mt-auto pt-2 text-[11px] font-semibold flex items-center gap-1 ${delta === 0 ? 'text-slate-400' : isGood ? 'text-emerald-600' : 'text-red-600'}`}>
                            <Icon size={13} />
                            Chênh lệch {delta > 0 ? '+' : ''}{delta}{unit}
                          </div>
                        );
                      };
                      return (
                        <>
                          {/* THỜI GIAN */}
                          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Thời gian (ngày)</h4>
                            <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                              <span className="text-slate-500">Kế hoạch</span><span className="font-bold text-[#0b1c30]">{summaryProjectStats.durationEst.total}</span>
                            </div>
                            <div className="flex items-center justify-between text-[12.5px]">
                              <span className="text-slate-500">Thực tế</span><span className="font-bold text-[#0b1c30]">{summaryProjectStats.durationAct.total}</span>
                            </div>
                            <DeltaLine delta={durDelta} unit=" ngày" />
                          </div>

                          {/* MANDAY */}
                          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Manday</h4>
                            <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                              <span className="text-slate-500">Kế hoạch</span><span className="font-bold text-[#0b1c30]">{summaryProjectStats.mandayEst.total}</span>
                            </div>
                            <div className="flex items-center justify-between text-[12.5px]">
                              <span className="text-slate-500">Thực tế</span><span className="font-bold text-[#0b1c30]">{summaryProjectStats.mandayAct.total}</span>
                            </div>
                            <DeltaLine delta={mdVariancePct} unit="%" />
                          </div>

                          {/* TASK */}
                          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Task</h4>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                              <div className="flex items-center justify-between"><span className="text-slate-500">Tổng</span><span className="font-bold text-[#0b1c30]">{summaryProjectStats.totalTasksCount.total}</span></div>
                              <div className="flex items-center justify-between"><span className="text-slate-500">Done</span><span className="font-bold text-emerald-600">{kpiDone}</span></div>
                              <div className="flex items-center justify-between"><span className="text-slate-500">Trễ</span><span className="font-bold text-red-600">{summaryProjectStats.overdueTasksCount.total}</span></div>
                              <div className="flex items-center justify-between"><span className="text-slate-500">Critical</span><span className="font-bold text-purple-600">{summaryProjectStats.criticalCount.total}</span></div>
                              <div className="flex items-center justify-between"><span className="text-slate-500">High</span><span className="font-bold text-amber-600">{summaryProjectStats.highCount.total}</span></div>
                              <div className="flex items-center justify-between"><span className="text-slate-500">Normal</span><span className="font-bold text-blue-600">{summaryProjectStats.normalCount.total}</span></div>
                            </div>
                          </div>

                          {/* KPI */}
                          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">KPI</h4>
                            <div className="flex items-baseline gap-1 mb-3">
                              <span className="text-2xl font-bold text-emerald-600">{summaryProjectStats.kpi.total}</span>
                              <span className="text-[11px] text-slate-400">điểm</span>
                            </div>
                            <div className="mt-auto grid grid-cols-2 gap-2 text-[11px]">
                              <div className="bg-amber-50 rounded-lg px-2.5 py-1.5">
                                <p className="text-amber-700 font-semibold">Implement</p>
                                <p className="font-bold text-amber-800">{summaryProjectStats.kpi.imp}</p>
                              </div>
                              <div className="bg-blue-50 rounded-lg px-2.5 py-1.5">
                                <p className="text-blue-700 font-semibold">Maintenance</p>
                                <p className="font-bold text-blue-800">{summaryProjectStats.kpi.main}</p>
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* PHÂN TÍCH THEO GIAI ĐOẠN IMPLEMENT / MAINTENANCE */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                    <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-3">Phân tích theo giai đoạn</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12.5px] text-left border-collapse">
                        <thead>
                          <tr className="text-slate-400 uppercase text-[9px] font-extrabold tracking-wider border-b border-slate-100">
                            <th className="py-2 pr-3">Chỉ số</th>
                            <th className="py-2 px-3 text-center bg-amber-50/60 rounded-t-md">Implement</th>
                            <th className="py-2 pl-3 text-center bg-blue-50/60 rounded-t-md">Maintenance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {[
                            { label: 'Thời gian ước tính (ngày)', imp: summaryProjectStats.durationEst.imp, main: summaryProjectStats.durationEst.main },
                            { label: 'Thời gian thực tế (ngày)', imp: summaryProjectStats.durationAct.imp, main: summaryProjectStats.durationAct.main },
                            { label: 'Manday ước tính', imp: summaryProjectStats.mandayEst.imp, main: summaryProjectStats.mandayEst.main },
                            { label: 'Manday thực tế', imp: summaryProjectStats.mandayAct.imp, main: summaryProjectStats.mandayAct.main },
                            { label: 'Số ngày trễ', imp: summaryProjectStats.overdueDays.imp, main: summaryProjectStats.overdueDays.main },
                            { label: 'Số task trễ', imp: summaryProjectStats.overdueTasksCount.imp, main: summaryProjectStats.overdueTasksCount.main },
                            { label: 'Tổng KPI', imp: summaryProjectStats.kpi.imp, main: summaryProjectStats.kpi.main },
                            { label: 'Tổng số task', imp: summaryProjectStats.totalTasksCount.imp, main: summaryProjectStats.totalTasksCount.main },
                            { label: 'Task Critical', imp: summaryProjectStats.criticalCount.imp, main: summaryProjectStats.criticalCount.main },
                            { label: 'Task High', imp: summaryProjectStats.highCount.imp, main: summaryProjectStats.highCount.main },
                            { label: 'Task Normal', imp: summaryProjectStats.normalCount.imp, main: summaryProjectStats.normalCount.main },
                          ].map(row => (
                            <tr key={row.label}>
                              <td className="py-2 pr-3 text-slate-600">{row.label}</td>
                              <td className="py-2 px-3 text-center font-bold text-[#0b1c30] bg-amber-50/30">{row.imp}</td>
                              <td className="py-2 pl-3 text-center font-bold text-[#0b1c30] bg-blue-50/30">{row.main}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* PHÂN TÍCH NHÂN SỰ: workload + KPI ranking */}
                  <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Phân tích nhân sự</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

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
                            <Trophy size={16} className="text-amber-500" />
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

                  {/* VẤN ĐỀ CẦN XỬ LÝ: overdue summary + bảng task trễ compact */}
                  <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">Vấn đề cần xử lý</h3>
                  <div className="bg-white border border-red-200 rounded-xl p-5 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between flex-wrap gap-2 border-b border-red-100 pb-3 mb-4">
                      <h4 className="text-sm font-bold text-red-600 flex items-center gap-2">
                        <AlertTriangle size={16} />
                        Task trễ hạn ({overdueTasksList.length})
                      </h4>
                      <span className="text-[11px] font-semibold text-red-500">
                        Tổng {summaryProjectStats.overdueDays.total} ngày trễ · Implement {summaryProjectStats.overdueDays.imp} · Maintenance {summaryProjectStats.overdueDays.main}
                      </span>
                    </div>

                    {overdueTasksList.length === 0 ? (
                        <p className="text-xs text-slate-500 italic text-center py-6">Không có task trễ hạn.</p>
                      ) : (
                        <div className="max-h-[320px] overflow-y-auto overflow-x-auto custom-scrollbar rounded-lg border border-slate-100">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                              <tr className="border-b border-slate-100 text-slate-400 uppercase text-[9px] font-extrabold tracking-wider bg-slate-50">
                                <th className="px-4 py-2 bg-slate-50">Tên Task</th>
                                <th className="px-4 py-2 bg-slate-50">Người phụ trách</th>
                                <th className="px-4 py-2 text-center bg-slate-50">Độ ưu tiên</th>
                                <th className="px-4 py-2 text-center bg-slate-50">Hạn chót</th>
                                <th className="px-4 py-2 text-center bg-slate-50">Số ngày trễ</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {overdueTasksList.map((t: any) => {
                                const prio = (t.priority || 'Normal').toUpperCase();
                                const rawDl = t.end_date_est || t.end_date || t.deadline || '';
                                const dlStr = rawDl ? formatDateToShow(rawDl) : '—';
                                const taskTitle = t.detail_task || t.detail || t.name || 'Nhiệm vụ không tên';
                                const initials = (t.assigned_name || '??').split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
                                return (
                                  <tr key={t.id} className="hover:bg-red-50/30 transition-colors">
                                    <td className="px-4 py-3 font-bold text-[#0b1c30] max-w-[320px] break-words leading-relaxed" title={taskTitle}>
                                      {taskTitle}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      {t.assigned_name ? (
                                        <div className="flex items-center gap-1.5">
                                          <div className="w-5 h-5 rounded-full bg-blue-100 text-[#0058be] flex items-center justify-center text-[9px] font-extrabold">
                                            {initials}
                                          </div>
                                          <span className="font-semibold text-slate-800">{t.assigned_name}</span>
                                        </div>
                                      ) : (
                                        <span className="text-slate-400 italic">Chưa giao</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                      <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase ${prio === 'CRITICAL' ? 'bg-purple-100 text-purple-700' :
                                          prio === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                            prio === 'INTERRUPT' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'
                                        }`}>
                                        {prio}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-center font-semibold text-slate-600 whitespace-nowrap">
                                      {dlStr}
                                    </td>
                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                      <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-200">
                                        Trễ {t.days_late} ngày
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                  )}
                </div>
              )}

              {/* TAB: TASKS */}
              {activeMainTab === 'tasks' && (
                <div className="flex-1 min-h-0 flex flex-col gap-2 mt-3">
                  {/* Phase Tabs + Search */}
                  <div className="flex items-center justify-between flex-nowrap gap-2 shrink-0">
                    <div ref={phaseNavContainerRef} className="flex items-center gap-4 h-9 flex-nowrap overflow-hidden flex-1 min-w-0">
                      {/* Master: luôn hiện, không tính vào cơ chế overflow */}
                      <div className="relative flex items-center gap-1 shrink-0 h-9">
                        <button onClick={() => setActivePhase('ALL')}
                          className={`h-9 text-[13px] transition-all whitespace-nowrap border-b-2 ${activePhase === 'ALL'
                            ? 'text-[#0058be] font-semibold border-[#0058be]'
                            : 'text-[#565e74] font-medium border-transparent hover:text-[#0b1c30]'
                            }`}>
                          Master
                        </button>
                      </div>
                      {visibleRealPhaseTabs.map(p => (
                        <div
                          key={p.key}
                          className={`relative group/phase flex items-center gap-1 shrink-0 h-9 ${draggingPhaseId === p.id ? 'opacity-40' : ''}`}
                          draggable={canManageProjectStructure(project) && reorderingPhaseId === null}
                          onDragStart={(e) => {
                            setDraggingPhaseId(p.id!);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(p.id));
                          }}
                          onDragOver={(e) => {
                            if (draggingPhaseId === null || draggingPhaseId === p.id) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            const rect = e.currentTarget.getBoundingClientRect();
                            const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                            setPhaseDropAtEnd(false);
                            setPhaseDropTarget({ id: p.id!, side });
                          }}
                          onDragLeave={() => {
                            setPhaseDropTarget(prev => (prev?.id === p.id ? null : prev));
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const target = phaseDropTarget;
                            if (draggingPhaseId !== null && target && target.id === p.id) {
                              commitPhaseReorder(draggingPhaseId, p.id!, target.side);
                            }
                            setDraggingPhaseId(null);
                            setPhaseDropTarget(null);
                          }}
                          onDragEnd={() => {
                            setDraggingPhaseId(null);
                            setPhaseDropTarget(null);
                            setPhaseDropAtEnd(false);
                          }}
                        >
                          {phaseDropTarget && phaseDropTarget.id === p.id && (
                            <span
                              className="absolute top-1 bottom-1 w-[3px] rounded-full bg-[#0058be] z-10"
                              style={phaseDropTarget.side === 'before' ? { left: -6 } : { right: -6 }}
                              aria-hidden="true"
                            />
                          )}
                          {/* Drag grip - chỉ hiện khi hover, không chiếm chỗ lúc bình thường */}
                          {canManageProjectStructure(project) && (
                            <span
                              className="opacity-0 group-hover/phase:opacity-100 transition-opacity text-slate-300 cursor-grab select-none text-[11px] -mr-1 tracking-[-2px]"
                              title="Kéo để đổi vị trí Phase"
                              aria-hidden="true"
                            >
                              ⋮⋮
                            </span>
                          )}
                          <button onClick={() => setActivePhase(p.key)}
                            title={p.label}
                            className={`h-9 max-w-[110px] truncate text-[13px] transition-all whitespace-nowrap border-b-2 ${activePhase === p.key
                              ? 'text-[#0058be] font-semibold border-[#0058be]'
                              : 'text-[#565e74] font-medium border-transparent hover:text-[#0b1c30]'
                              }`}>
                            {p.label}
                          </button>
                          {activePhase === p.key && !p.is_master && (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const key = `phase-${p.id}`;
                                  setHeaderMenuAnchorEl(e.currentTarget);
                                  setOpenHeaderMenu(openHeaderMenu === key ? null : key);
                                }}
                                className={`flex items-center justify-center w-7 h-7 rounded-full text-slate-400 bg-transparent hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:bg-slate-100 focus-visible:text-slate-600 transition-colors ${openHeaderMenu === `phase-${p.id}` ? 'bg-slate-100 text-slate-600' : ''}`}
                                title="Thao tác Phase"
                                aria-label="Thao tác Phase"
                              >
                                <MoreHorizontal size={14} />
                              </button>
                              <FloatingDropdown
                                anchorEl={headerMenuAnchorEl}
                                open={openHeaderMenu === `phase-${p.id}`}
                                onClose={() => setOpenHeaderMenu(null)}
                                className="bg-white border border-slate-200 rounded-lg shadow-lg w-[180px] py-1 text-left"
                              >
                                <button
                                  onClick={() => { setOpenHeaderMenu(null); handleOpenAIReviewDrawer('PHASE', p.id!, p.label); }}
                                  className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                                >
                                  <Sparkles size={15} className="text-indigo-600" />
                                  AI Check
                                </button>
                                {canManageProjectStructure(project) && (
                                  <button
                                    onClick={() => {
                                      setOpenHeaderMenu(null);
                                      setEditingPhaseId(p.id);
                                      setEditingPhaseName(p.label);
                                      setShowRenameModal(true);
                                    }}
                                    className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                                  >
                                    <Pencil size={15} className="text-slate-500" />
                                    Chỉnh sửa
                                  </button>
                                )}
                                {canManageProjectStructure(project) && (
                                  <button
                                    onClick={() => { setOpenHeaderMenu(null); handleOpenMovePhaseModal(p); }}
                                    className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                                  >
                                    <ArrowRightLeft size={15} className="text-slate-500" />
                                    Chuyển Project khác
                                  </button>
                                )}
                                {canManageProjectStructure(project) && <div className="my-1 border-t border-slate-100" />}
                                {canManageProjectStructure(project) && (
                                  <button
                                    onClick={() => { setOpenHeaderMenu(null); handleDeletePhase(p.id!, p.label); }}
                                    className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 size={15} />
                                    Xóa Phase
                                  </button>
                                )}
                              </FloatingDropdown>
                            </div>
                          )}
                        </div>
                      ))}

                      {overflowRealPhaseTabs.length > 0 && (
                        <div className="relative shrink-0">
                          <button
                            ref={phaseOverflowBtnRef}
                            onClick={() => setPhaseOverflowOpen(!phaseOverflowOpen)}
                            className={`h-7 px-2.5 rounded-[8px] text-[12.5px] font-semibold border transition-all flex items-center gap-1 whitespace-nowrap ${phaseOverflowOpen ? 'bg-slate-100 border-slate-300 text-[#0b1c30]' : 'bg-white border-[#D9DEE7] text-[#565e74] hover:bg-slate-50'}`}
                          >
                            Phase khác ({overflowRealPhaseTabs.length})
                            <ChevronDown size={14} />
                          </button>
                          <FloatingDropdown
                            anchorEl={phaseOverflowBtnRef.current}
                            open={phaseOverflowOpen}
                            onClose={() => setPhaseOverflowOpen(false)}
                            className="bg-white border border-slate-200 rounded-lg shadow-lg w-[280px] py-2"
                          >
                            <div className="px-3 pb-2">
                              <div className="relative">
                                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                  value={phaseOverflowSearch}
                                  onChange={e => setPhaseOverflowSearch(e.target.value)}
                                  placeholder="Tìm Phase..."
                                  className="w-full h-[34px] pl-7 pr-2 text-[12px] border border-slate-200 rounded-md outline-none focus:border-[#0058be]"
                                />
                              </div>
                              <p className="text-[10.5px] text-slate-400 mt-1.5 px-0.5">
                                Đã ghim {pinnedPhaseIds.length}/{MAX_PINNED_PHASES} Phase — ghim tối đa {MAX_PINNED_PHASES}, bỏ ghim bớt nếu muốn đổi.
                              </p>
                            </div>
                            <div className="max-h-[280px] overflow-auto border-t border-slate-100 py-1">
                              {realPhases
                                .filter(p => p.label.toLowerCase().includes(phaseOverflowSearch.trim().toLowerCase()))
                                .map(p => {
                                  const isPinned = pinnedPhaseIds.includes(p.id);
                                  const isActive = activePhase === p.key;
                                  const atCap = pinnedPhaseIds.length >= MAX_PINNED_PHASES && !isPinned;
                                  return (
                                    <div
                                      key={p.key}
                                      className={`flex items-center gap-2 px-3 h-9 text-[13px] cursor-pointer hover:bg-slate-50 ${isActive ? 'font-semibold text-[#0058be]' : 'text-[#0b1c30]'}`}
                                      onClick={() => { setActivePhase(p.key); setPhaseOverflowOpen(false); }}
                                    >
                                      <span className="truncate flex-1">{p.label}</span>
                                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#0058be] shrink-0" />}
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); togglePinPhase(p.id); }}
                                        className={`p-1 rounded hover:bg-slate-200 shrink-0 ${isPinned ? 'text-[#0058be]' : atCap ? 'text-slate-200' : 'text-slate-300'}`}
                                        title={isPinned ? 'Bỏ ghim Phase' : atCap ? `Đã ghim tối đa ${MAX_PINNED_PHASES} Phase` : 'Ghim Phase'}
                                      >
                                        {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
                                      </button>
                                    </div>
                                  );
                                })}
                            </div>
                          </FloatingDropdown>
                        </div>
                      )}

                      {/* "+" nằm NGAY TRONG phaseNavContainerRef (cùng hàng flex-nowrap
                          với Master/Phase tabs) để luôn dính sát Phase cuối cùng - trước
                          đây sống ngoài container nên bị flex-1 của container đẩy tới
                          tận mép phải hàng khi danh sách Phase ngắn hơn viewport, tạo
                          khoảng trắng lớn giữa Phase cuối và nút "+". Vẫn là drop-zone
                          "kéo tới cuối" - thả Phase đang kéo vào đây để đưa nó về cuối
                          danh sách Phase. */}
                      {canManageProjectStructure(project) && (
                        <button
                          onClick={() => {
                            setNewPhaseName('');
                            setShowPhaseModal(true);
                          }}
                          onDragOver={(e) => {
                            if (draggingPhaseId === null) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            setPhaseDropTarget(null);
                            setPhaseDropAtEnd(true);
                          }}
                          onDragLeave={() => setPhaseDropAtEnd(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggingPhaseId !== null) commitPhaseReorder(draggingPhaseId, 'end');
                            setDraggingPhaseId(null);
                            setPhaseDropAtEnd(false);
                          }}
                          className={`w-8 h-8 rounded-[8px] text-[#0058be] hover:bg-slate-100 transition-all flex items-center justify-center active:scale-95 shrink-0 ${phaseDropAtEnd ? 'ring-2 ring-[#0058be] bg-[#eef5ff]' : ''}`}
                          title="Tạo Phase mới · kéo Phase vào đây để đưa về cuối"
                          aria-label="Tạo Phase mới"
                        >
                          <Plus size={16} />
                        </button>
                      )}

                      {/* Lớp đo ẩn: đo width thật của từng Phase label (bị giới hạn max-w-[110px]
                          giống tab thật) để tính visiblePhaseCount ở trên - không ảnh hưởng layout. */}
                      <div style={{ position: 'absolute', visibility: 'hidden', height: 0, overflow: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none' }} aria-hidden="true">
                        {realPhases.map(p => (
                          <div
                            key={p.key}
                            ref={el => { phaseTabMeasureRefs.current[p.key] = el; }}
                            className="h-9 max-w-[110px] truncate text-[13px] font-semibold inline-flex items-center gap-1"
                          >
                            {p.label}
                            <span className="w-7 h-7 inline-block" />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* "⋯" gom Áp dụng template / Xuất thành Template - trước đây là
                        2 nút luôn hiện, giờ là thao tác phụ nên chuyển vào đây. Dùng
                        chung cơ chế openHeaderMenu/headerMenuAnchorEl với menu per-phase
                        và per-column, key riêng 'phase-toolbar'. */}
                    {(canApplyProjectTemplate(project) || isSuperAdmin()) && (
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            setHeaderMenuAnchorEl(e.currentTarget);
                            setOpenHeaderMenu(openHeaderMenu === 'phase-toolbar' ? null : 'phase-toolbar');
                          }}
                          className={`w-8 h-8 rounded-[8px] flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all active:scale-95 ${openHeaderMenu === 'phase-toolbar' ? 'bg-slate-100 text-slate-700' : ''}`}
                          title="Thao tác Template"
                          aria-label="Thao tác Template"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        <FloatingDropdown
                          anchorEl={headerMenuAnchorEl}
                          open={openHeaderMenu === 'phase-toolbar'}
                          onClose={() => setOpenHeaderMenu(null)}
                          align="right"
                          className="bg-white border border-slate-200 rounded-lg shadow-lg w-[240px] py-1"
                        >
                          {canApplyProjectTemplate(project) && (
                            <button
                              onClick={() => { setOpenHeaderMenu(null); handleOpenTemplateModal(); }}
                              className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                              title="Thay cấu trúc Phase và Task hiện tại bằng Project Template"
                            >
                              <LayoutTemplate size={15} className="text-slate-500" />
                              Áp dụng template
                            </button>
                          )}
                          {isSuperAdmin() && (
                            <button
                              onClick={() => { setOpenHeaderMenu(null); setShowExportTemplateModal(true); }}
                              className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                              title="Chọn Phase/Task Group/Task muốn tái sử dụng và tạo Project Template mới từ dự án này"
                            >
                              <FileOutput size={15} className="text-slate-500" />
                              Xuất thành Template
                            </button>
                          )}
                        </FloatingDropdown>
                      </div>
                    )}

                    {/* + Tạo task mới (split button: main = thêm task, dropdown = thêm
                        task / thêm group task) - dời xuống cuối hàng Phase (trước đây
                        ở hàng Tab Navigation); "Leader Review/Cần chú ý" đổi chỗ lên đó. */}
                    {canEditTask(project) && (
                    <div className="relative flex shrink-0">
                      <button
                        onClick={() => {
                          const currentPhaseGroups = activePhase === 'ALL'
                            ? taskGroups
                            : taskGroups.filter(g => {
                              const ph = phases.find(p => p.id === g.phase_id);
                              return ph && ph.name === activePhase;
                            });
                          if (currentPhaseGroups.length === 0) {
                            flash('Hãy tạo ít nhất một Task Group trước khi thêm Task!', true);
                            return;
                          }
                          const targetGroup = currentPhaseGroups[0];
                          setAddingTaskGroupId(targetGroup.id);
                          setAddingTaskParentCode(null);
                          setAddingTaskAfterCode(null);
                          setAddingTaskBeforeCode(null);
                          const dynamicCols = getDynamicColumns();
                          const initialForm: Record<string, string> = {};
                          dynamicCols.forEach(col => { initialForm[col] = ''; });
                          const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
                          if (statusCol) initialForm[statusCol] = 'Waiting';
                          setNewForm(initialForm);
                        }}
                        className="bg-[#0058be] hover:bg-[#0058be]/95 text-white font-semibold text-[13px] h-9 pl-4 pr-5 rounded-l-[8px] shadow-sm transition-all flex items-center gap-1.5 active:scale-95 whitespace-nowrap"
                      >
                        <Plus size={16} />
                        Tạo task mới
                      </button>
                      <button
                        ref={addTaskMenuBtnRef}
                        onClick={() => setAddTaskMenuOpen(!addTaskMenuOpen)}
                        className="bg-[#0058be] hover:bg-[#0058be]/95 text-white h-9 w-9 flex items-center justify-center rounded-r-[8px] shadow-sm transition-all border-l border-white/20 active:scale-95"
                        title="Thêm task / Thêm Group Task"
                      >
                        <ChevronDown size={16} />
                      </button>
                      <FloatingDropdown
                        anchorEl={addTaskMenuBtnRef.current}
                        open={addTaskMenuOpen}
                        onClose={() => setAddTaskMenuOpen(false)}
                        align="right"
                        className="bg-white border border-slate-200 rounded-lg shadow-lg w-[200px] py-1"
                      >
                          <button
                            onClick={() => {
                              setAddTaskMenuOpen(false);
                              const currentPhaseGroups = activePhase === 'ALL'
                                ? taskGroups
                                : taskGroups.filter(g => {
                                  const ph = phases.find(p => p.id === g.phase_id);
                                  return ph && ph.name === activePhase;
                                });
                              if (currentPhaseGroups.length === 0) {
                                flash('Hãy tạo ít nhất một Task Group trước khi thêm Task!', true);
                                return;
                              }
                              const targetGroup = currentPhaseGroups[0];
                              setAddingTaskGroupId(targetGroup.id);
                              setAddingTaskParentCode(null);
                              setAddingTaskAfterCode(null);
                              setAddingTaskBeforeCode(null);
                              const dynamicCols = getDynamicColumns();
                              const initialForm: Record<string, string> = {};
                              dynamicCols.forEach(col => { initialForm[col] = ''; });
                              const statusCol = dynamicCols.find(c => c.toUpperCase() === 'STATUS');
                              if (statusCol) initialForm[statusCol] = 'Waiting';
                              setNewForm(initialForm);
                            }}
                            className="w-full h-9 text-left px-3 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50 flex items-center gap-2"
                          >
                            <Plus size={16} className="text-[#0058be]" />
                            Thêm task
                          </button>
                          {canManageProjectStructure(project) && (
                          <button
                            onClick={() => {
                              setAddTaskMenuOpen(false);
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
                                flash('Vui lòng tạo Phase trước!', true);
                                return;
                              }
                              setAddingTaskGroupPhaseId(defaultPhaseId);
                              setNewTgForm({ name: '', manday_est: '', status: 'Waiting', start_date_est: '' });
                            }}
                            className="w-full h-9 text-left px-3 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50 flex items-center gap-2"
                          >
                            <FolderPlus size={16} className="text-indigo-600" />
                            Thêm Group Task
                          </button>
                          )}
                      </FloatingDropdown>
                    </div>
                    )}
                  </div>

                  {/* Task Table | Leader Review panel - table luôn ở flex-1 nên co
                      lại đúng phần viewport còn lại khi panel mở, không đổi
                      column width (width cột là inline style theo px cố định,
                      độc lập với width container cha) và scroll ngang riêng
                      của table vẫn hoạt động bình thường. */}
                  <div className="flex items-stretch gap-4 flex-1 min-h-0">
                  {/* Task Table */}
                  <div ref={taskTableCardRef} className="flex-1 min-w-0 min-h-[65vh] bg-white border border-[#c2c6d6]/60 rounded-xl shadow-sm flex flex-col overflow-hidden">
                    <div className="flex items-center px-3 pt-2 pb-1 border-b border-slate-100 shrink-0">
                      <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                        <button
                          onClick={() => setTaskFilterMode('all')}
                          className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${taskFilterMode === 'all' ? 'bg-[#0058be] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          Tất cả task
                        </button>
                        <button
                          onClick={() => setTaskFilterMode('review')}
                          className={`px-3 py-1.5 text-[12px] font-semibold transition-colors border-l border-slate-200 ${taskFilterMode === 'review' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          Task cần Review
                        </button>
                        <button
                          onClick={() => setTaskFilterMode('my_tasks')}
                          className={`px-3 py-1.5 text-[12px] font-semibold transition-colors border-l border-slate-200 ${taskFilterMode === 'my_tasks' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          Việc của tôi
                        </button>
                        <button
                          onClick={() => setTaskFilterMode('smart_priority')}
                          className={`px-3 py-1.5 text-[12px] font-semibold transition-colors border-l border-slate-200 ${taskFilterMode === 'smart_priority' ? 'bg-rose-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          Ưu tiên thông minh
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto task-table-scroll">
                      {/* table-layout: fixed - bắt buộc để mỗi cột giữ đúng width đã set (kể cả
                          width mặc định thu gọn cho MD/Priority/Status/KPI Ratio/ngày và width
                          do user tự resize) thay vì bị auto-layout của trình duyệt kéo giãn ra
                          để lấp đầy khoảng trống còn lại của bảng. */}
                      <table className="text-xs min-w-max border-collapse" style={{ tableLayout: 'fixed' }}>
                        <thead className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E3E7EE]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                          <tr>
                            <th className="text-center px-2 py-3 bg-[#FAFBFC] sticky left-0 z-[16]" style={{ minWidth: `${ACTION_COL_WIDTH}px`, width: `${ACTION_COL_WIDTH}px` }}></th>
                            {getDynamicColumns().map((col) => {
                              const colUpper = col.toUpperCase();
                              const width = getColumnWidth(col);
                              const isPinned = pinnedColumns.includes(col);
                              const canPin = col === 'TASK ID' || col === 'DETAIL TASK';
                              const colFilterActive =
                                (colUpper === 'PRIORITY' && priorityFilter !== 'All') ||
                                (colUpper === 'STATUS' && statusFilter !== 'All') ||
                                (colUpper === 'ASSIGNED' && assignedFilter !== 'All') ||
                                (colUpper === 'SUPPORT' && supportFilter !== 'All') ||
                                (colUpper === 'SKILL AREA' && skillSolutionFilter !== 'All') ||
                                (colUpper === 'SKILL' && skillVendorFilter !== 'All');
                              return (
                                <th
                                  key={col}
                                  className={`text-left py-2 text-[10.5px] font-semibold text-[#6b7280] uppercase tracking-wide bg-[#FAFBFC] group/th relative ${isPinned ? 'sticky z-[15]' : ''} ${draggingColumn && draggingColumn !== col ? 'bg-blue-50/60' : ''}`}
                                  style={{ minWidth: width, width, ...(isPinned ? { left: getPinnedLeftOffset(col) } : {}) }}
                                  onDragOver={(e) => { if (draggingColumn) e.preventDefault(); }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    if (draggingColumn) reorderColumn(draggingColumn, col);
                                    setDraggingColumn(null);
                                  }}
                                >
                                  <div className="flex items-center gap-1.5 pl-2 pr-1">
                                    <span
                                      draggable
                                      onDragStart={() => setDraggingColumn(col)}
                                      onDragEnd={() => setDraggingColumn(null)}
                                      className="cursor-grab active:cursor-grabbing select-none"
                                      title="Kéo để đổi thứ tự cột"
                                    >
                                      {colUpper === 'MANDAY EST' ? <span title="Manday EST">MD</span> : col}
                                    </span>
                                    {colFilterActive && <span className="w-1.5 h-1.5 rounded-full bg-[#0058be]" />}

                                    {/* Header menu: pin/unpin + hide column - chỉ hiện nút khi có
                                        ít nhất 1 action (cột vừa locked vừa không pin được thì
                                        menu sẽ rỗng, ẩn hẳn trigger thay vì mở ra trống). */}
                                    {(canPin || !LOCKED_COLUMNS.includes(col)) && (
                                    <div className="relative ml-auto">
                                      <button
                                        type="button"
                                        draggable={false}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const key = `col-${col}`;
                                          setHeaderMenuAnchorEl(e.currentTarget);
                                          setOpenHeaderMenu(openHeaderMenu === key ? null : key);
                                        }}
                                        className={`p-0.5 rounded hover:bg-slate-200 text-slate-400 opacity-0 group-hover/th:opacity-100 transition-opacity ${openHeaderMenu === `col-${col}` ? 'opacity-100 bg-slate-200' : ''}`}
                                      >
                                        <MoreHorizontal size={13} />
                                      </button>
                                      <FloatingDropdown
                                        anchorEl={headerMenuAnchorEl}
                                        open={openHeaderMenu === `col-${col}`}
                                        onClose={() => setOpenHeaderMenu(null)}
                                        align="right"
                                        className="bg-white border border-slate-200 rounded-lg shadow-lg w-[170px] py-1 text-left normal-case"
                                      >
                                        {canPin && (
                                          <button
                                            onClick={() => { setOpenHeaderMenu(null); togglePinColumn(col); }}
                                            className="w-full h-8 px-3 flex items-center gap-2 text-[12.5px] font-medium text-[#0b1c30] hover:bg-slate-50"
                                          >
                                            <Lock size={13} className="text-slate-500" />
                                            {isPinned ? 'Bỏ ghim' : 'Ghim bên trái'}
                                          </button>
                                        )}
                                        {!LOCKED_COLUMNS.includes(col) && (
                                          <button
                                            onClick={() => { setOpenHeaderMenu(null); toggleColumnVisibility(col); }}
                                            className="w-full h-8 px-3 flex items-center gap-2 text-[12.5px] font-medium text-[#0b1c30] hover:bg-slate-50"
                                          >
                                            <Columns3 size={13} className="text-slate-500" />
                                            Ẩn cột
                                          </button>
                                        )}
                                      </FloatingDropdown>
                                    </div>
                                    )}

                                    {colUpper === 'PRIORITY' && (
                                      <div className="relative" ref={priorityFilterRef}>
                                        <button
                                          onClick={() => setPriorityDropdownOpen(!priorityDropdownOpen)}
                                          className={`p-1 rounded-md hover:bg-slate-200 transition-opacity ${priorityFilter !== 'All' ? 'opacity-100 bg-blue-100 text-blue-700' : 'opacity-0 group-hover/th:opacity-100 text-slate-500'}`}
                                        >
                                          <Filter size={13} />
                                        </button>
                                        <FloatingDropdown
                                          anchorEl={priorityFilterRef.current}
                                          open={priorityDropdownOpen}
                                          onClose={() => setPriorityDropdownOpen(false)}
                                          align="right"
                                          className="bg-white border border-slate-200 rounded-md shadow-lg w-32"
                                        >
                                          {['All', 'Normal', 'High', 'Critical', 'Interrupt'].map(opt => (
                                            <button
                                              key={opt}
                                              onClick={() => { setPriorityFilter(opt); setPriorityDropdownOpen(false); }}
                                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 ${priorityFilter === opt ? 'font-bold text-blue-700 bg-blue-50' : ''}`}
                                            >
                                              {opt}
                                            </button>
                                          ))}
                                        </FloatingDropdown>
                                      </div>
                                    )}
                                    {colUpper === 'STATUS' && (
                                      <div className="relative" ref={statusFilterRef}>
                                        <button
                                          onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                                          className={`p-1 rounded-md hover:bg-slate-200 transition-opacity ${statusFilter !== 'All' ? 'opacity-100 bg-blue-100 text-blue-700' : 'opacity-0 group-hover/th:opacity-100 text-slate-500'}`}
                                        >
                                          <Filter size={13} />
                                        </button>
                                        <FloatingDropdown
                                          anchorEl={statusFilterRef.current}
                                          open={statusDropdownOpen}
                                          onClose={() => setStatusDropdownOpen(false)}
                                          align="right"
                                          className="bg-white border border-slate-200 rounded-md shadow-lg w-32"
                                        >
                                          {['All', 'Waiting', 'Process', 'Done', 'Rework', 'Cancel'].map(opt => (
                                            <button
                                              key={opt}
                                              onClick={() => { setStatusFilter(opt); setStatusDropdownOpen(false); }}
                                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 ${statusFilter === opt ? 'font-bold text-blue-700 bg-blue-50' : ''}`}
                                            >
                                              {opt}
                                            </button>
                                          ))}
                                        </FloatingDropdown>
                                      </div>
                                    )}
                                    {colUpper === 'ASSIGNED' && (() => {
                                      const opts = ['All', ...Array.from(new Set(items.map(t => t.assigned_name).filter(Boolean))).sort()];
                                      return (
                                        <div className="relative" ref={assignedFilterRef}>
                                          <button onClick={() => setAssignedDropdownOpen(!assignedDropdownOpen)} className={`p-1 rounded-md hover:bg-slate-200 transition-opacity ${assignedFilter !== 'All' ? 'opacity-100 bg-blue-100 text-blue-700' : 'opacity-0 group-hover/th:opacity-100 text-slate-500'}`}>
                                            <Filter size={13} />
                                          </button>
                                          <FloatingDropdown
                                            anchorEl={assignedFilterRef.current}
                                            open={assignedDropdownOpen}
                                            onClose={() => setAssignedDropdownOpen(false)}
                                            align="right"
                                            className="bg-white border border-slate-200 rounded-md shadow-lg w-44 max-h-60 overflow-y-auto"
                                          >
                                            {opts.map(opt => (
                                              <button key={opt} onClick={() => { setAssignedFilter(opt); setAssignedDropdownOpen(false); }}
                                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 truncate ${assignedFilter === opt ? 'font-bold text-blue-700 bg-blue-50' : ''}`}>
                                                {opt}
                                              </button>
                                            ))}
                                          </FloatingDropdown>
                                        </div>
                                      );
                                    })()}
                                    {colUpper === 'SUPPORT' && (() => {
                                      const opts = ['All', ...Array.from(new Set(items.map(t => t.support_name).filter(Boolean))).sort()];
                                      return (
                                        <div className="relative" ref={supportFilterRef}>
                                          <button onClick={() => setSupportDropdownOpen(!supportDropdownOpen)} className={`p-1 rounded-md hover:bg-slate-200 transition-opacity ${supportFilter !== 'All' ? 'opacity-100 bg-blue-100 text-blue-700' : 'opacity-0 group-hover/th:opacity-100 text-slate-500'}`}>
                                            <Filter size={13} />
                                          </button>
                                          <FloatingDropdown
                                            anchorEl={supportFilterRef.current}
                                            open={supportDropdownOpen}
                                            onClose={() => setSupportDropdownOpen(false)}
                                            align="right"
                                            className="bg-white border border-slate-200 rounded-md shadow-lg w-44 max-h-60 overflow-y-auto"
                                          >
                                            {opts.map(opt => (
                                              <button key={opt} onClick={() => { setSupportFilter(opt); setSupportDropdownOpen(false); }}
                                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 truncate ${supportFilter === opt ? 'font-bold text-blue-700 bg-blue-50' : ''}`}>
                                                {opt}
                                              </button>
                                            ))}
                                          </FloatingDropdown>
                                        </div>
                                      );
                                    })()}
                                    {colUpper === 'SKILL AREA' && (() => {
                                      const opts = buildSkillAreaFilterOptions();
                                      return (
                                        <div className="relative" ref={skillSolutionFilterRef}>
                                          <button onClick={() => setSkillSolutionDropdownOpen(!skillSolutionDropdownOpen)} className={`p-1 rounded-md hover:bg-slate-200 transition-opacity ${skillSolutionFilter !== 'All' ? 'opacity-100 bg-blue-100 text-blue-700' : 'opacity-0 group-hover/th:opacity-100 text-slate-500'}`}>
                                            <Filter size={13} />
                                          </button>
                                          <FloatingDropdown
                                            anchorEl={skillSolutionFilterRef.current}
                                            open={skillSolutionDropdownOpen}
                                            onClose={() => setSkillSolutionDropdownOpen(false)}
                                            align="right"
                                            className="bg-white border border-slate-200 rounded-md shadow-lg w-48 max-h-60 overflow-y-auto"
                                          >
                                            {opts.map(opt => (
                                              <button key={opt.value} onClick={() => { setSkillSolutionFilter(opt.value); setSkillSolutionDropdownOpen(false); }}
                                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 truncate ${skillSolutionFilter === opt.value ? 'font-bold text-blue-700 bg-blue-50' : ''}`}>
                                                {opt.label}
                                              </button>
                                            ))}
                                          </FloatingDropdown>
                                        </div>
                                      );
                                    })()}
                                    {colUpper === 'SKILL' && (() => {
                                      const opts = buildSkillFilterOptions();
                                      return (
                                        <div className="relative" ref={skillVendorFilterRef}>
                                          <button onClick={() => setSkillVendorDropdownOpen(!skillVendorDropdownOpen)} className={`p-1 rounded-md hover:bg-slate-200 transition-opacity ${skillVendorFilter !== 'All' ? 'opacity-100 bg-blue-100 text-blue-700' : 'opacity-0 group-hover/th:opacity-100 text-slate-500'}`}>
                                            <Filter size={13} />
                                          </button>
                                          <FloatingDropdown
                                            anchorEl={skillVendorFilterRef.current}
                                            open={skillVendorDropdownOpen}
                                            onClose={() => setSkillVendorDropdownOpen(false)}
                                            align="right"
                                            className="bg-white border border-slate-200 rounded-md shadow-lg w-48 max-h-60 overflow-y-auto"
                                          >
                                            {opts.map(opt => (
                                              <button key={opt.value} onClick={() => { setSkillVendorFilter(opt.value); setSkillVendorDropdownOpen(false); }}
                                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 truncate ${skillVendorFilter === opt.value ? 'font-bold text-blue-700 bg-blue-50' : ''}`}>
                                                {opt.label}
                                              </button>
                                            ))}
                                          </FloatingDropdown>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  {/* Resize handle */}
                                  <div
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      resizingColumnRef.current = { col, startX: e.clientX, startWidth: width };
                                      const onMove = (ev: MouseEvent) => {
                                        const ctx = resizingColumnRef.current;
                                        if (!ctx) return;
                                        const minW = getColumnMinWidth(col);
                                        const next = Math.max(minW, ctx.startWidth + (ev.clientX - ctx.startX));
                                        setColumnWidths(prev => ({ ...prev, [ctx.col]: next }));
                                      };
                                      const onUp = () => {
                                        resizingColumnRef.current = null;
                                        document.removeEventListener('mousemove', onMove);
                                        document.removeEventListener('mouseup', onUp);
                                      };
                                      document.addEventListener('mousemove', onMove);
                                      document.addEventListener('mouseup', onUp);
                                    }}
                                    onDoubleClick={() => {
                                      setColumnWidths(prev => {
                                        const next = { ...prev };
                                        delete next[col];
                                        return next;
                                      });
                                    }}
                                    className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-[#0058be]/40 select-none"
                                    title="Kéo để đổi độ rộng, double-click để reset"
                                  />
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody
                          className="divide-y divide-[#c2c6d6]/40 bg-white"
                          onDragOver={(e) => {
                            // Safety net, not a retarget: a native HTML5 drop is only
                            // accepted at a point if SOME dragover in that event's
                            // bubble path called preventDefault() on the LAST sample
                            // taken before release. A fast, short drag gesture (a
                            // quick upward flick is the classic case — reordering one
                            // row up is a much shorter, snappier motion than dragging
                            // several rows down) can have its last dragover sample
                            // land on an 8px spacer or right at a row boundary that
                            // never got its own dragover call in time, so the browser
                            // silently REJECTS the drop — no drop event fires
                            // anywhere, no error, nothing. This unconditional
                            // preventDefault() on the whole table body — active only
                            // during a Task/Group drag — guarantees the drop is always
                            // accepted somewhere in the table regardless of that last-
                            // sample race. It does NOT change which row/spacer the
                            // drop actually lands on or how it's handled — that's
                            // still whichever element is literally under the cursor at
                            // release, using its own existing onDrop logic.
                            if (draggingTaskId !== null || draggingGroupId !== null) {
                              e.preventDefault();
                            }
                          }}
                        >
                          {renderRows()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Leader Review panel - desktop (xl+): cạnh table, table co
                      lại nhường chỗ (flex-1 min-w-0 ở trên). Màn nhỏ hơn: overlay
                      drawer bên phải + backdrop, không ép table nhỏ lại. */}
                  {leaderReviewOpen && (
                    <>
                      <div
                        className="fixed inset-0 bg-slate-900/30 z-40 xl:hidden"
                        onClick={closeLeaderReviewPanel}
                      />
                      <div
                        className="w-[85vw] max-w-[360px] xl:w-[340px] xl:max-w-none shrink-0 bg-white border border-[#c2c6d6]/60 rounded-none xl:rounded-xl shadow-2xl xl:shadow-sm flex flex-col fixed xl:static top-0 xl:top-auto right-0 xl:right-auto h-full xl:h-auto z-50 xl:z-auto overflow-hidden"
                      >
                        {/* Header */}
                        <div className="px-4 py-3 border-b border-[#c2c6d6]/60 flex items-center justify-between shrink-0">
                          <div className="flex items-center gap-2">
                            <AlertTriangle size={16} className="text-amber-500" />
                            <h3 className="text-[13.5px] font-bold text-[#0b1c30]">Leader Review</h3>
                            {attentionTasks.length > 0 && (
                              <span className="text-[11px] font-semibold text-slate-400">{attentionTasks.length} mục</span>
                            )}
                          </div>
                          <button
                            onClick={closeLeaderReviewPanel}
                            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
                            title="Đóng"
                          >
                            <X size={16} />
                          </button>
                        </div>

                        {attentionTasks.length === 0 ? (
                          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
                            <CheckCircle2 size={28} className="text-emerald-400" />
                            <p className="text-[12.5px] text-slate-500">Hiện không có task cần xử lý ưu tiên.</p>
                          </div>
                        ) : (
                          <div className="flex-1 overflow-y-auto">
                            {/* Summary nhỏ trong panel - KHÔNG đưa ra ngoài table */}
                            <div className="grid grid-cols-4 gap-1.5 px-4 py-3 border-b border-[#c2c6d6]/60">
                              {[
                                { label: 'Quá hạn', value: attentionOverdueCount, color: 'text-rose-600' },
                                { label: 'Blocked', value: attentionBlockedCount, color: 'text-amber-600' },
                                { label: 'Chưa assign', value: attentionUnassignedCount, color: 'text-slate-500' },
                                { label: 'Chờ review', value: attentionReviewCount, color: 'text-blue-600' },
                              ].map(s => (
                                <div key={s.label} className="text-center">
                                  <div className={`text-base font-extrabold ${s.color}`}>{s.value}</div>
                                  <div className="text-[9.5px] text-slate-400 font-semibold uppercase tracking-wide leading-tight">{s.label}</div>
                                </div>
                              ))}
                            </div>

                            <div className="px-4 pt-3 pb-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ưu tiên xử lý</span>
                            </div>

                            <div className="px-2 pb-3 space-y-1.5">
                              {attentionTasks.map(a => {
                                const t = a.task;
                                const reasonParts: string[] = [];
                                if (a.overdue) reasonParts.push(`Quá hạn ${a.daysLate} ngày`);
                                if (a.blocked) reasonParts.push(a.blockedDays > 0 ? `Blocked ${a.blockedDays} ngày` : 'Blocked');
                                if (a.needReview) reasonParts.push('đang chờ review');
                                if (a.unassigned) reasonParts.push('chưa có người phụ trách');
                                const reasonText = reasonParts.slice(0, 2).join(' · ');

                                const primaryBadge = a.overdue
                                  ? { label: `Quá hạn`, cls: 'bg-rose-50 text-rose-700 border-rose-200', Icon: Clock }
                                  : a.blocked
                                    ? { label: 'Blocked', cls: 'bg-amber-50 text-amber-700 border-amber-200', Icon: Ban }
                                    : a.needReview
                                      ? { label: 'Review', cls: 'bg-blue-50 text-blue-700 border-blue-200', Icon: CheckCircle2 }
                                      : { label: 'Chưa assign', cls: 'bg-slate-100 text-slate-600 border-slate-200', Icon: UserX };

                                const isSelected = t.id === selectedAttentionTaskId;
                                return (
                                  <button
                                    key={t.id}
                                    onClick={() => handleOpenAttentionTask(t)}
                                    className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors group ${
                                      isSelected
                                        ? 'bg-[#EFF6FF] border-[#BFDBFE] border-l-[3px] border-l-[#2563EB]'
                                        : 'border-transparent hover:border-slate-200 hover:bg-[#F8FAFC]'
                                    }`}
                                  >
                                    <div className="flex items-start gap-2">
                                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.overdue ? 'bg-rose-500' : a.blocked ? 'bg-amber-500' : a.needReview ? 'bg-blue-500' : 'bg-slate-400'}`} />
                                      <div className="min-w-0 flex-1">
                                        <div className="text-[12.5px] font-semibold text-[#0b1c30] truncate group-hover:text-[#0058be]" title={t.detail || ''}>
                                          {t.detail || t.task_code}
                                        </div>
                                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                          {reasonText}
                                          {t.phase_name ? ` · ${t.phase_name}` : ''}
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${primaryBadge.cls}`}>
                                            <primaryBadge.Icon size={10} />
                                            {primaryBadge.label}
                                          </span>
                                          {t.assigned_name && (
                                            <span className="text-[10.5px] text-slate-500 font-medium truncate">{t.assigned_name}</span>
                                          )}
                                        </div>
                                        {a.needReview && (
                                          <div className="flex items-center gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
                                            <button
                                              onClick={async () => {
                                                try {
                                                  await approveTask(t.task_group_id, t.id);
                                                  flash('Đã duyệt task!');
                                                  refetchTasks();
                                                } catch (err: any) { flash(getApiErrorMessage(err, 'Lỗi khi duyệt.'), true); }
                                              }}
                                              className="px-2 py-1 text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
                                            >
                                              Duyệt
                                            </button>
                                            <button
                                              onClick={() => openReviewDrawer(t)}
                                              className="px-2 py-1 text-[10px] font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded transition-colors"
                                            >
                                              Yêu cầu sửa
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  </div>

                  {!taskFocusMode && (
                    <button
                      onClick={() => setTaskFocusMode(true)}
                      className="fixed bottom-6 right-6 z-40 flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-slate-200 shadow-lg text-[#0b1c30] text-[12.5px] font-semibold px-3.5 py-2 rounded-full transition-all"
                      title="Mở rộng bảng"
                    >
                      <Expand size={14} />
                      Mở rộng bảng
                    </button>
                  )}
                </div>
              )}

              {/* TAB 2: MEETINGS FOR THIS PROJECT */}
              {activeMainTab === 'meetings' && (
                <div className="space-y-6">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-[#0b1c30]">Quản lý Cuộc họp & Schedule (Dự án: {project?.name || ''})</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Theo dõi lịch họp tuần, biên bản tóm tắt AI và push task khuyến nghị cho riêng dự án này.</p>
                    </div>
                    {(isAdmin() || isMember()) && (
                      <button
                        onClick={() => {
                          setEditingMeeting({ project: project?.name || '', project_ids: project?.id ? [project.id] : [] });
                          setShowMeetingModal(true);
                        }}
                        className="flex items-center gap-2 bg-[#0058be] hover:bg-[#0058be]/90 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition-all"
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                        Tạo meeting dự án
                      </button>
                    )}
                  </div>

                  {/* WEEKLY SCHEDULE CALENDAR FOR THIS PROJECT */}
                  <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-sm font-bold text-[#0b1c30] uppercase tracking-wide">
                            {currentWeekInfo.weekTitle}
                          </h3>
                          {weekOffset !== 0 && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[11px] font-bold rounded-md">
                              {weekOffset < 0 ? `Quá khứ (${Math.abs(weekOffset)} tuần trước)` : `Tương lai (+${weekOffset} tuần)`}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#64748b] mt-0.5">
                          Cuộc họp bật AI sẽ tự động tạo Summary & đề xuất task sau khi kết thúc
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Week Controls */}
                        <div className="flex items-center bg-[#f1f5f9] p-0.5 rounded-lg border border-[#cbd5e1]">
                          <button
                            type="button"
                            onClick={() => setWeekOffset(prev => prev - 1)}
                            className="px-2.5 py-1 text-xs font-semibold text-[#0b1c30] hover:bg-white rounded-md transition-colors"
                          >
                            ‹ Tuần trước
                          </button>
                          <button
                            type="button"
                            onClick={() => setWeekOffset(0)}
                            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${weekOffset === 0 ? 'bg-white text-[#0058be] shadow-xs' : 'text-[#64748b] hover:bg-white'}`}
                          >
                            Hôm nay
                          </button>
                          <button
                            type="button"
                            onClick={() => setWeekOffset(prev => prev + 1)}
                            className="px-2.5 py-1 text-xs font-semibold text-[#0b1c30] hover:bg-white rounded-md transition-colors"
                          >
                            Tuần sau ›
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={loadMeetings}
                          className="px-3 py-1.5 bg-white hover:bg-slate-50 text-[#0b1c30] text-xs font-semibold rounded-lg transition-colors border border-[#cbd5e1] shadow-xs flex items-center gap-1.5"
                        >
                          <span>↻</span>
                          <span>Đồng bộ lịch</span>
                        </button>
                      </div>
                    </div>

                    {/* 7-Day Weekly Calendar Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mt-2">
                      {currentWeekInfo.days.map((d, i) => {
                        const dayMeetings = meetings.filter(m => {
                          if (!m || !m.date) return false;
                          const dateStr = String(m.date).trim();
                          if (dateStr.startsWith(d.isoDate)) return true;
                          const fullFormattedDate = `${d.formattedDate}/${d.yearNum}`;
                          if (dateStr === fullFormattedDate || dateStr.startsWith(fullFormattedDate)) return true;
                          if (dateStr === d.formattedDate) return true;
                          try {
                            const meetingDateObj = new Date(dateStr);
                            if (!isNaN(meetingDateObj.getTime())) {
                              return meetingDateObj.getFullYear() === d.fullDate.getFullYear() &&
                                meetingDateObj.getMonth() === d.fullDate.getMonth() &&
                                meetingDateObj.getDate() === d.fullDate.getDate();
                            }
                          } catch (e) { }
                          return false;
                        });

                        return (
                          <div key={i} className={`border rounded-xl p-3.5 min-h-[160px] ${d.isWeekend ? 'bg-slate-50/70 border-slate-200' : 'bg-white border-[#e2e8f0]'}`}>
                            <h4 className="text-[13px] font-bold text-[#0b1c30] mb-3">{d.label}</h4>
                            {dayMeetings.length > 0 ? (
                              dayMeetings.map(item => {
                                const timeVal = String(item.time || '').toLowerCase();
                                let isPM = timeVal.includes('pm') || timeVal.includes('chiều') || timeVal.includes('tối');
                                if (!isPM && !timeVal.includes('am') && !timeVal.includes('sáng')) {
                                  const hourMatch = timeVal.match(/(\d{1,2}):/);
                                  if (hourMatch) isPM = parseInt(hourMatch[1], 10) >= 12;
                                }
                                const attendeeCount = item.members?.length || item.member_count || 0;
                                const platformName = item.platform || 'Meet';

                                return (
                                  <div
                                    key={item.id}
                                    className={`rounded-lg p-2.5 mb-2.5 border-l-[4px] ${isPM ? 'bg-[#fff7e8] border-l-[#f59e0b]' : 'bg-[#edf5ff] border-l-[#1769d2]'
                                      }`}
                                  >
                                    <div className="text-[13px] font-medium text-[#0b1c30] leading-snug">
                                      <span className="font-normal">{item.time || (isPM ? '14:00' : '09:00')}</span> {item.title}
                                    </div>
                                    <small className="block text-[11px] text-[#64748b] mt-1">
                                      {platformName}{attendeeCount ? ` · ${attendeeCount} người` : ''} · <b className="text-[#0b1c30] font-bold">AI On</b>
                                    </small>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="border border-dashed border-[#e2e8f0] rounded-xl p-4 text-center text-[12px] text-[#94a3b8] mt-1">
                                Chưa có lịch họp
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Meeting Table List — cùng layout với bảng ở trang Meetings tổng
                      (app/meetings/page.tsx) để 2 nơi hiển thị đồng bộ. */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-[#0b1c30]">Danh sách cuộc họp dự án ({meetings.length})</h3>
                    {meetings.length === 0 ? (
                      <div className="bg-white border border-[#c2c6d6]/60 rounded-xl py-16 text-center">
                        <span className="material-symbols-outlined text-slate-300 text-[48px] block mb-3">event</span>
                        <p className="text-sm font-semibold text-slate-500">Chưa có cuộc họp nào cho dự án này</p>
                        <p className="text-xs text-slate-400 mt-1">Nhấn "+ Tạo meeting dự án" để tạo cuộc họp mới</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs" style={{ minWidth: 1000 }}>
                            <thead>
                              <tr className="bg-[#f8fafc] border-b border-[#e2e8f0] text-left">
                                <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Cuộc họp</th>
                                <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Dự án</th>
                                <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Người tham gia</th>
                                <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Thời gian</th>
                                <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Chuẩn bị</th>
                                <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">KPI Tasks</th>
                                <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Trạng thái</th>
                                <th className="p-3 font-bold text-[#76859a] text-[10px] uppercase tracking-wider">Điểm hiệu quả</th>
                                <th className="p-3"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {meetings.map(m => {
                                const projectNames: string[] = Array.isArray(m.projects) && m.projects.length
                                  ? m.projects.map((p: any) => p.name).filter(Boolean)
                                  : (m.project ? [m.project] : []);
                                const prep = m.score_prep;
                                const tasks: any[] = m.recommended_tasks || m.ai_summary?.recommended_tasks || [];
                                const syncedCount = tasks.filter((t: any) => t.imported_task_id).length;
                                const statusUpper = String(m.status || '').toUpperCase();
                                const isScheduledOrCancelled = statusUpper === 'SẮP TỚI' || statusUpper === 'ĐÃ HỦY';
                                const score = m.score_total;
                                return (
                                  <tr key={m.id} className="border-b border-[#edf1f6] hover:bg-[#fbfbff] transition-colors">
                                    <td className="p-3">
                                      <div className="flex items-center gap-2.5 min-w-[200px]">
                                        <div className="w-8 h-8 rounded-lg bg-[#efefff] text-[#5e57e7] flex items-center justify-center font-extrabold shrink-0">▣</div>
                                        <div className="min-w-0">
                                          <p
                                            onClick={() => { setDetailMeeting(m); setIsDetailOpen(true); }}
                                            className="font-bold text-[#0b1c30] truncate max-w-[220px] cursor-pointer hover:text-[#6366f1] transition-colors"
                                          >
                                            {m.title}
                                          </p>
                                          <p className="text-[10px] text-[#8492a6]">{m.platform || 'Google Meet'}{m.duration ? ` · ${m.duration} phút` : ''}</p>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="p-3">
                                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                                        {projectNames.length > 0 ? projectNames.map(name => (
                                          <span key={name} className="inline-flex items-center gap-1 bg-[#eef4ff] text-[#285dc4] border border-[#dbe8ff] rounded-md px-2 py-1 text-[10px] font-bold whitespace-nowrap">▣ {name}</span>
                                        )) : (
                                          <span className="inline-flex items-center gap-1 bg-[#f1f5f9] text-[#64748b] border border-[#e2e8f0] rounded-md px-2 py-1 text-[10px] font-bold whitespace-nowrap">Dự án chung</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="p-3 text-[11px] text-[#52627a]">{(m.members || []).length} người</td>
                                    <td className="p-3 whitespace-nowrap text-[11px]">{m.date} · {m.time}</td>
                                    <td className="p-3">
                                      {prep === null || prep === undefined ? (
                                        <span className="text-[#94a3b8]">—</span>
                                      ) : (
                                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${prep >= 20 ? 'bg-emerald-50 text-emerald-700' : prep > 5 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                                          {prep >= 20 ? '✓' : prep > 5 ? '!' : '×'} {prep}/25
                                        </span>
                                      )}
                                    </td>
                                    <td className="p-3">
                                      {isScheduledOrCancelled || tasks.length === 0 ? (
                                        <span className="text-[#94a3b8]">—</span>
                                      ) : (
                                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${syncedCount === tasks.length ? 'bg-emerald-50 text-emerald-700' : syncedCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                                          {syncedCount === tasks.length ? '✓' : syncedCount > 0 ? '!' : '×'} {Math.round((syncedCount / tasks.length) * 100)}% đã tạo
                                        </span>
                                      )}
                                    </td>
                                    <td className="p-3">
                                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${statusUpper.includes('DIỄN RA') || statusUpper === 'ĐÃ KẾT THÚC' || statusUpper === 'DONE' ? 'bg-[#e2f7ec] text-[#18724f]'
                                        : statusUpper === 'ĐÃ HỦY' || statusUpper === 'CANCELLED' ? 'bg-[#fff0f2] text-[#c73750]'
                                          : 'bg-[#eaf0ff] text-[#315dca]'
                                        }`}>
                                        {m.status}
                                      </span>
                                    </td>
                                    <td className="p-3">
                                      {score === null || score === undefined ? <span className="text-[#94a3b8]">—</span> : (
                                        <span className={`font-extrabold ${score >= 75 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{score}/100</span>
                                      )}
                                    </td>
                                    <td className="p-3 text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        {m.can_manage && !statusUpper.includes('DIỄN RA') && (
                                          <button
                                            onClick={() => setDeleteConfirmId(String(m.id))}
                                            title="Xóa cuộc họp"
                                            className="border border-[#d7dfeb] bg-white rounded-lg h-7 w-7 flex items-center justify-center text-[#94a3b8] hover:border-red-300 hover:text-red-600 transition-colors"
                                          >
                                            <span className="material-symbols-outlined text-[14px]">delete</span>
                                          </button>
                                        )}
                                        <button
                                          onClick={() => { setDetailMeeting(m); setIsDetailOpen(true); }}
                                          className="border border-[#d7dfeb] bg-white rounded-lg h-7 px-2.5 text-[#506078] text-[10px] font-bold hover:border-[#6366f1] hover:text-[#6366f1] transition-colors whitespace-nowrap"
                                        >
                                          Chi tiết ›
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Modals */}
                  {(isAdmin() || isMember()) && (
                    <CreateMeetingModal
                      isOpen={showMeetingModal}
                      onClose={() => { setShowMeetingModal(false); setEditingMeeting(null); }}
                      onSave={handleSaveMeeting}
                      initialData={editingMeeting}
                    />
                  )}

                  <MeetingDetailModal
                    isOpen={isDetailOpen}
                    onClose={() => { setIsDetailOpen(false); setDetailMeeting(null); }}
                    meeting={detailMeeting}
                    onEdit={detailMeeting?.can_manage ? (m => { setIsDetailOpen(false); setEditingMeeting(m); setShowMeetingModal(true); }) : undefined}
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
                          <button onClick={() => setDeleteConfirmId(null)} disabled={deletingMeeting} className="px-4 py-2 text-xs font-bold text-[#565e74] bg-white border border-[#c2c6d6] hover:bg-[#f0f2f5] rounded-lg transition-colors disabled:opacity-50">Hủy</button>
                          <button onClick={executeDeleteMeeting} disabled={deletingMeeting} className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm disabled:opacity-50">{deletingMeeting ? 'Đang xóa...' : 'Xác nhận xóa'}</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}


              {/* Old AI Task Inbox / Chat Sources / Mapping / Logs sub-tabs
                  removed — that system was for a separate chat-group/
                  Telegram integration, unrelated to the real Zalo
                  integration below. Task suggestions from a Zalo summary
                  now push straight into the project (see ZaloSummaryCard). */}
              {activeMainTab === 'chats' && id && (
                <ProjectZaloSummaryTab projectId={Number(id)} />
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
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#eff4ff]/60 rounded transition-colors flex items-center justify-between ${selectedMemberId === String(u.id) ? 'bg-[#eff4ff]/60 text-[#0058be] font-bold' : 'text-[#0b1c30]'
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
                                    if (removingMemberId !== null) return;
                                    setRemovingMemberId(m.id);
                                    try {
                                      await removeProjectMember(Number(id), m.id);
                                      loadProjectMembers();
                                      flash('Đã gỡ bỏ thành viên');
                                    } catch (err: any) {
                                      flash('Lỗi gỡ thành viên: ' + getApiErrorMessage(err), true);
                                    } finally {
                                      setRemovingMemberId(null);
                                    }
                                  }}
                                  disabled={removingMemberId === m.id}
                                  className="text-slate-400 hover:text-red-600 p-1 disabled:opacity-50 disabled:cursor-not-allowed"
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

              {activeMainTab === 'audit_logs' && isAdmin() && (
                <AuditLogsTab
                  projectId={Number(id)}
                  onSelectTask={(taskCodeOrId) => {
                    const found = items.find(t => t.task_code === taskCodeOrId || String(t.id) === String(taskCodeOrId));
                    if (found) {
                      setSelectedTask(found);
                    } else {
                      flash(`Không tìm thấy Task ${taskCodeOrId} trong danh sách hiện tại.`, true);
                    }
                  }}
                  onSelectProject={() => {
                    setShowEditProjectModal(true);
                  }}
                  onSelectPhase={(phId) => {
                    const ph = phases.find(p => String(p.id) === String(phId));
                    if (ph) {
                      setActivePhase(ph.name);
                      router.push(`/project/detail/tasks?id=${id}`);
                      flash(`Đã chuyển tới Phase '${ph.name}'`);
                    } else {
                      router.push(`/project/detail/tasks?id=${id}`);
                    }
                  }}
                />
              )}

              {activeMainTab === 'resources' && (
                <ProjectDocumentsTab
                  projectId={Number(id)}
                  phases={phases}
                  tasks={items || []}
                  projectName={project?.name || ''}
                  isProjectLeader={isAdmin() || projectMembers.some(
                    (m: any) => m.role === 'Leader' && m.email && m.email.toLowerCase() === (getEmail() || '').toLowerCase()
                  )}
                  onNavigateToTask={(taskCodeOrId) => {
                    const found = items.find(t => t.task_code === taskCodeOrId || String(t.id) === String(taskCodeOrId));
                    if (found) {
                      setSelectedTask(found);
                    }
                    router.push(`/project/detail/tasks?id=${id}`);
                  }}
                />
              )}

              {/* TAB: PROTOTYPE — Tính năng & WIP Log, ported from markee-dashboard's concept */}
              {activeMainTab === 'prototype' && id && (
                <ProjectPrototypeTab projectId={Number(id)} projectName={project?.name} />
              )}
            </div>

          </div>

        </div>

      </div>

      {/* Project Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 text-[#0058be]">
                <span className="material-symbols-outlined text-[28px]">schema</span>
                <div>
                  <h3 className="text-base font-bold text-[#0b1c30]">Áp dụng Project Template</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Chọn template để tạo nhanh các phase và task cha cho dự án này.</p>
                </div>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Cảnh báo ghi đè */}
            <div className="px-6 pt-4">
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
                <span className="text-red-500 text-[14px] shrink-0 mt-0.5">⚠️</span>
                <p className="text-[11px] text-red-700 leading-relaxed font-medium">
                  <strong>Lưu ý:</strong> Áp dụng template sẽ <strong>XÓA TOÀN BỘ Phase và Task hiện tại</strong> của dự án này, sau đó thay bằng cấu trúc của template được chọn. Hành động này <strong>không thể hoàn tác</strong>.
                </p>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-3 flex-1">
              {loadingTemplates ? (
                <div className="flex items-center justify-center py-10 text-sm text-slate-500">Đang tải template...</div>
              ) : templates.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Chưa có template nào. Hãy tạo template từ trang Cấu hình hệ thống trước.
                </div>
              ) : (
                templates.map((template: any) => (
                  <div key={template.id} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="p-4 flex items-start justify-between gap-4 bg-slate-50/50">
                      <div>
                        <div className="font-semibold text-sm text-[#0b1c30]">{template.name}</div>
                        <div className="text-xs text-slate-500 mt-1">{template.description || 'Không có mô tả'}</div>
                        <div className="text-[11px] text-slate-400 mt-2">
                          {template.phases?.length || 0} phases •{' '}
                          {template.phases?.reduce((acc: number, p: any) => acc + (p.task_groups?.length || 0), 0) || 0} task cha
                        </div>
                      </div>
                      <button
                        onClick={() => setConfirmApplyTemplateId(template.id)}
                        disabled={applyingTemplateId === template.id}
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors disabled:opacity-60 shrink-0"
                      >
                        {applyingTemplateId === template.id ? 'Đang áp dụng...' : 'Áp dụng'}
                      </button>
                    </div>

                    {/* Template Structure Preview */}
                    <div className="border-t border-slate-100 p-3 space-y-2 bg-white">
                      {(template.phases || []).map((phase: any, pIdx: number) => (
                        <div key={phase.id || pIdx} className="flex items-start gap-2">
                          <span className="text-[10px] font-bold text-[#0058be] bg-[#eff4ff] border border-[#0058be]/20 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                            {pIdx + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-[#0b1c30]">{phase.name}</div>
                            {(phase.task_groups || []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {(phase.task_groups || []).map((group: any, gIdx: number) => (
                                  <span key={group.id || gIdx} className="text-[10px] text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                                    {group.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            {phase.name.toLowerCase().includes('lab') || phase.name.toLowerCase().includes('poc') ? (
                              <div className="text-[10px] text-slate-400 italic mt-0.5">Phase trống — người dùng tự thêm task khi cần</div>
                            ) : (phase.task_groups || []).length === 0 ? (
                              <div className="text-[10px] text-slate-400 italic mt-0.5">Chưa có task cha</div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="bg-slate-50 px-6 py-4 flex justify-end border-t border-slate-100 shrink-0">
              <button
                onClick={() => setShowTemplateModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác Nhận Áp Dụng Template (GHI ĐÈ) — kèm Preview số liệu trước khi Apply */}
      {confirmApplyTemplateId !== null && (() => {
        const previewTemplate = templates.find((t: any) => t.id === confirmApplyTemplateId);
        const previewPhases = (previewTemplate?.phases || []).filter((p: any) => p.is_active !== false);
        const previewGroupCount = previewPhases.reduce((acc: number, p: any) => acc + (p.task_groups?.length || 0), 0);
        const previewTaskCount = previewPhases.reduce(
          (acc: number, p: any) => acc + (p.task_groups || []).reduce((a2: number, g: any) => a2 + (g.tasks?.length || 0), 0),
          0
        );
        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="p-6">
                <div className="flex items-center gap-3 text-amber-600 mb-3">
                  <span className="material-symbols-outlined text-[28px]">warning</span>
                  <h3 className="text-base font-bold text-[#0b1c30]">Xác nhận áp dụng template</h3>
                </div>
                {previewTemplate && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-3">
                    <div className="text-xs font-bold text-[#0b1c30] mb-2 truncate">{previewTemplate.name}</div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-lg font-bold text-[#0058be]">{previewPhases.length}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wide">Phases</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-[#0058be]">{previewGroupCount}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wide">Task Groups</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-[#0058be]">{previewTaskCount}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wide">Tasks</div>
                      </div>
                    </div>
                  </div>
                )}
                <p className="text-xs text-slate-600 leading-relaxed">
                  Áp dụng template này sẽ <strong className="text-red-600">XÓA TOÀN BỘ Phase và Task hiện tại</strong> của dự án, sau đó thay bằng cấu trúc ở trên.
                </p>
                <p className="text-xs text-slate-500 mt-2">Hành động này <strong>không thể hoàn tác</strong>. Bạn có chắc chắn muốn tiếp tục?</p>
              </div>
              <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
                <button
                  onClick={() => setConfirmApplyTemplateId(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={() => handleApplyTemplate(confirmApplyTemplateId)}
                  disabled={applyingTemplateId === confirmApplyTemplateId}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {applyingTemplateId === confirmApplyTemplateId ? 'Đang áp dụng...' : 'Áp dụng Template'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showExportTemplateModal && (
        <ExportProjectTemplateModal
          projectId={Number(id)}
          projectName={project?.name || ''}
          phases={phases}
          taskGroups={taskGroups}
          tasks={items}
          onClose={() => setShowExportTemplateModal(false)}
          onSuccess={(result) => flash(`Xuất template "${result.name}" thành công (${result.created_phase_count} phase, ${result.created_group_count} task group, ${result.created_task_count} task)`)}
        />
      )}

      <ProjectFormModal
        isOpen={showEditProjectModal}
        mode="edit"
        editingProject={project}
        onClose={() => setShowEditProjectModal(false)}
        onSaved={(updated) => { setProject(updated); loadProject(); }}
        onFlash={flash}
        onRequestDelete={() => { setShowEditProjectModal(false); setShowDeleteModal(true); }}
      />

      {/* Modal Xác Nhận Xóa Dự Án */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 text-rose-600 mb-3">
                <span className="material-symbols-outlined text-[28px]">warning</span>
                <h3 className="text-base font-bold text-[#0b1c30]">Xác nhận xóa dự án</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Bạn có chắc chắn muốn xóa dự án <strong className="text-[#0b1c30]">"{project?.name || ''}"</strong>?
              </p>
              <p className="text-xs text-rose-500 mt-2 font-medium">⚠️ Hành động này sẽ xóa toàn bộ các Phase, Task và dữ liệu liên quan. Không thể hoàn tác!</p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleDeleteSheet}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm cursor-pointer"
              >
                Xác nhận xóa
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
        projectId={aiDrawerProjectId}
        memberTab={memberIdParam ? { memberId: Number(memberIdParam), memberName: memberFilterParam, projectId: Number(id) } : undefined}
        onSuccessCheck={() => {
          reloadAll();
          loadProject();
        }}
      />

      {/* Leader Review Detail Drawer - read/review-first, TÁCH BIỆT hoàn toàn
          khỏi Task Edit Drawer bên dưới (selectedTask/drawerForm). Chỉ mở khi
          click item từ Leader Review panel (handleOpenAttentionTask) - click
          task trực tiếp từ table vẫn setSelectedTask thẳng như cũ, không đổi.
          Không có input/textarea nào ở đây, chỉ card hiển thị + action thật. */}
      {leaderReviewDetailTask && (() => {
        const t = leaderReviewDetailTask;
        const statusInfo = getStatusInfo(t.status);
        const lastLog = taskActivityLogs[0];
        // Tái sử dụng CHÍNH XÁC object đã quyết định task này vào Leader Review
        // (không tính lại reason bằng logic khác) - nếu task đã rớt khỏi hàng
        // đợi (vd vừa approve và không còn overdue/blocked/unassigned) thì
        // attentionInfo sẽ là undefined, hiển thị "không còn cần chú ý".
        const attentionInfo = attentionTasks.find(a => a.task.id === t.id);
        const isCritical = ['critical', 'urgent'].includes((t.priority || '').trim().toLowerCase());

        const TONE_BADGE: Record<string, string> = {
          rose: 'bg-rose-50 text-rose-700 border-rose-200',
          amber: 'bg-amber-50 text-amber-700 border-amber-200',
          slate: 'bg-slate-100 text-slate-600 border-slate-200',
          blue: 'bg-blue-50 text-blue-700 border-blue-200',
          purple: 'bg-purple-50 text-purple-700 border-purple-200',
        };
        const TONE_ICON: Record<string, string> = {
          rose: 'text-rose-600', amber: 'text-amber-600', slate: 'text-slate-500', blue: 'text-blue-600', purple: 'text-purple-600',
        };

        const reasons: Array<{ Icon: any; tone: string; label: string; text: string }> = [];
        if (attentionInfo?.overdue) {
          const deadlineStr = formatDateToShow(t.end_date_est || '');
          reasons.push({ Icon: Clock, tone: 'rose', label: 'Overdue', text: `Quá hạn ${attentionInfo.daysLate} ngày${deadlineStr ? ` · deadline ${deadlineStr}` : ''}` });
        }
        if (attentionInfo?.blocked) {
          const blockedParts = [`Blocked ${attentionInfo.blockedDays} ngày`];
          if (t.blocked_reason) blockedParts.push(`Lý do: ${t.blocked_reason}`);
          if (t.blocked_by_task) blockedParts.push(`Đang chờ: ${t.blocked_by_task.task_code || t.blocked_by_task.detail}`);
          reasons.push({ Icon: Ban, tone: 'amber', label: 'Blocked', text: blockedParts.join(' · ') });
        }
        if (attentionInfo?.unassigned) reasons.push({ Icon: UserX, tone: 'slate', label: 'Unassigned', text: 'Chưa có người phụ trách' });
        if (attentionInfo?.needReview) reasons.push({ Icon: CheckCircle2, tone: 'blue', label: 'Review pending', text: 'Đang chờ Leader Review' });
        if (isCritical) reasons.push({ Icon: AlertTriangle, tone: 'purple', label: 'Critical', text: 'Mức ưu tiên Critical' });

        const isPending = t.review_status === 'pending';
        const isApproved = t.review_status === 'approved';
        const isChangesRequested = t.review_status === 'changes_requested';
        // Duyệt/Yêu cầu sửa dùng ĐÚNG permission gate đã có cho Resources
        // approve/reject (is_project_leader ở backend) - isProjectManager ở FE
        // là bản tương đương (Super Admin hoặc PM/Leader của chính project này).
        const canReview = isProjectManager;

        return (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div onClick={() => setLeaderReviewDetailTask(null)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300" />
            <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 transition-transform duration-300 animate-slide-in">
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-[#fffbeb] to-white">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-amber-50 text-amber-600">
                    <AlertTriangle size={18} />
                  </span>
                  <h3 className="text-sm font-bold text-[#0b1c30]">Task cần chú ý</h3>
                </div>
                <button onClick={() => setLeaderReviewDetailTask(null)} className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Attention badges */}
                {reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {reasons.map((r, i) => (
                      <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-bold border ${TONE_BADGE[r.tone]}`}>
                        <r.Icon size={11} />
                        {r.label}
                      </span>
                    ))}
                  </div>
                )}

                {/* Phase + Task ID */}
                <div className="flex items-center gap-2 flex-wrap">
                  {t.phase_name && (
                    <span className="px-2.5 py-0.5 rounded-full bg-[#eff4ff] text-[#1d4ed8] text-[10px] font-bold uppercase border border-[#0058be]/10">
                      {t.phase_name}
                    </span>
                  )}
                  <span className="font-mono px-2 py-0.5 rounded bg-slate-50 text-slate-600 text-[11px] font-bold border border-slate-200">
                    {t.task_code || t.task_id}
                  </span>
                </div>

                {/* Title */}
                <div>
                  <h4 className="text-[15px] font-bold text-[#0b1c30] leading-snug">{t.detail}</h4>
                  {lastLog && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Cập nhật {formatTimeAgo(lastLog.created_at)} · bởi {lastLog.user_name}
                    </p>
                  )}
                </div>

                {/* Tại sao cần chú ý? - render TOÀN BỘ reason thật, dùng đúng
                    attentionInfo đã tính task này vào Leader Review, không fake. */}
                <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-3.5">
                  <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <AlertTriangle size={13} />
                    Tại sao cần chú ý?
                  </div>
                  {reasons.length === 0 ? (
                    <p className="text-[12.5px] text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 size={14} /> Task này không còn nằm trong danh sách cần chú ý.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {reasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12.5px] text-[#0b1c30]">
                          <r.Icon size={13} className={`mt-0.5 shrink-0 ${TONE_ICON[r.tone]}`} />
                          <span>{r.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Review status banner - lịch sử action thật (approved_by/
                    change_request_reason), không fake. */}
                {isApproved && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-[12.5px]">
                    <div className="font-bold text-emerald-800 flex items-center gap-1.5"><CheckCircle2 size={14} /> Đã duyệt</div>
                    <div className="mt-1 text-emerald-700">
                      bởi {t.approved_by_name || 'Quản lý'}{t.approved_at ? ` · ${formatTimeAgo(t.approved_at)}` : ''}
                    </div>
                  </div>
                )}
                {isChangesRequested && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-[12.5px]">
                    <div className="font-bold text-orange-800 flex items-center gap-1.5"><Ban size={14} /> Đã yêu cầu sửa</div>
                    {t.change_request_reason && <div className="mt-1 text-orange-800">{t.change_request_reason}</div>}
                    <div className="mt-1 text-orange-600 text-[11px]">
                      bởi {t.change_requested_by_name || 'Quản lý'}{t.change_requested_at ? ` · ${formatTimeAgo(t.change_requested_at)}` : ''}
                    </div>
                  </div>
                )}
                {/* Lịch sử yêu cầu sửa CŨ - vẫn hiện (mờ hơn) ngay cả khi task
                    đã được gửi lại review (review_status không còn là
                    'changes_requested' nữa) - KHÔNG xoá field change_request_*
                    khi request-review, chỉ để leader không mất dấu lần trước. */}
                {!isChangesRequested && t.change_request_reason && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[12.5px]">
                    <div className="font-bold text-slate-500 flex items-center gap-1.5"><Ban size={13} /> Từng bị yêu cầu sửa (đã gửi lại review)</div>
                    <div className="mt-1 text-slate-500">{t.change_request_reason}</div>
                    <div className="mt-1 text-slate-400 text-[11px]">
                      bởi {t.change_requested_by_name || 'Quản lý'}{t.change_requested_at ? ` · ${formatTimeAgo(t.change_requested_at)}` : ''}
                    </div>
                  </div>
                )}

                {/* Blocking banner - is_blocked là lịch sử thật, blocked_reason/
                    blocked_by_task không bị xoá khi unblock (mirror change_
                    request_reason ở trên). */}
                {t.is_blocked && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[12.5px]">
                    <div className="font-bold text-amber-800 flex items-center gap-1.5"><Ban size={14} /> Đang bị chặn</div>
                    {t.blocked_reason && <div className="mt-1 text-amber-800">{t.blocked_reason}</div>}
                    {t.blocked_by_task && (
                      <div className="mt-1 text-amber-700">Đang chờ: <span className="font-semibold">{t.blocked_by_task.task_code}</span> - {t.blocked_by_task.detail}</div>
                    )}
                    <div className="mt-1 text-amber-600 text-[11px]">
                      bởi {t.blocked_by_name || 'Một thành viên'}{t.blocked_at ? ` · ${formatTimeAgo(t.blocked_at)}` : ''}
                    </div>
                  </div>
                )}
                {!t.is_blocked && t.blocked_reason && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[12.5px]">
                    <div className="font-bold text-slate-500 flex items-center gap-1.5"><Ban size={13} /> Từng bị chặn (đã gỡ)</div>
                    <div className="mt-1 text-slate-500">{t.blocked_reason}</div>
                    <div className="mt-1 text-slate-400 text-[11px]">
                      Gỡ bởi {t.unblocked_by_name || 'Một thành viên'}{t.unblocked_at ? ` · ${formatTimeAgo(t.unblocked_at)}` : ''}
                    </div>
                  </div>
                )}

                {/* Action phù hợp theo reason/status - TOÀN BỘ khu vực Hành động
                    (kể cả AI check/Chỉnh sửa/More menu, không chỉ riêng Duyệt/
                    Yêu cầu sửa) chỉ dành cho Admin/Leader dự án/Super Admin -
                    member chỉ xem (read-only), theo đúng yêu cầu. Duyệt/Yêu
                    cầu sửa còn thêm điều kiện review_status THẬT SỰ đang pending. */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hành động</div>
                  {!canReview ? (
                    <p className="text-[12px] text-slate-400 italic flex items-center gap-1.5">
                      <Lock size={12} className="shrink-0" />
                      Chỉ xem - cần quyền Admin/Leader/Super Admin để thao tác (Duyệt, Yêu cầu sửa, AI check, chỉnh sửa...).
                    </p>
                  ) : (
                  <>
                  <div className="flex flex-wrap items-center gap-2">
                    {isPending && !confirmingApproveTask && !requestChangesOpen && (
                      <>
                        <button
                          onClick={() => setConfirmingApproveTask(true)}
                          className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center gap-1.5"
                        >
                          <CheckCircle2 size={14} /> Duyệt
                        </button>
                        <button
                          onClick={() => setRequestChangesOpen(true)}
                          className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 transition-colors flex items-center gap-1.5"
                        >
                          <Ban size={14} /> Yêu cầu sửa
                        </button>
                      </>
                    )}
                    {(isChangesRequested || isApproved) && !confirmingApproveTask && !requestChangesOpen && (
                      <button
                        onClick={() => handleRequestTaskReview(t)}
                        disabled={reviewActionBusy}
                        className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <CheckCircle2 size={14} /> {reviewActionBusy ? 'Đang gửi...' : 'Gửi lại để review'}
                      </button>
                    )}
                    {t.is_blocked ? (
                      <button
                        onClick={() => handleUnblockTask(t)}
                        disabled={blockActionBusy}
                        className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <CheckCircle2 size={14} /> {blockActionBusy ? 'Đang gỡ...' : 'Gỡ chặn'}
                      </button>
                    ) : (
                      <button
                        onClick={() => { setBlockReason(''); setBlockDependencyTaskId(''); setBlockPrompt({ taskId: t.id }); }}
                        className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-colors flex items-center gap-1.5"
                      >
                        <Ban size={14} /> Đánh dấu bị chặn
                      </button>
                    )}
                    <button
                      onClick={() => { setLeaderReviewDetailTask(null); handleOpenAIReviewDrawer('TASK', t.id, t.detail); }}
                      className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 transition-colors flex items-center gap-1.5"
                    >
                      <Sparkles size={14} /> AI check
                    </button>
                    <button
                      onClick={() => { setLeaderReviewDetailTask(null); setSelectedTask(t); }}
                      className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition-colors flex items-center gap-1.5"
                    >
                      <Pencil size={14} /> {attentionInfo?.unassigned ? 'Giao người phụ trách' : 'Chỉnh sửa task'}
                    </button>

                    {/* More menu - CHỈ secondary task-management actions
                        (Nhân bản/Xóa), không phải action nổi bật của review. */}
                    <div className="relative ml-auto">
                      <button
                        ref={leaderReviewMoreMenuBtnRef}
                        onClick={() => setLeaderReviewMoreMenuOpen(o => !o)}
                        className="h-8 w-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-colors"
                        title="Thao tác khác"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      <FloatingDropdown
                        anchorEl={leaderReviewMoreMenuBtnRef.current}
                        open={leaderReviewMoreMenuOpen}
                        onClose={() => setLeaderReviewMoreMenuOpen(false)}
                        align="right"
                        className="bg-white border border-slate-200 rounded-lg shadow-lg w-[190px] py-1 text-left"
                      >
                        {canEditTask(project) && (
                        <button
                          onClick={() => { setLeaderReviewMoreMenuOpen(false); setLeaderReviewDetailTask(null); handleDuplicateTask(t.task_group_id, t.id); }}
                          className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-[#0b1c30] hover:bg-slate-50"
                        >
                          <Copy size={15} className="text-[#0058be]" />
                          Nhân bản Task
                        </button>
                        )}
                        {canDeleteTask(project) && (
                        <button
                          onClick={() => { setLeaderReviewMoreMenuOpen(false); setLeaderReviewDetailTask(null); setTaskToDelete(t.id); }}
                          className="w-full h-9 px-3 flex items-center gap-2 text-[13px] font-medium text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={15} />
                          Xóa Task
                        </button>
                        )}
                      </FloatingDropdown>
                    </div>
                  </div>

                  {/* Confirm Duyệt - inline nhẹ, không dùng window.confirm */}
                  {confirmingApproveTask && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between gap-3">
                      <span className="text-[12.5px] text-emerald-800 font-medium">Xác nhận duyệt task này? Task sẽ được chuyển sang <b>Done</b>.</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => setConfirmingApproveTask(false)} disabled={reviewActionBusy} className="h-7 px-3 rounded-md text-[12px] font-semibold text-slate-600 hover:bg-white transition-colors disabled:opacity-60">
                          Huỷ
                        </button>
                        <button onClick={() => handleApproveTask(t)} disabled={reviewActionBusy} className="h-7 px-3 rounded-md text-[12px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-60">
                          {reviewActionBusy ? 'Đang xử lý...' : 'Xác nhận duyệt'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Yêu cầu sửa - reason bắt buộc */}
                  {requestChangesOpen && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-2">
                      <div className="text-[12.5px] font-bold text-orange-800">Yêu cầu chỉnh sửa</div>
                      <textarea
                        value={changeRequestReason}
                        onChange={e => setChangeRequestReason(e.target.value)}
                        placeholder="Nhập lý do yêu cầu sửa (bắt buộc)..."
                        rows={3}
                        autoFocus
                        className="w-full bg-white border border-orange-200 rounded-lg px-3 py-2 text-[12.5px] text-[#0b1c30] focus:outline-none focus:border-orange-400 transition-colors resize-none"
                      />
                      {changeRequestReason.trim().length > 0 && changeRequestReason.trim().length < 5 && (
                        <p className="text-[11px] text-rose-600">Cần tối thiểu 5 ký tự ({changeRequestReason.trim().length}/5).</p>
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => { setRequestChangesOpen(false); setChangeRequestReason(''); }}
                          disabled={reviewActionBusy}
                          className="h-7 px-3 rounded-md text-[12px] font-semibold text-slate-600 hover:bg-white transition-colors disabled:opacity-60"
                        >
                          Huỷ
                        </button>
                        <button
                          onClick={() => handleRequestTaskChanges(t)}
                          disabled={reviewActionBusy}
                          className="h-7 px-3 rounded-md text-[12px] font-semibold bg-orange-600 hover:bg-orange-700 text-white transition-colors disabled:opacity-60"
                        >
                          {reviewActionBusy ? 'Đang gửi...' : 'Gửi yêu cầu'}
                        </button>
                      </div>
                    </div>
                  )}
                  </>
                  )}
                </div>

                {/* Thông tin task - read-only summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Status</div>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border ${statusInfo.bg} border-current/10`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                      {statusInfo.label}
                    </span>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Priority</div>
                    <span className={`inline-block px-2.5 py-0.5 rounded-md border text-[11px] font-bold tracking-wide uppercase ${getPriorityStyle(t.priority)}`}>
                      {t.priority || 'Normal'}
                    </span>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Assignee</div>
                    <div className="text-[13px] font-semibold text-[#0b1c30]">
                      {t.assigned_name || <span className="text-slate-400 font-normal italic">Chưa giao</span>}
                    </div>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Manday</div>
                    <div className="text-[13px] font-semibold text-[#0b1c30] font-mono">
                      {t.manday_est !== null && t.manday_est !== undefined ? `${t.manday_est} MD` : '—'}
                    </div>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Start</div>
                    <div className="text-[13px] font-semibold text-[#0b1c30] font-mono">{formatDateToShow(t.start_date || '') || '—'}</div>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Deadline</div>
                    <div className="text-[13px] font-semibold text-[#0b1c30] font-mono">{formatDateToShow(t.end_date_est || '') || '—'}</div>
                  </div>
                </div>

                {/* AI assessment - chỉ hiện nếu AI Check đã thực sự chạy
                    (ai_status/last_ai_score là field thật trên task, do
                    /ai-review/check ghi - xem audit). AI không tự approve/
                    request-changes, chỉ hỗ trợ leader tự quyết định. */}
                {t.ai_status && t.ai_status !== 'NOT_CHECKED' && (
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">AI Assessment</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${t.ai_status === 'HAS_ISSUE' ? 'bg-rose-500' : t.ai_status === 'GOOD' ? 'bg-emerald-500' : t.ai_status === 'CHECKING' ? 'bg-blue-500 animate-pulse' : 'bg-amber-500'}`} />
                      <span className="text-[12.5px] font-semibold text-[#0b1c30]">{t.ai_status}</span>
                      {t.last_ai_score !== null && t.last_ai_score !== undefined && (
                        <span className="text-[11px] text-slate-500 font-mono">Score: {t.last_ai_score}/100</span>
                      )}
                      {t.last_ai_check_at && (
                        <span className="text-[11px] text-slate-400">· {formatTimeAgo(t.last_ai_check_at)}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Kết quả cần đạt / Checklist / Dependency - KHÔNG có field
                    tương ứng ở backend (task không có expected_result/checklist/
                    dependency), nên KHÔNG render các section này thay vì fake. */}

                {/* Hoạt động gần đây - tái sử dụng đúng getProjectAuditLogs, lọc
                    theo entity_id (xem taskActivityLogs) - chỉ Manager/Admin mới
                    gọi được endpoint này (require_manager ở backend). */}
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Hoạt động gần đây</div>
                  {!isAdmin() ? (
                    <p className="text-xs text-slate-400 italic">Cần quyền Manager để xem lịch sử hoạt động.</p>
                  ) : taskActivityLogs.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Chưa có hoạt động nào được ghi nhận gần đây cho task này.</p>
                  ) : (
                    <div className="space-y-3">
                      {taskActivityLogs.slice(0, 6).map((l: any) => (
                        <div key={l.id} className="flex items-start gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[9px] font-extrabold shrink-0 mt-0.5">
                            {(l.user_name || '??').split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] text-[#0b1c30] leading-snug">
                              <span className="font-semibold">{l.user_name}</span>{' '}
                              <span className="text-slate-600">{l.description || l.action}</span>
                            </p>
                            <p className="text-[10.5px] text-slate-400 mt-0.5 flex items-center gap-1">
                              <Clock size={10} /> {formatTimeAgo(l.created_at)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Task Detail Drawer */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Click-outside-to-close catcher — intentionally no dimming/blur
              (bg-slate-900/40 backdrop-blur-sm removed) so the Tasks table
              stays fully visible/legible behind the drawer, per spec. */}
          <div onClick={() => setSelectedTask(null)} className="absolute inset-0" />
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
                  <Sparkles size={16} />
                </button>
                {canEditTask(project) && (
                <button
                  onClick={() => handleDuplicateTask(selectedTask.task_group_id, selectedTask.id)}
                  className="w-8 h-8 rounded-lg hover:bg-blue-50 flex items-center justify-center text-slate-500 hover:text-[#0058be] transition-colors"
                  title="Nhân bản Task"
                >
                  <Copy size={16} />
                </button>
                )}
                {canDeleteTask(project) && (
                <button
                  onClick={() => { setSelectedTask(null); setTaskToDelete(selectedTask.id); }}
                  className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-slate-500 hover:text-red-600 transition-colors"
                  title="Xóa Task"
                >
                  <Trash2 size={16} />
                </button>
                )}
                <button onClick={() => setSelectedTask(null)} className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* KPI Snapshot — read-only, moved to the top of the drawer so
                  it's the first thing visible on open, matching the KPI
                  Snapshot placement decision. */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">KPI Snapshot</label>
                <div className="grid grid-cols-4 gap-3 mt-2">
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

              {/* Detail Task */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Detail Task</label>
                <textarea
                  value={drawerForm.detail || ''}
                  onChange={e => setDrawerForm({ ...drawerForm, detail: e.target.value })}
                  rows={3}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors resize-none"
                />
              </div>

              {/* Blocking workflow - is_blocked layer riêng, không phải fake
                  UI: dùng đúng blockTask/unblockTask API, cùng quyền sửa task
                  thường (không leader-only như Duyệt/Yêu cầu sửa). */}
              {selectedTask.is_blocked ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[12.5px]">
                  <div className="font-bold text-amber-800 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5"><Ban size={14} /> Task đang bị chặn</span>
                    <button
                      onClick={() => handleUnblockTask(selectedTask)}
                      disabled={blockActionBusy}
                      className="h-7 px-2.5 rounded-md text-[11.5px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-60"
                    >
                      {blockActionBusy ? 'Đang gỡ...' : 'Gỡ chặn'}
                    </button>
                  </div>
                  {selectedTask.blocked_reason && <div className="mt-1.5 text-amber-800">{selectedTask.blocked_reason}</div>}
                  {selectedTask.blocked_by_task && (
                    <div className="mt-1 text-amber-700">Đang chờ: <span className="font-semibold">{selectedTask.blocked_by_task.task_code}</span> - {selectedTask.blocked_by_task.detail}</div>
                  )}
                  <div className="mt-1 text-amber-600 text-[11px]">
                    bởi {selectedTask.blocked_by_name || 'Một thành viên'}{selectedTask.blocked_at ? ` · ${formatTimeAgo(selectedTask.blocked_at)}` : ''}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setBlockReason(''); setBlockDependencyTaskId(''); setBlockPrompt({ taskId: selectedTask.id }); }}
                  className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-colors flex items-center gap-1.5 w-fit"
                >
                  <Ban size={14} /> Đánh dấu bị chặn
                </button>
              )}

              {/* Status & Priority */}
              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Status</label>
                  <select
                    value={drawerForm.status || ''}
                    onChange={e => setDrawerForm({ ...drawerForm, status: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  >
                    {getAvailableStatuses().length === 0 ? (
                      <>
                        <option value="Todo">Todo</option>
                        <option value="Waiting">Waiting</option>
                        <option value="Process">Process</option>
                        <option value="Done">Done</option>
                        <option value="Cancel">Cancel</option>
                      </>
                    ) : (
                      getAvailableStatuses().map((st: any) => (
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

                {/* Manday Est & Start Date */}
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
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={drawerForm.start_date ? toPickerDate(drawerForm.start_date) : ''}
                    onChange={e => setDrawerForm({ ...drawerForm, start_date: fromPickerDate(e.target.value) })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  />
                </div>

                {/* Assigned & Support */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Assigned</label>
                  <SearchableSelect
                    label="thành viên"
                    icon=""
                    options={projectMembers.map((m: any) => ({ id: String(m.id), name: m.display_name }))}
                    value={drawerForm.assigned_id || ''}
                    onChange={(val: any) => setDrawerForm({ ...drawerForm, assigned_id: val === 'all' ? '' : val })}
                    placeholder="Tìm thành viên..."
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Support</label>
                  <SearchableSelect
                    label="thành viên"
                    icon=""
                    options={projectMembers.map((m: any) => ({ id: String(m.id), name: m.display_name }))}
                    value={drawerForm.support_id || ''}
                    onChange={(val: any) => setDrawerForm({ ...drawerForm, support_id: val === 'all' ? '' : val })}
                    placeholder="Tìm thành viên..."
                    className="w-full"
                  />
                </div>
              </div>

              {/* KPI RATIO */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">KPI Ratio</label>
                <input
                  type="text"
                  value={drawerForm.kpi_ratio || '90/10'}
                  onChange={e => setDrawerForm({ ...drawerForm, kpi_ratio: e.target.value })}
                  placeholder="90/10"
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors font-mono"
                />
              </div>

              {/* Skill Area */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Skill Area</label>
                  {isMemberOrAbove() && (
                    <button
                      type="button"
                      onClick={() => openSkillGroupCreateModal('', drawerForm.skill_solution_id, (groupId) => {
                        setDrawerForm((prev: any) => ({
                          ...prev,
                          skill_solution_id: String(groupId),
                          skill_vendor_id: '',
                        }));
                      })}
                      className="w-6 h-6 inline-flex items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-slate-500 hover:border-[#0058be] hover:bg-[#eff4ff] hover:text-[#0058be] transition-colors"
                      title="Tạo Skill Area mới"
                      aria-label="Tạo Skill Area mới"
                    >
                      <Plus size={14} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
                <SearchableSelect
                  label="Skill Area"
                  icon=""
                  options={categories
                    .filter(c => c.is_active)
                    .flatMap(c => c.groups || [])
                    .map((g: any) => ({ id: g.id, name: g.name }))}
                  value={drawerForm.skill_solution_id || ''}
                  onChange={(val: any) => {
                    const grpId = val === 'all' ? '' : val;
                    setDrawerForm({
                      ...drawerForm,
                      skill_solution_id: grpId,
                      skill_vendor_id: ''
                    });
                  }}
                  placeholder="Tìm Skill Area..."
                  className="w-full"
                />
              </div>

              {/* Skill */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Skill</label>
                  {isMemberOrAbove() && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!drawerForm.skill_solution_id) {
                          flash('Vui lòng chọn Skill Area trước khi tạo Skill.', true);
                          return;
                        }
                        setNewSkillVendorName('');
                        setShowCreateSkillVendorModal(true);
                      }}
                      className="w-6 h-6 inline-flex items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-slate-500 hover:border-[#0058be] hover:bg-[#eff4ff] hover:text-[#0058be] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={drawerForm.skill_solution_id ? 'Tạo Skill mới' : 'Chọn SKILL AREA trước'}
                      aria-label="Tạo Skill mới"
                    >
                      <Plus size={14} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
                {(() => {
                  let availSkills: any[] = [];
                  if (drawerForm.skill_solution_id) {
                    const grpObj = categories
                      .filter(c => c.is_active)
                      .flatMap(c => c.groups || [])
                      .find((g: any) => String(g.id) === String(drawerForm.skill_solution_id));
                    if (grpObj) availSkills = (grpObj.skills || []).filter((s: any) => s.is_active);
                  } else {
                    availSkills = categories
                      .filter(c => c.is_active)
                      .flatMap(c => c.groups || [])
                      .flatMap((g: any) => g.skills || [])
                      .filter((s: any) => s.is_active);
                  }
                  return (
                    <SearchableSelect
                      label="Skill"
                      icon=""
                      options={availSkills.map((s: any) => ({ id: s.id, name: s.name }))}
                      value={drawerForm.skill_vendor_id || ''}
                      onChange={(val: any) => setDrawerForm({ ...drawerForm, skill_vendor_id: val === 'all' ? '' : val })}
                      placeholder="Tìm Skill..."
                      className="w-full"
                    />
                  );
                })()}
              </div>

              {/* Link - dùng chung LinkChipsEditor với cột LINK trên bảng
                  (nhiều link dạng chip, nối bằng "\n" trong cùng 1 field
                  ticket_id) để tránh 1 input text thường làm mất xuống dòng
                  và hỏng các link đã lưu trước đó. */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Link</label>
                <LinkChipsEditor
                  value={drawerForm.ticket_id || ''}
                  onChange={(next) => setDrawerForm(prev => ({ ...prev, ticket_id: next }))}
                  inputValue={drawerLinkDraft}
                  onInputChange={setDrawerLinkDraft}
                  onInputKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setDrawerForm(prev => ({ ...prev, ticket_id: appendLinkValue(prev.ticket_id || '', drawerLinkDraft) }));
                      setDrawerLinkDraft('');
                    }
                  }}
                  onInputBlur={() => {
                    if (drawerLinkDraft.trim()) {
                      setDrawerForm(prev => ({ ...prev, ticket_id: appendLinkValue(prev.ticket_id || '', drawerLinkDraft) }));
                      setDrawerLinkDraft('');
                    }
                  }}
                />
              </div>

              {/* Remark - dùng chung RemarkMultiSelectInput với bảng (gắn
                  performanceSettings, ảnh hưởng KPI Final) thay vì text input
                  tự do để không tạo ra giá trị Remark không khớp danh mục. */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Remark</label>
                <RemarkMultiSelectInput
                  value={drawerForm.remark || ''}
                  performanceSettings={performanceSettings}
                  onChange={(next) => setDrawerForm({ ...drawerForm, remark: next })}
                  placeholder="Chọn Remark..."
                />
              </div>

              {/* Send */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Send</label>
                <select
                  value={drawerForm.send || ''}
                  onChange={e => setDrawerForm({ ...drawerForm, send: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                >
                  <option value="">-- Chọn --</option>
                  <option value="gửi">gửi</option>
                  <option value="đã gửi">đã gửi</option>
                </select>
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

      {reviewDrawerTask && (() => {
        const t = reviewDrawerTask;
        const statusL = (t.status || '').toLowerCase();
        const isReview = statusL.includes('review');
        const canApprove = isSuperAdmin() || isAdmin() || (() => {
          if (!myMemberId || !t.assigned_id) return false;
          const assignee = membersList.find((m: any) => Number(m.id) === Number(t.assigned_id));
          return assignee && Number(assignee.leader_member_id) === Number(myMemberId);
        })();
        const completedCount = reviewChecklist.filter(i => i.is_completed).length;
        const totalCount = reviewChecklist.length;
        return (
          <div className="fixed inset-0 z-[55] flex justify-end" onClick={() => setReviewDrawerTask(null)}>
            <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col animate-slide-in h-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-white flex items-center justify-between shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <ArrowUpRight size={18} className="text-blue-600" />
                    <span className="text-sm font-bold text-[#0b1c30]">Review</span>
                    <span className="font-mono text-[11px] text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">{t.task_code}</span>
                  </div>
                  <p className="text-[12px] text-slate-500 mt-1 line-clamp-1">{t.detail}</p>
                </div>
                <button onClick={() => setReviewDrawerTask(null)} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Status</div>
                    {(() => { const info = getStatusInfo(t.status); return (
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border ${info.bg} border-current/10`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />{info.label}
                      </span>
                    ); })()}
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Assignee</div>
                    <div className="text-[13px] font-semibold text-[#0b1c30]">{t.assigned_name || '—'}</div>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Deadline</div>
                    <div className="text-[13px] font-semibold text-[#0b1c30] font-mono">{formatDateToShow(t.end_date_est || '') || '—'}</div>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Manday EST</div>
                    <div className="text-[13px] font-semibold text-[#0b1c30] font-mono">{t.manday_est ?? '—'} MD</div>
                  </div>
                </div>

                {t.review_status === 'approved' && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    <span className="text-[12px] font-semibold text-emerald-700">Đã được duyệt{t.approved_by_name ? ` bởi ${t.approved_by_name}` : ''}</span>
                  </div>
                )}
                {t.review_status === 'changes_requested' && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle size={14} className="text-orange-600 shrink-0" />
                      <span className="text-[12px] font-semibold text-orange-700">Yêu cầu sửa{t.change_requested_by_name ? ` bởi ${t.change_requested_by_name}` : ''}</span>
                    </div>
                    {t.change_request_reason && <p className="text-[12px] text-orange-600 mt-1">{t.change_request_reason}</p>}
                  </div>
                )}

                <div className="border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[12px] font-bold text-slate-700 uppercase tracking-wider">
                      Checklist ({completedCount}/{totalCount})
                    </h4>
                    {totalCount > 0 && (
                      <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }} />
                      </div>
                    )}
                  </div>

                  {!canApprove && (
                    <div className="space-y-2">
                      {reviewChecklistLoading && <div className="text-[12px] text-slate-400 py-2">Đang tải...</div>}
                      {!reviewChecklistLoading && reviewChecklist.length === 0 && (
                        <div className="text-[12px] text-slate-400 py-2 italic">Chưa có mục checklist nào.</div>
                      )}
                      {reviewChecklist.map(item => (
                        <label key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                          <input
                            type="checkbox"
                            checked={item.is_completed}
                            onChange={() => handleToggleChecklistItem(item)}
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className={`text-[13px] ${item.is_completed ? 'line-through text-slate-400' : 'text-[#0b1c30]'}`}>{item.content}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {canApprove && (
                    <div className="space-y-2">
                      {reviewChecklistLoading && <div className="text-[12px] text-slate-400 py-2">Đang tải...</div>}
                      {!reviewChecklistLoading && reviewChecklist.length === 0 && (
                        <div className="text-[12px] text-slate-400 py-2 italic">Chưa có mục checklist nào.</div>
                      )}
                      {reviewChecklist.map(item => (
                        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 group/item">
                          <input
                            type="checkbox"
                            checked={item.is_completed}
                            onChange={() => handleToggleChecklistItem(item)}
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className={`text-[13px] flex-1 ${item.is_completed ? 'line-through text-slate-400' : 'text-[#0b1c30]'}`}>{item.content}</span>
                          <button
                            onClick={() => handleDeleteChecklistItem(item.id)}
                            className="opacity-0 group-hover/item:opacity-100 text-slate-400 hover:text-red-500 transition-opacity shrink-0"
                            title="Xóa"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      <div className="flex gap-2 mt-2">
                        <input
                          value={newChecklistContent}
                          onChange={e => setNewChecklistContent(e.target.value)}
                          placeholder="Thêm mục checklist..."
                          className="flex-1 h-8 px-2.5 text-[12px] border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddChecklistItem(); } }}
                        />
                        <button
                          onClick={handleAddChecklistItem}
                          disabled={!newChecklistContent.trim()}
                          className="h-8 px-3 text-[12px] font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                        >
                          Thêm
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 border-t border-slate-200 bg-white shrink-0 space-y-2">
                {isMember() && isReview && (
                  <button
                    onClick={handleNotifyReviewToLeader}
                    className="w-full px-4 py-2.5 rounded-lg text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm flex items-center justify-center gap-2"
                  >
                    <Bell size={14} />
                    Thông báo review cho Leader
                  </button>
                )}
                {canApprove && isReview && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleReviewDrawerApprove}
                      disabled={reviewActionBusy}
                      className="flex-1 px-4 py-2.5 rounded-lg text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
                    >
                      Duyệt
                    </button>
                    <button
                      onClick={() => setRequestChangesOpen(!requestChangesOpen)}
                      disabled={reviewActionBusy}
                      className="flex-1 px-4 py-2.5 rounded-lg text-[12px] font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 transition-colors"
                    >
                      Yêu cầu sửa
                    </button>
                  </div>
                )}
                {requestChangesOpen && canApprove && (
                  <div className="space-y-2">
                    <textarea
                      value={changeRequestReason}
                      onChange={e => setChangeRequestReason(e.target.value)}
                      placeholder="Lý do yêu cầu sửa (tối thiểu 5 ký tự)..."
                      rows={2}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-orange-400 resize-none"
                    />
                    <button
                      onClick={handleReviewDrawerRequestChanges}
                      disabled={reviewActionBusy || changeRequestReason.trim().length < 5}
                      className="w-full px-4 py-2 rounded-lg text-[12px] font-semibold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 transition-colors"
                    >
                      Gửi yêu cầu sửa
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Skill Area `+` modal, shared by every quick-add entry point
          (Task Detail Drawer's own "+" button, and table-cell quick-add via
          openSkillGroupCreateModal/onRequestAreaCreate) — creates a new
          Group under an explicitly chosen Category. Reuses POST
          /api/skills/groups and the existing `categories` tree. */}
      {showCreateSkillGroupModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-[#f8faff] to-white">
              <h3 className="text-sm font-bold text-[#0b1c30]">Tạo Skill Area mới</h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreateSkillGroupModal(false);
                  setNewSkillGroupName('');
                  setNewSkillGroupCategoryId('');
                }}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
                title="Đóng"
                aria-label="Đóng"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Category <span className="text-red-500">*</span></label>
                <select
                  value={newSkillGroupCategoryId}
                  onChange={e => setNewSkillGroupCategoryId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                >
                  <option value="">-- Chọn Category --</option>
                  {categories
                    .filter((c: any) => c.is_active)
                    .map((c: any) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Tên Group <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={newSkillGroupName}
                  onChange={e => setNewSkillGroupName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !creatingSkillGroup) handleCreateSkillGroupFromDrawer();
                  }}
                  placeholder="VD: Backend, Frontend, DevOps..."
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                  autoFocus
                />
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowCreateSkillGroupModal(false);
                  setNewSkillGroupName('');
                  setNewSkillGroupCategoryId('');
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-md text-slate-600 hover:bg-slate-200"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCreateSkillGroupFromDrawer}
                disabled={creatingSkillGroup || !newSkillGroupName.trim() || !newSkillGroupCategoryId}
                className="px-4 py-1.5 text-xs font-semibold rounded-md text-white bg-[#0058be] hover:bg-[#004a9e] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingSkillGroup ? 'Đang tạo...' : 'Tạo Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail → SKILL `+` modal: creates a new Skill under
          the currently selected SKILL AREA (Group). Reuses POST
          /api/skills/skills. Auto-selects the new Skill on success. */}
      {showCreateSkillVendorModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-[#f8faff] to-white">
              <h3 className="text-sm font-bold text-[#0b1c30]">Tạo Skill mới</h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreateSkillVendorModal(false);
                  setNewSkillVendorName('');
                }}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
                title="Đóng"
                aria-label="Đóng"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">SKILL AREA</label>
                <div className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-700">
                  {(() => {
                    const grpObj = categories
                      .filter((c: any) => c.is_active)
                      .flatMap((c: any) => c.groups || [])
                      .find((g: any) => String(g.id) === String(drawerForm.skill_solution_id));
                    return grpObj ? grpObj.name : '—';
                  })()}
                </div>
                <p className="text-[10.5px] text-slate-400 mt-1">Skill mới sẽ được gắn vào Skill Area đang chọn.</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Tên Skill <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={newSkillVendorName}
                  onChange={e => setNewSkillVendorName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !creatingSkillVendor) handleCreateSkillVendorFromDrawer();
                  }}
                  placeholder="VD: ReactJS, Python, Docker..."
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-[#0058be]"
                  autoFocus
                />
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowCreateSkillVendorModal(false);
                  setNewSkillVendorName('');
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-md text-slate-600 hover:bg-slate-200"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCreateSkillVendorFromDrawer}
                disabled={creatingSkillVendor || !newSkillVendorName.trim()}
                className="px-4 py-1.5 text-xs font-semibold rounded-md text-white bg-[#0058be] hover:bg-[#004a9e] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingSkillVendor ? 'Đang tạo...' : 'Tạo Skill'}
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
      {/* Modal Đánh dấu bị chặn - DÙNG CHUNG cho Task Edit Drawer, Leader Review
          Detail Drawer, và dropdown Status chọn thẳng 1 status chứa "block"
          (blockPrompt.statusValue có giá trị thì confirm sẽ lưu status đó
          trước khi gọi /block - xem handleConfirmBlockTask). */}
      {blockPrompt && (() => {
        const bpTask = items.find((it: any) => it.id === blockPrompt.taskId);
        if (!bpTask) return null;
        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="p-6 space-y-3">
                <div className="flex items-center gap-3 text-amber-600">
                  <Ban size={22} />
                  <h3 className="text-base font-bold text-[#0b1c30]">Đánh dấu bị chặn</h3>
                </div>
                <p className="text-xs text-slate-500 truncate">{bpTask.task_code} - {bpTask.detail}</p>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Lý do bị chặn *</label>
                  <textarea
                    value={blockReason}
                    onChange={e => setBlockReason(e.target.value)}
                    placeholder="Nhập lý do task bị chặn (bắt buộc)..."
                    rows={3}
                    autoFocus
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-amber-400 transition-colors resize-none"
                  />
                  {blockReason.trim().length > 0 && blockReason.trim().length < 5 && (
                    <p className="text-[11px] text-rose-600 mt-1">Cần tối thiểu 5 ký tự ({blockReason.trim().length}/5).</p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Task phụ thuộc (không bắt buộc)</label>
                  <select
                    value={blockDependencyTaskId}
                    onChange={e => setBlockDependencyTaskId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-[13px] text-[#0b1c30] focus:outline-none focus:border-amber-400"
                  >
                    <option value="">-- Không có --</option>
                    {items.filter((it: any) => it.id !== bpTask.id).map((it: any) => (
                      <option key={it.id} value={it.id}>{it.task_code} - {(it.detail || '').slice(0, 60)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
                <button
                  onClick={() => { setBlockPrompt(null); setBlockReason(''); setBlockDependencyTaskId(''); }}
                  disabled={blockActionBusy}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-60"
                >
                  Huỷ
                </button>
                <button
                  onClick={handleConfirmBlockTask}
                  disabled={blockActionBusy}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors shadow-sm disabled:opacity-60"
                >
                  {blockActionBusy ? 'Đang lưu...' : 'Đánh dấu bị chặn'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal xác nhận xóa task */}
      {taskToDelete !== null && (() => {
        const taskBeingDeleted = items.find(item => item.id === taskToDelete);
        const childCount = taskBeingDeleted?.task_code
          ? items.filter(t => t.task_code && t.task_code.startsWith(`${taskBeingDeleted.task_code}.`)).length
          : 0;
        return (
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
              {childCount > 0 && (
                <p className="text-xs text-red-600 font-semibold leading-relaxed mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  Nhiệm vụ này có {childCount} task con bên dưới — tất cả sẽ bị xóa theo.
                </p>
              )}
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
        );
      })()}

      {/* Modal Di chuyển Task — theo cấp Phase → Task Group → Vị trí */}
      {movingTask !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#0b1c30]">Di chuyển Task</h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{movingTask.detail}</p>
              </div>
              <button
                onClick={() => setMovingTask(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors shrink-0"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Đến Phase</label>
                <select
                  value={moveTargetPhaseId}
                  onChange={(e) => {
                    const newPhaseId = e.target.value === '' ? '' : parseInt(e.target.value, 10);
                    setMoveTargetPhaseId(newPhaseId);
                    const groupsInPhase = taskGroups.filter(g => g.phase_id === newPhaseId);
                    const stillValid = groupsInPhase.some(g => g.id === movingTask.task_group_id);
                    setMoveTargetGroupId(stillValid ? movingTask.task_group_id : (groupsInPhase[0]?.id ?? ''));
                    setMoveTargetPosition(stillValid ? computeCurrentPositionValue(movingTask) : 'end');
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                >
                  {phases.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Đến Task Group</label>
                <SearchableSelect
                  label="Task Group"
                  icon=""
                  options={taskGroups.filter(g => g.phase_id === moveTargetPhaseId).map((g: any) => ({ id: g.id, name: g.name }))}
                  value={moveTargetGroupId === '' ? '' : String(moveTargetGroupId)}
                  onChange={(val: any) => {
                    const newGroupId = val === '' ? '' : parseInt(val, 10);
                    setMoveTargetGroupId(newGroupId);
                    setMoveTargetPosition(newGroupId === movingTask.task_group_id ? computeCurrentPositionValue(movingTask) : 'end');
                  }}
                  placeholder="Chọn Task Group đích..."
                  className="w-full text-[11px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Vị trí</label>
                <select
                  value={moveTargetPosition}
                  onChange={(e) => setMoveTargetPosition(e.target.value)}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                >
                  <option value="start">Đầu danh sách</option>
                  {getRootTasksOfGroup(moveTargetGroupId, movingTask.id).map((t: any) => (
                    <option key={t.id} value={`after:${t.id}`}>
                      Sau {t.task_code} — {(t.detail || '').slice(0, 40)}
                    </option>
                  ))}
                  <option value="end">Cuối danh sách</option>
                </select>
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => setMovingTask(null)}
                disabled={savingMoveTask}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmMoveTask}
                disabled={savingMoveTask || moveTargetGroupId === '' || !moveHasChanged}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors shadow-sm disabled:opacity-50"
              >
                {savingMoveTask ? 'Đang di chuyển...' : 'Di chuyển'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Di chuyển Task Group — vị trí là mode (Đầu/Trước/Sau/Cuối Phase)
          + anchor Group riêng, khác với Task (1 dropdown gộp) vì Group thường
          có ít sibling hơn nên tách 2 bước sẽ rõ ràng hơn. */}
      {movingGroup !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#0b1c30]">Di chuyển Task Group</h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {movingGroup.name} · {(items.filter((t: any) => t.task_group_id === movingGroup.id)).length} Tasks
                </p>
              </div>
              <button
                onClick={() => setMovingGroup(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors shrink-0"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Phase đích</label>
                <select
                  value={moveGroupTargetPhaseId}
                  onChange={(e) => {
                    const newPhaseId = e.target.value === '' ? '' : parseInt(e.target.value, 10);
                    setMoveGroupTargetPhaseId(newPhaseId);
                    // Đổi Phase đích -> anchor Group của Phase cũ không còn hợp
                    // lệ, phải reset (đúng yêu cầu "loại bỏ anchor cũ").
                    const siblings = getGroupsOfPhase(newPhaseId, movingGroup.id);
                    if (siblings.length === 0) {
                      setMoveGroupPositionMode('end');
                      setMoveGroupAnchorId('');
                    } else if (newPhaseId === movingGroup.phase_id) {
                      const current = computeCurrentGroupPosition(movingGroup);
                      setMoveGroupPositionMode(current.mode);
                      setMoveGroupAnchorId(current.anchorGroupId);
                    } else {
                      setMoveGroupPositionMode('end');
                      setMoveGroupAnchorId('');
                    }
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                >
                  {phases.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {moveGroupTargetPhaseId !== '' && moveGroupTargetPhaseId !== movingGroup.phase_id && (() => {
                const sourcePhase = phases.find((p: any) => p.id === movingGroup.phase_id);
                const targetPhase = phases.find((p: any) => p.id === moveGroupTargetPhaseId);
                const taskCount = items.filter((t: any) => t.task_group_id === movingGroup.id).length;
                return (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800 leading-relaxed">
                    <div className="font-semibold">
                      Di chuyển "{movingGroup.name}" từ <strong>{sourcePhase?.name || 'Phase hiện tại'}</strong> → <strong>{targetPhase?.name || ''}</strong>
                    </div>
                    <div className="mt-0.5">{taskCount} Task sẽ được chuyển theo cùng Group.</div>
                  </div>
                );
              })()}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Vị trí</label>
                <select
                  value={moveGroupPositionMode}
                  onChange={(e) => {
                    setMoveGroupPositionMode(e.target.value as typeof moveGroupPositionMode);
                    setMoveGroupAnchorId('');
                  }}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                >
                  {/* Phase đích không có Group nào khác -> chỉ "Cuối Phase" có ý nghĩa */}
                  {moveGroupSiblingsInTargetPhase.length > 0 && <option value="start">Đầu Phase</option>}
                  {moveGroupSiblingsInTargetPhase.length > 0 && <option value="before">Trước Group...</option>}
                  {moveGroupSiblingsInTargetPhase.length > 0 && <option value="after">Sau Group...</option>}
                  <option value="end">Cuối Phase</option>
                </select>
              </div>
              {(moveGroupPositionMode === 'before' || moveGroupPositionMode === 'after') && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">
                    {moveGroupPositionMode === 'before' ? 'Trước Group' : 'Sau Group'}
                  </label>
                  <select
                    value={moveGroupAnchorId}
                    onChange={(e) => setMoveGroupAnchorId(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  >
                    <option value="">-- Chọn Group --</option>
                    {moveGroupSiblingsInTargetPhase.map((g: any) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => setMovingGroup(null)}
                disabled={savingMoveGroup}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmMoveGroup}
                disabled={
                  savingMoveGroup ||
                  !moveGroupHasChanged ||
                  ((moveGroupPositionMode === 'before' || moveGroupPositionMode === 'after') && moveGroupAnchorId === '')
                }
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors shadow-sm disabled:opacity-50"
              >
                {savingMoveGroup ? 'Đang di chuyển...' : 'Di chuyển'}
              </button>
            </div>
          </div>
        </div>
      )}

      {movingPhase !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#0b1c30]">Chuyển Phase sang Project khác</h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {movingPhase.label} · {taskGroups.filter((g: any) => g.phase_id === movingPhase.id).length} Task Group
                </p>
              </div>
              <button
                onClick={() => setMovingPhase(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors shrink-0"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Project đích</label>
                <SearchableSelect
                  label="Project"
                  icon="📁"
                  usePortal
                  options={moveProjectOptions.map((p: any) => ({ id: p.id, name: p.name }))}
                  value={movePhaseTargetProjectId}
                  onChange={(v: any) => setMovePhaseTargetProjectId((typeof v === 'string' && v.toLowerCase() === 'all') || v === '' ? '' : Number(v))}
                  placeholder="Tìm project..."
                />
              </div>
              {movePhaseTargetProjectId !== '' && (() => {
                const groupCount = taskGroups.filter((g: any) => g.phase_id === movingPhase.id).length;
                const taskCount = items.filter((t: any) => {
                  const g = taskGroups.find((gg: any) => gg.id === t.task_group_id);
                  return g && g.phase_id === movingPhase.id;
                }).length;
                const targetProject = moveProjectOptions.find((p: any) => p.id === movePhaseTargetProjectId);
                return (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800 leading-relaxed">
                    <div className="font-semibold">
                      Di chuyển "{movingPhase.label}" từ <strong>{project?.name || 'project hiện tại'}</strong> → <strong>{targetProject?.name || ''}</strong>
                    </div>
                    <div className="mt-0.5">{groupCount} Task Group · {taskCount} Task sẽ được chuyển theo cùng Phase.</div>
                    <div className="mt-0.5">Assigned/Support không thuộc project đích sẽ được giữ nguyên (không tự đổi).</div>
                  </div>
                );
              })()}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">Vị trí</label>
                <select
                  value={movePhasePositionMode}
                  onChange={(e) => {
                    setMovePhasePositionMode(e.target.value as typeof movePhasePositionMode);
                    setMovePhaseAnchorId('');
                  }}
                  disabled={movePhaseTargetProjectId === '' || moveTargetPhasesLoading}
                  className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors disabled:opacity-50"
                >
                  {moveTargetPhases.length > 0 && <option value="start">Đầu Project</option>}
                  {moveTargetPhases.length > 0 && <option value="before">Trước Phase...</option>}
                  {moveTargetPhases.length > 0 && <option value="after">Sau Phase...</option>}
                  <option value="end">Cuối Project</option>
                </select>
              </div>
              {(movePhasePositionMode === 'before' || movePhasePositionMode === 'after') && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">
                    {movePhasePositionMode === 'before' ? 'Trước Phase' : 'Sau Phase'}
                  </label>
                  <select
                    value={movePhaseAnchorId}
                    onChange={(e) => setMovePhaseAnchorId(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-full bg-white border border-[#c2c6d6] rounded-lg px-3 py-2 text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  >
                    <option value="">-- Chọn Phase --</option>
                    {moveTargetPhases.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <button
                onClick={() => setMovingPhase(null)}
                disabled={savingMovePhase}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmMovePhase}
                disabled={
                  savingMovePhase ||
                  movePhaseTargetProjectId === '' ||
                  ((movePhasePositionMode === 'before' || movePhasePositionMode === 'after') && movePhaseAnchorId === '')
                }
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors shadow-sm disabled:opacity-50"
              >
                {savingMovePhase ? 'Đang di chuyển...' : 'Di chuyển'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xóa Phase — cascade delete: Phase + all its Task Groups + all
          Tasks/Sub-tasks are always deletable together, no blocked state. */}
      {phaseToDelete !== null && (() => {
        const phaseGroupIds = taskGroups.filter((g: any) => g.phase_id === phaseToDelete.id).map((g: any) => g.id);
        const groupCount = phaseGroupIds.length;
        const taskCount = items.filter((t: any) => phaseGroupIds.includes(t.task_group_id)).length;
        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-3 text-rose-600">
                  <span className="material-symbols-outlined text-[28px]">warning</span>
                  <h3 className="text-base font-bold text-[#0b1c30]">
                    Xóa Phase "{phaseToDelete.name}"?
                  </h3>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Thao tác này sẽ xóa vĩnh viễn:
                </p>
                <ul className="mt-2 text-xs text-slate-700 space-y-1 list-disc pl-5">
                  <li>{groupCount} Task Group{groupCount !== 1 ? 's' : ''}</li>
                  <li>{taskCount} Task{taskCount !== 1 ? 's' : ''}</li>
                  <li>Các Sub-task bên trong</li>
                </ul>
                <p className="text-xs text-rose-500 mt-3 font-medium">
                  ⚠️ Tất cả dữ liệu thuộc Phase này sẽ bị xóa. Không thể hoàn tác.
                </p>
              </div>
              <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPhaseToDelete(null)}
                  disabled={deletingPhase}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeletePhase}
                  disabled={deletingPhase}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {deletingPhase ? 'Đang xóa...' : 'Xóa Phase'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Xóa Task Group — cascade delete: Group + all its Tasks/
          Sub-tasks, no blocked state. */}
      {groupToDelete !== null && (() => {
        const taskCount = items.filter((t: any) => t.task_group_id === groupToDelete.id).length;
        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-3 text-rose-600">
                  <span className="material-symbols-outlined text-[28px]">warning</span>
                  <h3 className="text-base font-bold text-[#0b1c30]">
                    Xóa Task Group "{groupToDelete.name}"?
                  </h3>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Thao tác này sẽ xóa:
                </p>
                <ul className="mt-2 text-xs text-slate-700 space-y-1 list-disc pl-5">
                  <li>{taskCount} Task{taskCount !== 1 ? 's' : ''}</li>
                  <li>Các Sub-task bên trong</li>
                </ul>
                <p className="text-xs text-rose-500 mt-3 font-medium">
                  ⚠️ Không thể hoàn tác.
                </p>
              </div>
              <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setGroupToDelete(null)}
                  disabled={deletingGroup}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteGroup}
                  disabled={deletingGroup}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {deletingGroup ? 'Đang xóa...' : 'Xóa Task Group'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
                <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center justify-between mb-1.5">
                  <span>Tên Phase *</span>
                  <span className={newPhaseName.length >= 19 ? 'text-rose-500' : 'text-slate-400'}>{newPhaseName.length}/19</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={19}
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
                disabled={savingPhase}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleCreatePhase}
                disabled={savingPhase}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors shadow-sm disabled:opacity-50"
              >
                {savingPhase ? 'Đang tạo...' : 'Tạo Phase'}
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
                <Pencil size={24} />
                <h3 className="text-base font-bold text-[#0b1c30]">Đổi tên Phase</h3>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center justify-between mb-1.5">
                  <span>Tên Phase Mới *</span>
                  <span className={editingPhaseName.length >= 19 ? 'text-rose-500' : 'text-slate-400'}>{editingPhaseName.length}/19</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={19}
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
                disabled={savingPhase}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleRenamePhase}
                disabled={savingPhase}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors shadow-sm disabled:opacity-50"
              >
                {savingPhase ? 'Đang lưu...' : 'Lưu Thay Đổi'}
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
                  disabled={savingTaskGroup}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={savingTaskGroup}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0058be] hover:bg-[#0058be]/90 transition-colors shadow-sm disabled:opacity-50"
                >
                  {savingTaskGroup ? 'Đang lưu...' : (editingTaskGroup ? 'Lưu thay đổi' : 'Tạo Task Group')}
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
  // Anchors the portal menu below (via getBoundingClientRect) — see
  // portalPos effect below for why this renders at document.body instead
  // of inline.
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [portalPos, setPortalPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const lastSyncedEditValue = useRef<string>('');

  // Only resync searchTerm when editValue itself changes to a different member —
  // otherwise every unrelated parent re-render wipes out what the user is typing.
  useEffect(() => {
    if (editValue === lastSyncedEditValue.current) return;
    lastSyncedEditValue.current = editValue;
    const currentMember = projectMembers.find(m => String(m.id) === String(editValue));
    if (currentMember) {
      setSearchTerm(currentMember.display_name || '');
    } else if (!editValue) {
      setSearchTerm('');
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

  // Renders the option list via a portal to document.body (positioned from
  // anchorRef's rect) so it's never clipped by the Tasks table's horizontal
  // scroll container — an inline absolutely-positioned dropdown here gets
  // cut off ("bị che") whenever the cell sits near the container's edge.
  useEffect(() => {
    if (!isOpen || !anchorRef.current) {
      setPortalPos(null);
      return;
    }
    const reposition = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const estimatedHeight = 170;
      const dropUp = window.innerHeight - rect.bottom < estimatedHeight && rect.top > window.innerHeight - rect.bottom;
      setPortalPos({
        top: Math.max(4, dropUp ? rect.top - estimatedHeight : rect.bottom + 4),
        left: rect.left,
        width: rect.width,
      });
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [isOpen]);

  // Same correction as the Skill dropdown below: `estimatedHeight` above is
  // a guess, not the menu's real height — clamp against the actual rendered
  // height once mounted so it can't fly off the top of a short viewport.
  useLayoutEffect(() => {
    if (!isOpen || !portalPos || !menuRef.current) return;
    const menuHeight = menuRef.current.getBoundingClientRect().height;
    const maxTop = Math.max(4, window.innerHeight - menuHeight - 4);
    const clampedTop = Math.min(Math.max(portalPos.top, 4), maxTop);
    if (Math.abs(clampedTop - portalPos.top) > 0.5) {
      setPortalPos(prev => (prev ? { ...prev, top: clampedTop } : prev));
    }
  }, [isOpen, portalPos]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const insideContainer = containerRef.current && containerRef.current.contains(event.target as Node);
      const insideMenu = menuRef.current && menuRef.current.contains(event.target as Node);
      if (!insideContainer && !insideMenu) {
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
      <div className="relative" ref={anchorRef}>
        <input
          type="text"
          value={searchTerm}
          placeholder="Tìm thành viên..."
          autoFocus
          onChange={e => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-white border border-[#0058be] rounded px-2 py-1 text-xs text-[#0b1c30] focus:outline-none font-semibold"
        />
        {isOpen && portalPos && createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: portalPos.top, left: portalPos.left, width: Math.max(portalPos.width, 200), zIndex: 9999 }}
            className="max-h-[170px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-2xl py-1"
          >
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
          </div>,
          document.body
        )}
      </div>
    </td>
  );
}

interface CategorySearchCellProps {
  col: string;
  // 'area' = picking a Skill Area (Group); 'skill' = picking a Skill. Drives
  // the header title/badge and the context line, matching the prototype's
  // "Chọn Skill Area"/"Chọn Skill" popup design.
  kind: 'area' | 'skill';
  items: any[];
  editValue: string;
  placeholder: string;
  onSaveWithAction: (val: string, action?: 'Enter' | 'Tab' | 'ShiftTab') => void;
  onCancel: () => void;
  // Quick-add straight from this cell — same "no match, create it" flow the
  // Task Detail drawer's dedicated + modals already have, just inlined here
  // since editing an EXISTING task's Skill Area/Skill in the table had no
  // create path at all before this (only "add a brand-new task" row and the
  // Task Detail drawer did). Omitted entirely disables quick-add (e.g. the
  // SKILL cell with no Skill Area chosen yet has nothing to attach a new
  // Skill to). areaIdOverride is only used for kind='skill', by the "⚙ Quản
  // lý danh mục" panel's per-Area "+ Skill" (adds to THAT area, not
  // necessarily the task's current one).
  onQuickCreate?: (name: string, areaIdOverride?: number) => Promise<{ id: number | string } | null>;
  // kind='area' only — when provided, the quick-add button opens the shared
  // Category-picker modal (openSkillGroupCreateModal) instead of calling
  // onQuickCreate directly, so creating a Skill Area from this cell always
  // requires an explicit Category choice, same as the Task Detail Drawer.
  onRequestAreaCreate?: (name: string) => void;
  // kind='skill' only — name of the Skill Area currently filtering `items`
  // (task already has one chosen), empty string when searching the whole
  // catalog because none is chosen yet.
  contextAreaName?: string;
  // Full Area→Skills tree, only for the "⚙ Quản lý danh mục" browse panel.
  // Omitted entirely hides that button (e.g. if the tree isn't loaded yet).
  catalogAreas?: { id: number; name: string; skills: { id: number; name: string }[] }[];
  // Steal focus (and so pop the panel open) the moment this cell mounts.
  // Correct when exactly one cell mounts at a time (clicking an EXISTING
  // task's cell to edit it), wrong for the "add new task" row: every column
  // — including both Skill Area and Skill — mounts together as one form, so
  // autofocus-on-mount would pop both panels open with nothing clicked.
  // Those call sites pass false.
  autoFocus?: boolean;
}

function CategorySearchCell({ col, kind, items, editValue, placeholder, onSaveWithAction, onCancel, onQuickCreate, onRequestAreaCreate, contextAreaName, catalogAreas, autoFocus = true }: CategorySearchCellProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const [isOpen, setIsOpen] = useState(autoFocus);
  const [catalogMode, setCatalogMode] = useState(false);
  const [catalogAddingFor, setCatalogAddingFor] = useState<number | null>(null);
  const [catalogSkillName, setCatalogSkillName] = useState('');
  const containerRef = useRef<HTMLTableDataCellElement>(null);
  // Anchors the portal panel below (via getBoundingClientRect) — see
  // portalPos effect below for why this renders at document.body instead
  // of inline.
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [portalPos, setPortalPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const currentItem = items.find(m => String(m.id) === String(editValue));
    if (currentItem) {
      setSearchTerm(currentItem.name || '');
    }
  }, [editValue, items]);

  const filteredItems = items.filter(m => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (m.name || '').toLowerCase().includes(term);
  });

  // Renders the popup panel via a portal to document.body (positioned from
  // anchorRef's rect) so it's never clipped by the Tasks table's horizontal
  // scroll container — an inline absolutely-positioned panel here gets cut
  // off ("bị che") whenever the cell sits near the container's edge.
  useEffect(() => {
    if (!isOpen || !anchorRef.current) {
      setPortalPos(null);
      return;
    }
    const reposition = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const estimatedHeight = 380;
      const dropUp = window.innerHeight - rect.bottom < estimatedHeight && rect.top > window.innerHeight - rect.bottom;
      setPortalPos({
        top: Math.max(4, dropUp ? rect.top - estimatedHeight : rect.bottom + 4),
        left: rect.left,
        width: rect.width,
      });
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [isOpen]);

  // The flip-up decision above uses a fixed `estimatedHeight` guess, not the
  // menu's real rendered height — on a short/narrow screen that guess can be
  // way taller than the menu actually is, pushing `top` far above the anchor
  // (even off the top of the viewport, rendering the dropdown up near the
  // page header instead of next to the cell that opened it). Once the menu
  // has actually rendered, clamp `top` to its real height so it always stays
  // fully on-screen and as close to the anchor as it can.
  useLayoutEffect(() => {
    if (!isOpen || !portalPos || !menuRef.current) return;
    const menuHeight = menuRef.current.getBoundingClientRect().height;
    const maxTop = Math.max(4, window.innerHeight - menuHeight - 4);
    const clampedTop = Math.min(Math.max(portalPos.top, 4), maxTop);
    if (Math.abs(clampedTop - portalPos.top) > 0.5) {
      setPortalPos(prev => (prev ? { ...prev, top: clampedTop } : prev));
    }
  }, [isOpen, portalPos]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const insideContainer = containerRef.current && containerRef.current.contains(event.target as Node);
      const insideMenu = menuRef.current && menuRef.current.contains(event.target as Node);
      if (!insideContainer && !insideMenu) {
        setIsOpen(false);
        onCancel();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onCancel]);

  const handleSelect = (itemId: number, action?: 'Enter' | 'Tab' | 'ShiftTab') => {
    onSaveWithAction(String(itemId), action);
    setIsOpen(false);
  };

  const trimmedSearch = searchTerm.trim();
  const hasExactMatch = trimmedSearch !== '' && items.some(m => (m.name || '').toLowerCase() === trimmedSearch.toLowerCase());
  const canQuickCreate = (Boolean(onQuickCreate) || Boolean(onRequestAreaCreate)) && trimmedSearch.length >= 2 && !hasExactMatch;

  const handleQuickCreate = async () => {
    if (kind === 'area' && onRequestAreaCreate) {
      // Hand off to the shared Category-picker modal instead of creating
      // inline - this cell's job ends here, the modal calls onSaveWithAction
      // for us once the user actually picks a Category and saves.
      onRequestAreaCreate(trimmedSearch);
      setIsOpen(false);
      return;
    }
    if (!onQuickCreate || !trimmedSearch || creating) return;
    setCreating(true);
    try {
      const created = await onQuickCreate(trimmedSearch);
      if (created) handleSelect(Number(created.id));
    } finally {
      setCreating(false);
    }
  };

  const handleCatalogAddSkill = async (areaId: number) => {
    const name = catalogSkillName.trim();
    if (!onQuickCreate || name.length < 2 || creating) return;
    setCreating(true);
    try {
      const created = await onQuickCreate(name, areaId);
      if (created) { setCatalogAddingFor(null); setCatalogSkillName(''); }
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        handleSelect(filteredItems[0].id);
      } else if (canQuickCreate) {
        handleQuickCreate();
      } else {
        onSaveWithAction('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const action = e.shiftKey ? 'ShiftTab' : 'Tab';
      if (filteredItems.length > 0) {
        handleSelect(filteredItems[0].id, action);
      } else {
        onSaveWithAction('', action);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      onCancel();
    }
  };

  const title = kind === 'area' ? 'Chọn Skill Area' : 'Chọn Skill';
  const badge = kind === 'area' ? 'SKILL AREA' : 'SKILL';
  const totalCatalogSkills = (catalogAreas || []).reduce((sum, a) => sum + a.skills.length, 0);

  return (
    <td key={col} className="px-2 py-1 min-w-[150px] relative" ref={containerRef}>
      <div className="relative" ref={anchorRef}>
        <input
          type="text"
          value={searchTerm}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onFocus={() => setIsOpen(true)}
          onChange={e => { setSearchTerm(e.target.value); setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          className="w-full bg-white border border-[#0058be] rounded px-2 py-1 text-xs text-[#0b1c30] focus:outline-none font-semibold"
        />
        {isOpen && portalPos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: portalPos.top, left: portalPos.left, width: Math.max(portalPos.width, 320), zIndex: 9999 }}
          className="max-h-[26rem] bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          {!catalogMode ? (
            <>
              {/* Header — title + kind badge, matching the prototype popup */}
              <div className="px-3 pt-2.5 pb-2 border-b border-slate-100 flex items-center justify-between shrink-0">
                <span className="text-[11px] font-black text-[#0b1c30]">{title}</span>
                <span className="text-[9px] font-bold text-[#0058be] bg-[#eff4ff] border border-[#0058be]/20 px-1.5 py-0.5 rounded">{badge}</span>
              </div>
              {/* Context line */}
              <div className="px-3 py-1.5 text-[10.5px] text-slate-400 border-b border-slate-100 shrink-0">
                {kind === 'area'
                  ? 'Chọn nhóm chuyên môn cấp cao để lọc Skill bên cạnh.'
                  : contextAreaName
                    ? <>Đang lọc theo <span className="font-bold text-[#0058be]">{contextAreaName}</span></>
                    : 'Chưa chọn Skill Area · đang tìm trên toàn bộ danh mục.'}
              </div>
              {/* Options list */}
              <div className="overflow-y-auto max-h-[180px] py-1 shrink-0">
                <div
                  onClick={() => { onSaveWithAction(''); setIsOpen(false); }}
                  className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 cursor-pointer font-bold transition-colors"
                >
                  — Không gán — <span className="text-[9.5px] text-red-300 font-normal">· Xóa lựa chọn</span>
                </div>
                {filteredItems.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-slate-400 italic text-center">Không tìm thấy</div>
                ) : (
                  filteredItems.map((m: any) => (
                    <div
                      key={m.id}
                      onClick={() => handleSelect(m.id)}
                      className="px-3 py-1.5 text-xs text-slate-700 hover:bg-[#eff4ff] hover:text-[#0058be] cursor-pointer font-semibold transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{m.name}</span>
                      {m.meta && <span className="text-[9.5px] text-slate-400 font-normal shrink-0">{m.meta}</span>}
                    </div>
                  ))
                )}
              </div>
              {/* Quick-add form — appears once 2+ chars typed with no exact match */}
              {canQuickCreate && (
                <div className="px-3 py-2.5 border-t border-slate-100 bg-emerald-50/50 shrink-0">
                  <div className="text-[11px] font-bold text-emerald-700">
                    Thêm {kind === 'area' ? 'Skill Area' : 'Skill'} "{trimmedSearch}"
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 mb-2 leading-snug">
                    {kind === 'area'
                      ? 'Bước tiếp theo sẽ hỏi Skill Area này thuộc Category nào trước khi tạo, để không rơi nhầm Category.'
                      : contextAreaName
                        ? <>Skill sẽ được thêm vào Skill Area <b>{contextAreaName}</b> và chọn ngay.</>
                        : 'Chọn Skill Area cha để danh mục luôn có cấu trúc rõ ràng, tránh tạo skill rời rạc.'}
                  </div>
                  <button
                    type="button"
                    onClick={handleQuickCreate}
                    disabled={creating}
                    className="w-full h-7 rounded-md text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {creating ? 'Đang tạo...' : kind === 'area' ? `Chọn Category cho "${trimmedSearch}"` : `+ Thêm "${trimmedSearch}"`}
                  </button>
                </div>
              )}
              {/* Footer hint + catalog toggle */}
              <div className="px-3 py-1.5 border-t border-slate-100 flex items-center justify-between gap-2 shrink-0 bg-slate-50/60">
                <span className="text-[9.5px] text-slate-400 truncate">Gõ để tìm · không có thì thêm nhanh ngay tại đây.</span>
                {catalogAreas && catalogAreas.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCatalogMode(true)}
                    className="text-[10px] font-bold text-[#0058be] hover:underline shrink-0 whitespace-nowrap"
                  >
                    ⚙ Quản lý danh mục
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Catalog browser — read-only structure + per-Area quick-add
                  Skill. Renaming/deleting stays in Settings (already exists
                  there); duplicating full CRUD here would be redundant. */}
              <div className="px-3 pt-2.5 pb-2 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div>
                  <div className="text-[11px] font-black text-[#0b1c30]">Danh mục Skill</div>
                  <div className="text-[9.5px] text-slate-400 mt-0.5">{(catalogAreas || []).length} Skill Area · {totalCatalogSkills} Skills</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setCatalogMode(false); setCatalogAddingFor(null); }}
                  className="text-[10px] font-bold text-slate-500 hover:text-[#0058be] shrink-0"
                >
                  ← Quay lại chọn
                </button>
              </div>
              <div className="overflow-y-auto max-h-[22rem] p-2 space-y-2">
                {(catalogAreas || []).map(a => (
                  <div key={a.id} className="border border-slate-100 rounded-lg p-2">
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-[11px] truncate">{a.name}</b>
                      <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full shrink-0">{a.skills.length} skills</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {a.skills.length ? (
                        a.skills.map(s => (
                          <span key={s.id} className="text-[9.5px] bg-slate-50 border border-slate-200 rounded-full px-1.5 py-0.5 text-slate-600">{s.name}</span>
                        ))
                      ) : (
                        <span className="text-[9.5px] text-slate-300 italic">Chưa có skill</span>
                      )}
                    </div>
                    {catalogAddingFor === a.id ? (
                      <div className="flex items-center gap-1 mt-1.5">
                        <input
                          autoFocus
                          value={catalogSkillName}
                          onChange={e => setCatalogSkillName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); handleCatalogAddSkill(a.id); }
                            if (e.key === 'Escape') { setCatalogAddingFor(null); setCatalogSkillName(''); }
                          }}
                          placeholder="Tên skill..."
                          className="flex-1 h-6 px-1.5 text-[10.5px] border border-slate-200 rounded outline-none focus:border-[#0058be]"
                        />
                        <button
                          type="button"
                          onClick={() => handleCatalogAddSkill(a.id)}
                          disabled={creating || catalogSkillName.trim().length < 2}
                          className="h-6 px-2 text-[10px] font-bold text-white bg-emerald-600 rounded disabled:opacity-50"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCatalogAddingFor(null); setCatalogSkillName(''); }}
                          className="h-6 px-1.5 text-[10px] text-slate-400 hover:text-slate-600"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setCatalogAddingFor(a.id); setCatalogSkillName(''); }}
                        className="text-[10px] font-bold text-[#0058be] hover:underline mt-1.5"
                      >
                        ＋ Skill
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>,
        document.body
        )}
      </div>
    </td>
  );
}

// Helper to render Remark values as styled tag pills
function renderRemarkTags(remarkVal: string, settings: any[]) {
  const cleanVal = (remarkVal || '').trim();
  if (!cleanVal || cleanVal.toLowerCase() === 'trống') {
    return <span className="text-slate-300 font-normal text-[11px] select-none">—</span>;
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

// Link chips - dùng chung giữa cột LINK trên bảng và field Link trong Task
// Detail Drawer. Nhiều link được lưu chung 1 field bằng cách nối "\n" - tách
// thành component riêng để 2 nơi luôn hiển thị/parse/ghi đúng 1 kiểu, tránh
// một input text thường làm mất ký tự xuống dòng và hỏng các link đã lưu.
function normalizeLinkValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Auto-prepend https:// cho domain trần (vd "docs.google.com/..."), giữ
  // nguyên text không phải URL (mã ticket, v.v.).
  return !/^https?:\/\//i.test(trimmed) && /^[a-zA-Z0-9-]+\./.test(trimmed) ? 'https://' + trimmed : trimmed;
}

function appendLinkValue(existing: string, rawInput: string): string {
  const normalized = normalizeLinkValue(rawInput);
  if (!normalized) return existing;
  const links = (existing || '').split('\n').filter(Boolean);
  return [...links, normalized].join('\n');
}

function linkChipLabel(link: string): string {
  if (!/^https?:\/\//i.test(link)) return link;
  try {
    const u = new URL(link);
    const host = u.hostname.replace('www.', '');
    if (host.includes('docs.google.com')) return 'Google Docs';
    if (host.includes('figma.com')) return 'Figma Design';
    if (host.includes('drive.google.com')) return 'Google Drive';
    if (host.includes('github.com')) return 'GitHub';
    if (host.includes('jira')) return 'Jira Ticket';
    if (host.includes('notion')) return 'Notion Page';
    if (host.includes('confluence')) return 'Confluence';
    return host + (u.pathname.length > 15 ? u.pathname.substring(0, 15) + '...' : u.pathname);
  } catch {
    return link;
  }
}

interface LinkChipsEditorProps {
  value: string;
  onChange: (next: string) => void;
  inputValue: string;
  onInputChange: (v: string) => void;
  onInputKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onInputBlur?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}

function LinkChipsEditor({ value, onChange, inputValue, onInputChange, onInputKeyDown, onInputBlur, autoFocus, placeholder }: LinkChipsEditorProps) {
  const links = (value || '').split('\n').filter(Boolean);
  return (
    <div className="flex flex-col gap-1.5">
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {links.map((link, idx) => (
            <div key={idx} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-md text-[11px] font-semibold text-blue-700 shadow-sm overflow-hidden opacity-75">
              <span className="px-2 py-0.5 max-w-[160px] truncate" title={link}>
                🔗 {linkChipLabel(link)}
              </span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(links.filter((_, i) => i !== idx).join('\n'));
                }}
                className="px-1 py-0.5 hover:bg-blue-200 text-blue-500 transition-colors"
                title="Xóa link"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        type="text"
        value={inputValue}
        autoFocus={autoFocus}
        onChange={e => onInputChange(e.target.value)}
        onKeyDown={onInputKeyDown}
        onBlur={onInputBlur}
        className="w-full bg-white border border-[#0058be] rounded px-1.5 py-1 text-xs text-[#0b1c30] focus:outline-none"
        placeholder={placeholder || 'Dán link mới và nhấn Enter...'}
      />
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
                        className={`group flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer text-xs font-semibold transition-all duration-150 ${isSelected
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

interface ParentRemarkSelectCellProps {
  col: string;
  parentRemarks: any[];
  onSelect: (val: string) => void;
  onClear: () => void;
  onCancel: () => void;
}

function ParentRemarkSelectCell({ col, parentRemarks, onSelect, onClear, onCancel }: ParentRemarkSelectCellProps) {
  const containerRef = useRef<HTMLTableDataCellElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCancel]);

  return (
    <td key={col} className="px-2 py-1 min-w-[260px] relative" ref={containerRef}>
      <div className="bg-white border border-emerald-300 rounded-lg shadow-xl z-50 p-2 min-w-[240px]">
        <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide px-1 pb-1.5 border-b border-emerald-100 mb-1.5">
          Chọn Remark Cha
        </div>
        {parentRemarks.length === 0 ? (
          <div className="text-[11px] text-slate-400 italic px-1 py-2">
            Chưa có Remark Cha nào. Vui lòng tạo trong Settings → KPIs.
          </div>
        ) : (
          <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto">
            {parentRemarks.map((pr) => {
              const kpiVal = parseFloat(pr.kpi);
              const lowerName = (pr.performance || '').toLowerCase();
              const isMultiplier = lowerName.includes('fail') || lowerName.includes('rework');
              let kpiText = `${kpiVal} KPI`;
              let kpiBadgeClass = "bg-slate-100 text-slate-600 border-slate-200";
              if (isMultiplier) {
                // FAIL / Rework là hệ số nhân KPI FINAL: ×0.7, ×0.5, ×0
                kpiText = `×${kpiVal}`;
                kpiBadgeClass = kpiVal > 0
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-rose-50 text-rose-700 border-rose-200";
              } else if (kpiVal > 0) {
                kpiText = `+${kpiVal} KPI`;
                kpiBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
              } else if (kpiVal < 0) {
                kpiText = `${kpiVal} KPI`;
                kpiBadgeClass = "bg-rose-50 text-rose-700 border-rose-200";
              } else {
                kpiBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";
              }
              return (
                <button
                  key={pr.id}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect(pr.performance); }}
                  className="text-left text-[11.5px] px-2.5 py-1.5 rounded-md hover:bg-emerald-50 hover:text-emerald-800 text-slate-700 font-semibold transition-colors border border-transparent hover:border-emerald-200 flex items-center gap-2 justify-between w-full"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                    <span className="truncate">{pr.performance}</span>
                  </span>
                  <span className={`shrink-0 text-[9.5px] font-black px-1.5 py-0.5 rounded border ${kpiBadgeClass}`}>
                    {kpiText}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="mt-2 w-full text-[10px] text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded py-1 transition-colors text-center font-semibold"
        >
          🗑 Huỷ Remark hiện tại
        </button>
      </div>
    </td>
  );
}