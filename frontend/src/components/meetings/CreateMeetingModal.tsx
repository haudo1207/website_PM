import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar as CalendarIcon, Sparkles, RefreshCw, Copy, Check, Share2 } from 'lucide-react';
import { generateMeetingLink, generateAiMeetingContent, getProjects, getAccounts } from '@/lib/api';
import SearchableSelect from '@/components/common/SearchableSelect';

interface CreateMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (meeting: any) => void | Promise<void>;
  initialData?: any;
}

interface MeetingFormData {
  title: string;
  platform: string;
  date: string;
  time: string;
  duration: string;
  link: string;
  transcript?: string;
  auto_summarize?: boolean;
  objective?: string;
  agenda?: string;
  project_ids: number[];
  member_ids: number[];
}

export default function CreateMeetingModal({ isOpen, onClose, onSave, initialData }: CreateMeetingModalProps) {
  const [formData, setFormData] = useState<MeetingFormData>({
    title: '',
    platform: 'Google Meet',
    date: '',
    time: '',
    duration: '60',
    link: '',
    transcript: '',
    auto_summarize: true,
    objective: '',
    agenda: '',
    project_ids: [],
    member_ids: []
  });
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [accountsList, setAccountsList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Ref, not state: reads/writes happen synchronously so rapid repeated
  // clicks within the same render tick still see the lock (state would be
  // stale-closured across those clicks since React hasn't re-rendered yet).
  const isSubmittingRef = useRef(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [isGeneratingAiContent, setIsGeneratingAiContent] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialData) {
      setFormData({
        ...initialData,
        platform: initialData.platform || 'Google Meet',
        transcript: initialData.transcript || '',
        auto_summarize: true,
        objective: initialData.objective || '',
        agenda: initialData.agenda || '',
        project_ids: Array.isArray(initialData.project_ids) && initialData.project_ids.length
          ? initialData.project_ids
          : (initialData.project_id ? [initialData.project_id] : []),
        member_ids: []
      });
    } else {
      const today = new Date().toISOString().split('T')[0];
      setFormData({
        title: '',
        platform: 'Google Meet',
        date: today,
        time: '09:00',
        duration: '60',
        link: '',
        transcript: '',
        auto_summarize: true,
        objective: '',
        agenda: '',
        project_ids: [],
        member_ids: []
      });
    }
    setError('');
  }, [initialData, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    getProjects().then((res: any) => {
      const items = res?.data || res || [];
      if (Array.isArray(items)) setProjectsList(items);
    }).catch(() => {});
    getAccounts().then((res: any) => {
      const items = res?.data || res || [];
      if (Array.isArray(items)) setAccountsList(items);
    }).catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  // Parse current HH:mm to 12-hour AM/PM
  const timeParts = (formData.time || '09:00').split(':');
  const h24 = parseInt(timeParts[0] || '9', 10);
  const minuteStr = timeParts[1] || '00';
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;

  const handleTimeChange = (h12Val: number, mVal: string, pVal: 'AM' | 'PM') => {
    let newH24 = h12Val;
    if (pVal === 'AM') {
      newH24 = h12Val === 12 ? 0 : h12Val;
    } else {
      newH24 = h12Val === 12 ? 12 : h12Val + 12;
    }
    const formattedHour = String(newH24).padStart(2, '0');
    setFormData({ ...formData, time: `${formattedHour}:${mVal}` });
  };

  const handleGenerateLink = async () => {
    if (!formData.title || !formData.date || !formData.time) {
      setError('Vui lòng điền tiêu đề, ngày và giờ bắt đầu trước khi tạo link');
      return;
    }
    setIsGeneratingLink(true);
    setError('');
    try {
      const data = await generateMeetingLink({
        platform: formData.platform,
        title: formData.title,
        date: formData.date,
        time: formData.time,
        duration: formData.duration
      });
      if (data.success && data.join_url) {
        const fullUrl = data.join_url.startsWith('http') ? data.join_url : `https://${data.join_url}`;
        setFormData(prev => ({ ...prev, link: fullUrl }));
      } else {
        setError('Không thể tạo link meeting tự động');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Lỗi khi tạo link meeting');
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return; // synchronous guard — see ref comment above
    isSubmittingRef.current = true;
    setError('');

    if (!formData.title || !formData.date || !formData.time) {
      setError('Vui lòng điền đầy đủ thông tin bắt buộc');
      isSubmittingRef.current = false;
      return;
    }

    setIsLoading(true);
    try {
      // Must await — otherwise isLoading resets before the create request
      // finishes, the button re-enables while still in flight, and repeated
      // clicks fire off duplicate meetings.
      await onSave({ ...formData, meeting_url: formData.link });
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra');
    } finally {
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const handleGenerateAiContent = async () => {
    if (!formData.title) {
      setError('Nhập tên cuộc họp trước để AI đề xuất nội dung');
      return;
    }
    setIsGeneratingAiContent(true);
    setError('');
    try {
      const firstProject = projectsList.find((p: any) => p.id === formData.project_ids[0]);
      const res = await generateAiMeetingContent({ title: formData.title, project_name: firstProject?.name });
      if (res?.success) {
        setFormData(prev => ({ ...prev, objective: res.goal || prev.objective, agenda: res.agenda || prev.agenda }));
      } else {
        setError('AI không đề xuất được nội dung, hãy nhập trực tiếp');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'AI đề xuất thất bại');
    } finally {
      setIsGeneratingAiContent(false);
    }
  };

  // Mirrors the server's prep-score formula (meeting_score_engine.py) for instant feedback.
  const hasObjective = Boolean(formData.objective && formData.objective.trim());
  const hasAgenda = Boolean(formData.agenda && formData.agenda.trim());
  const rawReadiness = (formData.title ? 2 : 0) + (formData.project_ids.length ? 3 : 0) + (hasObjective ? 8 : 0) + (hasAgenda ? 10 : 0) + (formData.date && formData.time ? 2 : 0);
  const readinessScore = hasObjective && hasAgenda ? rawReadiness : Math.min(rawReadiness, 5);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-[#c2c6d6]/40 flex items-center justify-between bg-[#f8f9fe] shrink-0">
          <div className="flex items-center gap-2 text-[#0058be]">
            <CalendarIcon size={18} />
            <h2 className="text-[14px] font-bold text-[#0b1c30]">
              {initialData ? 'Sửa Meeting' : 'Tạo Meeting mới'}
            </h2>
          </div>
          <button onClick={onClose} disabled={isLoading} className="p-1.5 text-[#565e74] hover:text-[#0b1c30] rounded-lg hover:bg-[#eff4ff] transition-colors disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        {/* Body & Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
            {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs rounded-lg font-semibold border border-red-200">{error}</div>}
            
            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Tên cuộc họp *</label>
              <input
                type="text"
                value={formData.title}
                onChange={e => setFormData({...formData, title: e.target.value})}
                placeholder="VD: Review tiến độ tuần 26"
                className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Dự án liên quan</label>
                <SearchableSelect
                  label="dự án"
                  isMulti
                  options={projectsList.map((p: any) => ({ id: p.id, name: p.name }))}
                  value={formData.project_ids}
                  onChange={(ids: number[]) => setFormData({ ...formData, project_ids: ids })}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Thành viên tham gia</label>
                <SearchableSelect
                  label="thành viên"
                  isMulti
                  options={accountsList.map((a: any) => ({ id: a.id, name: a.full_name || a.display_name || a.email || `#${a.id}` }))}
                  value={formData.member_ids}
                  onChange={(ids: number[]) => setFormData({ ...formData, member_ids: ids })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Nền tảng</label>
                <select 
                  value={formData.platform}
                  onChange={e => setFormData({...formData, platform: e.target.value})}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors font-medium"
                >
                  <option value="Google Meet">💻 Google Meet</option>
                  <option value="Zoom">🎥 Zoom</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Ngày họp *</label>
                <input 
                  type="date" 
                  value={formData.date}
                  onChange={e => setFormData({...formData, date: e.target.value})}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                />
              </div>
            </div>

            {formData.platform === 'Zoom' && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 leading-relaxed flex items-start gap-2">
                <span className="material-symbols-outlined text-amber-600 text-[16px] shrink-0 mt-0.5">info</span>
                <div>
                  <span className="font-bold text-amber-900">Lưu ý khi chọn Zoom:</span> Hệ thống dùng 1 tài khoản Zoom cố định. Tại cùng một khung giờ chỉ khởi tạo được 1 cuộc họp Zoom. Nếu trùng giờ với cuộc họp Zoom khác, sẽ không tạo thêm được link mới (khuyên dùng <b>Google Meet</b>).
                </div>
              </div>
            )}

            <div>
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Giờ bắt đầu (AM/PM)</label>
                <div className="flex items-center gap-1">
                  <select
                    value={hour12}
                    onChange={e => handleTimeChange(parseInt(e.target.value, 10), minuteStr, period)}
                    className="flex-1 px-2 py-2.5 border border-[#c2c6d6] rounded-lg text-xs bg-white focus:outline-none focus:border-[#0058be] transition-all text-center font-bold text-[#0b1c30]"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                    ))}
                  </select>
                  <span className="text-[#c2c6d6] font-bold">:</span>
                  <select
                    value={minuteStr}
                    onChange={e => handleTimeChange(hour12, e.target.value, period)}
                    className="flex-1 px-2 py-2.5 border border-[#c2c6d6] rounded-lg text-xs bg-white focus:outline-none focus:border-[#0058be] transition-all text-center font-bold text-[#0b1c30]"
                  >
                    {Array.from(new Set(['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', minuteStr])).sort().map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <div className="flex rounded-lg border border-[#c2c6d6] overflow-hidden bg-[#f0f2f5] p-0.5 ml-0.5">
                    <button
                      type="button"
                      onClick={() => handleTimeChange(hour12, minuteStr, 'AM')}
                      className={`px-2 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                        period === 'AM' ? 'bg-[#0058be] text-white shadow-sm' : 'text-[#565e74] hover:text-[#0b1c30]'
                      }`}
                    >
                      AM
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTimeChange(hour12, minuteStr, 'PM')}
                      className={`px-2 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                        period === 'PM' ? 'bg-[#0058be] text-white shadow-sm' : 'text-[#565e74] hover:text-[#0b1c30]'
                      }`}
                    >
                      PM
                    </button>
                  </div>
                </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider">Link meeting (tùy chọn)</label>
                <div className="flex items-center gap-3">
                  {formData.link && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(formData.link);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:underline"
                    >
                      {copiedLink ? <Check size={13} /> : <Copy size={13} />}
                      {copiedLink ? 'Đã sao chép!' : 'Sao chép link'}
                    </button>
                  )}
                  {(formData.platform === 'Zoom' || formData.platform === 'Google Meet') && (
                    <button
                      type="button"
                      onClick={handleGenerateLink}
                      disabled={isGeneratingLink}
                      className="flex items-center gap-1 text-[11px] font-bold text-[#0058be] hover:underline disabled:opacity-50"
                    >
                      <Sparkles size={13} className={isGeneratingLink ? 'animate-spin text-amber-500' : 'text-[#0058be]'} />
                      {isGeneratingLink ? 'Đang tạo link...' : `⚡ Tạo link ${formData.platform}`}
                    </button>
                  )}
                </div>
              </div>
              <input 
                type="text" 
                value={formData.link}
                onChange={e => setFormData({...formData, link: e.target.value})}
                placeholder={formData.platform === 'Zoom' ? 'https://zoom.us/j/...' : formData.platform === 'Google Meet' ? 'https://meet.google.com/...' : 'https://...'} 
                className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors placeholder:text-[#c2c6d6]"
              />
              {!initialData && !formData.link && (
                <>
                  {formData.platform === 'Zoom' && (
                    <p className="text-[11px] text-[#0058be] mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
                      Link Zoom sẽ tự động được tạo khi nhấn &quot;Tạo meeting&quot; nếu để trống.
                    </p>
                  )}
                  {formData.platform === 'Google Meet' && (
                    <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
                      Link Google Meet sẽ tự động được tạo khi nhấn &quot;Tạo meeting&quot; nếu để trống (yêu cầu kết nối Google).
                    </p>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Mục tiêu & kết quả mong đợi</label>
              <textarea
                value={formData.objective}
                onChange={e => setFormData({ ...formData, objective: e.target.value })}
                placeholder="Nhập mục tiêu và kết quả mong đợi của cuộc họp — hoặc để trống rồi dùng AI đề xuất bên dưới..."
                rows={2}
                className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors resize-y"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Agenda / vấn đề cần xử lý</label>
              <textarea
                value={formData.agenda}
                onChange={e => setFormData({ ...formData, agenda: e.target.value })}
                placeholder={'1. Nội dung cần cập nhật\n2. Vấn đề cần thảo luận\n3. Quyết định cần chốt'}
                rows={3}
                className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors resize-y"
              />
            </div>

            {/* AI Meeting Copilot — đặt sau Mục tiêu/Agenda: gõ tay trước, cần thì mới nhờ AI đề xuất/viết lại */}
            <div className="bg-[#f6f3ff] border border-[#ddd6fe] rounded-xl p-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#e7e3ff] text-[#6d28d9] flex items-center justify-center shrink-0">
                <Sparkles size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[#6d28d9]">AI Meeting Copilot</p>
                <p className="text-[11px] text-[#516079] leading-relaxed">Chưa biết viết gì? Để AI soạn hộ mục tiêu & agenda từ tên cuộc họp, rồi bạn chỉnh lại.</p>
              </div>
              <button
                type="button"
                onClick={handleGenerateAiContent}
                disabled={isGeneratingAiContent}
                className="px-3 py-2 text-[11px] font-bold text-white bg-[#6d28d9] hover:bg-[#5b21b6] rounded-lg transition-colors disabled:opacity-60 shrink-0"
              >
                {isGeneratingAiContent ? 'Đang soạn...' : '✦ AI đề xuất'}
              </button>
            </div>

            <div className="border border-[#e2e8f0] rounded-xl p-3 bg-[#fafbfc] space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-[#475569]">
                <span>Mức sẵn sàng trước họp</span>
                <span>{readinessScore}/25 điểm</span>
              </div>
              <div className="h-1.5 bg-[#e7ebf1] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${(readinessScore / 25) * 100}%`, background: 'linear-gradient(90deg,#635bff,#35b58d)' }}
                />
              </div>
              {(!hasObjective || !hasAgenda) && (
                <p className="text-[10px] text-amber-700">Thiếu mục tiêu hoặc agenda sẽ giới hạn điểm Chuẩn bị tối đa 5/25.</p>
              )}
            </div>

            {/* Auto AI Summary Notice */}
            <div className="bg-[#f6f3ff] border border-[#ddd6fe] rounded-xl p-3.5 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-[#6d28d9] text-xs">
                <Sparkles size={14} />
                <span>Tự động thu âm & AI Summary</span>
              </div>
              <p className="text-[11px] text-[#516079] leading-relaxed font-medium">
                Khi cuộc họp kết thúc, hệ thống sẽ tự động đồng bộ transcript từ link Zoom hoặc Google Meet để AI phân tích và gợi ý task vào dự án.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-[#f8f9fe] border-t border-[#c2c6d6]/40 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-bold text-[#565e74] bg-white border border-[#c2c6d6] rounded-lg hover:bg-[#f0f2f5] transition-colors disabled:opacity-40"
            >
              Hủy
            </button>
            <button 
              type="submit" 
              disabled={isLoading}
              className="px-4 py-2 flex items-center gap-2 text-xs font-bold text-white bg-[#0058be] rounded-lg hover:bg-[#0058be]/90 transition-colors disabled:opacity-70 shadow-sm"
            >
              {isLoading ? 'Đang xử lý...' : (initialData ? 'Cập nhật' : 'Tạo meeting')}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
