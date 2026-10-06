'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrIcon } from '@/components/Icons';

// The "icon" the customer taps after the haircut: opens a modal with a QR
// payment code. The barber scans it to charge the remaining balance from
// the card saved at booking time. The code is single-use, expires in 10 min.
export function CollectCodeButton({
  bookingId,
  serviceName,
  remaining,
  getToken,
}: {
  bookingId: string;
  serviceName: string;
  remaining: number;
  getToken: () => string;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [barberName, setBarberName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  async function generate() {
    setBusy(true);
    setError('');
    setCode(null);
    try {
      const r = await fetch('/api/payments/collect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ bookingId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || 'Could not create the code.');
      setCode(d.code);
      setExpiresAt(d.expiresAt ?? null);
      setBarberName(d.barberName ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the code.');
    }
    setBusy(false);
  }

  function openModal() {
    setOpen(true);
    setError('');
    void generate();
  }

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open ]);

  const secsLeft = expiresAt ? Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000)) : 0;
  const expired = !!expiresAt && secsLeft <= 0;
  const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
  const ss = String(secsLeft % 60).padStart(2, '0');

  return (
    <>
      <button
        onClick={openModal}
        className="mt-2.5 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1c1a15] text-white font-bold text-[14px] py-3 px-4 shadow-[0_6px_16px_rgba(0,0,0,0.22)] active:scale-[0.98] transition-transform"
      >
        <QrIcon size={18} className="text-gold" />
        Show payment code
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/55" onClick={() => setOpen(false)} />
          <div className="relative card w-full max-w-sm p-6 text-center fade-in max-h-[92dvh] overflow-y-auto">
            <h3 className="font-extrabold text-[18px]">Payment code</h3>
            <p className="text-sm text-neutral-600 mt-1">
              {serviceName} · remaining <b className="text-gold">${remaining.toFixed(2)}</b>
            </p>

            <div className="mt-4 flex justify-center">
              {busy ? (
                <div className="w-52 h-52 rounded-2xl bg-[#f4edda] border border-[#e6dabf] flex items-center justify-center text-sm text-neutral-500">
                  Creating code…
                </div>
              ) : code && !expired ? (
                <div className="bg-white p-4 rounded-2xl border-2 border-gold/60 shadow-[0_8px_30px_rgba(168,130,31,0.25)]">
                  <QRCodeSVG value={code} size={208} level="M" />
                </div>
              ) : (
                <div className="w-52 h-52 rounded-2xl bg-[#f4edda] border border-[#e6dabf] flex items-center justify-center text-sm text-neutral-500 px-6 text-center">
                  {error || 'Code expired.'}
                </div>
              )}
            </div>

            {!busy && !error && code && !expired && (
              <p className="text-[13px] font-bold text-neutral-700 mt-3">
                Expires in <span className="text-gold tabular-nums">{mm}:{ss}</span>
              </p>
            )}
            {error && <p className="text-sm text-red-700 mt-3 leading-relaxed">{error}</p>}

            <p className="text-[13px] text-neutral-500 mt-3 leading-relaxed">
              {barberName ? <>Show this to <b>{barberName}</b> before your haircut — </> : 'Show this to your barber before your haircut — '}
              scanning it charges the remaining <b>${remaining.toFixed(2)}</b> to your card.
            </p>

            <div className="grid grid-cols-2 gap-2.5 mt-5">
              <button
                onClick={() => void generate()}
                disabled={busy}
                className="rounded-2xl border-2 border-[#1c1a15] font-bold text-[14px] py-3 disabled:opacity-50"
              >
                {busy ? '…' : 'New code'}
              </button>
              <button onClick={() => setOpen(false)} className="gold-btn rounded-2xl font-bold text-[14px] py-3">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
