'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import SearchableSelect from '@/components/common/SearchableSelect';
import ZaloSummaryCard from '@/components/zalo/ZaloSummaryCard';
import { isMemberOrAbove } from '@/lib/auth';
import {
  getZaloStatus,
  importZaloSession,
  disconnectZalo,
  getZaloConversations,
  getZaloAvailableGroups,
  trackZaloGroup,
  getZaloConversationMessages,
  sendZaloMessage,
  sendZaloMessageToThread,
  refreshZaloConversationNames,
  linkZaloConversationToProject,
  getZaloSuggestedMentions,
  getZaloProjectMembers,
  createZaloTaskFromConversation,
  getZaloProjectTasks,
  requestZaloDemo,
  setZaloDemoSkip,
  getProjects,
  getZaloConversationSummaries,
  summarizeZaloConversationNow,
  ZaloConversation,
  ZaloMessage,
  ZaloSuggestedMember,
  ZaloProjectMember,
  ZaloOutgoingMention,
  ZaloProjectTask,
  ZaloTaskStatusFilter,
  ZaloTaskRangeFilter,
  ZaloConversationSummary,
  ZaloAvailableGroup,
} from '@/lib/api';
import { requestZaloSessionCookies, isZaloExtensionInstalled, ZaloExtensionError } from '@/lib/zaloExtension';

const initialsOf = (name: string) =>
  (name || '?').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

const formatDemoAt = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
};

const RANGE_LABELS: Record<ZaloTaskRangeFilter, string> = {
  today: 'Hôm nay',
  yesterday: 'Hôm qua',
  '7d': '7 ngày',
  all: 'Tất cả',
};

