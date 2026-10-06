'use client';

import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/** Subtle danger-styled "Cancel appointment" button with a mandatory
 *  confirmation dialog. Used by both the barber and owner dashboards. */
export function CancelBookingButton({
  bookingId,
  getToken,
  onCancelled,
}: {
  bookingId: string;
  getToken: () => string;
  onCancelled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function doCancel() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (!r.ok) throw new Error(`cancel failed (${r.status})`);
      setOpen(false);
      onCancelled();
    } catch {
      setError('Could not cancel. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setError(''); setOpen(true); }}
        className="inline-flex items-center gap-1 text-red-700/90 text-sm font-medium hover:text-red-800 transition-colors min-h-[44px]"
      >
        Cancel appointment
      </button>
      {open && (
        <ConfirmDialog
          title="Cancel this appointment?"
          message="Are you sure you want to cancel this appointment? This cannot be undone."
          confirmLabel="Yes, cancel it"
          busy={busy}
          onCancel={() => !busy && setOpen(false)}
          onConfirm={doCancel}
        />
      )}
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </>
  );
}

/** Greyed "Cancelled" label for already-cancelled bookings. */
export function CancelledLabel() {
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] bg-neutral-200/80 text-neutral-500 border border-neutral-300">
      Cancelled
    </span>
  );
}

/** Amber "No-show" label for no-show bookings (deposit kept). */
export function NoShowLabel() {
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] bg-amber-100 text-amber-800 border border-amber-300">
      No-show
    </span>
  );
}
