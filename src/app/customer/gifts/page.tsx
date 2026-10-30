'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeftIcon } from '@/components/Icons';
import { BranchPageSkeleton } from '@/components/Loading';
import { useCustomerSession, customerToken } from '@/components/CustomerAuth';
import { useLang } from '@/components/LanguageContext';
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

function shareText(g: BoughtGift, t: (k: string) => string): string {
  return t('giftCard.shareText')
    .replace('{service}', g.serviceName)
    .replace('{link}', `${CLAIM_BASE}?code=${g.shortCode}`)
    .replace('{code}', g.shortCode);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function GiftCard({ g }: { g: BoughtGift }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const text = shareText(g, t);
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
        <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">{t('giftCard.title')}</p>
        <h2 className="font-extrabold text-[22px] mt-2 text-[#141414]">🎁 {g.serviceName}</h2>
        <p className="text-neutral-600 text-[14px] mt-1">
          {g.recipientName ? t('giftCard.for').replace('{name}', g.recipientName) : t('giftCard.forFavorite')} · ${g.price.toFixed(2)}
        </p>
        <div className="mt-5 flex justify-center">
          <div className="bg-white rounded-2xl p-3 border border-gold/30">
            <QRCodeSVG value={g.qr ?? g.shortCode} size={176} />
          </div>
        </div>
        <p className="text-center mt-4 text-[12px] uppercase tracking-[0.2em] text-neutral-500">{t('giftCard.giftCode')}</p>
        <p className="text-center font-mono font-extrabold text-gold-dark text-[34px] tracking-[0.15em]">{g.shortCode}</p>
        <p className="text-center text-[12px] text-neutral-500 mt-2">{t('giftCard.valid12')}</p>
      </div>

      <div className="grid gap-2 mt-4">
        {canShare && (
          <button onClick={share} className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-3.5">
            {t('giftCard.sendShare')}
          </button>
        )}
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#25d366] text-white font-extrabold text-[16px] py-3.5"
        >
          {t('giftCard.sendWhatsApp')}
        </a>
        <button
          onClick={copy}
          className="w-full rounded-2xl px-6 py-3 text-[15px] font-bold bg-[#f4edda] border border-[#dccfae] text-neutral-700"
        >
          {copied ? t('giftCard.copied') : t('giftCard.copyMessage')}
        </button>
      </div>
    </div>
  );
}

