import React, { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

const WORKFLOW = [
  { title: 'Tạo meeting', body: 'Nhập mục tiêu, agenda và các vấn đề cần xử lý. Chọn đúng dự án nếu đã biết.', note: 'Mục tiêu + agenda là bắt buộc để đạt điểm Chuẩn bị' },
  { title: 'Dùng AI tạo mục tiêu & agenda', body: 'AI đọc tên meeting để đề xuất mục tiêu, kết quả mong đợi và agenda. Rà soát, sửa nhanh rồi xác nhận.', note: 'Nút "✦ AI đề xuất" trong form Tạo meeting' },
  { title: 'Chốt kết quả sau họp', body: 'Kiểm tra AI Summary, xác nhận quyết định và rà soát từng task: tên task, owner, deadline.', note: 'Tab "Task đề xuất" trong Chi tiết cuộc họp' },
  { title: 'Đồng bộ KPI Tasks', body: 'Bấm "📥 Đẩy task vào dự án" — Task thật được tạo ngay trong dự án, không cần qua bước PM import riêng nữa.', note: 'Điểm Kết quả chỉ tính khi task đã có imported_task_id thật (set ngay lúc đẩy)' },
];

const DEV_SPEC = {
  fields: [
    { object: 'Meeting', fields: 'objective, agenda, no_action_reason, score_*', purpose: 'Trường chuẩn bị + điểm hiệu quả' },
    { object: 'AITaskInbox (chat_ai_tasks)', fields: 'meeting_id, imported_task_id', purpose: 'Trace action item → Task thật để tính KPI Tasks %' },
    { object: 'Task (tasks_v2)', fields: 'days_late, end_date_est, kpi_final', purpose: 'Nguồn dữ liệu điểm Thực thi' },
    { object: 'MeetingFeedback', fields: 'meeting_id, member_id, helpful', purpose: 'Nguồn dữ liệu điểm Phản hồi' },
  ],
  endpoints: [
    'POST /api/meetings/{id}/push-tasks — tạo AITaskInbox + Task thật ngay (inline), tính lại điểm',
    'POST /api/projects/{pid}/ai-task-inbox/{task_id}/import — fallback: import nháp thành Task thật khi push-tasks lỗi',
    'POST /api/meetings/{id}/recalculate-score — tính lại điểm thủ công',
    'POST /api/meetings/{id}/feedback — gửi đánh giá nhanh',
    'GET /api/meetings/insights — dữ liệu chart/alerts (không bao gồm KPI grid, tính client-side từ GET /api/meetings)',
  ],
  formula: `prep = name(2) + project(3) + objective(8) + agenda(10) + datetime(2)
// thiếu objective/agenda -> prep = min(prep, 5)

execution = on_time(5) + required_attendance(5) + transcript_or_minutes(5)

result = decisions(10) + actions_extracted(5) + kpi_sync_rate*10 + valid_action_rate*10
// còn action chưa có imported_task_id -> result = min(result, 15), total = min(total, 69)

follow_through = on_time_action_rate*15 + no_reopen(5)
// meeting "không phát sinh task" hợp lệ (có lý do + có quyết định) -> follow_through = 20, status = final
feedback = helpful_rate * 5`,
};

export default function MeetingPlaybook() {
  const [tab, setTab] = useState<'employee' | 'dev'>('employee');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-2xs overflow-hidden mb-2">
      <div className="p-5 border-b border-[#edf1f6] flex items-center justify-between gap-4 flex-wrap">
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="flex-1 min-w-[220px] text-left"
        >
          <h2 className="text-sm font-extrabold text-[#0b1c30] flex items-center gap-2">
            <BookOpen size={16} className="text-[#6366f1]" />
            Hướng dẫn sử dụng & đặc tả triển khai
          </h2>
          <p className="text-[11px] text-[#64748b] mt-1">Nhân sự hiểu quy trình; Dev biết chính xác dữ liệu & endpoint đã xây dựng.</p>
        </button>
        <div className="flex items-center gap-2">
          {expanded && (
            <div className="flex bg-[#f0f3f7] rounded-lg p-1">
              <button
                onClick={() => setTab('employee')}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${tab === 'employee' ? 'bg-white text-[#6366f1] shadow-2xs' : 'text-[#69788e]'}`}
              >
                Dành cho nhân sự
              </button>
              <button
                onClick={() => setTab('dev')}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${tab === 'dev' ? 'bg-white text-[#6366f1] shadow-2xs' : 'text-[#69788e]'}`}
              >
                Dành cho Dev
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            className="flex items-center gap-1 text-[11px] font-bold text-[#6366f1] px-2 py-1.5 rounded-lg hover:bg-[#f5f3ff] transition-colors"
          >
            {expanded ? 'Thu gọn' : 'Mở rộng'}
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {!expanded ? null : tab === 'employee' ? (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {WORKFLOW.map((step, idx) => (
              <div key={step.title} className="border border-[#e2e8f0] rounded-xl p-3.5">
                <div className="w-7 h-7 rounded-lg bg-[#f5f3ff] text-[#6366f1] flex items-center justify-center font-extrabold text-xs mb-2.5">
                  {idx + 1}
                </div>
                <h3 className="text-xs font-bold text-[#0b1c30] mb-1.5">{step.title}</h3>
                <p className="text-[10px] text-[#6f7d91] leading-relaxed">{step.body}</p>
                <div className="mt-2 pt-2 border-t border-[#edf1f6] text-[9px] font-bold text-emerald-600">{step.note}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          <div className="border border-[#e2e8f0] rounded-xl overflow-hidden">
            <div className="px-3.5 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0] text-[11px] font-extrabold">Data model đang dùng</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-[#f8fafc] text-left">
                    <th className="p-2 font-bold text-[#64748b]">Object</th>
                    <th className="p-2 font-bold text-[#64748b]">Trường</th>
                    <th className="p-2 font-bold text-[#64748b]">Mục đích</th>
                  </tr>
                </thead>
                <tbody>
                  {DEV_SPEC.fields.map(row => (
                    <tr key={row.object} className="border-t border-[#edf1f6]">
                      <td className="p-2 font-bold text-[#0b1c30]">{row.object}</td>
                      <td className="p-2 text-[#475569] font-mono">{row.fields}</td>
                      <td className="p-2 text-[#6d7b90]">{row.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border border-[#e2e8f0] rounded-xl p-3.5">
            <div className="text-[11px] font-extrabold text-[#0b1c30] mb-2">Endpoint đã triển khai</div>
            <ul className="text-[10px] text-[#475569] font-mono space-y-1">
              {DEV_SPEC.endpoints.map(e => <li key={e}>{e}</li>)}
            </ul>
          </div>

          <div className="border border-[#e2e8f0] rounded-xl p-3.5">
            <div className="text-[11px] font-extrabold text-[#0b1c30] mb-2">Công thức tính điểm (backend/app/services/meeting_score_engine.py)</div>
            <pre className="bg-[#162033] text-[#dce7f5] rounded-lg p-3 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap">{DEV_SPEC.formula}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
