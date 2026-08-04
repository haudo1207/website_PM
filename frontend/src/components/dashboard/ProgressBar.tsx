interface ProgressBarProps {
  value: number; // 0–100
  color?: string; // tailwind bg class
  showLabel?: boolean;
  height?: string;
}

export default function ProgressBar({ value, color = 'bg-blue-500', showLabel = true, height = 'h-2' }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 bg-slate-100 rounded-full overflow-hidden ${height}`}>
        <div
          className={`${height} ${color} rounded-full transition-all duration-500`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-[11px] font-bold text-slate-600 tabular-nums w-9 text-right">{clamped}%</span>
      )}
    </div>
  );
}
