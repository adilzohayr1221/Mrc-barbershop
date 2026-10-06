'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeftIcon } from '@/components/Icons';
import { BranchPageSkeleton } from '@/components/Loading';
import { customerToken } from '@/components/CustomerAuth';

interface ClaimedGift {
  id: string;
  serviceName: string;
  price: number;
  buyerName: string;
  recipientName: string | null;
  shortCode: string;
  qr: string;
  expiresAt: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ClaimInner() {
  const searchParams = useSearchParams();
  const code = (searchParams.get('code') || '').trim().toUpperCase();
  const [phase, setPhase] = useState<'checking' | 'login' | 'claiming' | 'done' | 'error'>('checking');
  const [gift, setGift] = useState<ClaimedGift | null>(null);
  const [error, setError] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const token = customerToken();
    if (!token) {
      setPhase('login');
      return;
    }
    // Verify the session without redirecting (unlike useCustomerAuth).
    fetch('/api/auth/customer', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error('unauthorized');
        return r.json();
      })
      .then(() => {
        if (!code) {
          setError('This gift link is incomplete.');
          setPhase('error');
          return;
        }
        setPhase('claiming');
        return fetch('/api/gifts/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shortCode: code }),
        })
          .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
          .then(({ ok, d }) => {
            if (!ok) throw new Error(d.error || 'Could not claim the gift.');
            setGift(d.gift);
            setPhase('done');
          });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Could not claim the gift.';
        if (msg === 'unauthorized') {
          // Invalid/expired session → treat as logged out.
          setPhase('login');
        } else {
          setError(msg);
          setPhase('error');
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'checking' || phase === 'claiming') {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <BranchPageSkeleton />
        {phase === 'claiming' && (
          <p className="text-center text-[14px] text-neutral-500 font-semibold mt-4 fade-in">
            Saving your gift…
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
      <Link href="/customer/gifts" className="back-link"><ArrowLeftIcon size={16} /> Gifts</Link>

      {phase === 'login' && (
        <div className="fade-in mt-4">
          <div
            className="relative overflow-hidden rounded-3xl p-6 text-center border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
            style={{ background: 'linear-gradient(135deg, #fdf8ea 0%, #f6ead0 100%)' }}
          >
            <p className="text-[48px]">🎁</p>
            <h1 className="font-extrabold text-[22px] mt-2 text-[#141414]">You&apos;ve received a gift!</h1>
            <p className="text-neutral-600 text-[14px] mt-2 leading-relaxed">
              Someone gifted you a haircut at MRC Barbershop.
              Log in or create an account to save it to your account.
            </p>
          </div>
          <Link
            href={`/customer/login?next=${encodeURIComponent(`/customer/gifts/claim?code=${code}`)}`}
            className="gold-btn rounded-2xl w-full inline-flex items-center justify-center font-extrabold text-[16px] py-4 mt-5"
          >
            Log in / Sign up
          </Link>
          <p className="text-[12px] text-neutral-400 text-center mt-3 leading-relaxed">
            After logging in, the gift is saved automatically.
          </p>
        </div>
      )}

      {phase === 'done' && gift && (
        <div className="fade-in mt-4">
          <p className="text-[14px] font-bold text-green-700 bg-green-600/10 border border-green-600/25 rounded-xl px-4 py-3 mb-4 leading-relaxed">
            Saved to your account ✓ — show this code at the shop.
          </p>
          <div
            className="relative overflow-hidden rounded-3xl p-6 border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
            style={{ background: 'linear-gradient(135deg, #fdf8ea 0%, #f6ead0 100%)' }}
          >
            <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">MRC Barbershop · Gift card</p>
            <h2 className="font-extrabold text-[22px] mt-2 text-[#141414]">🎁 {gift.serviceName}</h2>
            <p className="text-neutral-600 text-[14px] mt-1">
              From {gift.buyerName} · ${gift.price.toFixed(2)}
            </p>
            <div className="mt-5 flex justify-center">
              <div className="bg-white rounded-2xl p-3 border border-gold/30">
                <QRCodeSVG value={gift.qr} size={176} />
              </div>
            </div>
            <p className="text-center mt-4 text-[12px] uppercase tracking-[0.2em] text-neutral-500">Gift code</p>
            <p className="text-center font-mono font-extrabold text-gold-dark text-[34px] tracking-[0.15em]">{gift.shortCode}</p>
            <p className="text-center text-[12px] text-neutral-500 mt-2">
              Valid until {fmtDate(gift.expiresAt)} · Single use
            </p>
          </div>
          <Link
            href="/customer/gifts"
            className="gold-btn rounded-2xl w-full inline-flex items-center justify-center font-extrabold text-[16px] py-4 mt-5"
          >
            View my gifts
          </Link>
        </div>
      )}

      {phase === 'error' && (
        <div className="fade-in mt-4">
          <div className="card p-6 text-center">
            <p className="text-[40px]">😕</p>
            <h1 className="font-extrabold text-[18px] mt-2">Couldn&apos;t claim the gift</h1>
            <p className="text-[14px] text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 mt-3 leading-relaxed font-semibold">
              {error || 'Something went wrong.'}
            </p>
            <Link
              href="/customer/gifts"
              className="inline-flex items-center justify-center gap-1.5 text-sm text-gold font-bold mt-4"
            >
              <ArrowLeftIcon size={14} /> Back to Gifts
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ClaimGiftPage() {
  return (
    <Suspense
      fallback={
        <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
          <BranchPageSkeleton />
        </main>
      }
    >
      <ClaimInner />
    </Suspense>
  );
}
