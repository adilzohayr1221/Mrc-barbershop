'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeftIcon, CheckSealIcon, ScissorsIcon, CalendarIcon, ClockIcon, UserIcon, PhoneIcon, PoleIcon, StarIcon } from '@/components/Icons';
import { BookFormSkeleton } from '@/components/Loading';
import { useCustomerAuth, customerToken } from '@/components/CustomerAuth';
import BarberProfileModal from '@/components/BarberProfileModal';
import PaymentStep from '@/components/PaymentStep';
import { ChatModal } from '@/components/ChatModal';
import { withSalon } from '../../salonQuery';
import type { PublicBarber, Service, Review } from '@/lib/types';

const TIMES = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'];

interface Confirmation {
  id: string;
  date: string;
  time: string;
  barberName: string;
  serviceName: string;
  price: number;
  depositPaid?: number;
  membership?: boolean;
  branchAddress: string;
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function weekdayOf(iso: string) {
  return new Date(iso + 'T12:00:00').getDay();
}

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  const full = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5 text-gold">
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} size={size} className={i <= full ? '' : 'opacity-25'} />
      ))}
    </span>
  );
}

export default function BookPage() {
  const { barberId } = useParams<{ barberId: string }>();
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branchId') || '';
  const { checked, name: accountName } = useCustomerAuth();

  const [barber, setBarber] = useState<PublicBarber | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [planAvailable, setPlanAvailable] = useState(false);
  const [planOptions, setPlanOptions] = useState<{ id: string; planName: string; planPrice: number }[]>([]);
  const [planChoice, setPlanChoice] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  // Prepay step: 'details' -> create Stripe PaymentIntent -> 'pay' -> confirm.
  const [step, setStep] = useState<'details' | 'pay'>('details');
  const [clientSecret, setClientSecret] = useState('');
  const [payAmount, setPayAmount] = useState(0);

  // Profile modal state.
  const [profileOpen, setProfileOpen] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);

  const days = useMemo(() => {
    const out: { value: string; weekday: string; dayNum: string; topLabel: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const value = d.toISOString().slice(0, 10);
      const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = String(d.getDate());
      // On the 1st of a month show the month name instead of the weekday.
      const topLabel = d.getDate() === 1 ? d.toLocaleDateString('en-US', { month: 'short' }) : weekday;
      out.push({ value, weekday, dayNum, topLabel });
    }
    return out;
  }, []);

  // Times the barber actually works on the selected day. If he never set
  // hours, the default shop slots apply (legacy behavior).
  const availableTimes = useMemo(() => {
    if (!date) return TIMES;
    if (!barber?.workingHours) return TIMES;
    const hours = barber.workingHours[String(weekdayOf(date)) as '0' | '1' | '2' | '3' | '4' | '5' | '6'];
    if (!hours || !hours.length) return [];
    const slots = new Set<string>();
    for (const h of hours) {
      const hh = h.slice(0, 2);
      slots.add(`${hh}:00`);
      slots.add(`${hh}:30`);
    }
    return TIMES.filter((t) => slots.has(t));
  }, [date, barber]);

  const dayClosed = !!date && !!barber?.workingHours && availableTimes.length === 0;

  function isDayClosed(iso: string) {
    if (!barber?.workingHours) return false;
    const hours = barber.workingHours[String(weekdayOf(iso)) as '0' | '1' | '2' | '3' | '4' | '5' | '6'];
    return !hours || !hours.length;
  }

  // Slots already booked for the selected day — shown as unavailable so a
  // booked appointment can't be booked twice.
  const [bookedTimes, setBookedTimes] = useState<string[]>([]);
  useEffect(() => {
    setBookedTimes([]);
    if (!date || !barberId) return;
    fetch(`/api/barbers/${barberId}/slots?date=${date}`)
      .then((r) => r.json())
      .then((d) => setBookedTimes(Array.isArray(d.booked) ? d.booked : []))
      .catch(() => {});
  }, [date, barberId]);

  function loadBarber() {
    fetch(`/api/barbers?branchId=${branchId}`)
      .then((r) => r.json())
      .then((d) => {
        const b = (d.barbers || []).find((x: PublicBarber) => x.id === barberId);
        setBarber(b || null);
      })
      .catch(() => {});
  }

  function loadReviews() {
    setLoadingReviews(true);
    fetch(`/api/reviews?barberId=${barberId}`)
      .then((r) => r.json())
      .then((d) => setReviews(d.reviews || []))
      .catch(() => setReviews([]))
      .finally(() => setLoadingReviews(false));
  }

  function openProfile() {
    setProfileOpen(true);
    setReviews([]);
    loadReviews();
  }

  useEffect(() => {
    if (!checked) return;
    if (!name && accountName) setName(accountName);
    loadBarber();
    fetch('/api/memberships/status', { headers: { Authorization: `Bearer ${customerToken()}` } })
      .then((r) => r.json())
      .then((d) => {
        const list = (d.memberships ?? (d.membership ? [d.membership] : []))
          .filter((mm: { status: string; currentWeekAvailable: boolean }) => mm.status === 'active' && mm.currentWeekAvailable)
          .map((mm: { id: string; planName?: string; planPrice?: number }) => ({
            id: mm.id,
            planName: mm.planName ?? 'Monthly Plan',
            planPrice: mm.planPrice ?? 0,
          }));
        if (list.length) {
          setPlanAvailable(true);
          setPlanOptions(list);
          setPlanChoice(list[0].id);
        }
      })
      .catch(() => {});
    fetch(withSalon('/api/services'))
      .then((r) => r.json())
      .then((d) => {
        setServices(d.services || []);
        if (d.services?.length) setServiceId(d.services[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barberId, branchId, checked, accountName]);

  async function continueToPayment() {
    setError('');
    if (!serviceId || !date || !time || name.trim().length < 2 || phone.replace(/\D/g, '').length < 7) {
      setError('Please fill in service, day, time, name and phone.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/payments/intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken()}`,
        },
        body: JSON.stringify({ barberId, serviceId, branchId, date, time }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not start the payment');
      setClientSecret(d.clientSecret);
      setPayAmount(d.amount);
      setStep('pay');
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment');
    }
    setBusy(false);
  }

  async function bookWithMembership() {
    setError('');
    if (!serviceId || !date || !time || name.trim().length < 2 || phone.replace(/\D/g, '').length < 7) {
      setError('Please fill in service, day, time, name and phone.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken()}`,
        },
        body: JSON.stringify({ barberId, serviceId, branchId, date, time, customerName: name, customerPhone: phone, useMembership: true, membershipId: planChoice || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Booking failed');
      setDone(d.booking);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    }
    setBusy(false);
  }

  async function placeBooking(paymentIntentId: string) {
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken()}`,
        },
        body: JSON.stringify({ barberId, serviceId, branchId, date, time, customerName: name, customerPhone: phone, paymentIntentId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Booking failed');
      setDone(d.booking);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    }
    setBusy(false);
  }

  if (!checked) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <BookFormSkeleton />
      </main>
    );
  }

  if (done) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <div className="card p-8 mt-10 text-center relative overflow-hidden fade-in">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-gold to-transparent" />
          <CheckSealIcon size={64} className="mx-auto" />
          <h1 className="page-title mt-4"><span className="gold-text">Booking confirmed</span></h1>
          <p className="page-sub mt-1">We&apos;ll see you soon.</p>
          <div className="ornament w-40 mx-auto mt-5"><span className="ornament-diamond" /></div>
          <div className="mt-5 text-left grid gap-2.5 text-[15px] bg-[#f7f2e2] border border-[#e6dabf] rounded-2xl p-5">
            <p><span className="text-neutral-500 text-sm block">Barber</span><b>{done.barberName}</b></p>
            <p><span className="text-neutral-500 text-sm block">Service</span><b>{done.serviceName}</b> <span className="text-gold font-semibold">${done.price}</span></p>
            {done.membership ? (
              <p><span className="text-neutral-500 text-sm block">Payment</span><b className="text-gold">Covered by your monthly plan</b><span className="text-neutral-500 text-sm"> · show your membership code at the shop</span></p>
            ) : typeof done.depositPaid === 'number' && (
              <p><span className="text-neutral-500 text-sm block">Deposit paid now</span><b className="text-gold">${done.depositPaid.toFixed(2)}</b>
                {done.price - done.depositPaid > 0.005 && (
                  <span className="text-neutral-500 text-sm"> · ${(done.price - done.depositPaid).toFixed(2)} due at the shop</span>
                )}
              </p>
            )}
            <p><span className="text-neutral-500 text-sm block">When</span><b>{fmtDate(done.date)} at {done.time}</b></p>
            <p><span className="text-neutral-500 text-sm block">Where</span><b>{done.branchAddress}</b></p>
          </div>
          <div className="flex flex-col gap-3 justify-center mt-7">
            <Link href={`/customer/receipt/${done.id}`} className="gold-btn rounded-2xl px-8 py-3.5 inline-block text-[15px]">
              🧾 View receipt
            </Link>
            <Link href={`/customer/appointments?new=${done.id}`} className="gold-outline-btn rounded-2xl px-8 py-3.5 inline-block text-[15px]">
              View my appointments
            </Link>
            <button onClick={() => setChatOpen(true)} className="gold-outline-btn rounded-2xl px-8 py-3.5 text-[15px]">
              💬 Message {done.barberName}
            </button>
            <Link href="/customer" className="gold-outline-btn rounded-2xl px-8 py-3.5 inline-block text-[15px]">
              Book another
            </Link>
          </div>
        </div>
        {chatOpen && (
          <ChatModal
            bookingId={done.id}
            title={`Chat with ${done.barberName}`}
            subtitle={`${fmtDate(done.date)} at ${done.time}`}
            me="customer"
            getToken={() => customerToken() ?? ''}
            onClose={() => setChatOpen(false)}
          />
        )}
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
      <Link href={`/customer/branch/${branchId}`} className="back-link"><ArrowLeftIcon size={16} /> Barbers</Link>

      {/* Barber identity header — tap the photo for the full profile */}
      <div className="card p-4 mt-3 flex items-center gap-4 fade-in">
        <button
          onClick={openProfile}
          aria-label={`View ${barber?.name || 'barber'}'s profile`}
          className="shrink-0 rounded-full transition-transform active:scale-95"
        >
          {barber?.photoUrl ? (
            <Image
              src={barber.photoUrl}
              alt={barber.name}
              width={64}
              height={64}
              className="rounded-full object-cover w-16 h-16 border-2 border-gold/60 shadow-[0_0_16px_rgba(212,175,55,0.3)]"
            />
          ) : (
            <div className="rounded-full w-16 h-16 bg-[#ece2c9] border-2 border-gold/40 flex items-center justify-center text-gold">
              <PoleIcon size={26} />
            </div>
          )}
        </button>
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.14em] text-gold uppercase">Booking</p>
          <h1 className="text-[21px] font-extrabold tracking-tight text-[#17130a] truncate">
            Book with {barber ? barber.name : '…'}
          </h1>
          {barber && (
            <button onClick={openProfile} className="flex items-center gap-1.5 mt-1">
              <Stars rating={barber.avgRating ?? 0} />
              <span className="text-[13px] text-neutral-500 font-medium">
                {barber.avgRating !== null ? barber.avgRating.toFixed(1) : 'New'} · {barber.reviewCount} review{barber.reviewCount === 1 ? '' : 's'}
              </span>
            </button>
          )}
        </div>
      </div>
      <p className="page-sub mt-3 mb-5">Pick a service, day and time.</p>

      {loading ? (
        <BookFormSkeleton />
      ) : step === 'pay' && clientSecret ? (
        <div className="fade-in">
          {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 mb-4">{error}</p>}
          <PaymentStep
            clientSecret={clientSecret}
            amount={payAmount}
            summary={{
              serviceName: services.find((s) => s.id === serviceId)?.name || 'Service',
              barberName: barber?.name || 'Barber',
              dateLabel: fmtDate(date),
              time,
              totalPrice: services.find((s) => s.id === serviceId)?.price ?? payAmount,
            }}
            onSuccess={(paymentIntentId) => placeBooking(paymentIntentId)}
            onBack={() => { setStep('details'); setClientSecret(''); }}
            onError={(msg) => setError(msg)}
          />
        </div>
      ) : (
      <div className="grid gap-5 fade-in">
        <div className="card p-5 overflow-hidden">
          <label className="label"><span className="inline-flex items-center gap-1.5"><ScissorsIcon size={14} className="text-gold" /> Service</span></label>
          <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — ${s.price} ({s.durationMin} min)
              </option>
            ))}
          </select>
          {services.length === 0 && <p className="text-sm text-neutral-600 mt-2 leading-relaxed">No services listed yet — the shop owner can add services and prices from the owner panel.</p>}
        </div>

        <div className="card p-5 overflow-hidden">
          <label className="label"><span className="inline-flex items-center gap-1.5"><CalendarIcon size={14} className="text-gold" /> Day <span className="text-neutral-400 font-normal">— all 14 days</span></span></label>
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const closed = isDayClosed(d.value);
              const selected = date === d.value;
              return (
                <button
                  key={d.value}
                  onClick={() => { setDate(d.value); setTime(''); }}
                  className={`min-w-0 flex flex-col items-center justify-center py-2 rounded-xl border transition-all min-h-[56px] ${
                    selected
                      ? 'border-[#1c1a15] bg-[#1c1a15] text-white shadow-[0_4px_14px_rgba(0,0,0,0.18)]'
                      : closed
                        ? 'border-[#e0d5b8] bg-[#f1ead6] text-neutral-400'
                        : 'border-[#dccfae] bg-[#f4edda] text-neutral-700'
                  }`}
                >
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${selected ? 'text-gold' : closed ? 'line-through' : 'text-neutral-500'}`}>
                    {d.topLabel}
                  </span>
                  <span className={`text-[16px] font-extrabold leading-tight ${closed && !selected ? 'line-through' : ''}`}>
                    {d.dayNum}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[12px] text-neutral-500 mt-2.5"><span className="line-through">Crossed-out</span> days are days off.</p>
        </div>

        <div className="card p-5 overflow-hidden">
          <label className="label"><span className="inline-flex items-center gap-1.5"><ClockIcon size={14} className="text-gold" /> Time</span></label>
          {dayClosed ? (
            <p className="text-sm text-neutral-600 bg-[#f4edda] border border-[#e6dabf] rounded-xl px-4 py-3 leading-relaxed">
              {barber?.name} doesn&apos;t work on {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}s — please pick another day.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {availableTimes.map((t) => {
                const booked = bookedTimes.includes(t);
                return (
                  <button
                    key={t}
                    disabled={booked}
                    onClick={() => setTime(t)}
                    title={booked ? 'Already booked' : undefined}
                    className={`min-w-0 px-2 py-3 rounded-xl border text-[15px] font-semibold transition-all min-h-[48px] ${
                      booked
                        ? 'border-[#e0d5b8] bg-[#f1ead6] text-neutral-400 line-through cursor-not-allowed'
                        : time === t
                          ? 'border-[#1c1a15] bg-[#1c1a15] text-white shadow-[0_4px_14px_rgba(0,0,0,0.18)]'
                          : 'border-[#dccfae] bg-[#f4edda] text-neutral-700'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-5 grid grid-cols-1 gap-4 overflow-hidden">
          <div className="min-w-0">
            <label className="label"><span className="inline-flex items-center gap-1.5"><UserIcon size={14} className="text-gold" /> Your name</span></label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
          </div>
          <div className="min-w-0">
            <label className="label"><span className="inline-flex items-center gap-1.5"><PhoneIcon size={14} className="text-gold" /> Phone</span></label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(410) 555-0100" inputMode="tel" autoComplete="tel" />
          </div>
        </div>

        {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3">{error}</p>}

        {planAvailable ? (
          <>
            {planOptions.length > 1 && (
              <div className="grid gap-2">
                <p className="text-[13px] font-bold text-neutral-600">Which plan is this booking for?</p>
                <div className="flex flex-wrap gap-2">
                  {planOptions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanChoice(p.id)}
                      className={`rounded-xl px-3.5 py-2.5 text-[13px] font-bold border-2 transition-all ${
                        planChoice === p.id
                          ? 'border-gold bg-gold/15 text-[#1c1a15]'
                          : 'border-neutral-200 bg-white text-neutral-600'
                      }`}
                    >
                      {p.planName}{p.planPrice ? ` · $${p.planPrice}/mo` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button onClick={bookWithMembership} disabled={busy} className="gold-btn rounded-2xl px-6 py-4 text-[17px]">
              {busy ? 'Booking…' : 'Book with my plan — no payment'}
            </button>
            <button onClick={continueToPayment} disabled={busy} className="gold-outline-btn rounded-2xl px-6 py-3.5 text-[15px] -mt-2">
              Or pay a $5 deposit instead
            </button>
          </>
        ) : (
          <button onClick={continueToPayment} disabled={busy} className="gold-btn rounded-2xl px-6 py-4 text-[17px]">
            {busy ? 'Preparing…' : 'Continue to payment'}
          </button>
        )}
      </div>
      )}

      {profileOpen && barber && (
        <BarberProfileModal
          barber={barber}
          branchId={branchId}
          reviews={reviews}
          loadingReviews={loadingReviews}
          token={customerToken()}
          onClose={() => setProfileOpen(false)}
          onReviewSubmitted={() => {
            loadReviews();
            loadBarber();
          }}
        />
      )}
    </main>
  );
}
