'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrIcon } from '@/components/Icons';

// Member's wallet code: opens a modal with a QR membership code (MRC2).
// The barber scans it to redeem this week's haircut. Rotates every 10 min.
export function MembershipCodeButton({ getToken, membershipId }: { getToken: () => string; membershipId: string }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  async function generate() {
    setBusy(true);
    setError('');
    setCode(null);
    try {
      const r = await fetch('/api/memberships/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ membershipId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || 'Could not create the code.');
      setCode(d.code);
      setExpiresAt(d.expiresAt ?? null);
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
  }, [open]);

  const secsLeft = expiresAt ? Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000)) : 0;
  const expired = !!expiresAt && secsLeft <= 0;
  const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
  const ss = String(secsLeft % 60).padStart(2, '0');

  return (
    <>
      <button
        onClick={openModal}
        className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1c1a15] text-white font-bold text-[14px] py-3 px-4 shadow-[0_6px_16px_rgba(0,0,0,0.22)] active:scale-[0.98] transition-transform"
      >
        <QrIcon size={18} className="text-gold" />
        Show membership code
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/55" onClick={() => setOpen(false)} />
          <div className="relative card w-full max-w-sm p-6 text-center fade-in max-h-[92dvh] overflow-y-auto">
            <h3 className="font-extrabold text-[18px]">Membership code</h3>
            <p className="text-sm text-neutral-600 mt-1">
              Your barber scans this to redeem <b className="text-gold">this week&apos;s haircut</b>.
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
              One scan = one haircut. Unused weeks don&apos;t carry over.
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
