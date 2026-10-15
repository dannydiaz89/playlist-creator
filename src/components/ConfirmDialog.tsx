'use client';
import { Dialog } from '@/components/Dialog';
import { btn } from '@/lib/design';

/** Destructive actions get an explicit confirm naming what will be lost. */
export function ConfirmDialog({
  open, title, body, confirmLabel, onConfirm, onCancel, busy,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} labelledBy="confirm-title">
      <div className="text-sm text-muted">{body}</div>
      <div className="flex items-center justify-end gap-2 pt-5">
        <button type="button" onClick={onCancel} data-autofocus className={btn.secondary}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={busy} className={btn.danger}>
          {busy ? 'Deleting…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
