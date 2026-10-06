'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, CheckIcon } from '@/components/Icons';
import { BranchPageSkeleton } from '@/components/Loading';
import { useCustomerAuth } from '@/components/CustomerAuth';
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
  planKind?: 'standard' | 'custom';
  planName?: string;
  planPrice?: number;
  weeklyServices?: { serviceId: string; name: string; price: number }[] | null;
}

interface StatusResp {
  memberships: MembershipStatus[];
  /** Back-compat: newest membership. */
  membership: MembershipStatus | null;
  plan: { price: number; haircuts: number };
}

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
  const availableIdx = m.weeks.findIndex((w) => w.state === 'available');
  const weekService =
    m.planKind === 'custom' && m.weeklyServices && availableIdx >= 0
      ? m.weeklyServices[availableIdx]?.name
      : null;
  return (
    <div className="fade-in">
      {m.status === 'past_due' && (
        <p className="text-[13px] font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 mb-4 leading-relaxed">
          Your last payment failed — please update your card on file, then your plan resumes.
        </p>
      )}
      <div className="relative overflow-hidden rounded-3xl p-6 border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
        style={{ background: 'linear-gradient(135deg, #1c1a15 0%, #0d0d0d 100%)' }}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">MRC Barbershop</p>
            <h2 className="font-extrabold text-[20px] mt-1 text-white">{m.planName ?? 'Monthly Plan'}</h2>
          </div>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${m.status === 'active' ? 'bg-green-600/10 text-green-700 border border-green-600/30' : 'bg-red-600/10 text-red-700 border border-red-600/30'}`}>
            {m.status === 'active' ? (m.cancelAtPeriodEnd ? 'Ends soon' : 'Active') : 'Past due'}
          </span>
        </div>
        <p className="text-[13px] text-neutral-300 mt-1">{m.memberName}{m.planPrice ? ` · $${m.planPrice}/mo` : ''}</p>
        {m.planKind === 'custom' && m.weeklyServices && (
          <div className="grid grid-cols-2 gap-1.5 mt-3">
            {m.weeklyServices.map((w, i) => (
              <p key={i} className="text-[12px] text-neutral-200 bg-white/10 border border-gold/30 rounded-lg px-2.5 py-1.5">
                <span className="text-gold font-bold">W{i + 1}</span> · {w.name}
              </p>
            ))}
          </div>
        )}
        <div className="flex justify-between mt-5 mb-1">
          {m.weeks.map((w) => <WeekDot key={w.index} week={w} />)}
        </div>
        <p className="text-[12px] text-neutral-400 mt-3 leading-relaxed">
          {m.currentWeekAvailable
            ? `✓ This week: ${weekService ?? '1 haircut'} available`
            : m.planKind === 'custom' ? "This week's service is used or gone." : "This week's haircut is used or gone."}
          {' · '}Renews {fmtDay(m.currentPeriodEnd)}
        </p>
        <p className="text-[12px] text-gold font-semibold mt-1.5">Stay fresh all month long.</p>
      </div>

      {m.status === 'active' && m.currentWeekAvailable ? (
        <MembershipCodeButton getToken={getToken} membershipId={m.id} />
      ) : (
        <p className="text-center text-[13px] text-neutral-400 mt-3 leading-relaxed">
          {m.status === 'past_due'
            ? 'Fix your payment to get this week\u2019s code.'
            : 'This week\u2019s code is used — the next one appears when its week starts.'}
        </p>
      )}

      {m.cancelAtPeriodEnd ? (
        <button
          onClick={() => onCancel(m.id, 'resume')}
          disabled={busy}
          className="w-full mt-4 text-[13px] text-gold font-bold py-2 disabled:opacity-50"
        >
          {busy ? 'Working…' : '↩ Resume this plan'}
        </button>
      ) : confirmCancel !== m.id ? (
        <button
          onClick={() => setConfirmCancel(m.id)}
          disabled={busy}
          className="w-full mt-4 text-[13px] text-neutral-400 font-medium py-2"
        >
          Cancel my plan
        </button>
      ) : (
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 fade-in">
          <p className="text-[14px] font-bold">Cancel the plan?</p>
          <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">
            It stays active until {fmtDay(m.currentPeriodEnd)} — your paid weeks still work.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setConfirmCancel(null)}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#f4edda] border border-[#dccfae] text-neutral-700 disabled:opacity-50"
            >
              Keep my plan
            </button>
            <button
              onClick={() => onCancel(m.id, 'cancel')}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Cancelling…' : 'Yes, cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mix & Match plan builder: pick a service for each of the 4 weeks.
 *  The monthly price is computed live from the chosen services' real prices. */
function MixMatchBuilder({ token, onError }: { token: string; onError: (msg: string) => void }) {
  const [services, setServices] = useState<{ id: string; name: string; price: number }[]>([]);
  const [picks, setPicks] = useState<string[]>(['', '', '', '']);
  const [busy, setBusy] = useState(false);

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

  async function subscribeCustom() {
    if (picks.some((p) => !p)) {
      onError('Pick a service for each week.');
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
      if (!r.ok) throw new Error(d.error || 'Could not start the subscription.');
      window.location.href = d.url;
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not start the subscription.');
      setBusy(false);
    }
  }

  return (
    <div className="fade-in mt-4">
      <div className="relative overflow-hidden rounded-3xl p-6 border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
        style={{ background: 'linear-gradient(135deg, #1c1a15 0%, #0d0d0d 100%)' }}>
        <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">New</p>
        <h2 className="font-extrabold text-[24px] mt-2 leading-tight text-white">Mix &amp; Match Weekly Plan</h2>
        <p className="text-gold font-semibold text-[15px] mt-1">You pick the service — every single week.</p>
        <p className="mt-2 text-[15px] text-neutral-300 leading-relaxed">
          <b className="text-gold text-[22px]">4 services</b> for <b className="text-gold text-[22px]">${price}</b>/month
        </p>
        <p className="text-[13px] text-neutral-400 mt-1 leading-relaxed">
          Haircut one week, shape up the next, beard after that — your call.
        </p>
        <p className="mt-3 inline-block text-[13px] font-extrabold text-white bg-gold rounded-full px-3.5 py-1.5">
          Pick any 4 in any order — save 25% every month
        </p>
      </div>

      <div className="card p-5 mt-4">
        <h3 className="font-extrabold text-[16px]">Build your month</h3>
        <p className="text-[13px] text-neutral-500 mt-1">Choose a service for each week. Your price updates live.</p>
        <div className="grid gap-4 mt-4">
          {picks.map((pick, week) => (
            <div key={week}>
              <p className="text-[13px] font-bold text-neutral-700 mb-2">Week {week + 1}</p>
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
          <span className="text-[14px] font-semibold text-neutral-500">Your monthly price</span>
          <span className="font-extrabold text-[28px] gold-text">
            {sum > 0 && <span className="line-through text-neutral-300 text-[17px] font-semibold mr-2">${sum}</span>}
            ${price}<span className="text-[14px] text-neutral-400 font-semibold">/mo</span>
          </span>
        </div>
        <ol className="mt-4 grid gap-2.5 text-[14px] text-neutral-600 leading-relaxed list-none">
          <li><b className="text-gold">1.</b> Pick your 4 services and subscribe — charged monthly.</li>
          <li><b className="text-gold">2.</b> Each week, show your membership code — your barber scans it.</li>
          <li><b className="text-gold">3.</b> One scan = that week&apos;s service. Skip a week and it&apos;s gone.</li>
        </ol>
        <button
          onClick={subscribeCustom}
          disabled={busy || !services.length}
          className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
        >
          {busy ? 'Starting…' : `Subscribe — $${price}/month`}
        </button>
        <p className="text-[12px] text-neutral-400 text-center mt-2.5 leading-relaxed">
          Renews automatically each month. Cancel anytime from here.
        </p>
      </div>
    </div>
  );
}

function WeekDot({ week }: { week: Week }) {
  const base = 'w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-extrabold border-2 transition-all';
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
  const { checked, token } = useCustomerAuth();
  const searchParams = useSearchParams();
  const [data, setData] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  function load() {
    if (!token) return;
    fetch('/api/memberships/status', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setError('Could not load the offer.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!checked) return;
    // Returning from Stripe Checkout — reconcile the subscription.
    if (searchParams.get('checkout') === 'success' && token) {
      setNotice('Confirming your subscription…');
      fetch('/api/memberships/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) setNotice('Welcome to your plan!');
          else setNotice(d.error || 'Subscription not found yet — pull to refresh.');
        })
        .catch(() => setNotice('Could not confirm — pull to refresh.'))
        .finally(() => {
          window.history.replaceState(null, '', '/customer/offers');
          load();
        });
    } else {
      if (searchParams.get('checkout') === 'cancelled') setNotice('Checkout was cancelled — no charge was made.');
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, token]);

  async function subscribe() {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/memberships/subscribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not start the subscription.');
      window.location.href = d.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the subscription.');
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
      if (!r.ok) throw new Error(d.error || 'Could not update the plan.');
      setConfirmCancel(null);
      setNotice(
        action === 'cancel'
          ? 'Plan will end after your paid period. Your remaining weeks still work.'
          : 'Your plan is active again!'
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the plan.');
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

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
      <Link href="/customer" className="back-link"><ArrowLeftIcon size={16} /> Branches</Link>
      <h1 className="page-title mt-3 mb-1"><span className="gold-text">Offers</span></h1>
      <p className="page-sub mb-6">Exclusive deals for MRC customers.</p>

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
          <h2 className="font-extrabold text-[19px]"><span className="gold-text">Add another plan</span></h2>
          <p className="page-sub mt-1">For your son, brother, or anyone — each plan gets its own weekly code.</p>
        </div>
      )}

      <div className="fade-in">
        <div className="relative overflow-hidden rounded-3xl p-6 border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
          style={{ background: 'linear-gradient(135deg, #1c1a15 0%, #0d0d0d 100%)' }}>
          <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">Limited offer</p>
          <h2 className="font-extrabold text-[24px] mt-2 leading-tight text-white">Monthly Haircut Plan</h2>
          <p className="text-gold font-semibold text-[15px] mt-1">Look sharp every week — for less.</p>
          <p className="mt-2 text-[15px] text-neutral-300 leading-relaxed">
            <b className="text-gold text-[22px]">4 haircuts</b> for <b className="text-gold text-[22px]">${price}</b>/month
            <span className="text-neutral-500 line-through text-[15px]"> instead of $160</span>
          </p>
          <div className="mt-4 grid gap-2 text-[13.5px] text-neutral-300">
            <p className="flex gap-2"><span className="text-gold">✓</span> One haircut every week — just show your code</p>
            <p className="flex gap-2"><span className="text-gold">✓</span> Charged monthly, cancel anytime</p>
            <p className="flex gap-2"><span className="text-gold">✓</span> A week you skip doesn&apos;t carry over</p>
          </div>
        </div>

        <div className="card p-5 mt-4">
          <h3 className="font-extrabold text-[16px]">How it works</h3>
          <ol className="mt-3 grid gap-2.5 text-[14px] text-neutral-600 leading-relaxed list-none">
            <li><b className="text-gold">1.</b> Subscribe — ${price} is charged monthly to your card.</li>
            <li><b className="text-gold">2.</b> Book any appointment with your plan — no deposit.</li>
            <li><b className="text-gold">3.</b> At the shop, tap <b>Show membership code</b> and your barber scans it.</li>
            <li><b className="text-gold">4.</b> One scan = one haircut. Skip a week and it&apos;s gone.</li>
          </ol>
        </div>

        <button
          onClick={subscribe}
          disabled={busy}
          className="gold-btn rounded-2xl w-full font-extrabold text-[16px] py-4 mt-4 disabled:opacity-50"
        >
          {busy ? 'Starting…' : `Subscribe — $${price}/month`}
        </button>
        <p className="text-[12px] text-neutral-400 text-center mt-2.5 leading-relaxed">
          Renews automatically each month. Cancel anytime from here.
        </p>

        {/* Mix & Match plan — same weekly mechanics, customer picks the services. */}
        {token && <MixMatchBuilder token={token} onError={setError} />}
      </div>

      {/* Gift a haircut promo */}
      <Link href="/customer/gifts" className="card p-5 mt-4 block border-2 border-gold/60 fade-in">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-extrabold text-[17px]">🎁 Gift a haircut</p>
            <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">
              Buy a haircut for your son, friend, or brother — send them the code on WhatsApp.
            </p>
          </div>
          <span className="gold-btn rounded-xl px-4 py-2.5 font-bold text-[14px] shrink-0">Gift →</span>
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
