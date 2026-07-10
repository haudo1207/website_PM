'use client';

import React, { useState, useEffect } from 'react';
import { X, Calendar as CalendarIcon } from 'lucide-react';

interface CreateMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (meeting: any) => void;
  initialData?: any;
}

export default function CreateMeetingModal({ isOpen, onClose, onSave, initialData }: CreateMeetingModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    platform: 'Zoom',
    date: '',
    time: '',
    duration: '60',
    link: '',
    project: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialData) {
      setFormData({ ...initialData, project: initialData.project || '' });
    } else {
      const today = new Date().toISOString().split('T')[0];
      setFormData({
        title: '',
        platform: 'Zoom',
        date: today,
        time: '09:00',
        duration: '60',
        link: '',
        project: ''
      });
    }
    setError('');
  }, [initialData, isOpen]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!formData.title || !formData.date || !formData.time) {
      setError('Vui lòng điền đầy đủ thông tin bắt buộc');
      return;
    }

    setIsLoading(true);
    try {
      onSave({ ...formData });
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#c2c6d6]/40 flex items-center justify-between bg-[#f8f9fe]">
          <div className="flex items-center gap-2 text-[#0058be]">
            <CalendarIcon size={18} />
            <h2 className="text-[14px] font-bold text-[#0b1c30]">
              {initialData ? 'Sửa Meeting' : 'Tạo Meeting mới'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-[#565e74] hover:text-[#0b1c30] rounded-lg hover:bg-[#eff4ff] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs rounded-lg font-semibold border border-red-200">{error}</div>}
          
          <form id="meetingForm" onSubmit={handleSubmit} className="space-y-5">
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

            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Dự án liên quan</label>
              <input 
                type="text" 
                value={formData.project}
                onChange={e => setFormData({...formData, project: e.target.value})}
                placeholder="VD: Core Banking System" 
                className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Nền tảng</label>
                <select 
                  value={formData.platform}
                  onChange={e => setFormData({...formData, platform: e.target.value})}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] bg-white focus:outline-none focus:border-[#0058be] transition-colors"
                >
                  <option value="Zoom">🎥 Zoom</option>
                  <option value="Google Meet">💻 Google Meet</option>
                  <option value="Teams">👥 Microsoft Teams</option>
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

            <div className="grid grid-cols-2 gap-4">
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
                <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Thời lượng (phút)</label>
                <input 
                  type="number"
                  min="1"
                  value={formData.duration}
                  onChange={e => setFormData({...formData, duration: e.target.value})}
                  className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors"
                  placeholder="VD: 60"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#565e74] uppercase tracking-wider mb-1.5">Link meeting (tùy chọn)</label>
              <input 
                type="text" 
                value={formData.link}
                onChange={e => setFormData({...formData, link: e.target.value})}
                placeholder="https://..." 
                className="w-full px-3 py-2.5 border border-[#c2c6d6] rounded-lg text-xs text-[#0b1c30] focus:outline-none focus:border-[#0058be] transition-colors placeholder:text-[#c2c6d6]"
              />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#f8f9fe] border-t border-[#c2c6d6]/40 flex items-center justify-end gap-3">
          <button 
            type="button" 
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-[#565e74] bg-white border border-[#c2c6d6] rounded-lg hover:bg-[#f0f2f5] transition-colors"
          >
            Hủy
          </button>
          <button 
            type="submit" 
            form="meetingForm"
            disabled={isLoading}
            className="px-4 py-2 flex items-center gap-2 text-xs font-bold text-white bg-[#0058be] rounded-lg hover:bg-[#0058be]/90 transition-colors disabled:opacity-70 shadow-sm"
          >
            {isLoading ? 'Đang xử lý...' : (initialData ? 'Cập nhật' : 'Tạo meeting')}
          </button>
        </div>

      </div>
    </div>
  );
}
