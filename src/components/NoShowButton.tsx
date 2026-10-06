'use client';

import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/** "No-show" button: marks the appointment as a no-show WITHOUT refunding
 *  the deposit. Used by both the barber and owner dashboards. */
export function NoShowButton({
  bookingId,
  getToken,
  onMarked,
}: {
  bookingId: string;
  getToken: () => string;
  onMarked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function doMark() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'no_show' }),
      });
      if (!r.ok) throw new Error(`no-show failed (${r.status})`);
      setOpen(false);
      onMarked();
    } catch {
      setError('Could not mark as no-show. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setError(''); setOpen(true); }}
        className="inline-flex items-center gap-1 text-amber-700 text-sm font-medium hover:text-amber-800 transition-colors min-h-[44px]"
      >
        No-show
      </button>
      {open && (
        <ConfirmDialog
          title="Mark as no-show?"
          message="The customer did not come. The $5 deposit will NOT be refunded. This cannot be undone."
          confirmLabel="Yes, no-show"
          busy={busy}
          onCancel={() => !busy && setOpen(false)}
          onConfirm={doMark}
        />
      )}
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </>
  );
}
