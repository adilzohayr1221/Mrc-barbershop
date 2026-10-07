'use client';

import { useEffect, useState } from 'react';

interface BarberBonusRow {
  barberId: string;
  barberName: string;
  completedHaircuts: number;
  bonus10: 'none' | 'earned' | 'paid';
  bonus10EarnedAt: string | null;
  bonus100: 'none' | 'earned' | 'paid';
  bonus100EarnedAt: string | null;
}

function bonusBadge(state: 'none' | 'earned' | 'paid', usd: number) {
  if (state === 'paid') return <span className="text-[11px] font-bold text-green-700 bg-green-600/10 border border-green-600/25 rounded-full px-2.5 py-1">✓ ${usd} paid</span>;
  if (state === 'earned') return <span className="text-[11px] font-bold text-gold bg-gold/10 border border-gold/40 rounded-full px-2.5 py-1">🎉 ${usd} earned</span>;
  return <span className="text-[11px] font-semibold text-neutral-400">—</span>;
}

// Owner: barber milestone bonuses ($100 at 10 haircuts, $500 at 100).
// Earned bonuses get a "Mark as paid" button; one-time each.
export default function BonusesTab({ getToken }: { getToken: () => string }) {
  const [rows, setRows] = useState<BarberBonusRow[]>([]);
  const [loyalty, setLoyalty] = useState<{ freeEarned: number; freeRedeemed: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    fetch('/api/loyalty/overview', { headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setRows(d.barbers);
          setLoyalty(d.loyalty);
        }
      })
      .catch(() => {});
  };
  useEffect(load, []);

  async function markPaid(barberId: string, which: 'bonus10' | 'bonus100', usd: number, name: string) {
    if (!confirm(`Mark the $${usd} bonus for ${name} as PAID?`)) return;
    setBusy(`${barberId}:${which}`);
    try {
      const r = await fetch('/api/loyalty/bonus/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ barberId, which }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Could not mark as paid.'); return; }
      load();
    } finally {
      setBusy(null);
    }
  }

  const pendingCount = rows.filter((r) => r.bonus10 === 'earned' || r.bonus100 === 'earned').length;

  return (
    <div>
      <div className="card p-4 mb-3">
        <p className="font-extrabold text-[15px]">🎯 Barber milestone bonuses</p>
        <p className="text-[12px] text-neutral-500 mt-1 leading-relaxed">
          $100 at 10 haircuts · $500 at 100 haircuts — one-time each. Pay the bonus, then mark it paid.
        </p>
        {loyalty && (
          <p className="text-[12px] text-neutral-500 mt-1">
            Loyalty free haircuts earned: <b>{loyalty.freeEarned}</b> · redeemed: <b>{loyalty.freeRedeemed}</b>
          </p>
        )}
      </div>

      {pendingCount > 0 && (
        <p className="text-[13px] font-bold text-gold bg-gold/10 border border-gold/40 rounded-xl px-4 py-2.5 mb-3">
          ⚠️ {pendingCount} barber{pendingCount === 1 ? '' : 's'} waiting for {pendingCount === 1 ? 'a' : ''} bonus payment
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500 text-center py-8">No barbers yet.</p>
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <div key={r.barberId} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <b className="text-[15px] truncate">{r.barberName}</b>
                <span className="text-[12px] text-neutral-500 shrink-0">{r.completedHaircuts} haircuts</span>
              </div>
              <div className="mt-3 grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-neutral-600">$100 bonus (10 haircuts)</span>
                  {r.bonus10 === 'earned' ? (
                    <button
                      onClick={() => void markPaid(r.barberId, 'bonus10', 100, r.barberName)}
                      disabled={busy === `${r.barberId}:bonus10`}
                      className="gold-btn rounded-xl px-3.5 py-2 text-[13px] font-bold disabled:opacity-50"
                    >
                      {busy === `${r.barberId}:bonus10` ? '…' : 'Mark as paid'}
                    </button>
                  ) : bonusBadge(r.bonus10, 100)}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-neutral-600">$500 bonus (100 haircuts)</span>
                  {r.bonus100 === 'earned' ? (
                    <button
                      onClick={() => void markPaid(r.barberId, 'bonus100', 500, r.barberName)}
                      disabled={busy === `${r.barberId}:bonus100`}
                      className="gold-btn rounded-xl px-3.5 py-2 text-[13px] font-bold disabled:opacity-50"
                    >
                      {busy === `${r.barberId}:bonus100` ? '…' : 'Mark as paid'}
                    </button>
                  ) : bonusBadge(r.bonus100, 500)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
