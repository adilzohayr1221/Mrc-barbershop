'use client';

import { useEffect, useState } from 'react';

interface BonusInfo {
  at: number;
  usd: number;
  state: 'none' | 'earned' | 'paid';
}

interface Milestone {
  completedHaircuts: number;
  bonus10: BonusInfo;
  bonus100: BonusInfo;
}

function BonusRow({ bonus, done }: { bonus: BonusInfo; done: number }) {
  const pct = Math.min(100, Math.round((done / bonus.at) * 100));
  const label =
    bonus.state === 'paid'
      ? `✓ $${bonus.usd} paid`
      : bonus.state === 'earned'
        ? `🎉 $${bonus.usd} earned — on its way!`
        : `$${bonus.usd} at ${bonus.at} haircuts`;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[13px]">
        <b>{label}</b>
        <span className="text-neutral-500 font-semibold">
          {Math.min(done, bonus.at)}/{bonus.at}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-[#e9dfc6] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #a8821f, #d4af37)' }}
        />
      </div>
    </div>
  );
}

// Barber milestone bonuses: $100 at 10 haircuts, $500 at 100 (one-time each).
export default function BonusCard({ token }: { token: string }) {
  const [m, setM] = useState<Milestone | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch('/api/loyalty/barber', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setM(d.milestone);
      })
      .catch(() => {});
  }, [token]);

  if (!m) return null;

  return (
    <div className="card p-5 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center text-xl shrink-0">
          🎯
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-[16px] text-[#141414]">My bonuses</div>
          <div className="text-[12px] text-neutral-500">
            {m.completedHaircuts} haircut{m.completedHaircuts === 1 ? '' : 's'} done in the app
          </div>
        </div>
      </div>
      <BonusRow bonus={m.bonus10} done={m.completedHaircuts} />
      <BonusRow bonus={m.bonus100} done={m.completedHaircuts} />
    </div>
  );
}