export default function ZaloAccountPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (!isMemberOrAbove()) {
      router.push('/dashboard/overview');
    } else {
      setAuthorized(true);
    }
  }, [router]);

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  // Surfaces "task/action succeeded but the Zalo notify failed" — e.g. the
  // Zalo session died silently in the background. Persistent (not a toast)
  // so it isn't missed, since this exact silent failure was the reported bug.
  const [zaloWarning, setZaloWarning] = useState('');
  const [extensionMissing, setExtensionMissing] = useState(false);

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['zalo-status'],
    queryFn: getZaloStatus,
    enabled: authorized,
    refetchInterval: 8000,
  });

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError('');
    setExtensionMissing(false);
    try {
      const installed = await isZaloExtensionInstalled();
      if (!installed) {
        setExtensionMissing(true);
        return;
      }
      const session = await requestZaloSessionCookies();
      await importZaloSession(session);
      await refetchStatus();
    } catch (err) {
      setConnectError(err instanceof ZaloExtensionError ? err.message : (err as any)?.response?.data?.detail || 'Kết nối thất bại.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Ngắt kết nối tài khoản Zalo?')) return;
    await disconnectZalo();
    await refetchStatus();
  };

  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);

  const { data: conversations = [], refetch: refetchConversations } = useQuery({
    queryKey: ['zalo-conversations'],
    queryFn: getZaloConversations,
    enabled: authorized && !!status?.connected,
    refetchInterval: 5000,
  });

  const { data: availableGroups = [], refetch: refetchAvailableGroups } = useQuery({
    queryKey: ['zalo-available-groups'],
    queryFn: getZaloAvailableGroups,
    enabled: authorized && !!status?.connected,
  });

  // Explicit "pick the real group, start tracking it right now" — instead
  // of only ever discovering a conversation reactively (whenever a message
  // happens to arrive through it), which left the user with no way to know
  // which of the auto-populated "Hội thoại nhóm" entries was the one they
  // actually cared about testing/using.
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const handleTrackGroup = async (threadId: string, name: string) => {
    setTrackingId(threadId);
    try {
      const result = await trackZaloGroup(threadId, name);
      await Promise.all([refetchAvailableGroups(), refetchConversations()]);
      setSelectedConversationId(result.conversation_id);
    } catch (err: any) {
      alert('Lỗi theo dõi nhóm: ' + (err.response?.data?.detail || err.message));
    } finally {
      setTrackingId(null);
    }
  };

  const [refreshingNames, setRefreshingNames] = useState(false);
  const handleRefreshNames = async () => {
    setRefreshingNames(true);
    try {
      await refreshZaloConversationNames();
      await refetchConversations();
    } finally {
      setRefreshingNames(false);
    }
  };

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-for-zalo-link'],
    queryFn: () => getProjects(),
    enabled: authorized,
  });

  const handleLinkProject = async (conversationId: number, projectId: string) => {
    await linkZaloConversationToProject(conversationId, projectId ? Number(projectId) : null);
    await refetchConversations();
  };

  // Plain useQuery would re-fetch "the first N messages" every poll and
  // just replace the array — for a conversation with more than N total
  // messages, without pagination that permanently hides everything past
  // the first N no matter how much newer traffic arrives (the actual "tin
  // nhắn không đồng bộ" bug). Poll incrementally instead: track the
  // highest message id we've already got, ask for only what's newer, and
  // append — the backend still returns the latest N on the very first
  // (after_id-less) call so opening a busy conversation isn't empty.
  const [messages, setMessages] = useState<ZaloMessage[]>([]);
  const lastMessageIdRef = useRef<number | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchNewMessages = async () => {
    if (selectedConversationId === null) return;
    const batch = await getZaloConversationMessages(selectedConversationId, lastMessageIdRef.current);
    if (batch.length === 0) return;
    lastMessageIdRef.current = batch[batch.length - 1].id;
    setMessages(prev => [...prev, ...batch]);
  };
  const refetchMessages = fetchNewMessages;

  useEffect(() => {
    setMessages([]);
    lastMessageIdRef.current = undefined;
    if (selectedConversationId === null || !authorized) return;
    fetchNewMessages();
    const interval = setInterval(fetchNewMessages, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId, authorized]);

  // Always land on the newest message — both right after opening a
  // conversation (first batch loads in) and as new messages arrive while
  // it's open. `messages` only changes reference when a genuinely new
  // batch is appended (see fetchNewMessages), so this doesn't re-fire on
  // every idle poll.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const selectedConversation = conversations.find((c: ZaloConversation) => c.id === selectedConversationId) || null;

  const { data: suggestedMentions } = useQuery({
    queryKey: ['zalo-suggested-mentions', selectedConversationId],
    queryFn: () => getZaloSuggestedMentions(selectedConversationId as number),
    enabled: authorized && selectedConversationId !== null && !!selectedConversation?.is_group,
  });

  // Assignee list for the "+ Task" form — this project's OWN member list
  // (project_members), not a live Zalo group-roster fetch. The roster
  // fetch above needs an active Zalo session and goes empty the moment
  // that session expires; the project's member list works regardless of
  // Zalo connectivity, which is what actually matters for "who can this
  // task be assigned to".
  const { data: projectMembers = [] } = useQuery({
    queryKey: ['zalo-project-members', selectedConversationId],
    queryFn: () => getZaloProjectMembers(selectedConversationId as number),
    enabled: authorized && selectedConversationId !== null && !!selectedConversation?.project_id,
  });

  // "Task trong dự án" modal — button stays small/collapsed by default (no
  // background polling of the whole task list) and only fetches once opened;
  // status + range filters re-fetch (cheap — this endpoint is scoped to 1
  // project and capped server-side).
  const [tasksModalOpen, setTasksModalOpen] = useState(false);
  const [taskStatusFilter, setTaskStatusFilter] = useState<ZaloTaskStatusFilter>('done');
  const [taskRangeFilter, setTaskRangeFilter] = useState<ZaloTaskRangeFilter>('all');

  const { data: projectTasks = [], isFetching: projectTasksLoading, refetch: refetchProjectTasks } = useQuery({
    queryKey: ['zalo-project-tasks', selectedConversationId, taskStatusFilter, taskRangeFilter],
    queryFn: () => getZaloProjectTasks(selectedConversationId as number, taskStatusFilter, taskRangeFilter),
    enabled: authorized && selectedConversationId !== null && !!selectedConversation?.project_id && tasksModalOpen,
  });

  // "Tóm tắt" modal — same lazy-fetch-only-when-open shape as Tasks above.
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summarizingNow, setSummarizingNow] = useState(false);
  const [summarizeError, setSummarizeError] = useState('');

  const { data: conversationSummaries = [], isFetching: summariesLoading, refetch: refetchSummaries } = useQuery({
    queryKey: ['zalo-conversation-summaries', selectedConversationId],
    queryFn: () => getZaloConversationSummaries(selectedConversationId as number),
    enabled: authorized && selectedConversationId !== null && summaryModalOpen,
  });

  const handleSummarizeNow = async () => {
    if (selectedConversationId === null) return;
    setSummarizingNow(true);
    setSummarizeError('');
    try {
      await summarizeZaloConversationNow(selectedConversationId);
      await refetchSummaries();
    } catch (e: any) {
      setSummarizeError(e?.response?.data?.detail || 'Lỗi khi tóm tắt.');
    } finally {
      setSummarizingNow(false);
    }
  };

  const [demoTask, setDemoTask] = useState<ZaloProjectTask | null>(null);
  const [demoDate, setDemoDate] = useState('');
  const [demoTime, setDemoTime] = useState('');
  const [requestingDemo, setRequestingDemo] = useState(false);
  const [demoError, setDemoError] = useState('');

  const openDemoForm = (task: ZaloProjectTask) => {
    setDemoTask(task);
    setDemoDate('');
    setDemoTime('');
    setDemoError('');
  };

  const handleRequestDemo = async () => {
    if (!demoTask || selectedConversationId === null) return;
    if (!demoDate || !demoTime) { setDemoError('Chọn cả ngày và giờ demo.'); return; }
    setRequestingDemo(true);
    setDemoError('');
    try {
      await requestZaloDemo(selectedConversationId, { task_id: demoTask.id, demo_at: `${demoDate}T${demoTime}` });
      setDemoTask(null);
      await refetchMessages();
      await refetchProjectTasks();
    } catch (err: any) {
      setDemoError(err?.response?.data?.detail || 'Gửi yêu cầu demo thất bại.');
    } finally {
      setRequestingDemo(false);
    }
  };

  const [togglingSkipTaskId, setTogglingSkipTaskId] = useState<number | null>(null);
  const handleToggleSkipDemo = async (task: ZaloProjectTask, skip: boolean) => {
    if (selectedConversationId === null) return;
    setTogglingSkipTaskId(task.id);
    try {
      await setZaloDemoSkip(selectedConversationId, task.id, skip);
      await refetchProjectTasks();
    } finally {
      setTogglingSkipTaskId(null);
    }
  };

  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const messageInputRef = useRef<HTMLInputElement>(null);

  // "@" autocomplete — typing "@" in this box suggests real group member
  // names (from suggestedMentions) to tag, same names Zalo itself would
  // suggest when tagging directly in the app.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(-1);

  const mentionMatches = (suggestedMentions?.members || []).filter((m: ZaloSuggestedMember) =>
    mentionQuery !== null ? m.zalo_name.toLowerCase().includes(mentionQuery.toLowerCase()) : false
  ).slice(0, 8);

  const handleMessageTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setMessageText(value);
    if (!selectedConversation?.is_group) {
      setMentionQuery(null);
      return;
    }
    const cursor = e.target.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const atIndex = uptoCursor.lastIndexOf('@');
    if (atIndex === -1 || /[\n]/.test(uptoCursor.slice(atIndex))) {
      setMentionQuery(null);
      return;
    }
    const textAfterAt = uptoCursor.slice(atIndex + 1);
    if (textAfterAt.length > 40) {
      setMentionQuery(null);
      return;
    }
    setMentionStart(atIndex);
    setMentionQuery(textAfterAt);
  };

  // Names picked from the autocomplete, kept alongside their real Zalo uid
  // so a genuine (notifying/highlighted) mention can be sent — not just
  // "@Name" as inert text. Positions are computed fresh at send time (see
  // handleSend) rather than tracked through edits, since further typing
  // would shift them.
  const [pickedMentions, setPickedMentions] = useState<{ name: string; uid: string }[]>([]);

  const selectMention = (name: string, uid: string | null) => {
    if (mentionStart === -1) return;
    const cursor = messageInputRef.current?.selectionStart ?? messageText.length;
    const before = messageText.slice(0, mentionStart);
    const after = messageText.slice(cursor);
    const newText = `${before}@${name} ${after}`;
    setMessageText(newText);
    if (uid) {
      setPickedMentions(prev => (prev.some(p => p.name === name) ? prev : [...prev, { name, uid }]));
    }
    setMentionQuery(null);
    setMentionStart(-1);
    requestAnimationFrame(() => {
      const pos = before.length + name.length + 2;
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const handleSend = async () => {
    const finalText = messageText.trim();
    if (!finalText || selectedConversationId === null) return;
    setSending(true);
    try {
      // Resolve each picked name to its position in the FINAL (trimmed)
      // text — if the user edited/removed the inserted "@Name" since
      // picking it, indexOf just won't find it and it's silently dropped
      // (falls back to plain text, no crash).
      const mentions: ZaloOutgoingMention[] = [];
      for (const pm of pickedMentions) {
        const tag = `@${pm.name}`;
        const pos = finalText.indexOf(tag);
        if (pos !== -1) mentions.push({ uid: pm.uid, pos, len: tag.length });
      }
      await sendZaloMessage(selectedConversationId, finalText, mentions.length > 0 ? mentions : undefined);
      setMessageText('');
      setMentionQuery(null);
      setPickedMentions([]);
      await refetchMessages();
    } finally {
      setSending(false);
    }
  };

  // "+ Task" form — direct alternative to the /task text command: pick
  // title/assignee/manday/deadline in a form instead of typing a command.
  // Assignee is picked from THIS PROJECT'S OWN member list (project_members)
  // — not a live Zalo group-roster fetch, which needs an active Zalo
  // session and goes empty the moment that session expires. Each option
  // still shows the person's Zalo name (used for the real @tag when set)
  // alongside their KPI system name.
  const TASK_PRIORITIES = ['Normal', 'High', 'Critical', 'Interrupt'];
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssigneeId, setTaskAssigneeId] = useState('');
  const [taskPriority, setTaskPriority] = useState('Normal');
  const [taskManday, setTaskManday] = useState('1');
  const [taskDeadline, setTaskDeadline] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskFormError, setTaskFormError] = useState('');

  const rosterOptions = projectMembers.map((m: ZaloProjectMember) => ({
    id: String(m.id),
    name: m.zalo_name || m.full_name,
    subtext: m.zalo_name ? `KPI: ${m.full_name}` : '(chưa đặt tên Zalo — vào Hồ sơ để đặt)',
  }));
  const membersMissingZaloName = projectMembers.filter((m: ZaloProjectMember) => !m.zalo_name);

  // presetMemberId: when opened from clicking a roster row (real Zalo
  // roster panel), pre-fill that person as assignee if they're resolvable
  // to a known project member — instead of making the admin search again.
  const openTaskForm = (presetMemberId?: number | null) => {
    setTaskTitle('');
    setTaskAssigneeId(presetMemberId ? String(presetMemberId) : '');
    setTaskPriority('Normal');
    setTaskManday('1');
    setTaskDeadline('');
    setTaskFormError('');
    setTaskFormOpen(true);
  };

  // Matches a live Zalo roster entry (from the "Thành viên nhóm" panel) to
  // a known project member — by zalo_uid first (durable), then zalo_name —
  // so clicking a real Zalo name can still pre-fill the assignee picker.
  const resolveProjectMemberFromRoster = (sm: ZaloSuggestedMember): number | null => {
    const byUid = sm.zalo_uid && projectMembers.find((m: ZaloProjectMember) => m.zalo_uid === sm.zalo_uid);
    if (byUid) return byUid.id;
    const byName = projectMembers.find((m: ZaloProjectMember) => (m.zalo_name || '').toLowerCase() === sm.zalo_name.toLowerCase());
    return byName ? byName.id : null;
  };

  const handleCreateTask = async () => {
    if (selectedConversationId === null) return;
    if (!taskTitle.trim()) { setTaskFormError('Nhập tên task.'); return; }
    const assigneeId = Number(taskAssigneeId);
    if (!assigneeId) { setTaskFormError('Chọn người thực hiện.'); return; }
    const manday = Number(taskManday);
    if (!manday || manday <= 0) { setTaskFormError('Manday không hợp lệ.'); return; }

    setCreatingTask(true);
    setTaskFormError('');
    try {
      const result = await createZaloTaskFromConversation(selectedConversationId, {
        title: taskTitle.trim(),
        assigned_member_id: assigneeId,
        priority: taskPriority,
        manday,
        deadline: taskDeadline || undefined,
      });
      setTaskFormOpen(false);
      if (result.zalo_notify_error) {
        setZaloWarning(`Đã tạo task [${result.task_code}] trong hệ thống, nhưng KHÔNG gửi được tin nhắn thông báo lên Zalo: ${result.zalo_notify_error}. Kiểm tra kết nối Zalo (có thể phiên đã hết hạn, cần Kết nối lại) rồi báo lại nhóm thủ công.`);
      } else {
        setZaloWarning('');
      }
      await refetchMessages();
    } catch (err: any) {
      setTaskFormError(err?.response?.data?.detail || 'Tạo task thất bại.');
    } finally {
      setCreatingTask(false);
    }
  };

  // Phase-1 helper: there is no reliable "browse all Zalo conversations" API
  // (see plan doc), so the first message to a brand-new thread is sent by
  // pasting its Zalo thread/user id by hand.
  const [newThreadId, setNewThreadId] = useState('');
  const [newThreadIsGroup, setNewThreadIsGroup] = useState(false);
  const [newThreadText, setNewThreadText] = useState('');
  const [sendingNewThread, setSendingNewThread] = useState(false);
  const [newThreadError, setNewThreadError] = useState('');

  const handleSendToNewThread = async () => {
    if (!newThreadId.trim() || !newThreadText.trim()) return;
    setSendingNewThread(true);
    setNewThreadError('');
    try {
      const result = await sendZaloMessageToThread({
        thread_id: newThreadId.trim(),
        text: newThreadText.trim(),
        is_group: newThreadIsGroup,
      });
      setNewThreadText('');
      setSelectedConversationId(result.conversation_id);
    } catch (err: any) {
      setNewThreadError(err?.response?.data?.detail || 'Gửi thất bại.');
    } finally {
      setSendingNewThread(false);
    }
  };

  if (!authorized) return null;

  return (
    <div className="flex min-h-screen bg-[#F4F6FB]">
      <Navbar />
      <main className="flex-1 md:ml-64 pt-14 md:pt-0 p-4 md:p-8">
        <div className="max-w-[1400px] mx-auto space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#0058be]/10 flex items-center justify-center text-2xl shrink-0">💬</div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">Tài khoản Zalo giao task</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Kết nối tài khoản Zalo của riêng bạn, gán hội thoại vào dự án, giao task và yêu cầu xem demo trực tiếp từ Zalo.
              </p>
            </div>
          </div>

          {/* Connection status card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full shrink-0 ${status?.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <div>
                  <div className="font-bold text-slate-800 text-[15px]">
                    {status?.connected ? `Đã kết nối — ${status.account?.label}` : 'Chưa kết nối'}
                  </div>
                  {status?.connected && status.account?.last_login_at && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Đăng nhập lần cuối: {new Date(status.account.last_login_at).toLocaleString('vi-VN')}
                    </p>
                  )}
                  {status && !status.worker.configured && (
                    <p className="text-xs text-red-600 font-semibold mt-0.5">Zalo worker chưa được cấu hình (ZALO_WORKER_URL).</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <a href="/zalo-login-extension.zip" download
                  className="px-4 py-2 text-sm font-bold rounded-lg border-2 border-slate-300 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 3v12m0 0l-4-4m4 4l4-4" />
                  </svg>
                  Tải extension
                </a>
                {status?.connected ? (
                  <button onClick={handleDisconnect} className="px-4 py-2 text-sm font-bold rounded-lg border-2 border-red-300 text-red-600 hover:bg-red-50">
                    Ngắt kết nối
                  </button>
                ) : (
                  <button onClick={handleConnect} disabled={connecting} className="px-4 py-2 text-sm font-bold rounded-lg bg-[#0058be] text-white hover:bg-[#00499e] disabled:opacity-60">
                    {connecting ? 'Đang kết nối…' : 'Kết nối'}
                  </button>
                )}
              </div>
            </div>
            {extensionMissing && (
              <div className="mt-3 text-sm text-amber-800 bg-amber-50 border-2 border-amber-200 rounded-lg p-3">
                Chưa cài extension "KPI Portal Zalo Login". Bấm <strong>Tải extension</strong> ở trên, giải nén file zip
                ra 1 thư mục, vào <code>chrome://extensions</code> → bật Developer mode → Load unpacked → chọn thư mục
                vừa giải nén, rồi bấm Kết nối lại.
              </div>
            )}
            {connectError && (
              <div className="mt-3 text-sm text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-3">{connectError}</div>
            )}
          </div>

          {zaloWarning && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="text-xl shrink-0">⚠️</span>
                <p className="text-sm font-semibold text-amber-800">{zaloWarning}</p>
              </div>
              <button onClick={() => setZaloWarning('')} className="text-amber-600 hover:text-amber-800 text-lg leading-none shrink-0">✕</button>
            </div>
          )}

          {/* Explicit group picker — pick the correct real group from Zalo
              (same source-of-truth as the "gửi tin nhắn thử" picker below)
              and start tracking it immediately, instead of waiting for a
              message to reactively create it and hoping it's the right one. */}
          {status?.connected && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-sm font-bold text-slate-700">👥 Chọn nhóm Zalo để theo dõi</span>
                <button onClick={() => refetchAvailableGroups()} className="text-xs font-bold text-slate-500 hover:text-[#0058be]">↻ Tải lại danh sách</button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Đây là danh sách nhóm THẬT lấy trực tiếp từ tài khoản Zalo đang kết nối. Chọn đúng nhóm bạn muốn —
                hệ thống sẽ bắt đầu theo dõi và nhận tin nhắn của nhóm đó ngay, không cần đợi có tin nhắn mới rồi mới tự hiện.
              </p>
              {availableGroups.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Chưa tải được nhóm nào — đợi vài giây sau khi kết nối rồi bấm "Tải lại danh sách".</p>
              ) : (
                <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto border border-slate-100 rounded-xl">
                  {availableGroups.map(g => (
                    <div key={g.thread_id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm font-semibold text-slate-800 truncate">{g.name}</span>
                      {g.already_tracked ? (
                        <span className="shrink-0 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">✓ Đang theo dõi</span>
                      ) : (
                        <button
                          onClick={() => handleTrackGroup(g.thread_id, g.name)}
                          disabled={trackingId === g.thread_id}
                          className="shrink-0 text-[11px] font-bold text-white bg-[#0058be] hover:bg-[#00499e] px-2.5 py-1 rounded-lg disabled:opacity-60"
                        >
                          {trackingId === g.thread_id ? 'Đang thêm…' : '+ Theo dõi'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Manual send-to-new-thread — tucked away, only needed once per brand-new thread */}
          <details className="group bg-white border border-slate-200 rounded-2xl shadow-sm">
            <summary className="cursor-pointer select-none list-none px-5 py-3.5 flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-bold text-slate-700">⚙️ Gửi tin nhắn thử tới 1 hội thoại mới</span>
              <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-5 pb-5">
              <p className="text-xs text-slate-500 mb-3">
                Chưa có danh sách hội thoại đầy đủ (Zalo không cung cấp API duyệt hết hội thoại) — chọn nhanh 1 group bên
                dưới (lấy từ cache của zalo-worker, không cần mở lại chat.zalo.me), hoặc tự nhập Zalo user/group id.
              </p>
              {availableGroups.length > 0 && (
                <div className="mb-2">
                  <SearchableSelect
                    label="group"
                    icon="👥"
                    className="w-full"
                    options={availableGroups.map(g => ({
                      id: g.thread_id,
                      name: g.name,
                      badge: g.already_tracked ? 'Đã có' : undefined,
                    }))}
                    value=""
                    onChange={(id: string) => {
                      const g = availableGroups.find(g => g.thread_id === id);
                      if (g) { setNewThreadId(g.thread_id); setNewThreadIsGroup(true); }
                    }}
                    placeholder="Gõ tên group để tìm nhanh…"
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-center">
                <input value={newThreadId} onChange={e => setNewThreadId(e.target.value)} placeholder="Zalo user/group id"
                  className="px-3 py-2 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal border-2 border-slate-300 rounded-lg w-56 focus:border-[#0058be] focus:outline-none" />
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <input type="checkbox" checked={newThreadIsGroup} onChange={e => setNewThreadIsGroup(e.target.checked)} />
                  Là nhóm
                </label>
                <input value={newThreadText} onChange={e => setNewThreadText(e.target.value)} placeholder="Nội dung tin nhắn"
                  className="px-3 py-2 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal border-2 border-slate-300 rounded-lg flex-1 min-w-[200px] focus:border-[#0058be] focus:outline-none" />
                <button onClick={handleSendToNewThread} disabled={sendingNewThread || !status?.connected}
                  className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-60">
                  {sendingNewThread ? 'Đang gửi…' : 'Gửi'}
                </button>
              </div>
              {newThreadError && <p className="text-xs text-red-600 mt-2">{newThreadError}</p>}
            </div>
          </details>

          {/* Conversation list + thread */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm grid grid-cols-1 md:grid-cols-[380px_1fr] h-[78vh] min-h-[560px] max-h-[860px] overflow-hidden">
            <div className="border-r border-slate-200 flex flex-col min-h-0">
              <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70 shrink-0">
                <span className="text-sm font-bold text-slate-800">Hội thoại nhóm ({conversations.length})</span>
                <button onClick={handleRefreshNames} disabled={refreshingNames}
                  title="Cập nhật lại tên hội thoại từ Zalo (cho các hội thoại cũ)"
                  className="text-xs font-bold text-slate-500 hover:text-[#0058be] disabled:opacity-50">
                  {refreshingNames ? '…' : '↻ Cập nhật tên'}
                </button>
              </div>
              <div className="divide-y divide-slate-100 overflow-y-auto flex-1 min-h-0">
                {conversations.map((c: ZaloConversation) => (
                  <div key={c.id}
                    className={`w-full text-left px-3.5 py-3 cursor-pointer border-l-4 transition-colors ${selectedConversationId === c.id ? 'bg-blue-50 border-l-[#0058be]' : 'border-l-transparent hover:bg-slate-50'}`}
                    onClick={() => setSelectedConversationId(c.id)}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#0058be] to-indigo-500 text-white flex items-center justify-center text-[11px] font-extrabold shrink-0">
                        {initialsOf(c.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-800 truncate">{c.name}</div>
                        <div className="text-xs text-slate-500 truncate">{c.last_message_preview || 'Chưa có tin nhắn'}</div>
                      </div>
                    </div>
                    <select
                      value={c.project_id ?? ''}
                      onClick={e => e.stopPropagation()}
                      onChange={e => handleLinkProject(c.id, e.target.value)}
                      className={`mt-2 w-full text-xs font-semibold rounded-lg px-2 py-1.5 border-2 ${c.project_id ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600'}`}
                      title="Gán hội thoại này vào 1 dự án để giao task/yêu cầu demo qua Zalo">
                      <option value="">— Chưa gán dự án —</option>
                      {projects.map((p: { id: number; name: string }) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {conversations.length === 0 && (
                  <div className="px-4 py-8 text-sm text-slate-400 text-center">Chưa có hội thoại nhóm nào.</div>
                )}
              </div>
            </div>
            <div className="flex flex-col min-h-0">
              {selectedConversationId === null ? (
                <div className="flex-1 flex flex-col items-center justify-center text-sm text-slate-400 gap-2">
                  <span className="text-4xl">👈</span>
                  Chọn 1 hội thoại nhóm để xem tin nhắn.
                </div>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap bg-white shrink-0">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-slate-900 truncate">{selectedConversation?.name}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedConversation?.is_group && (
                        <button onClick={() => setSummaryModalOpen(true)} type="button"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-50 text-indigo-700 border-2 border-indigo-200 hover:bg-indigo-100 whitespace-nowrap">
                          🧠 Tóm tắt
                        </button>
                      )}
                      {selectedConversation?.project_id && (
                        <button onClick={() => setTasksModalOpen(true)} type="button"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 border-2 border-emerald-200 hover:bg-emerald-100 whitespace-nowrap">
                          📋 Task trong dự án
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedConversation?.is_group && suggestedMentions && suggestedMentions.members.length > 0 && (
                    <div className="border-b border-slate-200 px-4 py-2.5 bg-slate-50 max-h-40 overflow-y-auto shrink-0">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                        Thành viên nhóm ({suggestedMentions.total_member})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestedMentions.members.map((sm: ZaloSuggestedMember) => (
                          selectedConversation?.project_id ? (
                            <button key={sm.zalo_name} type="button"
                              onClick={() => openTaskForm(resolveProjectMemberFromRoster(sm))}
                              title={sm.linked
                                ? `Giao task cho ${sm.member_full_name} (khớp tên Zalo)`
                                : 'Chưa liên kết tài khoản KPI — vẫn giao task được, hệ thống sẽ tự tạo hồ sơ tương ứng'}
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border-2 transition-colors ${sm.linked ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100' : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'}`}>
                              {sm.linked ? '✓' : '?'} @{sm.zalo_name}
                            </button>
                          ) : (
                            <span key={sm.zalo_name}
                              title={sm.linked ? `Khớp member: ${sm.member_full_name}` : 'Chưa có member nào đặt Tên Zalo trùng tên này'}
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border-2 ${sm.linked ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
                              {sm.linked ? '✓' : '?'} @{sm.zalo_name}
                            </span>
                          )
                        ))}
                      </div>
                      {selectedConversation?.project_id && (
                        <p className="text-[10px] text-slate-500 mt-1.5">
                          Bấm 1 tên để mở form giao task sẵn người đó — ✓ đã khớp tài khoản KPI, ? chưa khớp (vẫn giao được, hệ thống tự tạo hồ sơ).
                        </p>
                      )}
                    </div>
                  )}
                  <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-2.5 bg-[#FAFBFD]">
                    {messages.map((m: ZaloMessage) => (
                      <div key={m.id} className={`flex ${m.is_outgoing ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${m.is_outgoing ? 'bg-[#0058be] text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                          {!m.is_outgoing && m.sender_name && (
                            <div className="text-[11px] font-bold opacity-70 mb-0.5">{m.sender_name}</div>
                          )}
                          <span className="whitespace-pre-wrap">{m.content}</span>
                        </div>
                      </div>
                    ))}
                    {messages.length === 0 && (
                      <div className="text-sm text-slate-400 text-center py-10">Chưa có tin nhắn.</div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className="border-t border-slate-200 p-3 flex gap-2 relative bg-white shrink-0">
                    {mentionQuery !== null && mentionMatches.length > 0 && (
                      <div className="absolute bottom-full left-3 mb-1 w-64 max-h-48 overflow-y-auto bg-white border-2 border-slate-300 rounded-lg shadow-xl z-10">
                        {mentionMatches.map((m: ZaloSuggestedMember) => (
                          <button key={m.zalo_name} type="button"
                            onClick={() => selectMention(m.zalo_name, m.zalo_uid)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2">
                            <span className={m.linked ? 'text-emerald-600' : 'text-amber-600'}>{m.linked ? '✓' : '?'}</span>
                            <span className="truncate">{m.zalo_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <input ref={messageInputRef} value={messageText} onChange={handleMessageTextChange}
                      onKeyDown={e => {
                        if (e.key === 'Escape') { setMentionQuery(null); return; }
                        if (e.key === 'Enter' && !(mentionQuery !== null && mentionMatches.length > 0)) handleSend();
                      }}
                      placeholder="Nhập tin nhắn… (gõ @ để tag thành viên nhóm)"
                      className="flex-1 px-3 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal border-2 border-slate-300 rounded-lg focus:border-[#0058be] focus:outline-none" />
                    <button onClick={handleSend} disabled={sending} className="px-4 py-2.5 text-sm font-bold rounded-lg bg-[#0058be] text-white hover:bg-[#00499e] disabled:opacity-60">
                      Gửi
                    </button>
                    {selectedConversation?.project_id && (
                      <button onClick={() => openTaskForm()} type="button"
                        title="Tạo task giao cho 1 người trong hội thoại này"
                        className="px-3 py-2.5 text-sm font-bold rounded-lg border-2 border-[#0058be] text-[#0058be] hover:bg-blue-50 whitespace-nowrap">
                        + Task
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      {taskFormOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !creatingTask && setTaskFormOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900 mb-4">Tạo task mới</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên task</label>
                <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)}
                  placeholder="VD: Xây dựng landing page"
                  className="w-full px-3 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal border-2 border-slate-400 rounded-lg focus:border-[#0058be] focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Người thực hiện (thành viên dự án)</label>
                <SearchableSelect
                  label="thành viên"
                  icon="👤"
                  options={rosterOptions}
                  value={taskAssigneeId}
                  onChange={(v) => setTaskAssigneeId(v === 'all' ? '' : String(v))}
                  placeholder="Tìm theo tên Zalo hoặc tên KPI…"
                  className="w-full"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  {membersMissingZaloName.length > 0
                    ? `${membersMissingZaloName.length} người chưa đặt Tên Zalo (${membersMissingZaloName.map((m: ZaloProjectMember) => m.full_name).join(', ')}) — vẫn giao task được, nhưng tag sẽ chỉ là chữ thường (@Tên) chứ chưa tag thật. Vào Hồ sơ cá nhân đặt Tên Zalo để nhận tag thật.`
                    : 'Tất cả thành viên dự án đã có Tên Zalo — tag khi giao task sẽ là tag thật.'}
                </p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Priority</label>
                <select value={taskPriority} onChange={e => setTaskPriority(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm font-semibold text-slate-900 border-2 border-slate-400 rounded-lg bg-white focus:border-[#0058be] focus:outline-none">
                  {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Manday</label>
                  <input type="number" min="0.5" step="0.5" value={taskManday} onChange={e => setTaskManday(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm font-semibold text-slate-900 border-2 border-slate-400 rounded-lg focus:border-[#0058be] focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày demo</label>
                  <input type="date" value={taskDeadline} onChange={e => setTaskDeadline(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm font-semibold text-slate-900 bg-slate-50 border-2 border-slate-400 rounded-lg focus:border-[#0058be] focus:bg-white focus:outline-none" />
                </div>
              </div>
              {taskFormError && <p className="text-xs text-red-600">{taskFormError}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setTaskFormOpen(false)} disabled={creatingTask}
                className="px-4 py-2 text-sm font-semibold rounded-lg border-2 border-slate-300 text-slate-700 hover:bg-slate-50">
                Huỷ
              </button>
              <button onClick={handleCreateTask} disabled={creatingTask}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-[#0058be] text-white hover:bg-[#00499e] disabled:opacity-60">
                {creatingTask ? 'Đang tạo…' : 'Tạo task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tasksModalOpen && selectedConversation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setTasksModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">Task trong dự án</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedConversation.name}</p>
              </div>
              <button onClick={() => setTasksModalOpen(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
            </div>

            <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex rounded-lg border-2 border-slate-300 overflow-hidden">
                <button onClick={() => setTaskStatusFilter('assigned')}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors ${taskStatusFilter === 'assigned' ? 'bg-[#0058be] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  Đã giao
                </button>
                <button onClick={() => setTaskStatusFilter('done')}
                  className={`px-3 py-1.5 text-xs font-bold border-l-2 border-slate-300 transition-colors ${taskStatusFilter === 'done' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  Đã Done
                </button>
              </div>
              <div className="flex rounded-lg border-2 border-slate-300 overflow-hidden">
                {(['today', 'yesterday', '7d', 'all'] as ZaloTaskRangeFilter[]).map((r, idx) => (
                  <button key={r} onClick={() => setTaskRangeFilter(r)}
                    className={`px-3 py-1.5 text-xs font-bold transition-colors ${idx > 0 ? 'border-l-2 border-slate-300' : ''} ${taskRangeFilter === r ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {RANGE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {projectTasksLoading ? (
                <div className="text-sm text-slate-400 text-center py-10">Đang tải…</div>
              ) : projectTasks.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-10">Không có task nào phù hợp bộ lọc.</div>
              ) : (
                projectTasks.map((t: ZaloProjectTask) => (
                  <div key={t.id} className="border-2 border-slate-200 rounded-xl px-3.5 py-3 hover:border-slate-300 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">[{t.task_code}] {t.detail}</div>
                        <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                          <span>{t.assigned_name} · {t.priority} · {t.manday_est} manday</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.status === 'Done' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                            {t.status}
                          </span>
                        </div>
                      </div>
                      {t.status === 'Done' && (
                        <div className="shrink-0 text-right space-y-1">
                          {t.zalo_demo_skip ? (
                            <>
                              <div className="text-[11px] font-bold text-slate-500 whitespace-nowrap">🚫 Không cần xem demo</div>
                              <button onClick={() => handleToggleSkipDemo(t, false)} type="button" disabled={togglingSkipTaskId === t.id}
                                className="text-[11px] font-semibold text-slate-500 hover:text-[#0058be] hover:underline disabled:opacity-50">
                                Hoàn tác
                              </button>
                            </>
                          ) : (
                            <>
                              {t.last_demo_requested_at && (
                                <div className="text-[11px] font-bold text-emerald-700 whitespace-nowrap">
                                  ✅ Đã yêu cầu xem lúc {formatDemoAt(t.last_demo_requested_at)}
                                </div>
                              )}
                              <button onClick={() => openDemoForm(t)} type="button"
                                className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap ${t.last_demo_requested_at ? 'border-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                                {t.last_demo_requested_at ? 'Yêu cầu lại' : 'Yêu cầu xem demo'}
                              </button>
                              <button onClick={() => handleToggleSkipDemo(t, true)} type="button" disabled={togglingSkipTaskId === t.id}
                                className="block w-full text-[11px] font-semibold text-slate-400 hover:text-slate-600 hover:underline disabled:opacity-50">
                                Không cần xem demo
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {summaryModalOpen && selectedConversation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSummaryModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">Tóm tắt hội thoại (AI)</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedConversation.name}</p>
              </div>
              <button onClick={() => setSummaryModalOpen(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
            </div>

            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
              <p className="text-[11px] text-slate-500">Tự động chạy định kỳ theo <code>ZALO_SUMMARY_INTERVAL_SECONDS</code>. Bấm nút bên phải để chạy tóm tắt ngay (test).</p>
              <button onClick={handleSummarizeNow} disabled={summarizingNow} type="button"
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#0058be] text-white hover:bg-[#00499e] disabled:opacity-60 whitespace-nowrap">
                {summarizingNow ? 'Đang tóm tắt…' : '🧠 Tóm tắt ngay'}
              </button>
            </div>

            {summarizeError && (
              <div className="mx-5 mt-3 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 border-2 border-red-200 rounded-lg shrink-0">
                {summarizeError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {summariesLoading ? (
                <div className="text-sm text-slate-400 text-center py-10">Đang tải…</div>
              ) : conversationSummaries.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-10">Chưa có bản tóm tắt nào.</div>
              ) : (
                conversationSummaries.map((s: ZaloConversationSummary) => <ZaloSummaryCard key={s.id} s={s} />)
              )}
            </div>
          </div>
        </div>
      )}

      {demoTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={() => !requestingDemo && setDemoTask(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              {demoTask.last_demo_requested_at ? 'Yêu cầu lại xem demo' : 'Yêu cầu xem demo'}
            </h3>
            <p className="text-[13px] text-slate-600 mb-1">[{demoTask.task_code}] {demoTask.detail} — {demoTask.assigned_name}</p>
            {demoTask.last_demo_requested_at && (
              <p className="text-[11px] font-semibold text-emerald-700 mb-3">
                Đã yêu cầu lúc {formatDemoAt(demoTask.last_demo_requested_at)} — chọn giờ mới bên dưới để yêu cầu lại.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày</label>
                <input type="date" value={demoDate} onChange={e => setDemoDate(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm font-semibold text-slate-900 bg-slate-50 border-2 border-slate-400 rounded-lg focus:border-[#0058be] focus:bg-white focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Giờ</label>
                <input type="time" value={demoTime} onChange={e => setDemoTime(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm font-semibold text-slate-900 bg-slate-50 border-2 border-slate-400 rounded-lg focus:border-[#0058be] focus:bg-white focus:outline-none" />
              </div>
            </div>
            {demoError && <p className="text-xs text-red-600 mt-2">{demoError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setDemoTask(null)} disabled={requestingDemo}
                className="px-4 py-2 text-sm font-semibold rounded-lg border-2 border-slate-300 text-slate-700 hover:bg-slate-50">
                Huỷ
              </button>
              <button onClick={handleRequestDemo} disabled={requestingDemo}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
                {requestingDemo ? 'Đang gửi…' : demoTask.last_demo_requested_at ? 'Gửi yêu cầu lại' : 'Gửi yêu cầu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
