'use client';

export default function CalendarToolbar({
  rangeLabel,
  rangeDays,
  onRangeDaysChange,
  onPrev,
  onNext,
  onToday,
  onQuickCreate,
}: {
  rangeLabel: string;
  rangeDays: 4 | 7;
  onRangeDaysChange: (n: 4 | 7) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onQuickCreate: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 flex-wrap">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToday}
          className="text-[12.5px] font-semibold text-[#0b1c30] border border-slate-200 bg-white px-3 py-1.5 rounded-lg hover:bg-slate-50"
        >
          Hôm nay
        </button>
        <button
          type="button"
          onClick={onPrev}
          aria-label="Khoảng trước"
          className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Khoảng sau"
          className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
        >
          ›
        </button>
        <span className="text-[14.5px] font-bold text-[#0b1c30] ml-1">{rangeLabel}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="inline-flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {([4, 7] as const).map(n => (
            <button
              key={n}
              type="button"
              onClick={() => onRangeDaysChange(n)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors ${
                rangeDays === n ? 'bg-white text-[#0058be] shadow-sm' : 'text-slate-500 hover:text-[#0b1c30]'
              }`}
            >
              {n} ngày
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onQuickCreate}
          className="text-[12.5px] font-bold text-white bg-[#0058be] px-3.5 py-2 rounded-lg flex items-center gap-1.5 hover:bg-[#00459a]"
        >
          <span className="text-[15px] leading-none">+</span> Tạo task
        </button>
      </div>
    </div>
  );
}
