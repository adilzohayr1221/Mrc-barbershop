'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOutIcon, PlusIcon, TrashIcon, CalendarIcon, ScissorsIcon, StarIcon, PencilIcon } from '@/components/Icons';
import { OwnerTabSkeleton } from '@/components/Loading';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { TasksTab } from '@/components/TasksTab';
import { Leaderboard } from '@/components/Leaderboard';
import type { Barber, Service, Review, Branch, Booking, Salon } from '@/lib/types';

type Tab = 'appointments' | 'barbers' | 'leaderboard' | 'earnings' | 'services' | 'reviews' | 'branches' | 'tasks';

interface FullBooking extends Booking {
  barberName: string;
  serviceName: string;
  branchAddress: string;
  customerEmail?: string | null;
}

interface SalonReview extends Review {
  barberName: string;
}

interface EarningsTotals { today: number; week: number; month: number }

interface EarningsResp {
  ok: boolean;
  totals: EarningsTotals;
  perBarber: { id: string; name: string; earnings: EarningsTotals; haircuts: EarningsTotals & { all: number } }[];
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('mrc-salon-owner-token') || '';
  return { Authorization: `Bearer ${token}` };
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-gold">
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} size={13} className={i <= Math.round(rating) ? '' : 'opacity-25'} />
      ))}
    </span>
  );
}

