'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface FormulaTooltipProps {
  children: React.ReactNode;
  className?: string;
  /** Tailwind positioning class, e.g. 'left-0' or 'right-0'. Default: 'left-0' */
  align?: 'left' | 'right';
}

export default function FormulaTooltip({ children, className, align = 'left' }: FormulaTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(v => !v);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex" onClick={handleToggle}>
      <button
        type="button"
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 hover:text-slate-700 text-[9px] font-bold cursor-pointer transition-colors shrink-0 ${className ?? ''}`}
        aria-label="Giải thích công thức"
      >
        ?
      </button>
      {open && (
        <div
          className={`absolute z-[9999] top-full mt-1.5 ${align === 'right' ? 'right-0' : 'left-0'} min-w-[220px] max-w-[340px] bg-[#0b1c30] text-white text-[10px] leading-relaxed rounded-xl shadow-xl px-3.5 py-3 font-medium`}
          style={{ pointerEvents: 'auto' }}
        >
          {children}
          <div
            className={`absolute -top-1.5 ${align === 'right' ? 'right-3' : 'left-3'} w-3 h-3 bg-[#0b1c30] rotate-45`}
          />
        </div>
      )}
    </span>
  );
}
