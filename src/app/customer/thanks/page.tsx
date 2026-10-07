'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCustomerAuth } from '@/components/CustomerAuth';
import { ArrowLeftIcon } from '@/components/Icons';

interface ThanksInfo {
  ref: string;
  barberId: string;
  barberName: string;
  serviceName: string;
  canTip: boolean;
  alreadyTipped: boolean;
}

const TIP_PRESETS = [2, 5, 10];

function ThanksInner() {
  const { checked, token } = useCustomerAuth();
  const searchParams = useSearchParams();
  const ref = searchParams.get('ref') || '';
  const [info, setInfo] = useState<ThanksInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [tip, setTip] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [tipError, setTipError] = useState('');

  useEffect(() => {
    if (!checked || !token || !ref) return;
    fetch(`/api/thanks?ref=${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (!r.ok) throw new Error(d.error || 'Could not load.');
        setInfo(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
      .finally(() => setLoading(false));
  }, [checked, token, ref]);

  async function submit() {
    if (!info || stars < 1 || stars > 5) {
      setError('Tap the stars to rate your haircut.');
      return;
    }
    setBusy(true);
    setError('');
    setTipError('');
    try {
      // 1. Review (stars + optional words).
      const rr = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ barberId: info.barberId, rating: stars, text }),
      });
      const rd = await rr.json().catch(() => null);
      if (!rr.ok) throw new Error(rd?.error || 'Could not send your review.');

      // 2. Tip (بقشيش), if chosen and available.
      const tipAmount = tip ?? (customTip ? Number(customTip) : 0);
      if (tipAmount > 0) {
        const tr = await fetch('/api/tips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ref: info.ref, amount: tipAmount }),
        });
        const td = await tr.json().catch(() => null);
        if (!tr.ok) {
          // Review is saved; surface the tip problem without failing everything.
          setTipError(td?.error || 'The tip did not go through.');
        }
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send.');
    }
    setBusy(false);
  }

  if (!checked || loading) {
    return (
      <main className="flex-1 px-4 py-10 max-w-md mx-auto w-full text-center">
        <p className="text-neutral-500 text-sm">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
      <Link href="/customer" className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gold mb-4">
        <ArrowLeftIcon size={14} /> Back
      </Link>

      {error && !info ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-neutral-600">{error || 'This link is not valid.'}</p>
        </div>
      ) : done ? (
        <div className="card p-8 text-center fade-in">
          <div className="text-[48px] mb-3">🙏</div>
          <h1 className="font-extrabold text-[20px]">Thank you!</h1>
          <p className="text-[14px] text-neutral-600 mt-2 leading-relaxed">
            Your feedback was sent to {info?.barberName}.
            {tipError ? '' : ''}
          </p>
          {tipError && (
            <p className="text-[13px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3.5 py-2.5 mt-3 leading-relaxed">
              Review saved — but: {tipError}
            </p>
          )}
          <Link href="/customer" className="gold-btn rounded-2xl w-full font-extrabold text-[15px] py-3.5 mt-5 inline-block">
            Done
          </Link>
        </div>
      ) : info ? (
        <div className="card p-6 fade-in">
          <div className="text-center">
            <div className="text-[44px] mb-2">💈</div>
            <h1 className="font-extrabold text-[20px]">How was your haircut?</h1>
            <p className="text-[14px] text-neutral-500 mt-1">
              {info.serviceName} with <b className="text-neutral-700">{info.barberName}</b>
            </p>
          </div>

          <div className="flex justify-center gap-2 mt-5" role="radiogroup" aria-label="Star rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setStars(n)}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                className="text-[42px] leading-none transition-transform active:scale-125"
                style={{ filter: n <= stars ? 'none' : 'grayscale(1)', opacity: n <= stars ? 1 : 0.35 }}
              >
                ⭐
              </button>
            ))}
          </div>
          <p className="text-center text-[12px] text-neutral-500 mt-1.5 h-4">
            {stars === 5 && 'Amazing! 🔥'}
            {stars === 4 && 'Great! 👏'}
            {stars === 3 && 'Okay.'}
            {stars === 2 && 'Not great.'}
            {stars === 1 && 'Terrible.'}
          </p>

          <label className="block text-[13px] font-bold text-neutral-700 mt-4 mb-1.5">
            A few words <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="What did you like?"
            className="input w-full resize-none"
          />

          {(info.canTip || info.alreadyTipped) && (
            <>
              <label className="block text-[13px] font-bold text-neutral-700 mt-5 mb-1.5">
                💵 Leave a tip <span className="font-normal text-neutral-400">(بقشيش — optional, 100% goes to {info.barberName})</span>
              </label>
              {info.alreadyTipped ? (
                <p className="text-[13px] text-green-700 bg-green-600/10 border border-green-600/25 rounded-xl px-3.5 py-2.5 leading-relaxed">
                  You already tipped for this haircut — thank you! 🙏
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {TIP_PRESETS.map((v) => (
                      <button
                        key={v}
                        onClick={() => { setTip(tip === v ? null : v); setCustomTip(''); }}
                        className={`rounded-2xl py-3 font-extrabold text-[15px] border-2 transition-colors ${
                          tip === v
                            ? 'border-gold bg-gold/15 text-gold'
                            : 'border-[#e6dabf] bg-[#f7f2e2] text-neutral-700'
                        }`}
                      >
                        ${v}
                      </button>
                    ))}
                  </div>
                  <input
                    value={customTip}
                    onChange={(e) => { setCustomTip(e.target.value.replace(/[^0-9.]/g, '')); setTip(null); }}
                    placeholder="Custom amount"
                    inputMode="decimal"
                    className="input w-full mt-2"
                  />
                </>
              )}
            </>
          )}

          {error && (
            <p className="text-[13px] text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-3.5 py-2.5 mt-4 text-center leading-relaxed">
              {error}
            </p>
          )}
          <button
            onClick={() => void submit()}
            disabled={busy || stars < 1}
            className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-5 disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      ) : null}
    </main>
  );
}

export default function ThanksPage() {
  return (
    <Suspense>
      <ThanksInner />
    </Suspense>
  );
}
