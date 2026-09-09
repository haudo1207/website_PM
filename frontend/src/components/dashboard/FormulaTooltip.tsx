'use client';

// FormulaTooltip — small `?` help icon that opens a foreground popup with
// the formula/explanation text. Rendered into a Portal so it sits above
// every other UI layer, with internal scroll for long content and a
// clearly visible `X` close button.
//
// UX rule (this component): the popup is `position: fixed`, so it stays
// where the user opened it even when the underlying page scrolls. We
// intentionally do NOT auto-close on main-page scroll (the previous
// capture-phase scroll listener closed the popup as soon as anything —
// including the popup's own internal scroll area — bubbled a scroll event
// up to window, which made long explanations literally unreadable).
//
// Internal scroll inside the popup is supported (`.overflow-y-auto` on the
// body). Escape key and outside-click also close.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Portal from '@/components/Portal';

interface FormulaTooltipProps {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
}

const POPUP_WIDTH = 360;
const POPUP_MAX_HEIGHT = 420;
const VIEWPORT_GAP = 8;

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

  // Position the popup relative to the trigger. Prefer below the trigger;
  // flip above if there's not enough vertical room. Clamp horizontally so
  // it stays fully inside the viewport.
  const computePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    let left = align === 'right' ? rect.right - POPUP_WIDTH : rect.left;
    left = Math.max(VIEWPORT_GAP, Math.min(left, window.innerWidth - POPUP_WIDTH - VIEWPORT_GAP));

    const roomBelow = window.innerHeight - rect.bottom;
    const roomAbove = rect.top;
    let top;
    if (roomBelow >= POPUP_MAX_HEIGHT + VIEWPORT_GAP) {
      top = rect.bottom + VIEWPORT_GAP;
    } else if (roomAbove >= POPUP_MAX_HEIGHT + VIEWPORT_GAP) {
      top = rect.top - POPUP_MAX_HEIGHT - VIEWPORT_GAP;
    } else {
      // Not enough room either side — clamp to the larger side so the
      // header still stays visible.
      top = roomAbove > roomBelow
        ? Math.max(VIEWPORT_GAP, rect.top - POPUP_MAX_HEIGHT - VIEWPORT_GAP)
        : Math.max(VIEWPORT_GAP, rect.bottom + VIEWPORT_GAP);
    }
    setPos({ top, left });
  }, [align]);

  // Compute position when opening, and re-sync on resize (so a viewport
  // resize keeps the popup inside the visible area). We deliberately do
  // NOT recompute on page scroll — the popup is fixed and floats above
  // the page, so its on-screen position only needs to change when the
  // viewport itself changes.
  useLayoutEffect(() => {
    if (!open) return;
    computePosition();
    if (typeof window === 'undefined') return;
    const onResize = () => computePosition();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, computePosition]);

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
          aria-expanded={open}
        >
          ?
        </button>
      </span>
      {open && (
        <Portal>
          <div
            ref={popupRef}
            role="dialog"
            aria-modal="false"
            aria-label="Công thức"
            className="fixed z-[99999] shadow-2xl"
            style={{ top: pos.top, left: pos.left, width: POPUP_WIDTH, maxHeight: POPUP_MAX_HEIGHT }}
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-[#0b1c30] text-white text-[10px] leading-relaxed rounded-xl border border-white/10 overflow-hidden flex flex-col" style={{ maxHeight: POPUP_MAX_HEIGHT }}>
              {/* Header with title + clearly visible X close button */}
              <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1.5 border-b border-white/10 shrink-0">
                <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">Công thức</span>
                <button
                  type="button"
                  onClick={close}
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-sm font-bold transition-colors cursor-pointer"
                  aria-label="Đóng"
                  title="Đóng (Esc)"
                >
                  ✕
                </button>
              </div>
              {/* Scrollable content area — internal scroll so long
                  explanations stay readable even when the popup is
                  tall. We rely on the user scrolling inside this box,
                  NOT on main-page scroll, which is the reason the old
                  capture-phase scroll listener was removed. */}
              <div className="px-3.5 py-2.5 overflow-y-auto custom-scrollbar" style={{ maxHeight: POPUP_MAX_HEIGHT - 36 }}>
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