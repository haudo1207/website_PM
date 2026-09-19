'use client';

// Shared "message pane" for ONE Zalo conversation — messages, @-mention
// send box, "+Task" creation, "Tóm tắt" (AI digest) and "Task trong dự án"
// modals, and the demo-request flow. Extracted from /zalo-account so a
// project's own Chats tab can embed the exact same rich view scoped to
// whichever single group that project has linked (see GroupPicker in
// ProjectZaloSummaryTab) — no conversation switcher, no project-link
// dropdown, since both of those only make sense on the account-wide page.
import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import SearchableSelect from '@/components/common/SearchableSelect';
import ZaloSummaryCard from '@/components/zalo/ZaloSummaryCard';
import {
  getZaloConversation,
  getZaloConversationMessages,
  sendZaloMessage,
  getZaloSuggestedMentions,
  getZaloProjectMembers,
  createZaloTaskFromConversation,
  getZaloProjectTasks,
  requestZaloDemo,
  setZaloDemoSkip,
  getZaloConversationSummaries,
  summarizeZaloConversationNow,
  ZaloMessage,
  ZaloSuggestedMember,
  ZaloProjectMember,
  ZaloOutgoingMention,
  ZaloProjectTask,
  ZaloTaskStatusFilter,
  ZaloTaskRangeFilter,
  ZaloConversationSummary,
} from '@/lib/api';

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

const TASK_PRIORITIES = ['Normal', 'High', 'Critical', 'Interrupt'];

