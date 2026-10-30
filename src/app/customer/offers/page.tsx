'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, CheckIcon } from '@/components/Icons';
import { BranchPageSkeleton } from '@/components/Loading';
import { useCustomerSession } from '@/components/CustomerAuth';
import { useLang } from '@/components/LanguageContext';
import { MembershipCodeButton } from '@/components/MembershipCodeButton';
import { withSalon } from '../salonQuery';

interface Week {
  index: number;
  label: string;
  start: string;
  end: string;
  state: 'used' | 'available' | 'expired' | 'upcoming';
}

interface MembershipStatus {
  id: string;
  status: 'active' | 'past_due' | 'canceled';
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  memberName: string;
  weeks: Week[];
  currentWeekAvailable: boolean;
  planKind?: 'standard' | 'custom' | 'yearly';
  planName?: string;
  planPrice?: number;
  planInterval?: 'month' | 'year';
  totalWeeks?: number;
  guestSlot?: { state: 'used' | 'available' | 'expired' | 'upcoming'; weekIndex: number; label: string; start: string; end: string } | null;
  guestWeeksUsed?: number;
  weeklyServices?: { serviceId: string; name: string; price: number }[] | null;
}

interface StatusResp {
  memberships: MembershipStatus[];
  /** Back-compat: newest membership. */
  membership: MembershipStatus | null;
  plan: { price: number; haircuts: number };
}

// Mirrors YEARLY_PRICE_USD in lib/membership.ts (server-only module —
// the price itself is enforced by the Stripe price at checkout).
const YEARLY_PRICE_USD = 1300;

