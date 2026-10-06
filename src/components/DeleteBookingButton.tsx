'use client';

import { useState } from 'react';
import { TrashIcon } from './Icons';

/** Danger-styled "Delete" button for CANCELLED / NO-SHOW bookings only, with a
 *  mandatory strong confirmation shown inline, right under the button.
 *  Permanent hard delete — the record is removed forever.
 *  Used by both the barber and owner dashboards. */
export function DeleteBookingButton({
  bookingId,
  getToken,
  onDeleted,
}: {
  bookingId: string;
  getToken: () => string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function doDelete() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || `delete failed (${r.status})`);
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete. Please try again.');
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
        <TrashIcon size={14} /> Delete
      </button>
      {open && (
        <div className="mt-1 rounded-2xl border-2 border-red-700/30 bg-red-700/5 p-3.5 fade-in">
          <p className="text-[14px] font-extrabold text-red-800">Delete permanently?</p>
          <p className="text-[12.5px] text-neutral-600 mt-1 leading-relaxed">
            This appointment will be removed forever and cannot be recovered.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => !busy && setOpen(false)}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#f4edda] border border-[#dccfae] text-neutral-700 min-h-[48px] disabled:opacity-50"
            >
              Keep it
            </button>
            <button
              onClick={doDelete}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-red-700 min-h-[48px] disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Yes, delete it'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </>
  );
}
