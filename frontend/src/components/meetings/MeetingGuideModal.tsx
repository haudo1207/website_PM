import React from 'react';
import { Calendar, X, Users, Shield, AlertTriangle } from 'lucide-react';

interface MeetingGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const memberSteps = [
  <>Khi đến giờ họp, vào <b>Meeting → chọn cuộc họp → Join</b>.</>,
  <>Sử dụng <b>đúng tài khoản Google</b> có email đã được liên kết với thành viên được thêm vào cuộc họp và bấm <b>Tham gia</b>.</>,
  <>Thành viên có thể tự vào cuộc họp, không cần chờ duyệt.</>,
  <>Khi họp xong, chọn <b>Rời khỏi cuộc gọi</b>. Sau khi cuộc họp kết thúc, hệ thống n8n sẽ tự động xử lý <b>Summary</b>.</>,
];

const hostSteps = [
  <>Vào <b>Meeting → chọn đúng cuộc họp → Join</b>.</>,
  <>Sử dụng <b>tài khoản Host</b> đã được thiết lập cho cuộc họp và bấm <b>Tham gia</b>.</>,
  <>Host thực hiện điều hành cuộc họp.</>,
  <>Khi họp xong, Host chọn <b>Kết thúc cuộc gọi</b>, sau đó quay lại Web và bấm <b>Đánh dấu đã kết thúc</b>. Hệ thống n8n sẽ tự động xử lý <b>Summary</b>.</>,
];

export default function MeetingGuideModal({ isOpen, onClose }: MeetingGuideModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-xl border border-slate-100 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Calendar size={18} />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#0b1c30]">Hướng dẫn sử dụng Meeting</h2>
              <p className="text-[11px] text-[#64748b] mt-0.5">Hướng dẫn tạo và tham gia cuộc họp</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Section 1: Tạo cuộc họp — soft blue block, no border */}
          <div className="bg-blue-50 rounded-xl p-4 flex gap-3">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">1</span>
            <div className="space-y-1">
              <h3 className="text-xs font-extrabold text-[#0b1c30]">Tạo cuộc họp</h3>
              <p className="text-xs text-[#334155] leading-relaxed">
                Vào <b>Meeting → Tạo cuộc họp</b>, chọn <b>Dự án</b>, <b>Thành viên tham gia</b>, <b>Host (quan trọng)</b>, <b>Thời gian</b> và <b>Thời lượng</b>, sau đó bấm <b>Tạo cuộc họp</b>.
              </p>
            </div>
          </div>

          {/* Section 2: Thành viên tham gia — white + divider below */}
          <div className="pb-5 border-b border-slate-100 space-y-3">
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">2</span>
              <h3 className="text-xs font-extrabold text-[#0b1c30] flex items-center gap-1.5">
                <Users size={14} className="text-emerald-600" />
                Thành viên tham gia
              </h3>
            </div>
            <div className="space-y-2 pl-9">
              {memberSteps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-[#334155] leading-relaxed">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-extrabold flex items-center justify-center shrink-0 mt-0.5">{idx + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Host trực tiếp tham gia — white + divider below */}
          <div className="pb-1 space-y-3">
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">3</span>
              <div>
                <h3 className="text-xs font-extrabold text-[#0b1c30] flex items-center gap-1.5">
                  <Shield size={14} className="text-orange-500" />
                  Host trực tiếp tham gia
                </h3>
                <span className="inline-block mt-1 px-2 py-0.5 bg-orange-50 text-orange-700 text-[9px] font-bold rounded-full">
                  Backup khi VPS/Bot gặp sự cố
                </span>
              </div>
            </div>
            <div className="space-y-2 pl-9">
              {hostSteps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-[#334155] leading-relaxed">
                  <span className="w-4 h-4 rounded-full bg-orange-100 text-orange-700 text-[9px] font-extrabold flex items-center justify-center shrink-0 mt-0.5">{idx + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Warning — the only bordered card, highest visual weight */}
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-extrabold text-red-700 flex items-center gap-1.5">
              <AlertTriangle size={14} />
              Lưu ý quan trọng
            </h3>
            <ul className="space-y-2 text-xs text-red-900 leading-relaxed list-disc pl-4">
              <li>
                Thành viên phải sử dụng <b>đúng tài khoản Google</b> có email đã được liên kết với thành viên được thêm vào cuộc họp để có thể tham gia trực tiếp.
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800 list-none">
                  <span className="font-bold">Ví dụ:</span> D Huu Hau → haudo1207@gmail.com<br />
                  Khi Join phải chọn đúng tài khoản Google haudo1207@gmail.com.
                </div>
              </li>
              <li>Host phải sử dụng <b>đúng tài khoản Host</b> đã được thiết lập.</li>
              <li>Không <b>tự tạo cuộc họp hoặc link Google Meet</b> mới.</li>
              <li>Thành viên chọn <b>Rời khỏi cuộc gọi</b> khi kết thúc phần tham gia của mình; Host chọn <b>Kết thúc cuộc gọi</b> khi cuộc họp thực sự kết thúc.</li>
            </ul>
          </div>

        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="bg-[#0058be] hover:bg-[#004a9e] text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-colors shadow-sm"
          >
            Đã hiểu
          </button>
        </div>

      </div>
    </div>
  );
}
