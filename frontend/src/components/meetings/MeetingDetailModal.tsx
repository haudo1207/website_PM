'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Video, ExternalLink, Calendar, Clock, User, Sparkles, Check, Plus, MoreHorizontal, Info, FileText, Download, Copy, ListTodo, ShieldCheck, Search, FolderPlus, Users } from 'lucide-react';
import { pushMeetingTasks, getProjects, getAccounts, updateMeeting } from '@/lib/api';
import SearchableSelect from '@/components/common/SearchableSelect';
import { useQueryClient } from '@tanstack/react-query';

interface MeetingDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: any;
  onEdit?: (meeting: any) => void;
  onSummarize?: (meeting: any) => void;
}

export default function MeetingDetailModal({
  isOpen,
  onClose,
  meeting,
  onEdit,
  onSummarize
}: MeetingDetailModalProps) {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'overview' | 'summary' | 'tasks' | 'transcript' | 'details'>('overview');
  const [isPushing, setIsPushing] = useState(false);
  const [pushedSuccess, setPushedSuccess] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Assign Project Modal State
  const [isAssignProjectOpen, setIsAssignProjectOpen] = useState(false);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [isAssigningProject, setIsAssigningProject] = useState(false);

  // Add Member Modal State (Multi-Select Supported)
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [accountsList, setAccountsList] = useState<any[]>([]);
  const [selectedMemberNames, setSelectedMemberNames] = useState<string[]>([]);
  const [customMemberInput, setCustomMemberInput] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberRole, setMemberRole] = useState('Thành viên');
  const [isAddingMember, setIsAddingMember] = useState(false);

  const [toastText, setToastText] = useState<string | null>(null);

  // Per-task project selection and check state
  const [taskProjectsMap, setTaskProjectsMap] = useState<Record<number, number>>({});
  const [taskCheckedMap, setTaskCheckedMap] = useState<Record<number, boolean>>({});

  // Local State for Instant UI Feedback
  const [localProjectName, setLocalProjectName] = useState('');
  const [localProjectId, setLocalProjectId] = useState<number | null>(null);
  const [localMembers, setLocalMembers] = useState<any[]>([]);

  const creatorName = meeting?.creator_name || meeting?.creator?.display_name || meeting?.created_by_name || 'Host mkt.szone';

  // Auto fetch projects list when modal opens
  useEffect(() => {
    if (isOpen) {
      getProjects().then((res: any) => {
        const items = res?.data || res || [];
        if (Array.isArray(items)) setProjectsList(items);
      }).catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    if (meeting) {
      const pName = typeof meeting.project === 'string' ? meeting.project : (meeting.project?.name || meeting.project_name || '');
      setLocalProjectName(pName);
      setLocalProjectId(meeting.project_id || null);

      const rawMembers = Array.isArray(meeting.members) ? meeting.members : [];
      const hostObj = { display_name: creatorName, role: 'Người tạo (Host)' };
      const hasHost = rawMembers.some((m: any) =>
        (m.display_name && m.display_name.includes('Host')) || (m.role && m.role.includes('Host')) || m.display_name === creatorName
      );
      setLocalMembers(hasHost ? rawMembers : [hostObj, ...rawMembers]);
    }
  }, [meeting, creatorName]);

  if (!isOpen || !meeting) return null;

  // Real Meeting Fields
  const meetingTitle = meeting.title || 'Cuộc họp chưa có tên';
  const durationStr = meeting.duration ? `${meeting.duration} phút` : (meeting.time ? '30 phút' : 'Chưa xác định');
  const platformName = meeting.platform || 'Google Meet';
  const projectName = localProjectName || (typeof meeting.project === 'string' ? meeting.project : (meeting.project?.name || meeting.project_name || ''));
  const isUnassignedProject = !localProjectId && (!projectName || projectName === 'Dự án chung' || projectName === 'Chưa gán dự án');

  const statusUpper = String(meeting.status || 'UPCOMING').toUpperCase();
  const isDone = statusUpper === 'ĐÃ DIỄN RA' || statusUpper === 'DONE' || statusUpper === 'COMPLETED';

  // Join Link carry Host authuser
  const rawLink = meeting.meet_link || meeting.link || meeting.meeting_url || meeting.join_url || '';
  const baseLink = rawLink ? (rawLink.startsWith('http') ? rawLink : `https://${rawLink}`) : 'https://meet.google.com/new';
  const hostJoinLink = baseLink.includes('authuser=')
    ? baseLink
    : `${baseLink}${baseLink.includes('?') ? '&' : '?'}authuser=mkt.szone@gmail.com`;

  // Real AI & Summary Data
  const execSummary = meeting.executive_summary || (meeting.ai_summary?.executive_summary) || (Array.isArray(meeting.summary) && meeting.summary.length ? meeting.summary[0] : '');

  const decisionsList: string[] = meeting.decisions || (meeting.ai_summary?.decisions) || [];
  const tasksList: any[] = meeting.recommended_tasks || (meeting.ai_summary?.recommended_tasks) || [];
  const membersList: any[] = localMembers;
  const rawTranscript = meeting.transcript || meeting.ai_summary?.transcript || '';

  const isN8nSource = meeting.ai_summary?.source === 'n8n_google_sheet' || meeting.ai_summary?.n8n_metadata;
  const n8nTime = meeting.ai_summary?.n8n_metadata?.received_at || meeting.updated_at || meeting.created_at;

  const triggerToast = (msg: string) => {
    setToastText(msg);
    setTimeout(() => setToastText(null), 3000);
  };

  const handleOpenAssignProject = async () => {
    setIsAssignProjectOpen(true);
    try {
      const res = await getProjects();
      const items = res?.data || res || [];
      setProjectsList(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectProject = async (proj: any) => {
    setIsAssigningProject(true);
    try {
      const data = await updateMeeting(meeting.id, { project_id: proj.id });
      setLocalProjectName(proj.name);
      setLocalProjectId(proj.id);
      meeting.project_id = proj.id;
      meeting.project = proj.name;

      if (data?.data) {
        queryClient.setQueryData(['meetings'], (prev: any[] = []) =>
          prev.map(m => m.id === meeting.id ? data.data : m)
        );
      }
      setIsAssignProjectOpen(false);
      triggerToast(`✓ Đã gán dự án "${proj.name}" thành công!`);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Lỗi khi gán dự án');
    } finally {
      setIsAssigningProject(false);
    }
  };

  const toggleSelectMember = (name: string) => {
    setSelectedMemberNames(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const handleOpenAddMember = async () => {
    setIsAddMemberOpen(true);
    setSelectedMemberNames([]);
    setCustomMemberInput('');
    setMemberSearch('');
    try {
      const res = await getAccounts();
      const items = res?.data || res || [];
      setAccountsList(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const namesToAdd = [...selectedMemberNames];
    if (customMemberInput.trim() && !namesToAdd.includes(customMemberInput.trim())) {
      namesToAdd.push(customMemberInput.trim());
    }

    if (namesToAdd.length === 0) {
      alert("Vui lòng chọn ít nhất 1 thành viên hoặc tự nhập tên thành viên!");
      return;
    }

    setIsAddingMember(true);
    try {
      const hostObj = { display_name: creatorName, role: 'Người tạo (Host)' };
      const hasHost = localMembers.some((m: any) =>
        (m.display_name && m.display_name.includes('Host')) || (m.role && m.role.includes('Host')) || m.display_name === creatorName
      );
      const baseList = hasHost ? localMembers : [hostObj, ...localMembers];

      const existingNamesSet = new Set(baseList.map((m: any) => m.display_name || m.full_name || m.name));
      const newMemberObjects = namesToAdd
        .filter(name => !existingNamesSet.has(name))
        .map(name => ({
          display_name: name,
          role: memberRole
        }));

      const updatedMembers = [...baseList, ...newMemberObjects];
      const data = await updateMeeting(meeting.id, { members: updatedMembers });

      setLocalMembers(updatedMembers);
      meeting.members = updatedMembers;

      if (data?.data) {
        queryClient.setQueryData(['meetings'], (prev: any[] = []) =>
          prev.map(m => m.id === meeting.id ? data.data : m)
        );
      }
      setIsAddMemberOpen(false);
      setSelectedMemberNames([]);
      setCustomMemberInput('');
      triggerToast(`✓ Đã thêm ${namesToAdd.length} thành viên tham dự!`);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Lỗi khi thêm thành viên');
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleCopyLink = () => {
    if (!hostJoinLink) return;
    navigator.clipboard.writeText(hostJoinLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handlePushTasks = async () => {
    if (!tasksList.length) {
      alert("Cuộc họp này chưa có Task AI đề xuất để push!");
      return;
    }

    const tasksToPush = tasksList
      .map((t: any, idx: number) => {
        const selectedPid = taskProjectsMap[idx] || localProjectId || meeting.project_id || (projectsList[0]?.id);
        const selectedProj = projectsList.find((p: any) => p.id === selectedPid);
        return {
          ...t,
          project_id: selectedPid,
          project_name: selectedProj?.name || t.project_name || localProjectName,
          checked: taskCheckedMap[idx] !== false
        };
      })
      .filter((t: any) => t.checked);

    if (tasksToPush.length === 0) {
      alert("Vui lòng chọn ít nhất 1 task để đẩy vào dự án.");
      return;
    }

    setIsPushing(true);
    try {
      await pushMeetingTasks(meeting.id, tasksToPush);
      setPushedSuccess(true);
      triggerToast(`✓ Đã đẩy ${tasksToPush.length} task vào dự án thành công!`);
      setTimeout(() => setPushedSuccess(false), 3000);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Có lỗi khi push task vào dự án");
    } finally {
      setIsPushing(false);
    }
  };

  const handleDownloadTranscript = () => {
    if (!rawTranscript) {
      alert("Chưa có nội dung biên bản cuộc họp để tải về.");
      return;
    }
    const filename = `${meetingTitle.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_')}_Bien_ban.txt`;
    const blob = new Blob([rawTranscript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyTranscript = () => {
    if (!rawTranscript) return;
    navigator.clipboard.writeText(rawTranscript);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs animate-in fade-in duration-200 p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col border border-slate-200 animate-in zoom-in-95 duration-200 max-h-[92vh] my-auto">
        
        {/* Top Header Bar with Back Link */}
        <div className="px-6 pt-5 pb-4 bg-white border-b border-[#e2e8f0]">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#64748b] hover:text-[#0b1c30] transition-colors mb-3"
          >
            <ArrowLeft size={14} />
            <span>Quay lại danh sách cuộc họp</span>
          </button>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Title & Badges */}
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-extrabold text-[#0b1c30] tracking-tight">
                  {meetingTitle}
                </h2>
                <span className={`px-3 py-0.5 rounded-full text-xs font-bold ${
                  isDone 
                    ? 'bg-[#dcfce7] text-[#166534]' 
                    : 'bg-blue-50 text-blue-700'
                }`}>
                  {isDone ? 'Completed' : 'Scheduled'}
                </span>
              </div>

              {/* Sub-Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {execSummary ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#f5f3ff] text-[#6366f1]">
                    AI Summary sẵn sàng
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                    Chưa có AI Summary
                  </span>
                )}

                {isUnassignedProject ? (
                  <button 
                    type="button"
                    onClick={handleOpenAssignProject}
                    className="px-3 py-1 rounded-full text-[11px] font-extrabold bg-[#fef3c7] hover:bg-[#fde68a] text-[#92400e] border border-[#f59e0b]/40 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    title="Bấm để chọn và gán dự án"
                  >
                    <span>⚠️ Chưa gán Dự án</span>
                    <span className="underline text-[10px] font-bold opacity-80">(Bấm để gán)</span>
                  </button>
                ) : (
                  <button 
                    type="button"
                    onClick={handleOpenAssignProject}
                    className="px-3 py-1 rounded-full text-[11px] font-bold bg-blue-50 hover:bg-blue-100 text-[#0058be] border border-blue-200 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    title="Bấm để thay đổi dự án"
                  >
                    <span>📁 {projectName}</span>
                    <span className="text-[10px] opacity-75 font-semibold">(Đổi)</span>
                  </button>
                )}

                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#f1f5f9] text-[#64748b]">
                  {platformName}
                </span>
              </div>

              {/* Sub-Info Line */}
              <div className="flex items-center gap-4 text-xs text-[#64748b] flex-wrap font-medium pt-1">
                <span className="flex items-center gap-1">
                  <Calendar size={14} className="text-[#94a3b8]" />
                  {meeting.date || meeting.meeting_date || 'Chưa chọn'} · {meeting.time || meeting.start_time || 'Chưa chọn'}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={14} className="text-[#94a3b8]" />
                  {durationStr}
                </span>
                <span className="flex items-center gap-1">
                  <User size={14} className="text-[#94a3b8]" />
                  {creatorName}
                </span>
                {rawLink && (
                  <div className="flex items-center gap-1.5 bg-[#f5f3ff] px-2.5 py-1 rounded-lg border border-[#e0e7ff]">
                    <a
                      href={hostJoinLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#6366f1] font-bold hover:underline flex items-center gap-1 text-[11px]"
                      title="Mở Google Meet"
                    >
                      <ExternalLink size={12} />
                      <span>{rawLink.replace(/^https?:\/\//, '')}</span>
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="text-[#6366f1] hover:text-[#4f46e5] p-0.5 rounded hover:bg-[#eee9fe] transition-colors flex items-center gap-1"
                      title="Sao chép đường link cuộc họp"
                    >
                      {copiedLink ? (
                        <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">
                          ✓ Đã chép!
                        </span>
                      ) : (
                        <Copy size={13} className="text-[#6366f1]" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons Top Right */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-2.5 text-[#64748b] hover:text-[#0b1c30] rounded-xl hover:bg-slate-100 transition-colors border border-[#cbd5e1]"
                  title="Tùy chọn khác"
                >
                  <MoreHorizontal size={18} />
                </button>

                {showMenu && (
                  <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 text-xs font-medium space-y-0.5">
                    <button
                      onClick={() => { setShowMenu(false); onEdit?.(meeting); }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[#0b1c30] flex items-center gap-2"
                    >
                      <span>✏️ Chỉnh sửa cuộc họp</span>
                    </button>
                    <button
                      onClick={() => { setShowMenu(false); handleCopyLink(); }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-[#6366f1] flex items-center gap-2"
                    >
                      <span>📋 Sao chép link họp</span>
                    </button>
                    {onSummarize && (
                      <button
                        onClick={() => { setShowMenu(false); onSummarize(meeting); }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-purple-700 flex items-center gap-2 border-t border-slate-100"
                      >
                        <span>✨ Dán biên bản / Chạy AI</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <a
                href={hostJoinLink}
                target="_blank"
                rel="noreferrer"
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-2"
                title="Vào Google Meet bằng tài khoản Host mkt.szone@gmail.com"
              >
                <Video size={16} />
                <span>Tham gia (Host mkt.szone)</span>
                <ExternalLink size={13} />
              </a>
            </div>
          </div>

          {/* Sub Navigation Tabs */}
          <div className="flex items-center gap-6 border-t border-[#e2e8f0] mt-5 pt-3 text-xs font-bold text-[#64748b]">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'overview' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              Tổng quan
            </button>
            <button
              onClick={() => setActiveTab('summary')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'summary' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              AI Summary
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'tasks' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              Task đề xuất ({tasksList.length})
            </button>
            <button
              onClick={() => setActiveTab('transcript')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'transcript' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              Biên bản
            </button>
            <button
              onClick={() => setActiveTab('details')}
              className={`pb-2 border-b-2 transition-colors ${activeTab === 'details' ? 'border-[#6366f1] text-[#6366f1]' : 'border-transparent hover:text-[#0b1c30]'}`}
            >
              Thông tin chi tiết
            </button>
          </div>
        </div>

        {/* Modal Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-[#f8fafc]">
          
          {/* TAB 1: TỔNG QUAN */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column (7 Cols ~ 60%) */}
              <div className="lg:col-span-7 space-y-5">
                
                {/* Card 1: Thông tin cuộc họp */}
                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-4">
                  <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">
                    Thông tin cuộc họp
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-[#64748b] block mb-1">Dự án</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        {isUnassignedProject ? (
                          <span className="px-2.5 py-1 rounded-lg bg-[#fef3c7] text-[#92400e] font-bold text-[11px]">
                            ⚠️ Chưa gán dự án
                          </span>
                        ) : (
                          <span className="font-bold text-[#0b1c30] text-xs">{projectName}</span>
                        )}
                        <button 
                          type="button"
                          onClick={handleOpenAssignProject} 
                          className="px-3 py-1.5 text-xs font-extrabold text-[#6366f1] bg-[#f5f3ff] hover:bg-[#6366f1] hover:text-white border border-[#c7d2fe] hover:border-[#6366f1] rounded-xl transition-all shadow-2xs cursor-pointer flex items-center gap-1.5 active:scale-95"
                        >
                          <FolderPlus size={14} />
                          <span>{isUnassignedProject ? '+ Gán Dự Án Ngay' : 'Đổi Dự Án'}</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Nguồn dữ liệu</span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#ccfbf1] text-[#0f766e] font-bold text-[11px] inline-block">
                        {isN8nSource ? 'Tự động / Webhook' : 'Trực tiếp / Hệ thống'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Người tạo / Host</span>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-200 text-[#475569] font-bold text-[10px] flex items-center justify-center">
                          {creatorName[0]}
                        </div>
                        <span className="font-bold text-[#0b1c30]">{creatorName}</span>
                      </div>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Nền tảng</span>
                      <span className="font-bold text-[#0b1c30] flex items-center gap-1.5">
                        <Video size={14} className="text-[#6366f1]" />
                        {platformName}
                      </span>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Thời gian</span>
                      <span className="font-bold text-[#0b1c30]">
                        {meeting.date || meeting.meeting_date || 'Chưa chọn'} · {meeting.time || meeting.start_time || 'Chưa chọn'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[#64748b] block mb-1">Trạng thái</span>
                      <span className={`font-bold flex items-center gap-1.5 ${isDone ? 'text-[#166534]' : 'text-blue-600'}`}>
                        <span className={`w-2 h-2 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                        {isDone ? 'Completed' : 'Scheduled'}
                      </span>
                    </div>
                  </div>

                  {/* Sync Notification Box if n8n source */}
                  {isN8nSource && (
                    <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-[#1e40af]">
                      <div className="flex items-center gap-2">
                        <Info size={16} className="text-[#2563eb] shrink-0" />
                        <span>Cuộc họp này đã được xử lý và đồng bộ tự động lúc {n8nTime ? String(n8nTime).slice(0, 16) : 'gần đây'}.</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card 2: Thành viên tham dự */}
                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">
                      Thành viên tham dự ({membersList.length > 0 ? membersList.length : 1} người)
                    </h3>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap">
                    {membersList.length > 0 ? (
                      membersList.map((mb: any, idx: number) => {
                        const name = mb.display_name || mb.full_name || mb.name || 'Thành viên';
                        const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
                        const colors = ['bg-[#e0e7ff] text-[#4338ca]', 'bg-[#dcfce7] text-[#15803d]', 'bg-[#fef3c7] text-[#b45309]', 'bg-[#fae8ff] text-[#a21caf]'];

                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <div className={`w-9 h-9 rounded-full ${colors[idx % colors.length]} font-bold text-xs flex items-center justify-center shadow-2xs`}>
                              {initials}
                            </div>
                            <div className="text-xs">
                              <p className="font-bold text-[#0b1c30] leading-none">{name}</p>
                              <p className="text-[10px] text-[#64748b] mt-0.5">{mb.role || 'Thành viên'}</p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-[#e0e7ff] text-[#4338ca] font-bold text-xs flex items-center justify-center">
                          {creatorName[0]}
                        </div>
                        <div className="text-xs">
                          <p className="font-bold text-[#0b1c30] leading-none">{creatorName}</p>
                          <p className="text-[10px] text-[#64748b] mt-0.5">Người tạo (Host)</p>
                        </div>
                      </div>
                    )}

                    <button 
                      onClick={handleOpenAddMember} 
                      className="w-9 h-9 rounded-full border-2 border-dashed border-[#cbd5e1] hover:border-[#6366f1] text-[#64748b] hover:text-[#6366f1] font-bold text-xs flex items-center justify-center transition-colors cursor-pointer"
                      title="Thêm thành viên tham dự"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                {/* Card 3: Real Timeline */}
                <div className="bg-white rounded-2xl p-5 border border-[#e2e8f0] shadow-2xs space-y-4">
                  <h3 className="text-xs font-extrabold text-[#0b1c30] uppercase tracking-wider">
                    Nhật ký hoạt động
                  </h3>

                  <div className="space-y-4 relative pl-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                    <div className="relative">
                      <div className="absolute -left-5 top-1 w-3 h-3 rounded-full bg-[#6366f1] ring-4 ring-white"></div>
                      <div className="flex items-start justify-between text-xs">
                        <div>
                          <p className="font-bold text-[#0b1c30]">Khởi tạo cuộc họp</p>
                          <p className="text-[#64748b] mt-0.5">Cuộc họp đã được tạo trong hệ thống bởi {creatorName}</p>
                        </div>
                        <span className="text-[11px] text-[#94a3b8]">
                          {meeting.created_at ? String(meeting.created_at).slice(0, 16) : 'Gần đây'}
                        </span>
                      </div>
                    </div>

                    {execSummary && (
                      <div className="relative">
                        <div className="absolute -left-5 top-1 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                        <div className="flex items-start justify-between text-xs">
                          <div>
                            <p className="font-bold text-[#0b1c30]">AI Summary & Task Đề Xuất</p>
                            <p className="text-[#64748b] mt-0.5">Đã cập nhật bản tóm tắt và bóc tách công việc đề xuất</p>
                          </div>
                          <span className="text-[11px] text-[#94a3b8]">
                            {n8nTime ? String(n8nTime).slice(0, 16) : 'Hoàn tất'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Right Column: AI TÓM TẮT Widget (5 Cols ~ 40%) */}
              <div className="lg:col-span-5">
                <div className="bg-white rounded-2xl p-5 border border-[#e0e7ff] shadow-sm space-y-5 sticky top-4">
                  
                  {/* Widget Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[#6366f1]">
                      <Sparkles size={16} />
                      <h3 className="text-xs font-extrabold uppercase tracking-wider">AI TÓM TẮT</h3>
                    </div>
                    {onSummarize && (
                      <button onClick={() => onSummarize?.(meeting)} className="text-[11px] font-bold text-[#6366f1] hover:underline bg-[#f5f3ff] px-2.5 py-1 rounded-lg">
                        Dán / Chạy AI
                      </button>
                    )}
                  </div>

                  {/* Section 1: TÓM TẮT ĐIỀU HÀNH */}
                  <div className="space-y-1.5">
                    <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
                      TÓM TẮT ĐIỀU HÀNH
                    </h4>
                    {execSummary ? (
                      <p className="text-xs text-[#334155] leading-relaxed font-normal bg-[#f8f6ff] p-3 rounded-xl border border-[#eee9fe]">
                        {execSummary}
                      </p>
                    ) : (
                      <p className="text-xs text-[#94a3b8] italic bg-slate-50 p-3 rounded-xl border border-slate-200">
                        Chưa có bản tóm tắt. Bạn có thể nhấn 'Dán / Chạy AI' để tạo tóm tắt tự động.
                      </p>
                    )}
                  </div>

                  {/* Section 2: QUYẾT ĐỊNH CHÍNH */}
                  {decisionsList.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
                        QUYẾT ĐỊNH CHÍNH
                      </h4>
                      <ul className="space-y-2 text-xs text-[#334155]">
                        {decisionsList.map((dec: string, idx: number) => (
                          <li key={idx} className="flex items-start gap-2">
                            <Check size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                            <span>{dec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Section 3: TASK ĐỀ XUẤT */}
                  {tasksList.length > 0 && (
                    <div className="space-y-2.5 pt-1">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
                          TASK ĐỀ XUẤT
                        </h4>
                        <span className="px-2 py-0.5 bg-[#f1f5f9] text-[#475569] text-[10px] font-bold rounded-full">
                          {tasksList.length} tasks
                        </span>
                      </div>

                      <div className="space-y-2">
                        {tasksList.map((t: any, idx: number) => {
                          const priority = t.priority || 'Normal';
                          const pColor = priority === 'High' || priority === 'Critical' 
                            ? 'bg-red-500' 
                            : priority === 'Medium' 
                            ? 'bg-blue-500' 
                            : 'bg-emerald-500';

                          return (
                            <div key={idx} className="p-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl flex items-center justify-between gap-3 text-xs">
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${pColor}`}></span>
                                  <span className="text-[11px] font-bold text-slate-600">{priority}</span>
                                  <p className="font-bold text-[#0b1c30] truncate">{t.detail_task || t.title || t.name}</p>
                                </div>
                                <div className="flex items-center gap-3 text-[11px] text-[#64748b] font-medium pl-4">
                                  <span>👤 {t.owner || t.assigned_name || creatorName}</span>
                                  {t.deadline && <span>📅 {t.deadline}</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={handlePushTasks}
                          disabled={isPushing}
                          className="w-full py-3 bg-[#6366f1] hover:bg-[#4f46e5] disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                        >
                          {isPushing ? (
                            <span>Đang push task...</span>
                          ) : pushedSuccess ? (
                            <span>✓ Đã push task thành công!</span>
                          ) : (
                            <span>📥 Đẩy task vào dự án</span>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              </div>

            </div>
          )}

          {/* TAB 2: AI SUMMARY (DEDICATED FULL VIEW) */}
          {activeTab === 'summary' && (
            <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0] shadow-2xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-[#6366f1]">
                  <Sparkles size={20} />
                  <h3 className="text-base font-extrabold text-[#0b1c30]">Bản Tóm Tắt AI Chi Tiết</h3>
                </div>
                {onSummarize && (
                  <button onClick={() => onSummarize?.(meeting)} className="px-4 py-2 bg-[#f5f3ff] hover:bg-[#eee9fe] text-[#6366f1] text-xs font-bold rounded-xl transition-colors">
                    Dán biên bản / Chạy lại AI
                  </button>
                )}
              </div>

              {execSummary ? (
                <div className="space-y-6">
                  {/* Executive Summary Box */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">TÓM TẮT ĐIỀU HÀNH</h4>
                    <div className="p-4 bg-[#f8f6ff] border border-[#eee9fe] rounded-2xl text-sm text-[#334155] leading-relaxed">
                      {execSummary}
                    </div>
                  </div>

                  {/* Decisions List */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">CÁC QUYẾT ĐỊNH CHÍNH ({decisionsList.length})</h4>
                    {decisionsList.length > 0 ? (
                      <div className="space-y-2">
                        {decisionsList.map((dec, i) => (
                          <div key={i} className="p-3.5 bg-emerald-50/60 border border-emerald-200/80 rounded-xl flex items-start gap-3 text-xs text-[#065f46]">
                            <Check size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                            <span className="font-medium">{dec}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#94a3b8] italic">Chưa ghi nhận quyết định nào từ AI.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center mx-auto">
                    <Sparkles size={24} />
                  </div>
                  <p className="text-sm font-bold text-[#0b1c30]">Chưa có AI Summary cho cuộc họp này</p>
                  <p className="text-xs text-[#64748b]">Bấm "Dán biên bản / Chạy AI" để phân tích tóm tắt cuộc họp.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TASK ĐỀ XUẤT (DEDICATED FULL VIEW WITH PER-TASK PROJECT SELECTOR & PUSH BUTTON) */}
          {activeTab === 'tasks' && (
            <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0] shadow-2xs space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-[#6366f1]">
                  <ListTodo size={20} />
                  <h3 className="text-base font-extrabold text-[#0b1c30]">Task Đề Xuất Từ AI ({tasksList.length})</h3>
                </div>

                {tasksList.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Global Apply Project SearchableSelect */}
                    {projectsList.length > 0 && (
                      <div className="flex items-center gap-1.5 min-w-[200px]">
                        <span className="hidden sm:inline text-xs font-semibold text-[#475569] shrink-0">Gán tất cả:</span>
                        <SearchableSelect
                          label="dự án"
                          options={projectsList.map((p) => ({ id: p.id, name: p.name }))}
                          value=""
                          onChange={(val: any) => {
                            const pid = Number(val);
                            if (!pid) return;
                            const updated: Record<number, number> = {};
                            tasksList.forEach((_, i) => { updated[i] = pid; });
                            setTaskProjectsMap(updated);
                          }}
                          placeholder="Gõ tìm & gán tất cả..."
                          searchThreshold={0}
                          className="w-48 sm:w-56"
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handlePushTasks}
                      disabled={isPushing}
                      className="px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] disabled:bg-slate-300 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-2"
                    >
                      {isPushing ? 'Đang push task...' : pushedSuccess ? '✓ Đã push task thành công!' : '📥 Đẩy task đã chọn vào Dự án'}
                    </button>
                  </div>
                )}
              </div>

              {tasksList.length > 0 ? (
                <div className="space-y-3">
                  {tasksList.map((t, idx) => {
                    const priority = t.priority || 'Normal';
                    const pBadge = priority === 'High' || priority === 'Critical'
                      ? 'bg-red-100 text-red-800 border-red-200'
                      : priority === 'Medium'
                      ? 'bg-blue-100 text-blue-800 border-blue-200'
                      : 'bg-emerald-100 text-emerald-800 border-emerald-200';

                    const isChecked = taskCheckedMap[idx] !== false;
                    const currentTaskProjectId = taskProjectsMap[idx] || localProjectId || meeting.project_id || '';

                    return (
                      <div key={idx} className={`p-4 border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${isChecked ? 'border-[#cbd5e1] bg-white shadow-2xs' : 'border-slate-200 opacity-60 bg-slate-50'}`}>
                        <div className="space-y-2 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${pBadge}`}>
                              {priority}
                            </span>
                            <h4 className="font-bold text-[#0b1c30] text-xs sm:text-sm">{t.detail_task || t.title || t.name}</h4>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs text-[#64748b] font-medium pt-0.5">
                            <span>👤 Người thực hiện: <b className="text-[#0b1c30]">{t.owner || t.assigned_name || creatorName}</b></span>
                            {t.deadline && <span>📅 Hạn chót: <b className="text-[#0b1c30]">{t.deadline}</b></span>}

                            {/* Per-task Searchable Project Selector */}
                            <div className="flex items-center gap-1.5 min-w-[200px]">
                              <span className="text-[11px] font-bold text-[#475569] shrink-0">📁 Dự án:</span>
                              <SearchableSelect
                                label="dự án"
                                options={projectsList.map((p) => ({ id: p.id, name: p.name }))}
                                value={currentTaskProjectId}
                                onChange={(val: any) => {
                                  const pid = Number(val);
                                  setTaskProjectsMap(prev => ({ ...prev, [idx]: pid }));
                                }}
                                placeholder="Gõ tìm dự án..."
                                searchThreshold={0}
                                className="w-48 sm:w-56"
                              />
                            </div>
                          </div>
                        </div>

                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setTaskCheckedMap(prev => ({ ...prev, [idx]: checked }));
                          }}
                          className="w-5 h-5 text-[#6366f1] rounded border-slate-300 focus:ring-[#6366f1] cursor-pointer self-end sm:self-center shrink-0"
                          title="Chọn task để đẩy vào dự án"
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <div className="w-12 h-12 bg-slate-100 text-[#64748b] rounded-full flex items-center justify-center mx-auto">
                    <ListTodo size={24} />
                  </div>
                  <p className="text-sm font-bold text-[#0b1c30]">Chưa có task đề xuất</p>
                  <p className="text-xs text-[#64748b]">AI chưa phát hiện hành động hoặc công việc cụ thể từ biên bản cuộc họp này.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: BIÊN BẢN (TRANSCRIPT) */}
          {activeTab === 'transcript' && (
            <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0] shadow-2xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-[#6366f1]">
                  <FileText size={20} />
                  <h3 className="text-base font-extrabold text-[#0b1c30]">Biên Bản Cuộc Họp (Transcript)</h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyTranscript}
                    disabled={!rawTranscript}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-[#cbd5e1] text-[#475569] text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1.5"
                  >
                    <Copy size={14} />
                    <span>{copiedTranscript ? 'Đã sao chép!' : 'Sao chép'}</span>
                  </button>

                  <button
                    onClick={handleDownloadTranscript}
                    disabled={!rawTranscript}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-[#cbd5e1] text-[#0b1c30] text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1.5"
                  >
                    <Download size={14} />
                    <span>Tải file (.txt)</span>
                  </button>
                </div>
              </div>

              {rawTranscript ? (
                <div className="p-4 bg-[#f8fafc] border border-[#e2e8f0] rounded-2xl text-xs font-mono text-[#334155] whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto select-all">
                  {rawTranscript}
                </div>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <div className="w-12 h-12 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center mx-auto">
                    <FileText size={24} />
                  </div>
                  <p className="text-sm font-bold text-[#0b1c30]">Cuộc họp chưa có file biên bản / Transcript</p>
                  <p className="text-xs text-[#64748b]">Bạn có thể nhấn 'Dán biên bản / Chạy AI' để thêm nội dung cuộc họp.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: THÔNG TIN CHI TIẾT */}
          {activeTab === 'details' && (
            <div className="bg-white rounded-2xl p-6 border border-[#e2e8f0] shadow-2xs space-y-6">
              <div className="flex items-center gap-2 text-[#6366f1] border-b border-slate-100 pb-4">
                <ShieldCheck size={20} />
                <h3 className="text-base font-extrabold text-[#0b1c30]">Thông Tin Kỹ Thuật & Chi Tiết</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">ID Cuộc họp</span>
                  <p className="font-bold text-[#0b1c30]">#{meeting.id}</p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Nền tảng & Host Link</span>
                  <p className="font-bold text-[#6366f1] truncate">{hostJoinLink}</p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Dự án liên kết</span>
                  <p className="font-bold text-[#0b1c30]">{projectName || 'Chưa gán dự án'}</p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Thời gian tạo bản ghi</span>
                  <p className="font-bold text-[#0b1c30]">{meeting.created_at ? String(meeting.created_at) : 'N/A'}</p>
                </div>
              </div>

              {/* Raw AI Summary Payload if available */}
              {meeting.ai_summary && (
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-bold text-[#64748b] uppercase tracking-wider">DỮ LIỆU GỐC AI PAYLOAD (JSON)</h4>
                  <pre className="p-4 bg-slate-900 text-emerald-400 rounded-2xl text-[11px] font-mono overflow-x-auto max-h-60">
                    {JSON.stringify(meeting.ai_summary, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

        </div>

      </div>

      {/* Toast Notification Banner */}
      {toastText && (
        <div className="fixed top-6 right-6 z-[99] bg-[#0b1c30] text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-bold border border-slate-700 animate-in fade-in slide-in-from-top-3 duration-200">
          <Check size={18} className="text-emerald-400" />
          <span>{toastText}</span>
        </div>
      )}

      {/* Gán Dự Án Modal */}
      {isAssignProjectOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-[#0b1c30] flex items-center gap-2">
                <span>📁 Gán dự án cho cuộc họp</span>
              </h3>
              <button onClick={() => setIsAssignProjectOpen(false)} className="text-[#94a3b8] hover:text-[#0b1c30] text-xs font-bold">✕</button>
            </div>

            <div className="relative">
              <Search size={15} className="absolute left-3 top-2.5 text-[#94a3b8]" />
              <input
                type="text"
                placeholder="Tìm tên dự án..."
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs text-[#0b1c30] focus:outline-none focus:border-[#6366f1]"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1.5 pt-1">
              {projectsList.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">Đang tải danh sách dự án...</p>
              ) : (
                projectsList
                  .filter(p => (p.name || '').toLowerCase().includes(projectSearch.toLowerCase()))
                  .map(proj => (
                    <button
                      key={proj.id}
                      disabled={isAssigningProject}
                      onClick={() => handleSelectProject(proj)}
                      className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-[#f5f3ff] transition-all flex items-center justify-between border border-transparent hover:border-[#e0e7ff] text-xs"
                    >
                      <div>
                        <p className="font-bold text-[#0b1c30]">{proj.name}</p>
                        <p className="text-[10px] text-[#64748b]">{proj.code || proj.customer_name || 'Dự án hệ thống'}</p>
                      </div>
                      <span className="text-xs font-bold text-[#6366f1]">Chọn →</span>
                    </button>
                  ))
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => setIsAssignProjectOpen(false)} className="px-4 py-2 text-xs font-bold text-[#64748b] bg-white border border-[#cbd5e1] hover:bg-slate-50 rounded-xl transition-colors">
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thêm Thành Viên Modal (Multi-Select Supported) */}
      {isAddMemberOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-[#0b1c30] flex items-center gap-2">
                  <Users size={18} className="text-[#6366f1]" />
                  <span>Thêm thành viên tham dự (Chọn nhiều)</span>
                </h3>
                <p className="text-[11px] text-[#64748b] mt-0.5">Tích chọn nhiều nhân sự công ty hoặc tự nhập tên người ngoài</p>
              </div>
              <button onClick={() => setIsAddMemberOpen(false)} className="text-[#94a3b8] hover:text-[#0b1c30] text-xs font-bold p-1">✕</button>
            </div>

            <form onSubmit={handleAddMemberSubmit} className="space-y-4">
              {/* Search Input */}
              <div className="relative">
                <Search size={15} className="absolute left-3 top-2.5 text-[#94a3b8]" />
                <input
                  type="text"
                  placeholder="Tìm tên hoặc email nhân sự..."
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs text-[#0b1c30] focus:outline-none focus:border-[#6366f1]"
                />
              </div>

              {/* Staff Multi-Select List */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-bold text-[#64748b] uppercase">Danh sách nhân sự công ty</label>
                  <span className="text-[11px] font-bold text-[#6366f1]">Đã chọn: {selectedMemberNames.length} người</span>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1 p-2 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl">
                  {accountsList.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">Đang tải danh sách nhân sự...</p>
                  ) : (
                    accountsList
                      .filter(acc => {
                        const name = acc.full_name || acc.display_name || acc.email || '';
                        return name.toLowerCase().includes(memberSearch.toLowerCase());
                      })
                      .map((acc, idx) => {
                        const name = acc.full_name || acc.display_name || acc.email || `Nhân sự #${acc.id}`;
                        const isChecked = selectedMemberNames.includes(name);
                        const isAlreadyInMeeting = localMembers.some(m => (m.display_name || m.name) === name);

                        return (
                          <label
                            key={acc.id || idx}
                            className={`flex items-center justify-between p-2 rounded-lg transition-all text-xs cursor-pointer ${
                              isAlreadyInMeeting 
                                ? 'opacity-50 bg-slate-100 cursor-not-allowed'
                                : isChecked 
                                ? 'bg-[#f5f3ff] border border-[#e0e7ff] text-[#4338ca]' 
                                : 'hover:bg-white text-[#0b1c30]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                disabled={isAlreadyInMeeting}
                                checked={isChecked || isAlreadyInMeeting}
                                onChange={() => !isAlreadyInMeeting && toggleSelectMember(name)}
                                className="w-4 h-4 text-[#6366f1] rounded border-slate-300 focus:ring-[#6366f1] cursor-pointer"
                              />
                              <div className="w-7 h-7 rounded-full bg-[#e0e7ff] text-[#4338ca] font-bold text-[10px] flex items-center justify-center shrink-0">
                                {name[0]?.toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold truncate leading-tight">{name}</p>
                                <p className="text-[10px] text-[#64748b] truncate">{acc.email || acc.role || 'Thành viên công ty'}</p>
                              </div>
                            </div>
                            {isAlreadyInMeeting && (
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-md">Đã tham gia</span>
                            )}
                          </label>
                        );
                      })
                  )}
                </div>
              </div>

              {/* Custom External Name Input */}
              <div>
                <label className="block text-[10px] font-bold text-[#64748b] uppercase mb-1">Hoặc tự nhập tên người ngoài (Nếu có)</label>
                <input
                  type="text"
                  placeholder="Nhập tên người tham dự ngoài công ty..."
                  value={customMemberInput}
                  onChange={e => setCustomMemberInput(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs text-[#0b1c30] focus:outline-none focus:border-[#6366f1]"
                />
              </div>

              {/* Role Select */}
              <div>
                <label className="block text-[10px] font-bold text-[#64748b] uppercase mb-1">Vai trò cho các thành viên được chọn</label>
                <select
                  value={memberRole}
                  onChange={e => setMemberRole(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-xl text-xs text-[#0b1c30] font-medium focus:outline-none focus:border-[#6366f1]"
                >
                  <option value="Thành viên">Thành viên (Participant)</option>
                  <option value="PM / Chủ trì">PM / Chủ trì</option>
                  <option value="Host">Host</option>
                  <option value="Người ghi chép">Người ghi chép</option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-[#6366f1]">
                  Tổng thêm: {selectedMemberNames.length + (customMemberInput.trim() ? 1 : 0)} người
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsAddMemberOpen(false)} className="px-4 py-2 text-xs font-bold text-[#64748b] bg-white border border-[#cbd5e1] hover:bg-slate-50 rounded-xl transition-colors">
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isAddingMember || (selectedMemberNames.length === 0 && !customMemberInput.trim())}
                    className="px-4 py-2 text-xs font-bold text-white bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check size={15} />
                    <span>{isAddingMember ? 'Đang thêm...' : `Xác nhận thêm (${selectedMemberNames.length + (customMemberInput.trim() ? 1 : 0)})`}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