function fmtDay(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Wallet-style card for one of the customer's plans (they can hold several). */
function MembershipWallet({
  m,
  getToken,
  busy,
  confirmCancel,
  setConfirmCancel,
  onCancel,
}: {
  m: MembershipStatus;
  getToken: () => string;
  busy: boolean;
  confirmCancel: string | null;
  setConfirmCancel: (id: string | null) => void;
  onCancel: (membershipId: string, action: 'cancel' | 'resume') => void;
}) {
  const { t } = useLang();
  const availableIdx = m.weeks.findIndex((w) => w.state === 'available');
  const weekService =
    m.planKind === 'custom' && m.weeklyServices && availableIdx >= 0
      ? m.weeklyServices[availableIdx]?.name
      : null;
  return (
    <div className="fade-in">
      {m.status === 'past_due' && (
        <p className="text-[13px] font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 mb-4 leading-relaxed">
          {t('offers.pastDue')}
        </p>
      )}
      <div className="relative overflow-hidden rounded-3xl p-6 border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
        style={{ background: 'linear-gradient(135deg, #1c1a15 0%, #0d0d0d 100%)' }}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">MRC Barbershops</p>
            <h2 className="font-extrabold text-[20px] mt-1 text-white">{m.planName ?? 'Monthly Plan'}</h2>
          </div>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${m.status === 'active' ? 'bg-green-600/10 text-green-700 border border-green-600/30' : 'bg-red-600/10 text-red-700 border border-red-600/30'}`}>
            {m.status === 'active' ? (m.cancelAtPeriodEnd ? t('offers.endsSoon') : t('offers.active')) : t('offers.pastDueShort')}
          </span>
        </div>
        <p className="text-[13px] text-neutral-300 mt-1">{m.memberName}{m.planPrice ? ` · $${m.planPrice}${m.planInterval === 'year' ? t('offers.perYr') : t('offers.perMo')}` : ''}</p>
        {m.planKind === 'custom' && m.weeklyServices && (
          <div className="grid grid-cols-2 gap-1.5 mt-3">
            {m.weeklyServices.map((w, i) => (
              <p key={i} className="text-[12px] text-neutral-200 bg-white/10 border border-gold/30 rounded-lg px-2.5 py-1.5">
                <span className="text-gold font-bold">W{i + 1}</span> · {w.name}
              </p>
            ))}
          </div>
        )}
        {m.weeks.length > 12 ? (
          // Yearly plan: 48 week dots don't fit a wallet card — show progress.
          <div className="mt-5 mb-1">
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gold rounded-full"
                style={{ width: `${Math.round((m.weeks.filter((w) => w.state === 'used').length / m.weeks.length) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-neutral-400 mt-2 font-semibold">
              {t('offers.weeksUsedOf')
                .replace('{used}', String(m.weeks.filter((w) => w.state === 'used').length))
                .replace('{total}', String(m.weeks.length))}
            </p>
          </div>
        ) : (
          <div className="flex justify-between mt-5 mb-1">
            {m.weeks.map((w) => <WeekDot key={w.index} week={w} />)}
          </div>
        )}
        <p className="text-[12px] text-neutral-400 mt-3 leading-relaxed">
          {m.currentWeekAvailable
            ? `✓ ${t('offers.thisWeekAvailable').replace('{service}', weekService ?? '1 haircut')}`
            : m.planKind === 'custom' ? t('offers.weekUsedGoneCustom') : t('offers.weekUsedGone')}
          {' · '}{t('offers.renews').replace('{date}', fmtDay(m.currentPeriodEnd))}
        </p>
        {m.planKind === 'yearly' && m.guestSlot && (
          <p className="text-[12px] text-neutral-300 mt-1.5 leading-relaxed">
            {m.guestSlot.state === 'available' ? `🎁 ${t('offers.guestSlotAvailable')}` : m.guestSlot.state === 'used' ? `🎁 ${t('offers.guestSlotUsed')}` : ''}
            {(m.guestWeeksUsed ?? 0) > 0 && (
              <span className="text-neutral-500"> · {t('offers.guestUsedOf').replace('{used}', String(m.guestWeeksUsed))}</span>
            )}
          </p>
        )}
        <p className="text-[12px] text-gold font-semibold mt-1.5">{m.planKind === 'yearly' ? t('offers.stayFreshYear') : t('offers.stayFresh')}</p>
      </div>

      {m.status === 'active' && m.currentWeekAvailable ? (
        <MembershipCodeButton getToken={getToken} membershipId={m.id} />
      ) : (
        <p className="text-center text-[13px] text-neutral-400 mt-3 leading-relaxed">
          {m.status === 'past_due'
            ? t('offers.fixPaymentForCode')
            : t('offers.codeUsedNextWeek')}
        </p>
      )}

      {m.cancelAtPeriodEnd ? (
        <button
          onClick={() => onCancel(m.id, 'resume')}
          disabled={busy}
          className="w-full mt-4 text-[13px] text-gold font-bold py-2 disabled:opacity-50"
        >
          {busy ? t('offers.working') : `↩ ${t('offers.resumePlan')}`}
        </button>
      ) : confirmCancel !== m.id ? (
        <button
          onClick={() => setConfirmCancel(m.id)}
          disabled={busy}
          className="w-full mt-4 text-[13px] text-neutral-400 font-medium py-2"
        >
          {t('offers.cancelMyPlan')}
        </button>
      ) : (
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 fade-in">
          <p className="text-[14px] font-bold">{t('offers.cancelThePlan')}</p>
          <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">
            {t('offers.cancelStaysActive').replace('{date}', fmtDay(m.currentPeriodEnd))}
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setConfirmCancel(null)}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#f4edda] border border-[#dccfae] text-neutral-700 disabled:opacity-50"
            >
              {t('offers.keepMyPlan')}
            </button>
            <button
              onClick={() => onCancel(m.id, 'cancel')}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-red-700 disabled:opacity-50"
            >
              {busy ? t('offers.cancelling') : t('offers.yesCancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mix & Match plan builder: pick a service for each of the 4 weeks.
 *  The monthly price is computed live from the chosen services' real prices. */
function MixMatchBuilder({ token, onError, hasDiscount }: { token: string; onError: (msg: string) => void; hasDiscount: boolean }) {
  const { t } = useLang();
  const [services, setServices] = useState<{ id: string; name: string; price: number }[]>([]);
  const [picks, setPicks] = useState<string[]>(['', '', '', '']);
  const [busy, setBusy] = useState(false);
  const disc = (p: number) => hasDiscount ? Math.round(p * 0.85 * 100) / 100 : p;

  useEffect(() => {
    fetch(withSalon('/api/services'))
      .then((r) => r.json())
      .then((d) => {
        const list = (d.services || []).filter((s: { active: boolean }) => s.active);
        setServices(list);
        if (list.length) setPicks([list[0].id, list[0].id, list[0].id, list[0].id]);
      })
      .catch(() => {});
  }, []);

  const { sum, price } = (() => {
    const sum = picks.reduce((s, id) => {
      const svc = services.find((x) => x.id === id);
      return s + (svc ? svc.price : 0);
    }, 0);
    return { sum, price: Math.max(1, Math.round(sum * 0.75)) };
  })();
  const showPrice = disc(price);

  async function subscribeCustom() {
    if (picks.some((p) => !p)) {
      onError(t('offers.pickEachWeek'));
      return;
    }
    setBusy(true);
    onError('');
    try {
      const r = await fetch('/api/memberships/subscribe-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ serviceIds: picks }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('offers.couldNotStartSub'));
      window.location.href = d.url;
    } catch (e) {
      onError(e instanceof Error ? e.message : t('offers.couldNotStartSub'));
      setBusy(false);
    }
  }

  return (
    <div className="fade-in mt-4">
      <div className="relative overflow-hidden rounded-3xl p-6 border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
        style={{ background: 'linear-gradient(135deg, #1c1a15 0%, #0d0d0d 100%)' }}>
        <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">{t('offers.mixMatchNew')}</p>
        <h2 className="font-extrabold text-[24px] mt-2 leading-tight text-white">{t('offers.mixMatchTitle')}</h2>
        <p className="text-gold font-semibold text-[15px] mt-1">{t('offers.mixMatchTagline')}</p>
        <p className="mt-2 text-[15px] text-neutral-300 leading-relaxed">
          <b className="text-gold text-[22px]">{t('offers.mixMatchServices4')}</b> for <b className="text-gold text-[22px]">${showPrice}</b>{t('offers.perMonth')}
          {hasDiscount && <span className="block text-[12px] font-bold text-green-400 mt-1">🎓 {t('offers.discountBadge')}</span>}
        </p>
        <p className="text-[13px] text-neutral-400 mt-1 leading-relaxed">
          {t('offers.mixMatchDesc2')}
        </p>
        <p className="mt-3 inline-block text-[13px] font-extrabold text-white bg-gold rounded-full px-3.5 py-1.5">
          {t('offers.mixMatchBadge')}
        </p>
      </div>

      <div className="card p-5 mt-4">
        <h3 className="font-extrabold text-[16px]">{t('offers.buildYourMonth')}</h3>
        <p className="text-[13px] text-neutral-500 mt-1">{t('offers.chooseEachWeek')}</p>
        <div className="grid gap-4 mt-4">
          {picks.map((pick, week) => (
            <div key={week}>
              <p className="text-[13px] font-bold text-neutral-700 mb-2">{t('offers.week').replace('{n}', String(week + 1))}</p>
              <div className="flex flex-wrap gap-2">
                {services.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPicks((p) => p.map((x, i) => (i === week ? s.id : x)))}
                    className={`rounded-xl px-3.5 py-2.5 text-[13px] font-bold border-2 transition-all ${
                      pick === s.id
                        ? 'border-gold bg-gold/15 text-[#1c1a15]'
                        : 'border-neutral-200 bg-white text-neutral-600'
                    }`}
                  >
                    {s.name} <span className="text-gold/80">${s.price}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-baseline justify-between mt-5 pt-4 border-t border-neutral-100">
          <span className="text-[14px] font-semibold text-neutral-500">{t('offers.yourMonthlyPrice')}</span>
          <span className="font-extrabold text-[28px] gold-text">
            {sum > 0 && <span className="line-through text-neutral-300 text-[17px] font-semibold mr-2">${sum}</span>}
            ${showPrice}<span className="text-[14px] text-neutral-400 font-semibold">{t('offers.perMo')}</span>
          </span>
        </div>
        <ol className="mt-4 grid gap-2.5 text-[14px] text-neutral-600 leading-relaxed list-none">
          <li><b className="text-gold">1.</b> {t('offers.mixStep1')}</li>
          <li><b className="text-gold">2.</b> {t('offers.mixStep2')}</li>
          <li><b className="text-gold">3.</b> {t('offers.mixStep3')}</li>
        </ol>
        <button
          onClick={subscribeCustom}
          disabled={busy || !services.length}
          className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
        >
          {busy ? t('offers.starting') : t('offers.subscribe').replace('${price}', String(showPrice))}
        </button>
        <p className="text-[12px] text-neutral-400 text-center mt-2.5 leading-relaxed">
          {t('offers.renewsMonthly')}
        </p>
      </div>
    </div>
  );
}

function WeekDot({ week }: { week: Week }) {  const base = 'w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-extrabold border-2 transition-all';
  if (week.state === 'used')
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className={`${base} bg-gold border-gold text-[#1c1a15]`}><CheckIcon size={18} /></div>
        <span className="text-[10px] text-white/60 font-semibold">{week.label}</span>
      </div>
    );
  if (week.state === 'available')
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className={`${base} border-gold text-gold animate-pulse`}>1</div>
        <span className="text-[10px] text-gold font-bold">{week.label}</span>
      </div>
    );
  if (week.state === 'expired')
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className={`${base} border-white/15 text-white/25`}>✕</div>
        <span className="text-[10px] text-white/35 font-semibold">{week.label}</span>
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`${base} border-white/15 text-white/40`}>&nbsp;</div>
      <span className="text-[10px] text-white/35 font-semibold">{week.label}</span>
    </div>
  );
}

function OffersInner() {
  const { checked, token } = useCustomerSession();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const [data, setData] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  // 15% student/military discount (approved by the owner).
  const [hasDiscount, setHasDiscount] = useState(false);
  const disc = (p: number) => hasDiscount ? Math.round(p * 0.85 * 100) / 100 : p;

  function load() {
    // Guests can read the offers freely; plan data is account-based, so
    // without a session there is simply nothing personal to load.
    if (!token) { setLoading(false); return; }
    fetch('/api/memberships/status', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setError(t('offers.couldNotLoad')))
      .finally(() => setLoading(false));
    fetch('/api/customer/discount', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.discount?.status === 'approved') setHasDiscount(true); })
      .catch(() => {});
  }

  useEffect(() => {
    if (!checked) return;
    // Returning from Stripe Checkout — reconcile the subscription.
    if (searchParams.get('checkout') === 'success' && token) {
      setNotice(t('offers.confirming'));
      fetch('/api/memberships/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) setNotice(t('offers.welcome'));
          else setNotice(d.error || t('offers.notFoundRefresh'));
        })
        .catch(() => setNotice(t('offers.couldNotConfirm')))
        .finally(() => {
          window.history.replaceState(null, '', '/customer/offers');
          load();
        });
    } else {
      if (searchParams.get('checkout') === 'cancelled') setNotice(t('offers.cancelledNoCharge'));
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, token]);

  async function subscribe() {
    // Subscribing is account-based: guests go to login first, then return.
    if (!token) { window.location.href = '/customer/login?next=/customer/offers'; return; }
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/memberships/subscribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('offers.couldNotStartSub'));
      window.location.href = d.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('offers.couldNotStartSub'));
      setBusy(false);
    }
  }

  async function subscribeYearly() {
    // Same account rule as the monthly plan: guests log in first.
    if (!token) { window.location.href = '/customer/login?next=/customer/offers'; return; }
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/memberships/subscribe-yearly', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('offers.couldNotStartSub'));
      window.location.href = d.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('offers.couldNotStartSub'));
      setBusy(false);
    }
  }

  async function cancelPlan(membershipId: string, action: 'cancel' | 'resume') {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/memberships/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ membershipId, action }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('offers.couldNotUpdatePlan'));
      setConfirmCancel(null);
      setNotice(
        action === 'cancel'
          ? t('offers.planEndsAfterPeriod')
          : t('offers.planActiveAgain')
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('offers.couldNotUpdatePlan'));
    }
    setBusy(false);
  }

  if (!checked || loading) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <BranchPageSkeleton />
      </main>
    );
  }

  const memberships = (data?.memberships ?? []).filter((x) => x.status === 'active' || x.status === 'past_due');
  const price = data?.plan.price ?? 120;
  const showPrice = disc(price);

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
      <Link href="/customer" className="back-link"><ArrowLeftIcon size={16} /> {t('offers.backToBranches')}</Link>
      <h1 className="page-title mt-3 mb-1"><span className="gold-text">{t('offers.title')}</span></h1>
      <p className="page-sub mb-6">{t('offers.sub')}</p>

      {notice && (
        <p className="text-[13px] font-semibold text-green-800 bg-green-600/10 border border-green-600/25 rounded-xl px-4 py-3 mb-4 leading-relaxed fade-in">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-[13px] font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 mb-4 leading-relaxed">
          {error}
        </p>
      )}

      {/* The customer's plans — one account can hold several (e.g. for family). */}
      {memberships.map((mm) => (
        <div key={mm.id} className="mb-6">
          <MembershipWallet
            m={mm}
            getToken={() => token ?? ''}
            busy={busy}
            confirmCancel={confirmCancel}
            setConfirmCancel={setConfirmCancel}
            onCancel={cancelPlan}
          />
        </div>
      ))}

      {memberships.length > 0 && (
        <div className="mb-4">
          <h2 className="font-extrabold text-[19px]"><span className="gold-text">{t('offers.addAnotherPlan')}</span></h2>
          <p className="page-sub mt-1">{t('offers.addAnotherDesc')}</p>
        </div>
      )}

      <div className="fade-in">
        <div className="relative overflow-hidden rounded-3xl p-6 border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
          style={{ background: 'linear-gradient(135deg, #1c1a15 0%, #0d0d0d 100%)' }}>
          <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">{t('offers.limitedOffer')}</p>
          <h2 className="font-extrabold text-[24px] mt-2 leading-tight text-white">{t('offers.monthlyPlan')}</h2>
          <p className="text-gold font-semibold text-[15px] mt-1">{t('offers.lookSharp')}</p>
          <p className="mt-2 text-[15px] text-neutral-300 leading-relaxed">
            <b className="text-gold text-[22px]">{t('offers.haircuts4')}</b> for <b className="text-gold text-[22px]">${showPrice}</b>{t('offers.perMonth')}
            <span className="text-neutral-500 line-through text-[15px]"> {t('offers.insteadOf')}</span>
            {hasDiscount && <span className="block text-[12px] font-bold text-green-400 mt-1">🎓 {t('offers.discountBadge')}</span>}
          </p>
          <div className="mt-4 grid gap-2 text-[13.5px] text-neutral-300">
            <p className="flex gap-2"><span className="text-gold">✓</span> {t('offers.checkOneHaircut')}</p>
            <p className="flex gap-2"><span className="text-gold">✓</span> {t('offers.checkChargedMonthly')}</p>
            <p className="flex gap-2"><span className="text-gold">✓</span> {t('offers.checkSkipWeek')}</p>
          </div>
        </div>

        <div className="card p-5 mt-4">
          <h3 className="font-extrabold text-[16px]">{t('offers.howItWorks')}</h3>
          <ol className="mt-3 grid gap-2.5 text-[14px] text-neutral-600 leading-relaxed list-none">
            <li><b className="text-gold">1.</b> {t('offers.step1').replace('${price}', String(showPrice))}</li>
            <li><b className="text-gold">2.</b> {t('offers.step2')}</li>
            <li><b className="text-gold">3.</b> {t('offers.step3')}</li>
            <li><b className="text-gold">4.</b> {t('offers.step4')}</li>
          </ol>
        </div>

        <button
          onClick={subscribe}
          disabled={busy}
          className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
        >
          {busy ? t('offers.starting') : t('offers.subscribe').replace('${price}', String(price))}
        </button>
        <p className="text-[12px] text-neutral-400 text-center mt-2.5 leading-relaxed">
          {t('offers.renewsMonthly')}
        </p>

        {/* Mix & Match plan — same weekly mechanics, customer picks the services. */}
        {token && <MixMatchBuilder token={token} onError={setError} hasDiscount={hasDiscount} />}

        {/* Yearly plan — same weekly membership, billed once a year, plus a
            free guest cut every week. */}
        <div className="relative overflow-hidden rounded-3xl p-6 border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)] mt-6"
          style={{ background: 'linear-gradient(135deg, #1c1a15 0%, #0d0d0d 100%)' }}>
          <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">{t('offers.mixMatchNew')}</p>
          <h2 className="font-extrabold text-[24px] mt-2 leading-tight text-white">{t('offers.yearlyPlan')}</h2>
          <p className="text-gold font-semibold text-[15px] mt-1">{t('offers.yearlyTagline')}</p>
          <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full border border-gold/60 bg-gold/10 text-gold text-[12px] font-extrabold tracking-[0.25em]">∞ {t('offers.unlimitedBadge')}</span>
          <p className="mt-2 text-[15px] text-neutral-300 leading-relaxed">
            <b className="text-gold text-[22px]">{t('offers.unlimitedHaircuts')}</b> for <b className="text-gold text-[22px]">${disc(YEARLY_PRICE_USD)}</b>{t('offers.perYear')}
            <span className="text-neutral-500 line-through text-[15px]"> {t('offers.yearlyInsteadOf')}</span>
            {hasDiscount && <span className="block text-[12px] font-bold text-green-400 mt-1">🎓 {t('offers.discountBadge')}</span>}
          </p>
          <div className="mt-4 grid gap-2 text-[13.5px] text-neutral-300">
            <p className="flex gap-2"><span className="text-gold">✓</span> {t('offers.checkOneHaircut')}</p>
            <p className="flex gap-2"><span className="text-gold">✓</span> {t('offers.guestPerk')}</p>
            <p className="flex gap-2"><span className="text-gold">✓</span> {t('offers.checkChargedYearly')}</p>
            <p className="flex gap-2"><span className="text-gold">✓</span> {t('offers.checkSkipWeek')}</p>
          </div>
        </div>

        <div className="card p-5 mt-4">
          <h3 className="font-extrabold text-[16px]">{t('offers.howItWorks')}</h3>
          <ol className="mt-3 grid gap-2.5 text-[14px] text-neutral-600 leading-relaxed list-none">
            <li><b className="text-gold">1.</b> {t('offers.yearlyStep1').replace('${price}', String(disc(YEARLY_PRICE_USD)))}</li>
            <li><b className="text-gold">2.</b> {t('offers.step2')}</li>
            <li><b className="text-gold">3.</b> {t('offers.step3')}</li>
            <li><b className="text-gold">4.</b> {t('offers.step4')}</li>
          </ol>
        </div>

        <button
          onClick={subscribeYearly}
          disabled={busy}
          className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
        >
          {busy ? t('offers.starting') : t('offers.subscribeYearly').replace('${price}', String(YEARLY_PRICE_USD))}
        </button>
        <p className="text-[12px] text-neutral-400 text-center mt-2.5 leading-relaxed">
          {t('offers.renewsYearly')}
        </p>
      </div>

      {/* Gift a haircut promo */}
      <Link href="/customer/gifts" className="card p-5 mt-4 block border-2 border-gold/60 fade-in">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-extrabold text-[17px]">🎁 {t('offers.giftTitle')}</p>
            <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">
              {t('offers.giftDesc')}
            </p>
          </div>
          <span className="gold-btn rounded-xl px-4 py-2.5 font-bold text-[14px] shrink-0">{t('offers.giftBtn')}</span>
        </div>
      </Link>
    </main>
  );
}

export default function OffersPage() {
  return (
    <Suspense
      fallback={
        <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
          <BranchPageSkeleton />
        </main>
      }
    >
      <OffersInner />
    </Suspense>
  );
}