export default function SalonDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('appointments');
  const [salon, setSalon] = useState<Salon | null>(null);
  const [bookings, setBookings] = useState<FullBooking[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [reviews, setReviews] = useState<SalonReview[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [earnings, setEarnings] = useState<EarningsResp | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const h = authHeaders();
    const j = (r: Response) => {
      if (r.status === 401) {
        localStorage.removeItem('mrc-salon-owner-token');
        router.replace('/salon');
        throw new Error('unauthorized');
      }
      return r.json();
    };
    try {
      const [m, b, br, s, rv, brn, er] = await Promise.all([
        fetch('/api/salon/me', { headers: h }).then(j),
        fetch('/api/salon/bookings', { headers: h }).then(j),
        fetch('/api/salon/barbers', { headers: h }).then(j),
        fetch('/api/salon/services', { headers: h }).then(j),
        fetch('/api/salon/reviews', { headers: h }).then(j),
        fetch('/api/salon/branches', { headers: h }).then(j),
        fetch('/api/salon/earnings', { headers: h }).then(j),
      ]);
      setSalon(m.salon || null);
      setBookings(b.bookings || []);
      setBarbers(br.barbers || []);
      setServices(s.services || []);
      setReviews(rv.reviews || []);
      setBranches(brn.branches || []);
      setEarnings(er.ok ? er : null);
    } catch (e) {
      if ((e as Error).message !== 'unauthorized') setError('Could not load data.');
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => {
    if (!localStorage.getItem('mrc-salon-owner-token')) {
      router.replace('/salon');
      return;
    }
    load();
  }, [load, router]);

  function logout() {
    localStorage.removeItem('mrc-salon-owner-token');
    router.replace('/salon');
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'appointments', label: '📅 Appointments' },
    { id: 'barbers', label: '💈 Barbers' },
    { id: 'leaderboard', label: '🏆 Leaderboard' },
    { id: 'earnings', label: '💰 Earnings' },
    { id: 'services', label: '✂️ Services' },
    { id: 'reviews', label: '⭐ Reviews' },
    { id: 'branches', label: '🏢 Branches' },
    { id: 'tasks', label: '✅ Tasks' },
  ];

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase text-gold/80">Salon owner</p>
          <h1 className="page-title mt-1 truncate"><span className="gold-text">{salon ? salon.name : 'My salon'}</span></h1>
        </div>
        <button onClick={logout} className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-gold transition-colors shrink-0">
          <LogOutIcon size={16} /> Log out
        </button>
      </div>

      <div className="flex gap-2 mt-5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 rounded-2xl text-sm font-bold whitespace-nowrap transition-all min-h-[44px] ${
              tab === t.id
                ? 'bg-[#1c1a15] text-white shadow-[0_4px_14px_rgba(0,0,0,0.18)]'
                : 'bg-[#f4edda] border border-[#dccfae] text-neutral-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 mt-4">{error}</p>}

      <div className="mt-5">
        {!loaded ? (
          <OwnerTabSkeleton />
        ) : (
          <>
            {tab === 'appointments' && <AppointmentsTab bookings={bookings} />}
            {tab === 'barbers' && <BarbersTab barbers={barbers} branches={branches} reload={load} />}
            {tab === 'leaderboard' && (
              <Leaderboard
                apiBase="/api/salon/leaderboard"
                getToken={() => localStorage.getItem('mrc-salon-owner-token') || ''}
              />
            )}
            {tab === 'earnings' && <EarningsTab data={earnings} />}
            {tab === 'services' && <ServicesTab services={services} reload={load} />}
            {tab === 'reviews' && <ReviewsTab reviews={reviews} />}
            {tab === 'branches' && <BranchesTab branches={branches} reload={load} />}
            {tab === 'tasks' && (
              <TasksTab
                getToken={() => localStorage.getItem('mrc-salon-owner-token') || ''}
                apiBase="/api/salon/tasks"
                barbers={barbers}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

/* ---------------- Appointments ---------------- */
function AppointmentsTab({ bookings }: { bookings: FullBooking[] }) {
  const upcoming = bookings.filter((b) => b.status === 'booked');
  if (!bookings.length)
    return (
      <div className="card p-10 text-center fade-in">
        <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold mb-4">
          <CalendarIcon size={26} />
        </div>
        <p className="font-bold text-[16px]">No appointments yet</p>
        <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
          New customer bookings will appear here as soon as they come in.
        </p>
      </div>
    );
  return (
    <div className="grid gap-2.5 fade-in">
      {upcoming.map((b) => (
        <div key={b.id} className="card p-4">
          <div className="flex justify-between items-center gap-2">
            <b className="text-[15px] truncate">{b.customerEmail || b.customerName || 'Customer'}</b>
            <span className="chip shrink-0">{b.date} · {b.time}</span>
          </div>
          <div className="text-sm text-neutral-600 mt-1.5">
            {b.serviceName} with {b.barberName}
          </div>
          <div className="text-xs text-neutral-600 mt-0.5">{b.branchAddress}</div>
        </div>
      ))}
      {upcoming.length === 0 && (
        <div className="card p-10 text-center">
          <p className="font-bold text-[16px]">No upcoming appointments</p>
          <p className="text-sm text-neutral-600 mt-1.5">Past appointments are listed below.</p>
        </div>
      )}
      {bookings
        .filter((b) => b.status !== 'booked')
        .map((b) => (
          <div key={b.id} className="card p-4 opacity-55">
            <div className="flex justify-between items-center gap-2">
              <b className="text-[15px] text-neutral-500 line-through truncate">{b.customerEmail || b.customerName || 'Customer'}</b>
              <span className="chip !text-neutral-500 shrink-0">{b.date} · {b.time}</span>
            </div>
            <div className="text-sm text-neutral-400 mt-1.5">
              {b.serviceName} with {b.barberName}
            </div>
            <div className="text-xs text-neutral-400 mt-0.5">{b.branchAddress}</div>
          </div>
        ))}
    </div>
  );
}

/* ---------------- Barbers ---------------- */
function BarbersTab({ barbers, branches, reload }: { barbers: Barber[]; branches: Branch[]; reload: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [skills, setSkills] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmBarber, setConfirmBarber] = useState<Barber | null>(null);
  const [actBusy, setActBusy] = useState(false);

  function toggleBranchId(id: string) {
    setBranchIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function addBarber() {
    setErr('');
    if (name.trim().length < 2) { setErr('Enter the barber’s name (at least 2 letters).'); return; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Enter a valid email address (or leave it empty).'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/salon/barbers', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
          branchIds,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not add the barber. Please try again.');
      setName(''); setEmail(''); setSkills(''); setBranchIds([]); setShowAdd(false);
      setNotice('Barber added.');
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the barber. Please try again.');
    }
    setBusy(false);
  }

  async function toggleActive() {
    if (!confirmBarber) return;
    setActBusy(true);
    try {
      const r = await fetch(`/api/salon/barbers/${confirmBarber.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !confirmBarber.active }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not update the barber. Please try again.');
      setConfirmBarber(null);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not update the barber. Please try again.');
    }
    setActBusy(false);
  }

  return (
    <div>
      {notice && (
        <p className="text-sm font-semibold text-green-800 bg-green-600/10 border border-green-600/25 rounded-xl px-4 py-2.5 mb-4">{notice}</p>
      )}
      {!showAdd ? (
        <button onClick={() => setShowAdd(true)} className="gold-btn rounded-2xl px-4 py-3 text-[15px] inline-flex items-center justify-center gap-2 w-full mb-4">
          <PlusIcon size={18} /> Add barber
        </button>
      ) : (
        <div className="card p-5 grid gap-4 mb-4">
          <div>
            <label className="label">Barber name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
          </div>
          <div>
            <label className="label">Email (optional)</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" type="email" autoComplete="email" />
          </div>
          <div>
            <label className="label">Skills (optional, comma-separated)</label>
            <input className="input" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Fade, Beard trim" />
          </div>
          <div>
            <label className="label">Branches</label>
            {branches.length === 0 ? (
              <p className="text-sm text-neutral-500">Add a branch first (🏢 Branches tab).</p>
            ) : (
              <div className="grid gap-2">
                {branches.map((br) => (
                  <label key={br.id} className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                    <input type="checkbox" checked={branchIds.includes(br.id)} onChange={() => toggleBranchId(br.id)} className="w-5 h-5 accent-[#b98a1d]" />
                    {br.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          {err && (
            <p className="text-sm font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-2.5">{err}</p>
          )}
          <div className="flex gap-3">
            <button onClick={addBarber} disabled={busy} className="gold-btn rounded-2xl px-4 py-3 text-[15px] flex-1">
              {busy ? 'Adding…' : 'Add barber'}
            </button>
            <button onClick={() => { setShowAdd(false); setErr(''); }} className="text-sm text-neutral-600 underline underline-offset-2 px-2">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid gap-2.5">
        {barbers.map((b) => (
          <div key={b.id} className="card p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <b className="text-[15px] truncate">{b.name}</b>
                <span className={`text-[10px] font-extrabold uppercase tracking-wide rounded-full px-2 py-0.5 ${b.active ? 'bg-green-600/10 text-green-700 border border-green-600/30' : 'bg-neutral-200 text-neutral-500 border border-neutral-300'}`}>
                  {b.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              {b.email && <div className="text-xs text-neutral-500 mt-0.5 truncate">{b.email}</div>}
              {b.skills && b.skills.length > 0 && (
                <div className="text-xs text-neutral-500 mt-0.5 truncate">{b.skills.join(', ')}</div>
              )}
            </div>
            <button
              onClick={() => setConfirmBarber(b)}
              className={`text-sm font-semibold underline underline-offset-2 shrink-0 ${b.active ? 'text-red-700/90' : 'text-gold'}`}
            >
              {b.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ))}
        {barbers.length === 0 && (
          <div className="card p-10 text-center fade-in">
            <p className="font-bold text-[16px]">No barbers yet</p>
            <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
              Add your barbers above — customers will be able to book with them.
            </p>
          </div>
        )}
      </div>

      {confirmBarber && (
        <ConfirmDialog
          title={confirmBarber.active ? 'Deactivate barber?' : 'Activate barber?'}
          message={confirmBarber.active
            ? `${confirmBarber.name} will no longer be bookable. Past history is kept.`
            : `${confirmBarber.name} will be bookable again.`}
          confirmLabel={confirmBarber.active ? 'Deactivate' : 'Activate'}
          busy={actBusy}
          onCancel={() => setConfirmBarber(null)}
          onConfirm={toggleActive}
        />
      )}
    </div>
  );
}

/* ---------------- Earnings ---------------- */
function EarningsTab({ data }: { data: EarningsResp | null }) {
  if (!data)
    return (
      <div className="card p-10 text-center fade-in">
        <p className="font-bold text-[16px]">Could not load earnings</p>
        <p className="text-sm text-neutral-600 mt-1.5">Pull to refresh and try again.</p>
      </div>
    );
  const cards: { label: string; value: number }[] = [
    { label: 'Today', value: data.totals.today },
    { label: 'This week', value: data.totals.week },
    { label: 'This month', value: data.totals.month },
  ];
  return (
    <div className="grid gap-2.5 fade-in">
      <div
        className="rounded-3xl p-5 relative overflow-hidden border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
        style={{ background: 'linear-gradient(135deg, #fdf8ea 0%, #f6ead0 100%)' }}
      >
        <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">Shop earnings</p>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          {cards.map((c) => (
            <div key={c.label}>
              <div className="text-[19px] font-extrabold text-gold-dark">${c.value.toFixed(2)}</div>
              <div className="text-[10px] text-neutral-500 uppercase tracking-[0.12em] mt-0.5 font-semibold">{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      {data.perBarber.map((b) => (
        <div key={b.id} className="card p-4">
          <b className="text-[15px]">{b.name}</b>
          <div className="grid grid-cols-3 gap-2 mt-2.5 text-center">
            <div className="rounded-xl bg-[#f7f2e2] border border-[#e6dabf] py-2">
              <b className="text-gold text-[16px] block">${b.earnings.today.toFixed(2)}</b>
              <span className="text-[10px] text-neutral-500 font-semibold">Today</span>
            </div>
            <div className="rounded-xl bg-[#f7f2e2] border border-[#e6dabf] py-2">
              <b className="text-gold text-[16px] block">${b.earnings.week.toFixed(2)}</b>
              <span className="text-[10px] text-neutral-500 font-semibold">Week</span>
            </div>
            <div className="rounded-xl bg-[#f7f2e2] border border-[#e6dabf] py-2">
              <b className="text-gold text-[16px] block">${b.earnings.month.toFixed(2)}</b>
              <span className="text-[10px] text-neutral-500 font-semibold">Month</span>
            </div>
          </div>
        </div>
      ))}
      {data.perBarber.length === 0 && (
        <div className="card p-10 text-center">
          <p className="font-bold text-[16px]">No earnings yet</p>
          <p className="text-sm text-neutral-600 mt-1.5">Completed haircuts will show up here.</p>
        </div>
      )}
    </div>
  );
}

/* ---------------- Services ---------------- */
function ServicesTab({ services, reload }: { services: Service[]; reload: () => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('30');
  const [err, setErr] = useState('');

  async function add() {
    setErr('');
    if (name.trim().length < 2) { setErr('Enter a service name (at least 2 letters).'); return; }
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) { setErr('Enter a valid price (more than $0).'); return; }
    const r = await fetch('/api/salon/services', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), price: p, durationMin: Number(duration) }),
    });
    if (r.ok) { setName(''); setPrice(''); setDuration('30'); reload(); }
    else {
      const d = await r.json().catch(() => ({}));
      setErr(d.error || 'Could not add the service. Please try again.');
    }
  }

  async function toggleActive(s: Service) {
    await fetch(`/api/salon/services/${s.id}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !s.active }),
    });
    reload();
  }

  async function remove(id: string) {
    if (!confirm('Delete this service?')) return;
    await fetch(`/api/salon/services/${id}`, { method: 'DELETE', headers: authHeaders() });
    reload();
  }

  return (
    <div>
      <div className="card p-5 grid gap-4 mb-4">
        <div>
          <label className="label">Service name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Haircut" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Price ($)</label>
            <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="30" />
          </div>
          <div>
            <label className="label">Minutes</label>
            <input className="input" value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" placeholder="30" />
          </div>
        </div>
        <button onClick={add} className="gold-btn rounded-2xl px-4 py-3 text-[15px] inline-flex items-center justify-center gap-2">
          <PlusIcon size={18} /> Add service
        </button>
        {err && (
          <p className="text-sm font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-2.5">{err}</p>
        )}
      </div>

      <div className="grid gap-2.5">
        {services.map((s) => (
          <div key={s.id} className="card p-4 flex items-center justify-between gap-3">
            <div className={s.active ? '' : 'opacity-50'}>
              <b className="text-[15px]">{s.name}</b>
              <div className="text-sm text-neutral-600 mt-0.5"><span className="text-gold font-semibold">${s.price}</span> · {s.durationMin} min</div>
            </div>
            <div className="flex gap-4 text-sm shrink-0">
              <button onClick={() => toggleActive(s)} className="text-gold underline underline-offset-2">{s.active ? 'Hide' : 'Show'}</button>
              <button onClick={() => remove(s.id)} className="inline-flex items-center gap-1 text-red-700/90 underline underline-offset-2"><TrashIcon size={14} /> Delete</button>
            </div>
          </div>
        ))}
        {services.length === 0 && (
          <div className="card p-10 text-center fade-in">
            <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold mb-4">
              <ScissorsIcon size={26} />
            </div>
            <p className="font-bold text-[16px]">No services yet</p>
            <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
              Add your services with prices above — customers will pick from them when booking.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Reviews (read-only) ---------------- */
function ReviewsTab({ reviews }: { reviews: SalonReview[] }) {
  if (!reviews.length)
    return (
      <div className="card p-10 text-center fade-in">
        <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold mb-4">
          <StarIcon size={26} />
        </div>
        <p className="font-bold text-[16px]">No reviews yet</p>
        <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
          Customer reviews will show up here once they start coming in.
        </p>
      </div>
    );
  return (
    <div className="grid gap-2.5 fade-in">
      {reviews.map((r) => (
        <div key={r.id} className="card p-4">
          <div className="flex justify-between items-center text-sm gap-2">
            <b className="truncate">{r.customerName || 'Customer'}</b>
            <Stars rating={r.rating} />
          </div>
          {r.barberName && <p className="text-xs text-neutral-500 mt-0.5">Barber: {r.barberName}</p>}
          {r.text ? (
            <p className="text-sm text-neutral-700 mt-1.5 leading-relaxed">{r.text}</p>
          ) : (
            <p className="text-xs text-neutral-400 mt-1.5 italic">Stars only</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Branches ---------------- */
function BranchesTab({ branches, reload }: { branches: Branch[]; reload: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  async function add() {
    setErr('');
    if (name.trim().length < 2) { setErr('Enter a branch name (at least 2 letters).'); return; }
    if (address.trim().length < 4) { setErr('Enter the branch address.'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/salon/branches', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), address: address.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not add the branch. Please try again.');
      setName(''); setAddress('');
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the branch. Please try again.');
    }
    setBusy(false);
  }

  async function saveEdit() {
    if (!editing) return;
    if (editName.trim().length < 2 || editAddress.trim().length < 4) return;
    setEditBusy(true);
    try {
      const r = await fetch(`/api/salon/branches/${editing.id}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), address: editAddress.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not update the branch. Please try again.');
      setEditing(null);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not update the branch. Please try again.');
    }
    setEditBusy(false);
  }

  async function remove(id: string) {
    if (!confirm('Delete this branch?')) return;
    await fetch(`/api/salon/branches/${id}`, { method: 'DELETE', headers: authHeaders() });
    reload();
  }

  return (
    <div>
      <div className="card p-5 grid gap-4 mb-4">
        <div>
          <label className="label">Branch name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Downtown branch" />
        </div>
        <div>
          <label className="label">Address</label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St" />
        </div>
        <button onClick={add} disabled={busy} className="gold-btn rounded-2xl px-4 py-3 text-[15px] inline-flex items-center justify-center gap-2">
          <PlusIcon size={18} /> {busy ? 'Adding…' : 'Add branch'}
        </button>
        {err && (
          <p className="text-sm font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-2.5">{err}</p>
        )}
      </div>

      <div className="grid gap-2.5">
        {branches.map((b) =>
          editing && editing.id === b.id ? (
            <div key={b.id} className="card p-5 grid gap-4">
              <div>
                <label className="label">Branch name</label>
                <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="label">Address</label>
                <input className="input" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
              </div>
              <div className="flex gap-3">
                <button onClick={saveEdit} disabled={editBusy} className="gold-btn rounded-xl px-4 py-2.5 text-sm flex-1">
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditing(null)} className="text-sm text-neutral-600 underline underline-offset-2 px-2">Cancel</button>
              </div>
            </div>
          ) : (
            <div key={b.id} className="card p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <b className="text-[15px]">{b.name}</b>
                <div className="text-sm text-neutral-600 mt-0.5 truncate">{b.address}</div>
              </div>
              <div className="flex gap-4 text-sm shrink-0">
                <button
                  onClick={() => { setEditing(b); setEditName(b.name); setEditAddress(b.address); }}
                  className="inline-flex items-center gap-1 text-gold underline underline-offset-2"
                >
                  <PencilIcon size={14} /> Edit
                </button>
                <button onClick={() => remove(b.id)} className="inline-flex items-center gap-1 text-red-700/90 underline underline-offset-2">
                  <TrashIcon size={14} /> Delete
                </button>
              </div>
            </div>
          )
        )}
        {branches.length === 0 && (
          <div className="card p-10 text-center fade-in">
            <p className="font-bold text-[16px]">No branches yet</p>
            <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
              Add your first branch above — barbers and customers pick from it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
