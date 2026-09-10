'use client';

// FormulaTooltip — small `?` help icon that opens a foreground popup with
// the formula/explanation text.
//
// UX guarantees (this component):
// 1. Rendered into a Portal so it sits above every other UI layer
//    (`z-[99999]`, `position: fixed`).
// 2. Stays ANCHORED to its `?` — even when the underlying page scrolls,
//    the popup's on-screen position is recomputed on every relevant
//    scroll event so the arrow still points at the trigger. Internal
//    scroll inside the popup does NOT close or re-anchor the popup.
// 3. AUTO-CLOSES when the trigger leaves the visible viewport — once the
//    `?` is no longer relevant (scrolled away, hidden behind another
//    element, etc.) the explanation disappears so it can't mislead the
//    user. Uses an IntersectionObserver against the trigger.
// 4. Internal scroll for long content (the popup body has its own
//    `overflow-y-auto`, independent of the page).
// 5. Clearly visible `X` close button + Escape key + outside-click all
//    close the popup.
//
// Formula / KPI content is NOT modified by this component — callers
// pass the same JSX they always have.

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
const VIEWPORT_VISIBILITY_THRESHOLD = 0; // trigger fully off-screen → close

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
  // it stays fully inside the viewport. Returns the chosen coordinates
  // without setting state — pure function, so it's safe to call from
  // both useLayoutEffect (open/close) and the scroll handler (anchoring).
  const computePosition = useCallback(() => {
    if (!triggerRef.current) return null;
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
    return { top, left };
  }, [align]);

  // Initial position + re-position on viewport resize. We DELIBERATELY do
  // NOT recompute on main-page scroll in this effect — that's handled by
  // a separate capture-phase scroll listener below so it can ignore
  // scroll events that originate INSIDE the popup's own scroll area
  // (the previous component used a single capture listener that closed
  // the popup on any scroll, which made the internal area literally
  // unreadable).
  useLayoutEffect(() => {
    if (!open) return;
    const posNow = computePosition();
    if (posNow) setPos(posNow);
    if (typeof window === 'undefined') return;
    const onResize = () => {
      const next = computePosition();
      if (next) setPos(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, computePosition]);

  // Re-anchor on scroll: any scroll that moves the trigger must move the
  // popup with it. We listen at the capture phase because `scroll` doesn't
  // bubble, so a listener on `window` without capture wouldn't catch
  // scroll events from nested scrollable ancestors. Scroll events whose
  // target lives INSIDE the popup itself are ignored — that's the
  // internal-scroll case, and we don't want the popup to chase the
  // user's own scrolling inside its own body.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (popupRef.current && target && popupRef.current.contains(target)) return;
      const next = computePosition();
      if (next) setPos(next);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open, computePosition]);

  // Auto-close when the trigger leaves the visible viewport. The observer
  // is only attached while the popup is open, and observes the trigger
  // span (not the popup), so the popup's own movement doesn't toggle
  // intersection on/off. threshold=0 fires on fully-out-of-viewport;
  // rootMargin=null defaults to the visual viewport.
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const trigger = triggerRef.current;
    if (typeof IntersectionObserver === 'undefined') {
      // Very old browsers — skip auto-close rather than crash.
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.intersectionRatio <= VIEWPORT_VISIBILITY_THRESHOLD) {
          setOpen(false);
        }
      },
      { threshold: [0, VIEWPORT_VISIBILITY_THRESHOLD] },
    );
    observer.observe(trigger);
    return () => observer.disconnect();
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
              {/* Internal scroll area — independent of the page, so long
                  explanations stay readable without disturbing the
                  popup's anchor relationship to its `?`. */}
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