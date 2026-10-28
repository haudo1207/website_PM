'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Shared floating menu/popover trigger-anchored to a button (row "..."
// menus, header "..." menus, small comboboxes, column filters, etc.).
// Extracted (chốt 2026-10-28) from project/detail/page.tsx's own
// originally-local copy — the exact same implementation, now a real
// shared component so every "..." menu in the app goes through ONE
// correctly-positioned/z-indexed implementation instead of each screen
// hand-rolling its own `position: relative` parent + `absolute` child,
// which is what caused this exact "menu hidden behind the nav sidebar"
// bug to resurface at a second, then a third+ location — those ad-hoc
// copies were never touched by the first fix (commit 1113178) because
// they were never the same component to begin with.
//
// Renders into a Portal so it sits above every other UI layer (z-[1050]:
// below the nav sidebar's fixed z-[1100], above every other modal/overlay —
// see RemarkMultiSelectInput/SearchableSelect for the same convention).
// Stays ANCHORED to its trigger button even as the page scrolls/resizes,
// flips above/below and left/right to avoid viewport overflow, and closes
// on outside click, Escape, or scroll (ignoring scroll events that
// originate from inside the menu's own scrollable body).
export default function FloatingDropdown({
  anchorEl,
  open,
  onClose,
  align = 'left',
  className = '',
  style,
  children,
}: {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  className?: string;
  // Extra inline styles merged onto the portaled menu — e.g. matching the
  // trigger's own width (`width: anchorEl?.offsetWidth`) for a combobox-
  // style dropdown, where the old absolute-positioned version got that for
  // free from `left-0 right-0` inside a `position: relative` parent.
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    setPos(align === 'right'
      ? { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) }
      : { top: rect.bottom + 4, left: rect.left });

    // 'scroll' không bubble nên phải nghe ở capture phase để bắt được scroll
    // của bất kỳ ancestor/scroll-container nào (phase strip, table wrapper...).
    // Nhưng capture phase cũng bắt luôn scroll NỘI BỘ của chính menu (vd. danh
    // sách cột dài) - phải loại trừ trường hợp đó, nếu không menu sẽ tự đóng
    // ngay khi user vừa mới lăn chuột để cuộn nó.
    const closeOnOutsideScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('scroll', closeOnOutsideScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', closeOnOutsideScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [open, anchorEl, align, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, onClose, anchorEl]);

  // Flip the menu to open ABOVE the trigger when opening below would push it
  // past the bottom of the viewport (e.g. the "⋮" row menu on a Group Task/
  // Task near the bottom of the table) — without this it renders off-screen,
  // looking like it's missing or covered by something.
  //
  // Also flip LEFT↔RIGHT so a menu anchored to the very edge of the viewport
  // (Task `...` next to the left side of a narrow window, or near the right
  // side) stays fully visible: the default `align="right"` opens the menu to
  // the LEFT of the button; if there isn't enough horizontal room there we
  // switch to opening to the RIGHT (`left: rect.right`), and vice-versa for
  // `align="left"`. The flip is symmetric and re-runs whenever the user
  // scrolls/resizes so a fresh re-position is always picked up.
  useLayoutEffect(() => {
    if (!open || !anchorEl || !pos || !menuRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const VIEWPORT_GAP = 8;
    let nextTop = pos.top;
    let nextLeft = pos.left;
    let nextRight = pos.right;

    // Vertical flip: bottom-overflow → above the anchor.
    if (menuRect.bottom > window.innerHeight - VIEWPORT_GAP) {
      const flippedTop = anchorRect.top - menuRect.height - 4;
      if (flippedTop >= 0) {
        nextTop = flippedTop;
      }
    }

    // Horizontal flip: when `align="right"` (menu extends LEFT from the
    // anchor's right edge) and the menu would clip past the left viewport
    // edge, switch to extending RIGHT from the anchor's right edge. When
    // `align="left"` and it would clip past the right edge, mirror-image.
    const overflowsLeft = menuRect.left < VIEWPORT_GAP;
    const overflowsRight = menuRect.right > window.innerWidth - VIEWPORT_GAP;
    if (align === 'right' && overflowsLeft) {
      // Menu opens to the right of the anchor (instead of left of it).
      nextLeft = anchorRect.right;
      nextRight = undefined;
    } else if (align === 'left' && overflowsRight) {
      // Menu opens to the left of the anchor (instead of right of it).
      nextRight = Math.max(VIEWPORT_GAP, window.innerWidth - anchorRect.left);
      nextLeft = undefined;
    }

    if (nextTop !== pos.top || nextLeft !== pos.left || nextRight !== pos.right) {
      setPos({ top: nextTop, left: nextLeft, right: nextRight });
    }
  }, [open, anchorEl, pos, align]);

  if (!open || !pos || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={menuRef}
      // z-[1050]: below the nav sidebar's fixed z-[1100], above every other
      // modal/overlay — see RemarkMultiSelectInput/SearchableSelect for the
      // same convention.
      style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 1050, maxHeight: '70vh', overflowY: 'auto', ...style }}
      className={`text-[#0b1c30] ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}
