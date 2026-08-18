'use client';
import React, { useState, useEffect } from 'react';
import { X, Sparkles, AlertTriangle, CheckCircle, Send, FileText } from 'lucide-react';

import { pushMeetingTasks, getProjects, getAccounts, updateMeeting } from '@/lib/api';
import { getToken } from '@/lib/auth';
import SearchableSelect from '@/components/common/SearchableSelect';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  meeting: any;
  onSave: (m: any) => void;
}

export default function SummarizeModal({ isOpen, onClose, meeting, onSave }: Props) {
  const [transcript, setTranscript] = useState('');
  const [executiveSummary, setExecutiveSummary] = useState('');
  const [decisions, setDecisions] = useState<string[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [membersList, setMembersList] = useState<any[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedCreatorId, setSelectedCreatorId] = useState<number | null>(null);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState('');
  const [error, setError] = useState('');
  const [showTranscriptTab, setShowTranscriptTab] = useState(false);

  useEffect(() => {
    if (meeting && isOpen) {
      setTranscript(meeting.transcript || '');
      setExecutiveSummary(meeting.executive_summary || '');
      setDecisions(meeting.decisions || []);
      setSelectedProjectId(meeting.project_id || null);
      setSelectedCreatorId(meeting.created_by || null);

      const existingTasks = Array.isArray(meeting.recommended_tasks)
        ? meeting.recommended_tasks.map((t: any) => ({ ...t, checked: true }))
        : [];
      setTasks(existingTasks);

      // If no transcript and no summary, default to show transcript input tab
      if (!meeting.transcript && !meeting.executive_summary) {
        setShowTranscriptTab(true);
      } else {
        setShowTranscriptTab(false);
      }

      setError('');
      setPushSuccess('');
    }
  }, [meeting, isOpen]);


  useEffect(() => {
    if (isOpen) {
      getProjects().then(res => {
        if (Array.isArray(res)) setProjectsList(res);
        else if (res && res.data) setProjectsList(res.data);
      }).catch(err => console.error("Error loading projects:", err));

      getAccounts().then(res => {
        if (Array.isArray(res)) setMembersList(res);
        else if (res && res.data) setMembersList(res.data);
      }).catch(err => console.error("Error loading members:", err));
    }
  }, [isOpen]);

  const handleSummarize = async () => {
    if (!transcript.trim()) {
      setError('Vui lòng dán/nhập biên bản cuộc họp trước.');
      return;
    }
    setIsLoading(true);
    setError('');
    setPushSuccess('');
    try {
      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers,
        body: JSON.stringify({ meetingId: meeting.id, transcript })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.executive_summary) setExecutiveSummary(data.executive_summary);
        if (data.decisions) setDecisions(data.decisions);
        if (data.recommended_tasks) {
          setTasks(data.recommended_tasks.map((t: any) => ({ ...t, checked: true })));
        }
        setShowTranscriptTab(false);
        if (data.data) onSave(data.data);
      } else {
        setError(data.error || 'Lỗi khi gửi văn bản đến AI.');
      }
    } catch (err: any) {
      setError(err.message || 'Không thể kết nối API tóm tắt.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePushTasks = async () => {
    if (!meeting) return;
    const selectedTasks = tasks.filter(t => t.checked);
    if (selectedTasks.length === 0) {
      setError('Hãy chọn ít nhất một task để push vào Project.');
      return;
    }

    setIsPushing(true);
    setError('');
    setPushSuccess('');

    try {
      const res = await pushMeetingTasks(meeting.id, selectedTasks);
      if (res.success) {
        setPushSuccess(`✓ Đã push ${selectedTasks.length} task vào Project. Member được giao việc đã nhận thông báo; task mới đã xuất hiện trong tổng task của Project và được đưa vào kỳ KPI/Manday.`);
      } else {
        setError('Không thể push task vào Project.');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Lỗi khi push task vào Project');
    } finally {
      setIsPushing(false);
    }
  };

  const handleSaveAssignment = async () => {
    if (!meeting?.id) return;
    setIsSavingAssignment(true);
    setError('');
    setPushSuccess('');
    try {
      const res = await updateMeeting(meeting.id, {
        ...meeting,
        project_id: selectedProjectId,
        created_by: selectedCreatorId
      });
      if (res.success) {
        setPushSuccess('✓ Đã cập nhật Dự án và Người tạo cuộc họp thành công!');
        if (onSave) onSave(res.data);
      } else {
        setError('Không thể lưu thông tin phân công.');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Lỗi khi lưu phân công cuộc họp');
    } finally {
      setIsSavingAssignment(false);
    }
  };

  if (!isOpen || !meeting) return null;

  const attendeeCount = Array.isArray(meeting.members) 
    ? meeting.members.length 
    : (meeting.member_count !== undefined ? meeting.member_count : (meeting.people || 0));

  const timeInfo = `${meeting.date || meeting.meeting_date || 'Chưa đặt ngày'} · ${meeting.time || meeting.start_time || 'Chưa đặt giờ'} · ${attendeeCount} người tham dự`;

  const currentProjectName = projectsList.find(p => p.id === selectedProjectId)?.name || meeting.project_name || meeting.project || 'Dự án chung';
  const currentCreatorName = membersList.find(m => m.id === selectedCreatorId)?.display_name || membersList.find(m => m.id === selectedCreatorId)?.full_name || meeting.creator_name || 'Chưa chọn người tạo';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl h-full shadow-2xl overflow-y-auto flex flex-col p-6 space-y-5 animate-in slide-in-from-right duration-200 border-l border-slate-200">
        
        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-[#17253d]">AI Meeting Summary & Tasks</h2>
            <p className="text-xs text-slate-500 mt-0.5">Tự động tóm tắt nội dung cuộc họp và gợi ý các task khuyến nghị</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Meeting Info Subheader Banner + Quick Project & Creator Selection */}
        <div className="p-3.5 bg-[#eef6ff] border border-[#cfe4ff] rounded-xl text-xs space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <strong className="text-[#1769d2] text-sm block">{meeting.title || 'Cuộc họp'}</strong>
              <span className="text-[#59687f] block font-medium mt-0.5">{timeInfo}</span>
            </div>
          </div>

          {/* Quick Assignment Controls */}
          <div className="pt-2 border-t border-[#cfe4ff]/60 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-extrabold text-[#1769d2] uppercase block mb-1">Gán Dự án:</label>
              <SearchableSelect
                label="dự án"
                options={Array.from(new Set([currentProjectName, ...projectsList.map(p => p.name)]))}
                value={currentProjectName}
                onChange={(val: any) => {
                  const found = projectsList.find(p => p.name === val);
                  setSelectedProjectId(found ? found.id : null);
                }}
                placeholder="Tìm dự án..."
                className="w-full"
              />
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-[#1769d2] uppercase block mb-1">Người tạo (Creator):</label>
              <SearchableSelect
                label="người tạo"
                options={Array.from(new Set([currentCreatorName, ...membersList.map(m => m.full_name || m.display_name)]))}
                value={currentCreatorName}
                onChange={(val: any) => {
                  const found = membersList.find(m => (m.full_name || m.display_name) === val);
                  setSelectedCreatorId(found ? found.id : null);
                }}
                placeholder="Tìm người tạo..."
                className="w-full"
              />
            </div>
          </div>

          {(selectedProjectId !== meeting.project_id || selectedCreatorId !== meeting.created_by) && (
            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={handleSaveAssignment}
                disabled={isSavingAssignment}
                className="px-3 py-1.5 bg-[#1769d2] hover:bg-[#1258b3] text-white font-bold text-[11px] rounded-lg transition-all shadow-xs disabled:opacity-50"
              >
                {isSavingAssignment ? 'Đang lưu...' : 'Lưu phân công'}
              </button>
            </div>
          )}
        </div>


        {/* Toggle Transcript / Edit */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setShowTranscriptTab(!showTranscriptTab)}
            className="text-xs font-bold text-[#1769d2] hover:underline flex items-center gap-1.5"
          >
            <FileText size={14} />
            {showTranscriptTab ? 'Xem bản tóm tắt AI' : 'Xem / Sửa Biên bản thô (Transcript)'}
          </button>

          {showTranscriptTab && (
            <button
              type="button"
              onClick={handleSummarize}
              disabled={isLoading || !transcript.trim()}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs transition-all flex items-center gap-1 disabled:opacity-50"
            >
              <Sparkles size={14} />
              {isLoading ? 'AI đang tóm tắt...' : 'Chạy AI Tóm tắt ngay'}
            </button>
          )}
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl flex items-start gap-2 border border-red-200">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {pushSuccess && (
          <div className="p-3.5 bg-[#ecfdf5] border border-[#bbf7d0] text-[#08775a] text-xs font-bold rounded-xl leading-relaxed flex items-start gap-2">
            <CheckCircle size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            <span>{pushSuccess}</span>
          </div>
        )}

        {/* Transcript Tab View */}
        {showTranscriptTab ? (
          <div className="space-y-3 flex-1 flex flex-col min-h-[300px]">
            <label className="text-xs font-bold text-slate-600 uppercase block">Nội dung cuộc họp (Transcript / Notes)</label>
            <textarea
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              placeholder="Dán hoặc viết biên bản cuộc họp thô tại đây..."
              className="w-full flex-1 p-3.5 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-[#1769d2] transition-all resize-none leading-relaxed text-[#17253d] font-mono bg-slate-50/50"
            />
          </div>
        ) : executiveSummary ? (
          <div className="space-y-5">
            {/* Section 1: Executive Summary */}
            <div className="space-y-2">
              <h3 className="text-xs font-extrabold text-[#17253d] uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={14} className="text-[#6d28d9]" />
                ✦ Tóm tắt điều hành
              </h3>
              <div className="bg-[#f6f3ff] border border-[#ddd6fe] rounded-xl p-4 text-xs text-[#516079] leading-relaxed">
                <p>{executiveSummary}</p>
              </div>
            </div>

            {/* Section 2: Key Decisions */}
            {decisions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-extrabold text-[#17253d] uppercase tracking-wider">Quyết định chính</h3>
                <ul className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-[#59687f] space-y-2 font-medium">
                  {decisions.map((dec, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-[#1769d2] font-bold">•</span>
                      <span>{dec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Section 3: AI Recommended Tasks Form */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-extrabold text-[#17253d] uppercase tracking-wider flex items-center justify-between">
                <span>Task AI đề xuất ({tasks.length})</span>
                <span className="text-[11px] font-normal text-slate-400">Chọn task để push vào Project Plan</span>
              </h3>

              {tasks.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 text-center">
                  Không có task khuyến nghị từ cuộc họp này.
                </div>
              ) : (
                <div id="aiTaskList" className="space-y-3">
                  {tasks.map((t, i) => (
                    <label
                      key={i}
                      className={`block border border-[#e4eaf3] rounded-xl p-3.5 transition-all bg-white hover:border-[#1769d2]/40 shadow-xs ${t.checked ? 'ring-1 ring-[#1769d2]/20' : 'opacity-60 bg-slate-50'}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={t.checked}
                          onChange={e => {
                            const updated = [...tasks];
                            updated[i].checked = e.target.checked;
                            setTasks(updated);
                          }}
                          className="mt-1 w-4 h-4 rounded text-[#1769d2] focus:ring-[#1769d2]"
                        />
                        
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <strong className="text-xs font-bold text-[#17253d] truncate block">{t.detail_task}</strong>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${t.priority === 'Critical' ? 'bg-red-100 text-red-700' : t.priority === 'High' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                              {t.priority || 'Normal'}
                            </span>
                          </div>

                          {/* Dropdown Options Form Row */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
                            {/* Project Select */}
                            <div>
                              <SearchableSelect
                                label="dự án"
                                icon=""
                                options={Array.from(new Set([
                                  t.project_name || meeting.project || 'Dự án chung',
                                  ...projectsList.map(p => p.name),
                                ]))}
                                value={t.project_name || meeting.project || 'Dự án chung'}
                                onChange={(val: any) => {
                                  const updated = [...tasks];
                                  updated[i].project_name = val === 'all' ? '' : val;
                                  setTasks(updated);
                                }}
                                placeholder="Tìm dự án..."
                                className="w-full"
                              />
                            </div>

                            {/* Member Select */}
                            <div>
                              <SearchableSelect
                                label="người phụ trách"
                                icon=""
                                options={Array.from(new Set([
                                  ...(t.assigned_name ? [t.assigned_name] : []),
                                  ...membersList.map(m => m.full_name || m.display_name),
                                ]))}
                                value={t.assigned_name || ''}
                                onChange={(val: any) => {
                                  const updated = [...tasks];
                                  updated[i].assigned_name = val === 'all' ? '' : val;
                                  setTasks(updated);
                                }}
                                placeholder="Tìm người phụ trách..."
                                className="w-full"
                              />
                            </div>

                            {/* Deadline Date Picker */}
                            <div>
                              <input
                                type="date"
                                value={t.deadline ? (t.deadline.includes('/') ? t.deadline.split('/').reverse().join('-') : t.deadline) : ''}
                                onChange={e => {
                                  const updated = [...tasks];
                                  updated[i].deadline = e.target.value;
                                  setTasks(updated);
                                }}
                                className="w-full bg-white border border-[#dce3ee] rounded-lg p-1.5 text-[11px] font-mono font-bold text-[#17253d] focus:outline-none focus:border-[#1769d2]"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-slate-200 border-dashed rounded-2xl bg-slate-50 space-y-3">
            <Sparkles size={36} className="text-slate-400" />
            <div>
              <p className="text-sm font-bold text-slate-700">Chưa có bản tóm tắt AI cho cuộc họp này</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">Cuộc họp này chưa diễn ra hoặc chưa được nhập biên bản transcript. Hãy bấm nút dưới để dán biên bản và chạy AI.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowTranscriptTab(true)}
              className="px-4 py-2 bg-[#1769d2] hover:bg-[#1258b3] text-white text-xs font-bold rounded-xl transition-all shadow-xs"
            >
              Dán biên bản & Chạy AI Tóm tắt
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3 mt-auto">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Đóng
          </button>
          
          {tasks.length > 0 && !showTranscriptTab && (
            <button
              type="button"
              onClick={handlePushTasks}
              disabled={isPushing || tasks.length === 0}
              className="px-5 py-2.5 bg-[#1769d2] hover:bg-[#1258b3] text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
            >
              <Send size={14} />
              {isPushing ? 'Đang push task vào Project...' : 'Push task vào Project'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
