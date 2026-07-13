'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { Search, Sparkles } from 'lucide-react';
import Navbar from '@/components/Navbar';
import MeetingCard from '@/components/meetings/MeetingCard';
import CreateMeetingModal from '@/components/meetings/CreateMeetingModal';
import PromptSettingsModal from '@/components/meetings/PromptSettingsModal';
import SummarizeModal from '@/components/meetings/SummarizeModal';
import { getMeetings, createMeeting, updateMeeting, deleteMeeting, syncMeeting } from '@/lib/api';

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState('All');
  const [monthFilter, setMonthFilter] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSummarizeOpen, setIsSummarizeOpen] = useState(false);
  const [summarizingMeeting, setSummarizingMeeting] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchMeetings = async () => {
    setIsLoading(true);
    try {
      const data = await getMeetings();
      if (data.success) setMeetings(data.data);
    } catch (error) { console.error("Failed to fetch meetings", error); }
    finally { setIsLoading(false); }
  };

  useEffect(() => { fetchMeetings(); }, []);

  const filteredMeetings = useMemo(() => {
    return meetings.filter(m => {
      const matchesSearch = m.title.toLowerCase().includes(searchTerm.toLowerCase()) || (m.project && m.project.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesPlatform = platformFilter === 'All' || m.platform === platformFilter;
      let matchesMonth = true;
      if (monthFilter !== 'All' && monthFilter !== '') matchesMonth = m.date && m.date.startsWith(monthFilter);
      return matchesSearch && matchesPlatform && matchesMonth;
    });
  }, [meetings, searchTerm, platformFilter, monthFilter]);

  const handleSaveMeeting = async (meetingData: any) => {
    try {
      if (meetingData.id) {
        const data = await updateMeeting(meetingData.id, meetingData);
        if (data.success) {
          setMeetings(meetings.map(m => m.id === meetingData.id ? data.data : m));
        }
      } else {
        const data = await createMeeting(meetingData);
        if (data.success) setMeetings([data.data, ...meetings]);
      }
      setIsModalOpen(false); setEditingMeeting(null);
    } catch (error: any) {
      console.error("Failed to save meeting", error);
      alert(error.response?.data?.detail || "Có lỗi xảy ra khi lưu cuộc họp");
    }
  };

  const executeDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteMeeting(parseInt(deleteConfirmId));
      setMeetings(prev => prev.filter(m => m.id !== parseInt(deleteConfirmId)));
      setDeleteConfirmId(null);
    } catch (error: any) {
      console.error("Failed to delete meeting", error);
      alert(error.response?.data?.detail || "Có lỗi xảy ra khi xóa cuộc họp");
    }
  };

  const handleSync = async (meeting: any) => {
    const data = await syncMeeting(parseInt(meeting.id));
    if (data.success) {
      setMeetings(prev => prev.map(m => m.id === meeting.id ? data.data : m));
    }
  };

  // Stats
  const totalMeetings = meetings.length;
  const doneMeetings = meetings.filter(m => m.status === 'ĐÃ DIỄN RA').length;
  const upcomingMeetings = meetings.filter(m => m.status === 'SẮP TỚI').length;
  const aiProcessing = meetings.filter(m => m.status === 'ĐANG XỬ LÝ AI').length;

  return (
    <div className="h-screen bg-[#f0f2f5] text-[#0b1c30] flex overflow-hidden" style={{ fontFamily: "'Work Sans', sans-serif" }}>
      <Navbar />
      <div className="flex-1 pl-[230px] flex flex-col h-screen overflow-hidden">
        {/* Top bar */}
        <div className="h-[52px] bg-white border-b border-[#c2c6d6]/60 flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#0058be] text-[20px]">calendar_month</span>
            <span className="text-xs font-bold text-[#0b1c30]">Quản lý Meetings</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSettingsOpen(true)} className="flex items-center gap-1.5 bg-white hover:bg-[#f0f2f5] border border-[#c2c6d6] text-[#565e74] text-xs font-bold px-3 py-2 rounded-lg transition-colors">
              <Sparkles size={14} className="text-emerald-500" />Cấu hình AI
            </button>
            <button onClick={() => { setEditingMeeting(null); setIsModalOpen(true); }} className="flex items-center gap-2 bg-[#0058be] hover:bg-[#0058be]/90 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-sm">
              <span className="material-symbols-outlined text-[16px]">add</span>Tạo meeting
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Tổng cuộc họp</p>
              <div className="flex items-baseline gap-2 mt-1"><span className="text-2xl font-bold text-[#0b1c30]">{totalMeetings}</span></div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden"><div className="bg-[#0058be] h-full" style={{ width: '100%' }}></div></div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-emerald-200 shadow-sm">
              <p className="text-[10px] text-emerald-700 uppercase font-bold tracking-wider">Đã diễn ra</p>
              <div className="flex items-baseline justify-between mt-1"><span className="text-2xl font-bold text-emerald-600">{doneMeetings}</span><span className="material-symbols-outlined text-emerald-500 text-[18px]">event_available</span></div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden"><div className="bg-emerald-500 h-full" style={{ width: `${totalMeetings > 0 ? (doneMeetings / totalMeetings) * 100 : 0}%` }}></div></div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-[10px] text-[#565e74] uppercase font-bold tracking-wider">Sắp tới</p>
              <div className="flex items-baseline justify-between mt-1"><span className="text-2xl font-bold text-[#0058be]">{upcomingMeetings}</span><span className="material-symbols-outlined text-[#0058be] text-[18px]">event_upcoming</span></div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden"><div className="bg-[#0058be] h-full" style={{ width: `${totalMeetings > 0 ? (upcomingMeetings / totalMeetings) * 100 : 0}%` }}></div></div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-amber-200 shadow-sm">
              <p className="text-[10px] text-amber-700 uppercase font-bold tracking-wider">Đang xử lý AI</p>
              <div className="flex items-baseline justify-between mt-1"><span className="text-2xl font-bold text-amber-600">{aiProcessing}</span><span className="material-symbols-outlined text-amber-500 text-[18px]">auto_awesome</span></div>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-3 overflow-hidden"><div className="bg-amber-500 h-full" style={{ width: `${totalMeetings > 0 ? (aiProcessing / totalMeetings) * 100 : 0}%` }}></div></div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 bg-white p-3 rounded-xl border border-[#c2c6d6]/60 shadow-sm">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-2.5 text-[#c2c6d6]" />
              <input type="text" placeholder="Tìm kiếm cuộc họp, dự án..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-[#f0f2f5] border border-[#c2c6d6] rounded-lg text-xs focus:outline-none focus:border-[#0058be] transition-all text-[#0b1c30]" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-[#565e74] hidden sm:block whitespace-nowrap">Nền tảng:</label>
              <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} className="px-3 py-2 bg-[#f0f2f5] border border-[#c2c6d6] rounded-lg text-xs focus:outline-none focus:border-[#0058be] min-w-[130px] text-[#0b1c30]">
                <option value="All">Tất cả</option><option value="Zoom">Zoom</option><option value="Teams">Teams</option><option value="Google Meet">Google Meet</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-[#565e74] hidden sm:block whitespace-nowrap">Thời gian:</label>
              <input type={monthFilter === 'All' ? 'text' : 'month'} placeholder="Tháng/Năm" onFocus={e => (e.target.type = 'month')} onBlur={e => { if (!e.target.value) e.target.type = 'text'; }} value={monthFilter === 'All' ? '' : monthFilter} onChange={e => setMonthFilter(e.target.value || 'All')} className="px-3 py-2 bg-[#f0f2f5] border border-[#c2c6d6] rounded-lg text-xs focus:outline-none focus:border-[#0058be] min-w-[130px] placeholder:text-[#c2c6d6] text-[#0b1c30]" />
            </div>
          </div>

          {/* Meeting List */}
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-16 text-[#565e74] text-xs"><div className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-[#0058be] border-t-transparent rounded-full animate-spin" />Đang tải danh sách cuộc họp...</div></div>
            ) : filteredMeetings.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-[#c2c6d6] border-dashed">
                <div className="w-12 h-12 bg-[#eff4ff] text-[#0058be] rounded-full flex items-center justify-center mx-auto mb-3"><Search size={24} /></div>
                <p className="text-[#565e74] font-bold text-sm">Không tìm thấy cuộc họp nào</p>
                <p className="text-[#727785] text-xs mt-1">Hãy thử thay đổi điều kiện lọc hoặc tạo mới.</p>
              </div>
            ) : (
              filteredMeetings.map(meeting => (
                <MeetingCard key={meeting.id} meeting={meeting}
                  onEdit={m => { setEditingMeeting(m); setIsModalOpen(true); }}
                  onDelete={id => setDeleteConfirmId(id)}
                  onSummarize={m => { setSummarizingMeeting(m); setIsSummarizeOpen(true); }}
                  onSync={handleSync}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <CreateMeetingModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveMeeting} initialData={editingMeeting} />
      <PromptSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <SummarizeModal isOpen={isSummarizeOpen} onClose={() => { setIsSummarizeOpen(false); setSummarizingMeeting(null); }} meeting={summarizingMeeting} onSave={m => setMeetings(prev => prev.map(x => x.id === m.id ? m : x))} />

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
              <button onClick={executeDelete} className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm">Xác nhận xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
