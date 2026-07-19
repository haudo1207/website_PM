interface SummaryCardProps {
  title: string;
  value: string | number;
  accent: 'blue' | 'green' | 'yellow' | 'red';
}

const accentClasses: Record<SummaryCardProps['accent'], string> = {
  blue: 'border-[#0058be]/20 bg-[#f8fbff] text-[#0058be]',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  yellow: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-rose-200 bg-rose-50 text-rose-700',
};

export default function SummaryCard({ title, value, accent }: SummaryCardProps) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${accentClasses[accent]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-80">{title}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