export default function ZaloConversationPane({ conversationId }: { conversationId: number }) {
  // The conversation object itself (name, project_id, is_group) — resolved
  // by id directly (not filtered out of the connector's own conversation
  // list) so any project member the conversation is linked to can open this
  // pane, not just whoever personally connected the Zalo session.
  const { data: conversation = null } = useQuery({
    queryKey: ['zalo-conversation', conversationId],
    queryFn: () => getZaloConversation(conversationId),
    refetchInterval: 15_000,
  });

  const [messages, setMessages] = useState<ZaloMessage[]>([]);
  const lastMessageIdRef = useRef<number | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchNewMessages = async () => {
    const batch = await getZaloConversationMessages(conversationId, lastMessageIdRef.current);
    if (batch.length === 0) return;
    lastMessageIdRef.current = batch[batch.length - 1].id;
    setMessages(prev => [...prev, ...batch]);
  };
  const refetchMessages = fetchNewMessages;

  useEffect(() => {
    setMessages([]);
    lastMessageIdRef.current = undefined;
    fetchNewMessages();
    // 1.5s (was 4s) — the worker already forwards each Zalo message to the
    // backend the instant its own listener fires (no batching on that side),
    // so this interval is the only remaining hop between "message landed in
    // our DB" and "shows up on screen". Cheap poll (just an indexed id>
    // filter, empty batches short-circuit immediately), worth tightening.
    const interval = setInterval(fetchNewMessages, 1500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const { data: suggestedMentions } = useQuery({
    queryKey: ['zalo-suggested-mentions', conversationId],
    queryFn: () => getZaloSuggestedMentions(conversationId),
    enabled: !!conversation?.is_group,
  });

  const { data: projectMembers = [] } = useQuery({
    queryKey: ['zalo-project-members', conversationId],
    queryFn: () => getZaloProjectMembers(conversationId),
    enabled: !!conversation?.project_id,
  });

  const [tasksModalOpen, setTasksModalOpen] = useState(false);
  const [taskStatusFilter, setTaskStatusFilter] = useState<ZaloTaskStatusFilter>('done');
  const [taskRangeFilter, setTaskRangeFilter] = useState<ZaloTaskRangeFilter>('all');

  const { data: projectTasks = [], isFetching: projectTasksLoading, refetch: refetchProjectTasks } = useQuery({
    queryKey: ['zalo-project-tasks', conversationId, taskStatusFilter, taskRangeFilter],
    queryFn: () => getZaloProjectTasks(conversationId, taskStatusFilter, taskRangeFilter),
    enabled: !!conversation?.project_id && tasksModalOpen,
  });

  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summarizingNow, setSummarizingNow] = useState(false);
  const [summarizeError, setSummarizeError] = useState('');

  const { data: conversationSummaries = [], isFetching: summariesLoading, refetch: refetchSummaries } = useQuery({
    queryKey: ['zalo-conversation-summaries', conversationId],
    queryFn: () => getZaloConversationSummaries(conversationId),
    enabled: summaryModalOpen,
  });

  const handleSummarizeNow = async () => {
    setSummarizingNow(true);
    setSummarizeError('');
    try {
      await summarizeZaloConversationNow(conversationId);
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
    if (!demoTask) return;
    if (!demoDate || !demoTime) { setDemoError('Chọn cả ngày và giờ demo.'); return; }
    setRequestingDemo(true);
    setDemoError('');
    try {
      await requestZaloDemo(conversationId, { task_id: demoTask.id, demo_at: `${demoDate}T${demoTime}` });
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
    setTogglingSkipTaskId(task.id);
    try {
      await setZaloDemoSkip(conversationId, task.id, skip);
      await refetchProjectTasks();
    } finally {
      setTogglingSkipTaskId(null);
    }
  };

  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const messageInputRef = useRef<HTMLInputElement>(null);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(-1);

  const mentionMatches = (suggestedMentions?.members || []).filter((m: ZaloSuggestedMember) =>
    mentionQuery !== null ? m.zalo_name.toLowerCase().includes(mentionQuery.toLowerCase()) : false
  ).slice(0, 8);

  const handleMessageTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setMessageText(value);
    if (!conversation?.is_group) {
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
    if (!finalText) return;
    setSending(true);
    try {
      const mentions: ZaloOutgoingMention[] = [];
      for (const pm of pickedMentions) {
        const tag = `@${pm.name}`;
        const pos = finalText.indexOf(tag);
        if (pos !== -1) mentions.push({ uid: pm.uid, pos, len: tag.length });
      }
      await sendZaloMessage(conversationId, finalText, mentions.length > 0 ? mentions : undefined);
      setMessageText('');
      setMentionQuery(null);
      setPickedMentions([]);
      await refetchMessages();
    } finally {
      setSending(false);
    }
  };

  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssigneeId, setTaskAssigneeId] = useState('');
  const [taskPriority, setTaskPriority] = useState('Normal');
  const [taskManday, setTaskManday] = useState('1');
  const [taskDeadline, setTaskDeadline] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskFormError, setTaskFormError] = useState('');
  const [zaloWarning, setZaloWarning] = useState('');

  const rosterOptions = projectMembers.map((m: ZaloProjectMember) => ({
    id: String(m.id),
    name: m.zalo_name || m.full_name,
    subtext: m.zalo_name ? `KPI: ${m.full_name}` : '(chưa đặt tên Zalo — vào Hồ sơ để đặt)',
  }));
  const membersMissingZaloName = projectMembers.filter((m: ZaloProjectMember) => !m.zalo_name);

  const openTaskForm = (presetMemberId?: number | null) => {
    setTaskTitle('');
    setTaskAssigneeId(presetMemberId ? String(presetMemberId) : '');
    setTaskPriority('Normal');
    setTaskManday('1');
    setTaskDeadline('');
    setTaskFormError('');
    setTaskFormOpen(true);
  };

  const resolveProjectMemberFromRoster = (sm: ZaloSuggestedMember): number | null => {
    const byUid = sm.zalo_uid && projectMembers.find((m: ZaloProjectMember) => m.zalo_uid === sm.zalo_uid);
    if (byUid) return byUid.id;
    const byName = projectMembers.find((m: ZaloProjectMember) => (m.zalo_name || '').toLowerCase() === sm.zalo_name.toLowerCase());
    return byName ? byName.id : null;
  };

  const handleCreateTask = async () => {
    if (!taskTitle.trim()) { setTaskFormError('Nhập tên task.'); return; }
    const assigneeId = Number(taskAssigneeId);
    if (!assigneeId) { setTaskFormError('Chọn người thực hiện.'); return; }
    const manday = Number(taskManday);
    if (!manday || manday <= 0) { setTaskFormError('Manday không hợp lệ.'); return; }

    setCreatingTask(true);
    setTaskFormError('');
    try {
      const result = await createZaloTaskFromConversation(conversationId, {
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

  if (!conversation) {
    return <div className="text-sm text-slate-400 text-center py-16">Đang tải…</div>;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col h-[70vh] min-h-[480px] max-h-[780px] overflow-hidden">
      {zaloWarning && (
        <div className="bg-amber-50 border-b-2 border-amber-300 p-3 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-2.5">
            <span className="text-lg shrink-0">⚠️</span>
            <p className="text-xs font-semibold text-amber-800">{zaloWarning}</p>
          </div>
          <button onClick={() => setZaloWarning('')} className="text-amber-600 hover:text-amber-800 text-base leading-none shrink-0">✕</button>
        </div>
      )}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap bg-white shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-slate-900 truncate">{conversation.name}</div>
        </div>
        <div className="flex items-center gap-2">
          {conversation.is_group && (
            <button onClick={() => setSummaryModalOpen(true)} type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-50 text-indigo-700 border-2 border-indigo-200 hover:bg-indigo-100 whitespace-nowrap">
              🧠 Tóm tắt
            </button>
          )}
          {conversation.project_id && (
            <button onClick={() => setTasksModalOpen(true)} type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 border-2 border-emerald-200 hover:bg-emerald-100 whitespace-nowrap">
              📋 Task trong dự án
            </button>
          )}
        </div>
      </div>
      {conversation.is_group && suggestedMentions && suggestedMentions.members.length > 0 && (
        <div className="border-b border-slate-200 px-4 py-2.5 bg-slate-50 max-h-40 overflow-y-auto shrink-0">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
            Thành viên nhóm ({suggestedMentions.total_member})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestedMentions.members.map((sm: ZaloSuggestedMember) => (
              conversation.project_id ? (
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
          {conversation.project_id && (
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
        {conversation.project_id && (
          <button onClick={() => openTaskForm()} type="button"
            title="Tạo task giao cho 1 người trong hội thoại này"
            className="px-3 py-2.5 text-sm font-bold rounded-lg border-2 border-[#0058be] text-[#0058be] hover:bg-blue-50 whitespace-nowrap">
            + Task
          </button>
        )}
      </div>

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

      {tasksModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setTasksModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">Task trong dự án</h3>
                <p className="text-xs text-slate-500 mt-0.5">{conversation.name}</p>
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

      {summaryModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSummaryModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">Tóm tắt hội thoại (AI)</h3>
                <p className="text-xs text-slate-500 mt-0.5">{conversation.name}</p>
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
                conversationSummaries.map((s: ZaloConversationSummary) => (
                  <ZaloSummaryCard key={s.id} s={s} projectId={conversation.project_id ?? undefined} />
                ))
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
