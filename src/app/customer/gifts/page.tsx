'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeftIcon } from '@/components/Icons';
import { BranchPageSkeleton } from '@/components/Loading';
import { useCustomerAuth, customerToken } from '@/components/CustomerAuth';
import PaymentStep from '@/components/PaymentStep';
import { withSalon } from '../salonQuery';

interface Service {
  id: string;
  name: string;
  price: number;
}

interface BoughtGift {
  id: string;
  serviceName: string;
  price: number;
  recipientName: string | null;
  shortCode: string;
  token: string;
  qr: string;
  expiresAt: string;
}

interface MyGift extends BoughtGift {
  status: 'active' | 'redeemed';
  createdAt: string;
  redeemedAt: string | null;
  buyerName: string;
  role: 'bought' | 'received';
  claimed: boolean;
}

const CLAIM_BASE = 'https://mrc-barbershop-mrc-0043.vercel.app/customer/gifts/claim';

function shareText(g: BoughtGift): string {
  return (
    `🎁 I've gifted you a haircut at MRC Barbershop!\n` +
    `Service: ${g.serviceName}\n` +
    `Tap to receive it: ${CLAIM_BASE}?code=${g.shortCode}\n` +
    `Or show this code at the shop: ${g.shortCode} — valid for 12 months.`
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function GiftCard({ g }: { g: BoughtGift }) {
  const [copied, setCopied] = useState(false);
  const text = shareText(g);
  const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as { share?: unknown }).share === 'function';

  async function share() {
    try {
      await (navigator as Navigator & { share: (d: { text: string }) => Promise<void> }).share({ text });
    } catch {
      /* user cancelled */
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="fade-in">
      <div
        className="relative overflow-hidden rounded-3xl p-6 border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
        style={{ background: 'linear-gradient(135deg, #fdf8ea 0%, #f6ead0 100%)' }}
      >
        <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">MRC Barbershop · Gift card</p>
        <h2 className="font-extrabold text-[22px] mt-2 text-[#141414]">🎁 {g.serviceName}</h2>
        <p className="text-neutral-600 text-[14px] mt-1">
          {g.recipientName ? `For ${g.recipientName}` : 'For your favorite person'} · ${g.price.toFixed(2)}
        </p>
        <div className="mt-5 flex justify-center">
          <div className="bg-white rounded-2xl p-3 border border-gold/30">
            <QRCodeSVG value={g.qr} size={176} />
          </div>
        </div>
        <p className="text-center mt-4 text-[12px] uppercase tracking-[0.2em] text-neutral-500">Gift code</p>
        <p className="text-center font-mono font-extrabold text-gold-dark text-[34px] tracking-[0.15em]">{g.shortCode}</p>
        <p className="text-center text-[12px] text-neutral-500 mt-2">Valid for 12 months · Single use</p>
      </div>

      <div className="grid gap-2 mt-4">
        {canShare && (
          <button onClick={share} className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-3.5">
            Send via WhatsApp / share
          </button>
        )}
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#25d366] text-white font-extrabold text-[16px] py-3.5"
        >
          Send on WhatsApp
        </a>
        <button
          onClick={copy}
          className="w-full rounded-2xl px-6 py-3 text-[15px] font-bold bg-[#f4edda] border border-[#dccfae] text-neutral-700"
        >
          {copied ? 'Copied ✓' : 'Copy gift message'}
        </button>
      </div>
    </div>
  );
}

function MyGiftRow({ g }: { g: MyGift }) {
  const [show, setShow] = useState(false);
  const active = g.status === 'active';
  const received = g.role === 'received';
  return (
    <div className="card p-4 fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-extrabold text-[15px]">🎁 {g.serviceName}</p>
          <p className="text-[13px] text-neutral-500 mt-0.5">
            {received
              ? `From ${g.buyerName} · `
              : g.recipientName
                ? `For ${g.recipientName} · `
                : ''}${g.price.toFixed(2)}
          </p>
          <p className="text-[12px] text-neutral-400 mt-0.5">
            {active ? `Valid until ${fmtDate(g.expiresAt)}` : `Redeemed ${fmtDate(g.redeemedAt)}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
              active
                ? 'bg-gold/15 text-[#8a6a12] border-gold/40'
                : 'bg-green-600/10 text-green-700 border-green-600/30'
            }`}
          >
            {active ? '🎁 Ready' : '✓ Redeemed'}
          </span>
          {!received && g.claimed && active && (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-blue-600/10 text-blue-700 border-blue-600/30">
              Claimed ✓
            </span>
          )}
        </div>
      </div>
      <p className="font-mono font-extrabold text-[18px] tracking-[0.2em] mt-3">{g.shortCode}</p>
      <button
        onClick={() => setShow((s) => !s)}
        className="mt-2 text-[13px] text-gold font-bold"
      >
        {show ? 'Hide code' : 'Show code'}
      </button>
      {show && (
        <div className="mt-3">
          <div className="flex justify-center">
            <div className="bg-white rounded-2xl p-3 border border-neutral-200">
              <QRCodeSVG value={g.qr} size={150} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareText(g))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl bg-[#25d366] text-white font-bold text-[14px] py-2.5"
            >
              WhatsApp
            </a>
            <button
              onClick={() => navigator.clipboard?.writeText(shareText(g)).catch(() => {})}
              className="rounded-xl px-4 py-2.5 text-[14px] font-bold bg-[#f4edda] border border-[#dccfae] text-neutral-700"
            >
              Copy message
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GiftsPage() {
  const { checked, name } = useCustomerAuth();
  const token = () => customerToken();
  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [serviceId, setServiceId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [payPrice, setPayPrice] = useState(0);
  const [payServiceName, setPayServiceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bought, setBought] = useState<BoughtGift | null>(null);
  const [mine, setMine] = useState<MyGift[]>([]);

  useEffect(() => {
    if (!checked) return;
    fetch(withSalon('/api/services'))
      .then((r) => r.json())
      .then((d) => {
        const list: Service[] = Array.isArray(d.services) ? d.services : [];
        setServices(list.filter((s) => s.price > 0));
        if (list.length) setServiceId(list[0].id);
      })
      .catch(() => setError('Could not load services.'))
      .finally(() => setLoadingServices(false));
    fetch('/api/gifts/mine', { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.gifts)) setMine(d.gifts);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  async function startPayment() {
    if (!serviceId) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/gifts/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ serviceId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not start the payment.');
      const svc = services.find((s) => s.id === serviceId);
      setPayPrice(d.amount);
      setPayServiceName(svc?.name || 'Haircut');
      setClientSecret(d.clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.');
    }
    setBusy(false);
  }

  async function finishPurchase(paymentIntentId: string) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/gifts/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          serviceId,
          paymentIntentId,
          recipientName: recipientName.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not create the gift.');
      setBought(d.gift);
      setMine((m) => [{ ...d.gift, status: 'active', createdAt: new Date().toISOString(), redeemedAt: null, buyerName: name, role: 'bought', claimed: false } as MyGift, ...m]);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the gift.');
    }
    setBusy(false);
  }

  if (!checked || loadingServices) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <BranchPageSkeleton />
      </main>
    );
  }

  const selected = services.find((s) => s.id === serviceId);

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
      <Link href="/customer/offers" className="back-link"><ArrowLeftIcon size={16} /> Offers</Link>
      <h1 className="page-title mt-3 mb-1"><span className="gold-text">Gift a haircut 🎁</span></h1>
      <p className="page-sub mb-6">Buy a haircut and send it to your son, friend, or brother.</p>

      {error && (
        <p className="text-[13px] font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 mb-4 leading-relaxed">
          {error}
        </p>
      )}

      {bought ? (
        <>
          <p className="text-[14px] font-bold text-green-700 bg-green-600/10 border border-green-600/25 rounded-xl px-4 py-3 mb-4 leading-relaxed fade-in">
            Payment complete — your gift is ready to send!
          </p>
          <GiftCard g={bought} />
          <button
            onClick={() => {
              setBought(null);
              setClientSecret('');
              setRecipientName('');
            }}
            className="w-full mt-4 text-[14px] text-gold font-bold py-2"
          >
            Buy another gift
          </button>
        </>
      ) : clientSecret ? (
        <PaymentStep
          clientSecret={clientSecret}
          amount={payPrice}
          summary={{ serviceName: `Gift — ${payServiceName}`, totalPrice: payPrice, amountLabel: 'Total due now' }}
          onSuccess={(piId) => void finishPurchase(piId)}
          onBack={() => setClientSecret('')}
          onError={setError}
        />
      ) : (
        <div className="card p-5 fade-in">
          <h2 className="font-extrabold text-[16px]">Pick a service</h2>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="input w-full mt-3 text-[16px]"
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — ${s.price.toFixed(2)}
              </option>
            ))}
          </select>
          <label className="block text-[14px] font-bold mt-4 mb-1.5">Who is this gift for? <span className="text-neutral-400 font-medium">(optional)</span></label>
          <input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="e.g. Adam"
            maxLength={60}
            className="input w-full text-[16px]"
          />
          <button
            onClick={startPayment}
            disabled={busy || !serviceId}
            className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-5 disabled:opacity-50"
          >
            {busy ? 'Starting…' : `Continue — ${selected ? `$${selected.price.toFixed(2)}` : ''}`}
          </button>
          <p className="text-[12px] text-neutral-400 text-center mt-2.5 leading-relaxed">
            The recipient scans your gift code at the shop — no appointment needed.
          </p>
        </div>
      )}

      {!bought && !clientSecret && (() => {
        const boughtGifts = mine.filter((g) => g.role === 'bought');
        const receivedGifts = mine.filter((g) => g.role === 'received');
        if (!boughtGifts.length && !receivedGifts.length) return null;
        return (
          <>
            {boughtGifts.length > 0 && (
              <div className="mt-8">
                <h2 className="font-extrabold text-[16px] mb-3">My gifts</h2>
                <div className="grid gap-3">
                  {boughtGifts.map((g) => <MyGiftRow key={g.id} g={g} />)}
                </div>
              </div>
            )}
            {receivedGifts.length > 0 && (
              <div className="mt-8">
                <h2 className="font-extrabold text-[16px] mb-3">Received gifts 🎁</h2>
                <div className="grid gap-3">
                  {receivedGifts.map((g) => <MyGiftRow key={g.id} g={g} />)}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </main>
  );
}