function MyGiftRow({ g }: { g: MyGift }) {
  const { t } = useLang();
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
              ? `${t('giftCard.from').replace('{name}', g.buyerName)} · `
              : g.recipientName
                ? `${t('giftCard.forPerson').replace('{name}', g.recipientName)} · `
                : ''}${g.price.toFixed(2)}
          </p>
          <p className="text-[12px] text-neutral-400 mt-0.5">
            {active ? t('giftCard.validUntil').replace('{date}', fmtDate(g.expiresAt)) : t('giftCard.redeemed').replace('{date}', fmtDate(g.redeemedAt))}
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
            {active ? t('giftCard.ready') : t('giftCard.redeemedBadge')}
          </span>
          {!received && g.claimed && active && (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-blue-600/10 text-blue-700 border-blue-600/30">
              {t('giftCard.claimed')}
            </span>
          )}
        </div>
      </div>
      <p className="font-mono font-extrabold text-[18px] tracking-[0.2em] mt-3">{g.shortCode}</p>
      <button
        onClick={() => setShow((s) => !s)}
        className="mt-2 text-[13px] text-gold font-bold"
      >
        {show ? t('giftCard.hideCode') : t('giftCard.showCode')}
      </button>
      {show && (
        <div className="mt-3">
          <div className="flex justify-center">
            <div className="bg-white rounded-2xl p-3 border border-neutral-200">
              <QRCodeSVG value={g.qr ?? g.shortCode} size={150} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareText(g, t))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl bg-[#25d366] text-white font-bold text-[14px] py-2.5"
            >
              {t('giftCard.whatsapp')}
            </a>
            <button
              onClick={() => navigator.clipboard?.writeText(shareText(g, t)).catch(() => {})}
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
  const { checked, name } = useCustomerSession();
  const { t } = useLang();
  const token = () => customerToken();
  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [serviceId, setServiceId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [payPrice, setPayPrice] = useState(0);
  const [cardFeeUpTo, setCardFeeUpTo] = useState(0);
  const [payServiceName, setPayServiceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bought, setBought] = useState<BoughtGift | null>(null);
  const [mine, setMine] = useState<MyGift[]>([]);
  // 15% student/military discount (approved by the owner).
  const [hasDiscount, setHasDiscount] = useState(false);
  const disc = (p: number) => hasDiscount ? Math.round(p * 0.85 * 100) / 100 : p;

  useEffect(() => {
    if (!checked) return;
    fetch(withSalon('/api/services'))
      .then((r) => r.json())
      .then((d) => {
        const list: Service[] = Array.isArray(d.services) ? d.services : [];
        setServices(list.filter((s) => s.price > 0));
        if (list.length) setServiceId(list[0].id);
      })
      .catch(() => setError(t('gifts.couldNotLoadServices')))
      .finally(() => setLoadingServices(false));
    fetch('/api/customer/discount', { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.discount?.status === 'approved') setHasDiscount(true); })
      .catch(() => {});
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
    // Buying a gift is account-based: guests browse freely, then log in to pay.
    if (!token()) { window.location.href = '/customer/login?next=/customer/gifts'; return; }
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/gifts/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ serviceId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('gifts.couldNotStartPayment'));
      const svc = services.find((s) => s.id === serviceId);
      setPayPrice(d.amount);
      setPayServiceName(svc?.name || 'Haircut');
      setCardFeeUpTo(d.cardFeeUpTo ?? 0);
      setClientSecret(d.clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('gifts.couldNotStartPayment'));
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
      if (!r.ok) throw new Error(d.error || t('gifts.couldNotCreateGift'));
      setBought(d.gift);
      setMine((m) => [{ ...d.gift, status: 'active', createdAt: new Date().toISOString(), redeemedAt: null, buyerName: name, role: 'bought', claimed: false } as MyGift, ...m]);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('gifts.couldNotCreateGift'));
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
      <Link href="/customer/offers" className="back-link"><ArrowLeftIcon size={16} /> {t('gifts.backToOffers')}</Link>
      <h1 className="page-title mt-3 mb-1"><span className="gold-text">{t('gifts.title')}</span></h1>
      <p className="page-sub mb-6">{t('gifts.sub')}</p>

      {error && (
        <p className="text-[13px] font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 mb-4 leading-relaxed">
          {error}
        </p>
      )}

      {bought ? (
        <>
          <p className="text-[14px] font-bold text-green-700 bg-green-600/10 border border-green-600/25 rounded-xl px-4 py-3 mb-4 leading-relaxed fade-in">
            {t('gifts.paymentComplete')}
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
            {t('gifts.buyAnother')}
          </button>
        </>
      ) : clientSecret ? (
        <PaymentStep
          clientSecret={clientSecret}
          amount={payPrice}
          manualCapture
          feeInfo={cardFeeUpTo > 0 ? { maxFee: cardFeeUpTo, mode: 'now' } : null}
          summary={{ serviceName: `Gift — ${payServiceName}`, totalPrice: payPrice, amountLabel: 'Total due now' }}
          onSuccess={(piId) => void finishPurchase(piId)}
          onBack={() => setClientSecret('')}
          onError={setError}
        />
      ) : (
        <div className="card p-5 fade-in">
          <h2 className="font-extrabold text-[16px]">{t('gifts.pickService')}</h2>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="input w-full mt-3 text-[16px]"
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — ${disc(s.price).toFixed(2)}{hasDiscount && disc(s.price) !== s.price ? ` ${t('gifts.was').replace('{price}', `$${s.price.toFixed(2)}`)}` : ''}
              </option>
            ))}
          </select>
          <label className="block text-[14px] font-bold mt-4 mb-1.5">{t('gifts.whoFor')} <span className="text-neutral-400 font-medium">{t('gifts.optional')}</span></label>
          <input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder={t('gifts.recipientPlaceholder')}
            maxLength={60}
            className="input w-full text-[16px]"
          />
          <button
            onClick={startPayment}
            disabled={busy || !serviceId}
            className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-5 disabled:opacity-50"
          >
            {busy ? t('gifts.starting') : t('gifts.continue').replace('{price}', selected ? `$${disc(selected.price).toFixed(2)}` : '')}
          </button>
          {hasDiscount && (
            <p className="text-[12px] font-bold text-green-800 text-center mt-2">🎓 {t('gifts.discountApplied')}</p>
          )}
          <p className="text-[12px] text-neutral-400 text-center mt-2.5 leading-relaxed">
            {t('gifts.scanAtShop')}
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
                <h2 className="font-extrabold text-[16px] mb-3">{t('gifts.myGifts')}</h2>
                <div className="grid gap-3">
                  {boughtGifts.map((g) => <MyGiftRow key={g.id} g={g} />)}
                </div>
              </div>
            )}
            {receivedGifts.length > 0 && (
              <div className="mt-8">
                <h2 className="font-extrabold text-[16px] mb-3">{t('gifts.receivedGifts')}</h2>
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
