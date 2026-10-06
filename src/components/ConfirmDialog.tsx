'use client';

import { useEffect } from 'react';

/** Themed confirmation dialog. Rendered only when `open` is true. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  busyLabel,
  cancelLabel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  busyLabel?: string;
  cancelLabel?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-sm p-6 fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-extrabold text-[17px]">{title}</h3>
        <p className="text-sm text-neutral-600 mt-2 leading-relaxed">{message}</p>
        <div className="flex gap-2.5 mt-5">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-3 rounded-2xl text-sm font-bold bg-[#f4edda] border border-[#dccfae] text-neutral-700 min-h-[48px] disabled:opacity-50"
          >
            {cancelLabel ?? 'Keep it'}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-3 rounded-2xl text-sm font-bold text-white bg-red-700 hover:bg-red-800 transition-colors min-h-[48px] disabled:opacity-50"
          >
            {busy ? (busyLabel ?? 'Cancelling…') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
