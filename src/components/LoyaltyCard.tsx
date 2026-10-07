'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useCustomerAuth } from '@/components/CustomerAuth';

interface LoyaltyState {
  paidHaircuts: number;
  needed: number;
  freeEarned: boolean;
  freeUsed: boolean;
  reward: { id: string; qr: string; status: string } | null;
}

// Customer loyalty card: "4 haircuts -> the 5th is FREE" (one-time).
// Shows progress, and the free-haircut QR once earned.
export default function LoyaltyCard() {
  const { checked, token } = useCustomerAuth();
  const [loyalty, setLoyalty] = useState<LoyaltyState | null>(null);

  useEffect(() => {
    if (!checked || !token) return;
    fetch('/api/loyalty/mine', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setLoyalty(d.loyalty);
      })
      .catch(() => {});
  }, [checked, token]);

  if (!loyalty) return null;
  // Reward fully used and no progress to show — hide the card.
  if (loyalty.freeUsed) return null;

  const remaining = Math.max(0, loyalty.needed - loyalty.paidHaircuts);
  const pct = Math.min(100, Math.round((loyalty.paidHaircuts / loyalty.needed) * 100));

  return (
    <div
      className="block rounded-2xl p-4 mb-4 relative overflow-hidden border border-gold/40 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
      style={{ background: 'linear-gradient(120deg, #1c1a16 0%, #0e0d0b 100%)' }}
    >
      {loyalty.reward ? (
        <div className="text-center">
          <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-gold">🎉 Loyalty reward</p>
          <p className="font-extrabold text-[17px] mt-1 text-white">Your 5th haircut is FREE!</p>
          <p className="text-[13px] text-neutral-400 mt-0.5 mb-3">Show this code at the shop — one-time use</p>
          <div className="inline-block bg-white rounded-2xl p-3">
            <QRCodeSVG value={loyalty.reward.qr} size={150} />
          </div>
        </div>
      ) : (
        <>
          <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-gold">✂️ Loyalty</p>
          <p className="font-extrabold text-[17px] mt-1 text-white">
            {loyalty.paidHaircuts}/{loyalty.needed} haircuts
          </p>
          <p className="text-[13px] text-neutral-400 mt-0.5">
            {remaining === 0
              ? 'Reward on its way…'
              : `${remaining} more haircut${remaining === 1 ? '' : 's'} — your 5th is FREE!`}
          </p>
          <div className="mt-3 h-2.5 rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #d4af37, #f5d67b)' }}
            />
          </div>
        </>
      )}
    </div>
  );
}
