'use client';

// Link chips — shared by Quick Create, the Tasks tab LINK column, and the
// Task Detail drawer. All three read/write the SAME field (Task.ticket_id);
// multiple links are stored newline-joined in that one field. Centralized
// here so all three always parse/render/normalize links identically.
export function normalizeLinkValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Auto-prepend https:// cho domain trần (vd "docs.google.com/..."), giữ
  // nguyên text không phải URL (mã ticket, v.v.).
  return !/^https?:\/\//i.test(trimmed) && /^[a-zA-Z0-9-]+\./.test(trimmed) ? 'https://' + trimmed : trimmed;
}

export function appendLinkValue(existing: string, rawInput: string): string {
  const normalized = normalizeLinkValue(rawInput);
  if (!normalized) return existing;
  const links = (existing || '').split('\n').filter(Boolean);
  return [...links, normalized].join('\n');
}

export function linkChipLabel(link: string): string {
  if (!/^https?:\/\//i.test(link)) return link;
  try {
    const u = new URL(link);
    const host = u.hostname.replace('www.', '');
    if (host.includes('docs.google.com')) return 'Google Docs';
    if (host.includes('figma.com')) return 'Figma Design';
    if (host.includes('drive.google.com')) return 'Google Drive';
    if (host.includes('github.com')) return 'GitHub';
    if (host.includes('jira')) return 'Jira Ticket';
    if (host.includes('notion')) return 'Notion Page';
    if (host.includes('confluence')) return 'Confluence';
    return host + (u.pathname.length > 15 ? u.pathname.substring(0, 15) + '...' : u.pathname);
  } catch {
    return link;
  }
}

interface LinkChipsEditorProps {
  value: string;
  onChange: (next: string) => void;
  inputValue: string;
  onInputChange: (v: string) => void;
  onInputKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onInputBlur?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}

export function LinkChipsEditor({ value, onChange, inputValue, onInputChange, onInputKeyDown, onInputBlur, autoFocus, placeholder }: LinkChipsEditorProps) {
  const links = (value || '').split('\n').filter(Boolean);
  return (
    <div className="flex flex-col gap-1.5">
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {links.map((link, idx) => {
            const isUrl = /^https?:\/\//i.test(link);
            return (
              <div key={idx} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-md text-[11px] font-semibold text-blue-700 shadow-sm overflow-hidden opacity-75">
                <span
                  className={`px-2 py-0.5 max-w-[160px] truncate ${isUrl ? 'cursor-pointer hover:bg-blue-100 transition-colors' : ''}`}
                  title={link}
                  onClick={() => { if (isUrl) window.open(link, '_blank', 'noopener,noreferrer'); }}
                >
                  🔗 {linkChipLabel(link)}
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange(links.filter((_, i) => i !== idx).join('\n'));
                  }}
                  className="px-1 py-0.5 hover:bg-blue-200 text-blue-500 transition-colors"
                  title="Xóa link"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}
      <input
        type="text"
        value={inputValue}
        autoFocus={autoFocus}
        onChange={e => onInputChange(e.target.value)}
        onKeyDown={onInputKeyDown}
        onBlur={onInputBlur}
        className="w-full bg-white border border-[#0058be] rounded px-1.5 py-1 text-xs text-[#0b1c30] focus:outline-none"
        placeholder={placeholder || 'Dán link mới và nhấn Enter...'}
      />
    </div>
  );
}
