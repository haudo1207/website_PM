'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Portal from '@/components/Portal';

interface FormulaTooltipProps {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
}

export default function FormulaTooltip({ children, className, align = 'left' }: FormulaTooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(v => !v);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Recalculate popup position when open.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    const popupW = 340; // max-w
    let left = align === 'right' ? rect.right - popupW : rect.left;
    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - popupW - 8));
    const top = rect.bottom + gap;

    setPos({ top, left });
  }, [open, align]);

  // Close on scroll/resize (popup is fixed-positioned, must re-sync).
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener('scroll', handler, true);   // capture phase = catches scrollable parents too
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  // Close on click outside trigger + popup.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <>
      <span ref={triggerRef} className="relative inline-flex" onClick={handleToggle}>
        <button
          type="button"
          className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 hover:text-slate-700 text-[9px] font-bold cursor-pointer transition-colors shrink-0 ${className ?? ''}`}
          aria-label="Giải thích công thức"
        >
          ?
        </button>
      </span>
      {open && (
        <Portal>
          <div
            ref={popupRef}
            className="fixed z-[99999]"
            style={{ top: pos.top, left: pos.left, maxWidth: 340, width: 340 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-[#0b1c30] text-white text-[10px] leading-relaxed rounded-xl shadow-2xl border border-white/10 overflow-hidden">
              {/* Header with close button */}
              <div className="flex items-center justify-between px-3.5 pt-3 pb-1.5">
                <span className="text-[9px] font-bold text-white/40 uppercase tracking-wider">Công thức</span>
                <button
                  type="button"
                  onClick={close}
                  className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 text-white/50 hover:text-white text-xs font-bold transition-colors cursor-pointer"
                  aria-label="Đóng"
                >
                  ✕
                </button>
              </div>
              {/* Scrollable content area */}
              <div className="px-3.5 pb-3 max-h-[320px] overflow-y-auto custom-scrollbar">
                {children}
              </div>
            </div>
            {/* Arrow pointing to the trigger */}
            <div
              className={`absolute -top-1.5 ${align === 'right' ? 'right-3' : 'left-3'} w-3 h-3 bg-[#0b1c30] rotate-45 border-l border-t border-white/10`}
            />
          </div>
        </Portal>
      )}
    </>
  );
}
