'use client';
import { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { btn, panel, cn } from '@/lib/design';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * aria-modal="true" alone does NOT trap focus, close on Escape, restore focus,
 * or make the background inert. All four are implemented here because the
 * attribute on its own is decorative.
 */
const SIZES = {
  sm: 'max-w-md',   // confirmations, sign-in
  lg: 'max-w-2xl',  // forms with several sections
} as const;

export function Dialog({
  open, onClose, title, children, labelledBy = 'dialog-title', size = 'sm',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  labelledBy?: string;
  size?: keyof typeof SIZES;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Keep the latest onClose in a ref. Callers pass an inline arrow, so its
  // identity changes every render; depending on it directly made the lifecycle
  // effect re-run on EVERY keystroke, which re-focused [data-autofocus] and
  // yanked the caret back to the first field mid-typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Stable for the life of the dialog: reads the ref rather than closing over
  // onClose, so the listener is attached once.
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, []);

  // Depends ONLY on `open`. Everything here is open/close lifecycle and must
  // run exactly once per opening, never per render.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const t = setTimeout(() => {
      const target =
        panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 20);

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus(); // focus returns to whatever opened the dialog
    };
  }, [open, onKeyDown]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={panelRef}
        className={cn(panel, 'w-full p-6 max-h-[88vh] overflow-y-auto shadow-xl', SIZES[size])}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <h2 id={labelledBy} className="text-lg font-medium text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className={cn(btn.ghost, '!min-h-0 !p-2 -m-2')}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
