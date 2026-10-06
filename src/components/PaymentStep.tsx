'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { ArrowLeftIcon, LockIcon } from '@/components/Icons';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

interface Summary {
  serviceName: string;
  barberName?: string;
  dateLabel?: string;
  time?: string;
  totalPrice: number;
  amountLabel?: string;
}

function PayForm({
  amount,
  summary,
  onSuccess,
  onBack,
  onError,
}: {
  amount: number;
  summary: Summary;
  onSuccess: (paymentIntentId: string) => void;
  onBack: () => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    onError('');
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });
    if (error) {
      onError(error.message || 'Payment failed. Please check your card and try again.');
      setBusy(false);
      return;
    }
    if (paymentIntent && paymentIntent.status === 'succeeded') {
      const { hapticSuccess } = await import('@/lib/haptics');
      hapticSuccess();
      onSuccess(paymentIntent.id);
    } else {
      onError('Payment did not complete. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 fade-in">
      <div className="card p-5">
        <h2 className="font-extrabold text-[17px]">Order summary</h2>
        <div className="mt-3 grid gap-2 text-[15px] bg-[#f7f2e2] border border-[#e6dabf] rounded-2xl p-4">
          <p className="flex justify-between gap-3"><span className="text-neutral-500">Service</span><b className="text-right">{summary.serviceName}</b></p>
          {summary.barberName && (
            <p className="flex justify-between gap-3"><span className="text-neutral-500">Barber</span><b className="text-right">{summary.barberName}</b></p>
          )}
          {summary.dateLabel && summary.time && (
            <p className="flex justify-between gap-3"><span className="text-neutral-500">When</span><b className="text-right">{summary.dateLabel} at {summary.time}</b></p>
          )}
          <p className="flex justify-between gap-3"><span className="text-neutral-500">Service price</span><b className="text-right">${summary.totalPrice.toFixed(2)}</b></p>
          <p className="flex justify-between gap-3 pt-2 mt-1 border-t border-[#e6dabf]">
            <span className="font-bold">{summary.amountLabel ?? 'Deposit due now'}</span>
            <b className="text-gold text-[18px]">${amount.toFixed(2)}</b>
          </p>
          {summary.totalPrice - amount > 0.005 && (
            <p className="text-[13px] text-neutral-500 text-right -mt-1">
              Remaining ${(summary.totalPrice - amount).toFixed(2)} is paid at the shop.
            </p>
          )}
          {summary.totalPrice - amount > 0.005 && (
            <p className="text-[12px] text-neutral-500 leading-relaxed mt-2 pt-2 border-t border-[#e6dabf]">
              By paying this deposit you agree that before your haircut, your barber will charge
              the remaining ${(summary.totalPrice - amount).toFixed(2)} to this same card when
              you show your payment code.
            </p>
          )}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-extrabold text-[17px] flex items-center gap-2">
          Payment <LockIcon size={14} className="text-gold" />
        </h2>
        <p className="text-[13px] text-neutral-500 mt-1 mb-4">Secure payment via Stripe.</p>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>

      <button onClick={pay} disabled={busy || !stripe} className="gold-btn rounded-2xl px-6 py-4 text-[17px]">
        {busy ? 'Processing…' : `Pay $${amount.toFixed(2)}`}
      </button>
      <button onClick={onBack} disabled={busy} className="flex items-center justify-center gap-1.5 text-sm text-neutral-500 font-medium -mt-2">
        <ArrowLeftIcon size={14} /> Back to details
      </button>
    </div>
  );
}

export default function PaymentStep({
  clientSecret,
  amount,
  summary,
  onSuccess,
  onBack,
  onError,
}: {
  clientSecret: string;
  amount: number;
  summary: Summary;
  onSuccess: (paymentIntentId: string) => void;
  onBack: () => void;
  onError: (msg: string) => void;
}) {
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            fontFamily: 'Inter, system-ui, sans-serif',
            colorPrimary: '#a8821f',
            borderRadius: '12px',
          },
        },
      }}
    >
      <PayForm amount={amount} summary={summary} onSuccess={onSuccess} onBack={onBack} onError={onError} />
    </Elements>
  );
}
