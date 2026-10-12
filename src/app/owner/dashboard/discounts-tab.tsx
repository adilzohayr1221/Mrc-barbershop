'use client';

import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { authHeaders } from './auth';

/* ---------------- Student & military discounts ---------------- */
export function DiscountsTab() {
  const [items, setItems] = useState<{
    customerId: string;
    name: string;
    email: string;
    type: 'student' | 'military';
    status: 'pending' | 'approved';
    photoUrl: string | null;
    requestedAt: string;
  }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState<string | null>(null);

  const load = () => {
    fetch('/api/owner/discounts', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.discounts) setItems(d.discounts); })
      .catch(() => {});
  };
  useEffect(load, []);

  async function act(customerId: string, name: string, action: 'approve' | 'reject' | 'revoke') {
    const msg = action === 'approve'
      ? `Approve the 15% discount for ${name}? It applies to all their bookings, plans and gifts.`
      : action === 'reject'
        ? `Reject ${name}'s discount request? They can try again.`
        : `Revoke ${name}'s 15% discount? They will pay full price from now on.`;
    if (!confirm(msg)) return;
    setBusy(customerId);
    try {
      const r = await fetch('/api/owner/discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ customerId, action }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Could not update.'); return; }
      load(); // refresh: rejected drops off, approved moves to the active list
    } finally {
      setBusy(null);
    }
  }

  const pending = items.filter((x) => x.status === 'pending');
  const approved = items.filter((x) => x.status === 'approved');

  return (
    <div className="grid gap-4 fade-in">
      {items.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-sm text-neutral-500">No discount requests.</p>
        </div>
      )}

      {pending.length > 0 && (
        <section>
          <p className="text-[13px] font-bold text-gold mb-2">{pending.length} waiting for your review</p>
          <p className="text-[12px] text-neutral-500 mb-3 bg-gold/10 border border-gold/30 rounded-xl px-3 py-2">
            ⚠️ Check that the <b>name on the ID photo matches the account name</b> before approving —
            one ID can't be shared between friends.
          </p>
          <div className="grid gap-3">
            {pending.map((x) => (
              <div key={x.customerId} className="card p-4">
                {x.photoUrl && (
                  <button onClick={() => setEnlarged(x.photoUrl)} className="block w-full">
                    <img src={x.photoUrl} alt="ID photo" className="w-full rounded-xl object-cover max-h-72" />
                  </button>
                )}
                <div className="flex items-center justify-between mt-2.5">
                  <div>
                    <p className="font-bold text-[14px]">{x.name}</p>
                    <p className="text-[12px] text-neutral-500">
                      {x.email} · {new Date(x.requestedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="chip shrink-0">{x.type === 'student' ? '🎓 Student' : '🎖️ Military'}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => act(x.customerId, x.name, 'reject')}
                    disabled={busy === x.customerId}
                    className="flex-1 rounded-xl px-4 py-3 text-[13px] font-extrabold bg-neutral-100 text-neutral-600 border border-neutral-300"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => act(x.customerId, x.name, 'approve')}
                    disabled={busy === x.customerId}
                    className="flex-1 gold-btn rounded-xl px-4 py-3 text-[13px] font-extrabold"
                  >
                    {busy === x.customerId ? '…' : '✓ Approve 15% off'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {approved.length > 0 && (
        <section>
          <p className="text-[13px] font-bold text-neutral-600 mb-2">Active discounts ({approved.length})</p>
          <div className="grid gap-2">
            {approved.map((x) => (
              <div key={x.customerId} className="card p-3.5 flex items-center gap-3">
                <span className="flex-1 min-w-0">
                  <b className="text-[14px] block truncate">{x.name}</b>
                  <span className="text-[12px] text-neutral-500">
                    {x.type === 'student' ? '🎓 Student' : '🎖️ Military'} · 15% off
                  </span>
                </span>
                <button
                  onClick={() => act(x.customerId, x.name, 'revoke')}
                  disabled={busy === x.customerId}
                  className="rounded-xl px-3 py-2 text-[12px] font-extrabold text-red-700 border border-red-600/30 bg-red-600/5 shrink-0"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {enlarged && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setEnlarged(null)}
        >
          <img src={enlarged} alt="ID enlarged" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
