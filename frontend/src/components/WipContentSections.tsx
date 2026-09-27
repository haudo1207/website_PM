'use client';

// Tách nội dung WIP (markdown do SUMMARY_PROMPT/EXTRACTION_PROMPT sinh ra,
// luôn có cấu trúc cố định "## 1. MỤC TIÊU CHÍNH", "## 2. TRẠNG THÁI HIỆN
// TẠI"...) thành khối "Mục đích" nổi bật + các card gập/mở có phụ đề và
// list đánh số tròn — theo đúng style panel "Mô tả tính năng" mẫu người
// dùng gửi (numbered step, subtitle, chevron xoay), thay vì render nguyên
// 1 khối markdown dài. Log cũ không có cấu trúc "## " (Skill/Knowledge Hub
// cũ) vẫn fallback về render markdown nguyên khối như trước.
import { Children, cloneElement, isValidElement, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown } from 'lucide-react';

interface Section {
  title: string;
  body: string;
}

type Audience = 'all' | 'user' | 'dev';
const SECTION_META: [string, { icon: string; subtitle: string; audience: Audience }][] = [
  ['MỤC TIÊU', { icon: '🎯', subtitle: 'Vì sao làm việc này, đang ở giai đoạn nào', audience: 'all' }],
  ['LUỒNG SỬ DỤNG', { icon: '▶️', subtitle: 'Đọc 30 giây là hiểu cách dùng', audience: 'user' }],
  ['TÍNH NĂNG', { icon: '⚙️', subtitle: 'Scope chính đã/cần làm', audience: 'dev' }],
  ['ACCEPTANCE', { icon: '✓', subtitle: 'Làm xong khi các điều kiện này đạt', audience: 'dev' }],
  ['DỮ LIỆU', { icon: '🗂️', subtitle: 'Field tối thiểu cần backend/API', audience: 'dev' }],
  ['QUY TẮC', { icon: '💡', subtitle: 'Giúp không thao tác sai + quyết định đã chốt', audience: 'user' }],
  ['VẤN ĐỀ', { icon: '⚠️', subtitle: 'Chưa xử lý xong + bước tiếp theo', audience: 'dev' }],
  ['TỒN TẠI', { icon: '⚠️', subtitle: 'Chưa xử lý xong + bước tiếp theo', audience: 'dev' }],
  ['PROMPT', { icon: '🤖', subtitle: 'Copy để mở phiên chat mới', audience: 'dev' }],
];
function metaFor(title: string): { icon: string; subtitle: string; audience: Audience } {
  const upper = title.toUpperCase();
  for (const [key, meta] of SECTION_META) {
    if (upper.includes(key)) return meta;
  }
  return { icon: '▪️', subtitle: '', audience: 'all' };
}

function parseSections(content: string): { title: string; sections: Section[] } | null {
  if (!content) return null;
  const h1Match = content.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : '';
  // 8 mục cố định luôn ở dạng "## N. TÊN MỤC" — tách theo ranh giới "## ".
  const parts = content.split(/\n(?=##\s+)/);
  const sections: Section[] = [];
  for (const part of parts) {
    const m = part.match(/^##\s+(.+?)\n([\s\S]*)$/);
    if (!m) continue;
    const body = m[2].trim();
    if (!body) continue; // mục rỗng (AI để trống) thì bỏ qua, đỡ nhiễu
    sections.push({ title: m[1].replace(/^\d+\.\s*/, '').trim(), body });
  }
  // Chưa đủ cấu trúc "## " (log cũ, hoặc nội dung khác) — để nguyên render
  // markdown như trước, không ép vỡ layout.
  if (sections.length < 2) return null;
  return { title, sections };
}

// Render mỗi gạch đầu dòng thành 1 "step" có số tròn, giống style bước
// dùng trong panel mẫu — áp dụng đều cho mọi list vì nội dung AI sinh ra
// luôn ở dạng "- ..." (không phân biệt list thường/luồng các bước).
// react-markdown xen thêm text node rỗng (xuống dòng) giữa các <li> trong
// children — lọc bỏ những node không phải element thật trước khi đánh số,
// nếu không mỗi <li> bị nhảy 2 số 1 lần (2,4,6,8...) thay vì 1,2,3,4.
function numberChildren(children: any) {
  const items = Children.toArray(children).filter(isValidElement);
  return items.map((child, i) => cloneElement(child as any, { key: i, stepIndex: i }));
}
const numberedListComponents = {
  ul: ({ children }: any) => <div className="space-y-2 my-1.5">{numberChildren(children)}</div>,
  ol: ({ children }: any) => <div className="space-y-2 my-1.5">{numberChildren(children)}</div>,
  li: ({ children, stepIndex }: any) => (
    <div className="flex items-start gap-2">
      <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
        {(stepIndex ?? 0) + 1}
      </span>
      <div className="flex-1 text-[12px] text-slate-600 leading-relaxed">{children}</div>
    </div>
  ),
  p: ({ children }: any) => <p className="text-[12px] text-slate-600 leading-relaxed m-0">{children}</p>,
};

const AUDIENCE_OPTIONS: { key: Audience; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'user', label: 'Người dùng' },
  { key: 'dev', label: 'Dev / QA' },
];

export default function WipContentSections({ content }: { content: string }) {
  const parsed = parseSections(content);
  const goalIdx = parsed?.sections.findIndex((s) => s.title.toUpperCase().includes('MỤC TIÊU')) ?? -1;
  const firstOpenIdx = parsed ? parsed.sections.findIndex((_, i) => i !== goalIdx) : -1;
  const [openIdx, setOpenIdx] = useState<number | null>(firstOpenIdx >= 0 ? firstOpenIdx : null);
  const [audience, setAudience] = useState<Audience>('all');

  if (!parsed) {
    return (
      <div className="prose prose-sm prose-slate max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {parsed.title && <h4 className="text-[13px] font-extrabold text-slate-800 mb-1">{parsed.title}</h4>}

      {goalIdx >= 0 && (
        <div className="border border-indigo-200 bg-indigo-50/60 rounded-xl px-3.5 py-3">
          <div className="text-[10px] font-black text-indigo-600 uppercase tracking-wide">{parsed.sections[goalIdx].title}</div>
          <div className="mt-1 prose prose-sm prose-slate max-w-none [&_p]:my-0 [&_p]:text-[12.5px] [&_p]:leading-relaxed [&_p]:text-slate-700">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={numberedListComponents}>
              {parsed.sections[goalIdx].body}
            </ReactMarkdown>
          </div>
        </div>
      )}

      <div className="flex gap-1.5">
        {AUDIENCE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setAudience(opt.key)}
            className={`flex-1 text-[10.5px] font-bold py-1.5 rounded-lg border transition-colors ${
              audience === opt.key ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {parsed.sections.map((s, i) => {
        if (i === goalIdx) return null;
        const meta = metaFor(s.title);
        if (audience !== 'all' && meta.audience !== 'all' && meta.audience !== audience) return null;
        const isOpen = openIdx === i;
        return (
          <div key={i} className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <button
              type="button"
              onClick={() => setOpenIdx(isOpen ? null : i)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-start gap-2">
                <span className="text-[13px] leading-none mt-0.5">{meta.icon}</span>
                <span>
                  <span className="block text-[11.5px] font-bold text-slate-700">{s.title}</span>
                  {meta.subtitle && <span className="block text-[10px] text-slate-400 mt-0.5">{meta.subtitle}</span>}
                </span>
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="px-3 pb-3 pt-0.5 border-t border-slate-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={numberedListComponents}>
                  {s.body}
                </ReactMarkdown>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
