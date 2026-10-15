'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { LanguageProvider } from '@/components/LanguageContext';
import PaymentStep from '@/components/PaymentStep';
import { CheckSealIcon } from '@/components/Icons';

// Walk-in payment page — the target of each barber's personal QR code.
// A customer with no appointment scans the code, enters the amount the
// barber quotes, and pays by card, Apple Pay, or bank. 100% of the
// payment goes to the barber (standard payout fee applies, as always).
export default function WalkinPayPage() {
  return (
    <LanguageProvider>
      <PayInner />
    </LanguageProvider>
  );
}

function PayInner() {
  const params = useParams();
  const barberId = typeof params.barberId === 'string' ? params.barberId : '';

  const [info, setInfo] = useState<{ barberName: string; branchName: string | null } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [amountStr, setAmountStr] = useState('');
  const [payerName, setPayerName] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [amount, setAmount] = useState(0);
  const [paidPi, setPaidPi] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!barberId) return;
    fetch(`/api/pay/${encodeURIComponent(barberId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.barberName) setInfo({ barberName: d.barberName, branchName: d.branchName ?? null });
        else setNotFound(true);
      })
      .catch(() => setNotFound(true));
  }, [barberId]);

  async function startPayment() {
    const amt = Math.round(parseFloat(amountStr) * 100) / 100;
    if (!Number.isFinite(amt) || amt < 1 || amt > 1000) {
      setError('Enter an amount between $1 and $1,000.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/pay/${encodeURIComponent(barberId)}/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, payerName: payerName.trim() || undefined }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.clientSecret) throw new Error(d?.error || 'Could not start the payment.');
      setAmount(amt);
      setClientSecret(d.clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPaid(paymentIntentId: string) {
    setPaidPi(paymentIntentId);
    setError('');
    try {
      const r = await fetch(`/api/pay/${encodeURIComponent(barberId)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntentId }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || 'confirm failed');
      setDone(true);
    } catch {
      setError('Your payment went through, but we could not confirm it yet. Tap below to finish confirming — you will not be charged again.');
    }
  }

  return (
    <main className="flex-1 flex flex-col items-center px-5 py-10">
      <Image src="/logo.jpg" alt="MRC Barbershop logo" width={84} height={84} className="hero-logo" priority />
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-center">
        <span className="gold-text">MRC Barbershop</span>
      </h1>

      {notFound ? (
        <div className="card p-6 mt-8 w-full max-w-md text-center">
          <p className="font-bold text-[16px]">This payment page is not available.</p>
          <p className="text-sm text-neutral-500 mt-2">Please ask your barber for a new QR code.</p>
        </div>
      ) : !info ? (
        <p className="text-sm text-neutral-500 mt-10">Loading…</p>
      ) : done ? (
        <div className="card p-6 mt-8 w-full max-w-md text-center">
          <div className="flex justify-center text-green-600"><CheckSealIcon size={52} /></div>
          <p className="font-extrabold text-[19px] mt-3">Payment complete</p>
          <p className="text-sm text-neutral-600 mt-2">
            You paid <b>${amount.toFixed(2)}</b> to <b>{info.barberName}</b>. Thank you!
          </p>
        </div>
      ) : clientSecret ? (
        <div className="w-full max-w-md mt-8">
          {error && (
            <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-800">
              <p>{error}</p>
              {paidPi && (
                <button onClick={() => confirmPaid(paidPi)} className="mt-2 underline font-bold">
                  Finish confirming
                </button>
              )}
            </div>
          )}
          <PaymentStep
            clientSecret={clientSecret}
            amount={amount}
            summary={{ serviceName: 'Walk-in payment', barberName: info.barberName, totalPrice: amount, amountLabel: 'You pay' }}
            onSuccess={(piId) => void confirmPaid(piId)}
            onBack={() => { setClientSecret(''); setError(''); }}
            onError={(msg) => setError(msg)}
          />
        </div>
      ) : (
        <div className="card p-6 mt-8 w-full max-w-md">
          <p className="text-center text-[15px]">
            Pay <b>{info.barberName}</b>
            {info.branchName ? <span className="text-neutral-500"> · {info.branchName}</span> : null}
          </p>
          <label className="block mt-5 text-[12px] font-bold uppercase tracking-wide text-neutral-500">Amount (USD)</label>
          <div className="mt-1 flex items-center rounded-xl border border-neutral-300 bg-white px-4">
            <span className="text-neutral-500 font-bold">$</span>
            <input
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="35.00"
              className="w-full px-2 py-3.5 text-[17px] font-semibold outline-none bg-transparent"
            />
          </div>
          <label className="block mt-4 text-[12px] font-bold uppercase tracking-wide text-neutral-500">Your name (optional)</label>
          <input
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            placeholder="So your barber knows who paid"
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3.5 text-[15px] outline-none"
          />
          {error && <p className="text-red-700 text-sm mt-3">{error}</p>}
          <button onClick={startPayment} disabled={busy} className="gold-btn w-full rounded-xl py-3.5 mt-5 font-extrabold text-[15px]">
            {busy ? 'Starting…' : 'Continue to payment'}
          </button>
          <p className="text-[11px] text-neutral-400 mt-4 leading-relaxed text-center">
            Pay securely by card, Apple Pay, or bank. Your payment goes to your barber.
          </p>
        </div>
      )}
    </main>
  );
}
