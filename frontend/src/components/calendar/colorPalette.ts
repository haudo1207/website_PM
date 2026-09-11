// 24 curated presets (Tailwind 500/700 hex values) for the Personal
// Calendar's per-Project color preference — see "Chốt phân tích & thiết kế
// – Màu Project trong Personal Calendar" §4. Not exhaustive: users can also
// enter any custom HEX via the color picker (~16.7M colors), this list is
// just the "pick quickly" shortcut.
export const PROJECT_COLOR_PRESETS: string[] = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#64748b',
  '#6b7280', '#71717a', '#78716c', '#b91c1c', '#1d4ed8', '#15803d',
];

export const DEFAULT_PROJECT_COLOR = '#565e74';

export function isValidHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}
