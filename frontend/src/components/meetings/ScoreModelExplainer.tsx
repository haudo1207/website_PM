import React, { useState } from 'react';
import { Gauge, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

const STEPS = [
  {
    title: '1. Chuẩn bị',
    weight: '25 điểm',
    highlight: true,
    items: [
      'Tên meeting + đúng dự án: 5đ',
      'Mục tiêu & kết quả mong đợi: 8đ',
      'Agenda/vấn đề cần xử lý: 10đ',
      'Ngày và giờ họp rõ ràng: 2đ',
    ],
  },
  {
    title: '2. Điều hành',
    weight: '15 điểm',
    highlight: false,
    items: [
      'Bắt đầu đúng giờ: 5đ',
      'Đủ thành phần bắt buộc: 5đ',
      'Có transcript/biên bản: 5đ',
    ],
  },
  {
    title: '3. Kết quả & KPI Tasks',
    weight: '35 điểm',
    highlight: true,
    items: [
      'Quyết định được ghi nhận: 10đ',
      'AI/tổ chức bóc tách task: 5đ',
      '% task đã tạo trong KPI dự án × 10đ',
      '% task đủ owner/deadline × 10đ',
    ],
  },
  {
    title: '4. Thực thi',
    weight: '20 điểm',
    highlight: false,
    items: [
      'Task hoàn thành đúng hạn × 15đ',
      'Không phải họp lại vì chưa chốt: 5đ',
    ],
  },
  {
    title: '5. Phản hồi',
    weight: '5 điểm',
    highlight: false,
    items: [
      'Đánh giá nhanh sau họp',
      'Hữu ích / chưa hữu ích',
      'Tỷ lệ phản hồi hữu ích × 5đ',
    ],
  },
];

export default function ScoreModelExplainer() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full p-5 border-b border-[#edf1f6] flex items-center justify-between gap-4 flex-wrap text-left hover:bg-[#fafbfc] transition-colors"
      >
        <div>
          <h2 className="text-sm font-extrabold text-[#0b1c30] flex items-center gap-2">
            <Gauge size={16} className="text-[#0058be]" />
            Cách tính điểm & kiểm tra tự động
          </h2>
          <p className="text-[11px] text-[#64748b] mt-1">
            Điểm được tính từ dữ liệu thực tế trước, trong và sau meeting — không cho người dùng tự chấm.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-[#eff4ff] text-[#0058be] text-xs font-extrabold">100 điểm</div>
          <div className="flex items-center gap-1 text-[11px] font-bold text-[#0058be]">
            {expanded ? 'Thu gọn' : 'Mở rộng'}
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </button>

      {expanded && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-4">
            {STEPS.map(step => (
              <div
                key={step.title}
                className={`border rounded-xl p-3.5 ${step.highlight ? 'border-[#bcd6f5] bg-[#f5f8ff]' : 'border-[#e2e8f0]'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <strong className="text-xs text-[#0b1c30]">{step.title}</strong>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${step.highlight ? 'bg-[#eff4ff] text-[#0058be]' : 'bg-[#f0f2f6] text-[#506078]'}`}>
                    {step.weight}
                  </span>
                </div>
                <ul className="text-[10px] text-[#6d7b90] leading-relaxed list-disc pl-4 space-y-0.5">
                  {step.items.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>

          <div className="mx-4 mb-4 p-3 rounded-xl bg-[#fff5df] text-[#7a4300] text-[11px] flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div>
              <strong>Điều kiện khóa điểm:</strong> Thiếu mục tiêu hoặc agenda → mục Chuẩn bị tối đa 5/25. Có task sau họp
              nhưng chưa được tạo thật trong KPI Tasks dự án → mục Kết quả tối đa 15/35 và tổng điểm không vượt quá 69.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
