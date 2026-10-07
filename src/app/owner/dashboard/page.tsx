'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { LogOutIcon, PlusIcon, PencilIcon, TrashIcon, CalendarIcon, PoleIcon, StarIcon, ScissorsIcon, UserIcon, LockIcon, CheckIcon } from '@/components/Icons';
import { OwnerTabSkeleton } from '@/components/Loading';
import { CancelBookingButton, CancelledLabel, NoShowLabel } from '@/components/CancelBookingButton';
import { NoShowButton } from '@/components/NoShowButton';
import { DeleteBookingButton } from '@/components/DeleteBookingButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { TeamChatModal } from '@/components/TeamChatModal';
import { TasksTab } from '@/components/TasksTab';
import BonusesTab from '@/components/BonusesTab';
import { Leaderboard } from '@/components/Leaderboard';
import type { Barber, Service, Review, Branch, Booking, WorkingHours, Salon } from '@/lib/types';

type Tab = 'bookings' | 'barbers' | 'leaderboard' | 'services' | 'reviews' | 'customers' | 'plans' | 'earnings' | 'photos' | 'complaints' | 'skills' | 'shop' | 'partners' | 'salons' | 'tasks' | 'bonuses';

// Compact read-only summary of a barber's self-set working hours, e.g.
// "Mon–Fri 9:00 AM–5:00 PM · Sat 10:00 AM–2:00 PM". Empty = never set.
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtHour(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}
function fmtHour12(h: number): string {
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
}

// Group consecutive hours: ['09:00','10:00','11:00','13:00'] -> "9 AM–12 PM, 1 PM"
function formatHourList(hours: string[]): string {
  const nums = [...new Set(hours.map((h) => Number(h.slice(0, 2))))].sort((a, b) => a - b);
  const groups: [number, number][] = [];
  for (const n of nums) {
    const last = groups[groups.length - 1];
    if (last && last[1] === n - 1) last[1] = n;
    else groups.push([n, n]);
  }
  return groups
    .map(([a, b]) => (a === b ? fmtHour12(a) : `${fmtHour12(a)}–${fmtHour12(b + 1)}`))
    .join(', ');
}

function formatHours(wh?: WorkingHours | null): string {
  if (!wh) return '';
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
  const parts: string[] = [];
  for (const d of order) {
    const hours = wh[String(d) as keyof WorkingHours];
    if (!hours || !hours.length) continue;
    parts.push(`${DAY_SHORT[d]} ${formatHourList(hours)}`);
  }
  return parts.length ? parts.join(' · ') : 'No working days set';
}

interface FullBooking extends Booking {
  barberName: string;
  serviceName: string;
  branchAddress: string;
  customerEmail?: string | null;
}
interface BarberAdmin extends Barber {
  photoUrl: string | null;
}

interface EarningsTotals { today: number; week: number; month: number }

interface EarningsResp {
  totals: EarningsTotals;
  perBarber: { id: string; name: string; earnings: EarningsTotals; haircuts: EarningsTotals & { all: number } }[];
}

interface PlanRow {
  id: string;
  customerName: string;
  customerEmail: string;
  status: 'active' | 'past_due' | 'canceled';
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  weeksUsed: number;
  createdAt: string;
  planName?: string;
  planPrice?: number;
}

interface CustomerRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('mrc_owner_token') || '';
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

export default function OwnerDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('bookings');
  const [bookings, setBookings] = useState<FullBooking[]>([]);
  const [barbers, setBarbers] = useState<BarberAdmin[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [earnings, setEarnings] = useState<EarningsResp | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [teamUnread, setTeamUnread] = useState(0);
  const [teamChatOpen, setTeamChatOpen] = useState(false);

  const loadTeamUnread = useCallback(() => {
    const token = localStorage.getItem('mrc_owner_token');
    if (!token) return;
    fetch('/api/team-chat/unread', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setTeamUnread(typeof d.unread === 'number' ? d.unread : 0))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const h = authHeaders();
    const j = (r: Response) => {
      if (r.status === 401) {
        localStorage.removeItem('mrc_owner_token');
        router.replace('/owner');
        throw new Error('unauthorized');
      }
      return r.json();
    };
    try {
      const [b, br, s, rv, brn, cu, pl, er] = await Promise.all([
        fetch('/api/owner/bookings', { headers: h }).then(j),
        fetch('/api/owner/barbers', { headers: h }).then(j),
        fetch('/api/owner/services', { headers: h }).then(j),
        fetch('/api/owner/reviews', { headers: h }).then(j),
        fetch('/api/branches').then((r) => r.json()),
        fetch('/api/owner/customers', { headers: h }).then(j),
        fetch('/api/owner/memberships', { headers: h }).then(j),
        fetch('/api/owner/earnings', { headers: h }).then(j),
      ]);
      setBookings(b.bookings || []);
      setBarbers(br.barbers || []);
      setServices(s.services || []);
      setReviews(rv.reviews || []);
      setBranches(brn.branches || []);
      setCustomers(cu.customers || []);
      setPlans(pl.memberships || []);
      setEarnings(er.ok ? er : null);
    } catch (e) {
      if ((e as Error).message !== 'unauthorized') setError('Could not load data.');
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => {
    if (!localStorage.getItem('mrc_owner_token')) {
      router.replace('/owner');
      return;
    }
    load();
    loadTeamUnread();
    const t = setInterval(loadTeamUnread, 30000);
    return () => clearInterval(t);
  }, [load, loadTeamUnread, router]);

  function logout() {
    localStorage.removeItem('mrc_owner_token');
    router.replace('/owner');
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'bookings', label: 'Bookings' },
    { id: 'barbers', label: 'Barbers' },
    { id: 'leaderboard', label: '🏆 Leaderboard' },
    { id: 'bonuses', label: '🎯 Bonuses' },
    { id: 'services', label: 'Services' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'photos', label: 'Photos' },
    { id: 'complaints', label: 'Complaints' },
    { id: 'skills', label: 'Skills' },
    { id: 'shop', label: 'Shop' },
    { id: 'partners', label: 'Partners' },
    { id: 'salons', label: '💈 Salons' },
    { id: 'tasks', label: '✅ Tasks' },
    { id: 'customers', label: 'Customers' },
    { id: 'plans', label: 'Plans' },
    { id: 'earnings', label: 'Earnings' },
  ];

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase text-gold/80">MRC Barbershop</p>
          <h1 className="page-title mt-1"><span className="gold-text">Shop management</span></h1>
        </div>
        <button onClick={logout} className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-gold transition-colors shrink-0">
          <LogOutIcon size={16} /> Log out
        </button>
      </div>

      <button
        onClick={() => setTeamChatOpen(true)}
        className="mt-4 w-full card p-4 flex items-center gap-3 text-left card-hover"
      >
        <span className="text-[18px] shrink-0">👁️</span>
        <span className="flex-1 min-w-0">
          <span className="block font-extrabold text-[14px] text-[#141414]">Team chat</span>
          <span className="block text-[11px] text-neutral-500">Read the barbers&apos; chat — invisible to them</span>
        </span>
        {teamUnread > 0 && (
          <span className="bg-red-600 text-white text-[10px] font-extrabold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">
            {teamUnread}
          </span>
        )}
        <span className="text-neutral-400 font-extrabold text-lg shrink-0">›</span>
      </button>

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
            {tab === 'bookings' && <BookingsTab bookings={bookings} setBookings={setBookings} />}
            {tab === 'barbers' && <BarbersTab barbers={barbers} branches={branches} reload={load} />}
            {tab === 'leaderboard' && (
              <Leaderboard
                apiBase="/api/owner/leaderboard"
                getToken={() => localStorage.getItem('mrc_owner_token') || ''}
              />
            )}
            {tab === 'bonuses' && (
              <BonusesTab getToken={() => localStorage.getItem('mrc_owner_token') || ''} />
            )}
            {tab === 'services' && <ServicesTab services={services} reload={load} />}
            {tab === 'reviews' && <ReviewsTab reviews={reviews} reload={load} />}
            {tab === 'photos' && <PhotosTab />}
            {tab === 'complaints' && <ComplaintsTab />}
            {tab === 'skills' && <SkillsTab />}
            {tab === 'shop' && <ShopTab />}
            {tab === 'partners' && <PartnersTab />}
            {tab === 'customers' && <CustomersTab customers={customers} bookings={bookings} reload={load} />}
            {tab === 'plans' && <PlansTab plans={plans} />}
            {tab === 'earnings' && <EarningsTab data={earnings} />}
            {tab === 'salons' && <SalonsTab />}
            {tab === 'tasks' && (
              <TasksTab
                getToken={() => localStorage.getItem('mrc_owner_token') || ''}
                apiBase="/api/owner/tasks"
                barbers={barbers}
                salonPicker
              />
            )}
          </>
        )}
      </div>

      {teamChatOpen && (
        <TeamChatModal
          getToken={() => localStorage.getItem('mrc_owner_token') || ''}
          readOnly
          subtitle="All barbers · read-only · invisible to them"
          onClose={() => {
            setTeamChatOpen(false);
            loadTeamUnread();
          }}
        />
      )}
    </main>
  );
}

/* ---------------- Bookings ---------------- */
function BookingsTab({ bookings, setBookings }: { bookings: FullBooking[]; setBookings: React.Dispatch<React.SetStateAction<FullBooking[]>> }) {
  // Optimistic local updates: the mutation responses are authoritative, so the
  // list updates instantly without waiting on a re-fetch (blob reads can lag
  // briefly behind overwrites).
  const markCancelledLocal = (id: string) =>
    setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status: 'cancelled' as const } : b)));
  const markNoShowLocal = (id: string) =>
    setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status: 'no_show' as const } : b)));
  const removeLocal = (id: string) => setBookings((bs) => bs.filter((b) => b.id !== id));
  function ownerToken() {
    return localStorage.getItem('mrc_owner_token') || '';
  }
  if (!bookings.length)
    return (
      <div className="card p-10 text-center fade-in">
        <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold mb-4">
          <CalendarIcon size={26} />
        </div>
        <p className="font-bold text-[16px]">No bookings yet</p>
        <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
          New customer bookings will appear here as soon as they come in.
        </p>
      </div>
    );
  return (
    <div className="grid gap-2.5">
      {bookings.map((b) => b.status !== 'booked' ? (
        <div key={b.id} className="card p-4 opacity-55">
          <div className="flex justify-between items-center gap-2">
            <b className="text-[15px] text-neutral-500 line-through">{b.customerName}</b>
            <span className="flex items-center gap-2 shrink-0">
              <span className="chip !text-neutral-500">{b.date} · {b.time}</span>
              {b.status === 'cancelled' ? <CancelledLabel /> : <NoShowLabel />}
            </span>
          </div>
          <div className="text-sm text-neutral-400 mt-1.5">
            {b.serviceName} with {b.barberName} · {b.customerPhone}
          </div>
          {b.customerEmail && <div className="text-xs text-neutral-400">{b.customerEmail}</div>}
          <div className="text-xs text-neutral-400 mt-0.5">{b.branchAddress}</div>
          {b.status === 'no_show' && (
            <div className="text-xs text-amber-700 font-medium mt-1">Deposit kept — not refunded.</div>
          )}
          <div className="mt-1">
            <DeleteBookingButton bookingId={b.id} getToken={ownerToken} onDeleted={() => removeLocal(b.id)} />
          </div>
        </div>
      ) : (
        <div key={b.id} className="card p-4">
          <div className="flex justify-between items-center gap-2">
            <b className="text-[15px]">{b.customerName}</b>
            <span className="chip shrink-0">{b.date} · {b.time}</span>
          </div>
          {b.customerEmail && <div className="text-xs text-neutral-500 mt-0.5">{b.customerEmail}</div>}
          <div className="text-sm text-neutral-600 mt-1.5">
            {b.serviceName} with {b.barberName} · {b.customerPhone}
          </div>
          <div className="text-xs text-neutral-600 mt-0.5">{b.branchAddress}</div>
          {b.completedAt && (
            <div className="mt-2.5 flex items-center gap-3 rounded-2xl bg-[#f7f2e2] border border-[#e6dabf] p-2.5">
              {b.completionPhotoPath ? (
                <a
                  href={`/api/photos/${encodeURIComponent(b.completionPhotoPath.split('/').pop() || '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0"
                >
                  <img
                    src={`/api/photos/${encodeURIComponent(b.completionPhotoPath.split('/').pop() || '')}`}
                    alt="Finished haircut"
                    className="w-14 h-14 rounded-xl object-cover border border-gold/40"
                  />
                </a>
              ) : null}
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-green-700">✓ Done</p>
                <p className="text-[11px] text-neutral-500">
                  {b.payoutAmount ? `Paid out $${b.payoutAmount.toFixed(2)}` : 'Completed'}
                  {b.completionPhotoPath ? ' · tap photo to view' : ''}
                </p>
              </div>
            </div>
          )}
          <div className="mt-1 flex items-center gap-5">
            <NoShowButton bookingId={b.id} getToken={ownerToken} onMarked={() => markNoShowLocal(b.id)} />
            <CancelBookingButton bookingId={b.id} getToken={ownerToken} onCancelled={() => markCancelledLocal(b.id)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Barbers ---------------- */
function BarbersTab({ barbers, branches, reload }: { barbers: BarberAdmin[]; branches: Branch[]; reload: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [skills, setSkills] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<BarberAdmin | null>(null);
  const [editName, setEditName] = useState('');
  const [editSkills, setEditSkills] = useState('');
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');
  const [reqBusy, setReqBusy] = useState<string | null>(null);
  const [resetBarberFor, setResetBarberFor] = useState<BarberAdmin | null>(null);
  // Salon assignment at approval: the barber no longer picks a salon at signup —
  // the platform owner picks it here. 'mrc' = my own shops.
  const [salonOptions, setSalonOptions] = useState<{ id: string; name: string }[]>([]);
  const [approveSalon, setApproveSalon] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/owner/salons', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.salons || [])
          .filter((e: { salon: { status: string } }) => e.salon.status === 'active')
          .map((e: { salon: { id: string; name: string } }) => ({ id: e.salon.id, name: e.salon.name }));
        setSalonOptions(list);
      })
      .catch(() => {});
  }, []);
  const [barberTempPw, setBarberTempPw] = useState<{ name: string; email: string; password: string } | null>(null);
  const [barberCopied, setBarberCopied] = useState(false);

  async function addBarber() {
    setErr('');
    if (name.trim().length < 2) { setErr('Enter the barber’s name (at least 2 letters).'); return; }
    if (!branchIds.length) { setErr('Pick at least one branch for this barber.'); return; }
    setBusy(true);
    const form = new FormData();
    form.set('name', name.trim());
    form.set('skills', JSON.stringify(skills.split(',').map((s) => s.trim()).filter(Boolean)));
    form.set('branchIds', JSON.stringify(branchIds));
    if (photo) form.set('photo', photo);
    const r = await fetch('/api/owner/barbers', { method: 'POST', headers: authHeaders(), body: form });
    setBusy(false);
    if (r.ok) {
      setShowAdd(false); setName(''); setSkills(''); setBranchIds([]); setPhoto(null);
      reload();
    } else {
      const d = await r.json().catch(() => ({}));
      setErr(d.error || 'Could not add the barber. Please try again.');
    }
  }

  async function removeBarber(id: string, barberName: string) {
    if (!confirm(`Remove ${barberName}? They will disappear from booking and login. Their email will be freed so they can register again. Past records are kept.`)) return;
    await fetch(`/api/owner/barbers/${id}`, { method: 'DELETE', headers: authHeaders() });
    reload();
  }

  async function approveBarber(id: string) {
    setReqBusy(id);
    const current = barbers.find((x) => x.id === id);
    const salonId = approveSalon[id] || current?.salonId || 'mrc';
    const r = await fetch(`/api/owner/barbers/${id}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, salonId }),
    });
    setReqBusy(null);
    if (r.ok) {
      setNotice('Barber approved — set their photo, skills and branches from the barber list.');
      setTimeout(() => setNotice(''), 5000);
      reload();
    }
  }

  async function declineBarber(id: string, barberName: string) {
    if (!confirm(`Decline ${barberName}'s request? Their signup will be deleted.`)) return;
    setReqBusy(id);
    await fetch(`/api/owner/barbers/${id}`, { method: 'DELETE', headers: authHeaders() });
    setReqBusy(null);
    reload();
  }

  const pending = barbers.filter((b) => b.active && b.approved === false);
  const listed = barbers.filter((b) => b.active && b.approved !== false);

  async function doBarberReset() {
    if (!resetBarberFor) return;
    setBusy(true);
    setNotice('');
    try {
      const r = await fetch(`/api/owner/barbers/${encodeURIComponent(resetBarberFor.id)}/reset`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || `reset failed (${r.status})`);
      setBarberTempPw({ name: d.name, email: d.email, password: d.tempPassword });
      setBarberCopied(false);
      setResetBarberFor(null);
      reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not reset. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copyBarberPw() {
    if (!barberTempPw) return;
    try {
      await navigator.clipboard.writeText(barberTempPw.password);
    } catch {
      /* clipboard unavailable — user can select the text manually */
    }
    setBarberCopied(true);
  }

  function startEdit(b: BarberAdmin) {
    setEditing(b);
    setEditName(b.name);
    setEditSkills(b.skills.join(', '));
    setEditBranchIds([...b.branchIds]);
    setEditPhoto(null);
    if (editPhotoUrl) URL.revokeObjectURL(editPhotoUrl);
    setEditPhotoUrl(null);
    setNotice('');
  }

  function cancelEdit() {
    if (editPhotoUrl) URL.revokeObjectURL(editPhotoUrl);
    setEditing(null);
    setEditName(''); setEditSkills(''); setEditBranchIds([]);
    setEditPhoto(null); setEditPhotoUrl(null);
  }

  function onEditPhoto(f: File | null) {
    if (editPhotoUrl) URL.revokeObjectURL(editPhotoUrl);
    setEditPhoto(f);
    setEditPhotoUrl(f ? URL.createObjectURL(f) : null);
  }

  async function saveEdit() {
    if (!editing || editBusy) return;
    setErr('');
    const n = editName.trim();
    if (n.length < 2) { setErr('Enter the barber’s name (at least 2 letters).'); return; }
    if (n.length > 60) { setErr('The name is too long (max 60 letters).'); return; }
    if (!editBranchIds.length) { setErr('Pick at least one branch for this barber.'); return; }
    setEditBusy(true);
    const form = new FormData();
    form.set('name', n);
    form.set('skills', JSON.stringify(editSkills.split(',').map((s) => s.trim()).filter(Boolean)));
    form.set('branchIds', JSON.stringify(editBranchIds));
    if (editPhoto) form.set('photo', editPhoto);
    const r = await fetch(`/api/owner/barbers/${editing.id}`, { method: 'PUT', headers: authHeaders(), body: form });
    setEditBusy(false);
    if (r.ok) {
      cancelEdit();
      reload();
      setNotice('Barber updated.');
      setTimeout(() => setNotice(''), 3000);
    } else {
      const d = await r.json().catch(() => ({}));
      setErr(d.error || 'Could not save. Please try again.');
    }
  }

  return (
    <div>
      <button onClick={() => setShowAdd(!showAdd)} className="gold-btn rounded-2xl px-5 py-3 mb-4 inline-flex items-center gap-2 text-[15px]">
        <PlusIcon size={18} /> {showAdd ? 'Cancel' : 'Add barber'}
      </button>

      {notice && (
        <p className="text-sm font-semibold text-green-800 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 mb-4">{notice}</p>
      )}
      {err && (
        <p className="text-sm font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-2.5 mb-4">{err}</p>
      )}

      {pending.length > 0 && (
        <div className="mb-4">
          <h3 className="font-bold text-[15px] mb-2">New barber requests ({pending.length})</h3>
          <div className="grid gap-2.5">
            {pending.map((b) => (
              <div key={b.id} className="card p-4 border-2 border-gold/60">
                <div className="flex items-center gap-3">
                  <div className="rounded-full w-[52px] h-[52px] bg-[#ece2c9] border border-gold/40 flex items-center justify-center text-gold shrink-0">
                    <PoleIcon size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <b className="text-[15px]">{b.name}</b>
                    <div className="text-xs text-neutral-500 truncate">{b.email}</div>
                    <div className="text-[11px] text-neutral-400 mt-0.5">
                      Requested {new Date(b.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <select
                    className="input !py-2.5 text-sm flex-1 min-w-0"
                    value={approveSalon[b.id] || b.salonId || 'mrc'}
                    onChange={(e) => setApproveSalon((m) => ({ ...m, [b.id]: e.target.value }))}
                    title="Assign to salon"
                  >
                    <option value="mrc">My shops (MRC)</option>
                    {salonOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => approveBarber(b.id)}
                    disabled={reqBusy === b.id}
                    className="gold-btn rounded-xl px-4 py-2.5 text-sm flex-1"
                  >
                    {reqBusy === b.id ? 'Working…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => declineBarber(b.id, b.name)}
                    disabled={reqBusy === b.id}
                    className="rounded-xl px-4 py-2.5 text-sm border border-red-300 text-red-700 font-semibold hover:bg-red-50 flex-1"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && (
        <div className="card p-5 grid gap-4 mb-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Barber name" />
          </div>
          <div>
            <label className="label">Skills (comma separated)</label>
            <input className="input" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Fades, Beard trim, Kids cuts" />
          </div>
          <div>
            <label className="label">Branches</label>
            <div className="flex flex-wrap gap-2">
              {branches.map((b, i) => (
                <button
                  key={b.id}
                  onClick={() => setBranchIds((p) => p.includes(b.id) ? p.filter((x) => x !== b.id) : [...p, b.id])}
                  className={`px-3.5 py-2 rounded-xl text-sm border font-medium transition-all min-h-[44px] ${
                    branchIds.includes(b.id)
                      ? 'border-[#1c1a15] bg-[#1c1a15] text-white font-bold'
                      : 'border-[#dccfae] bg-[#f4edda] text-neutral-700'
                  }`}
                >
                  {i + 1} · {b.address.split(',')[0]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Photo (optional)</label>
            <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} className="text-sm text-neutral-600 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border file:border-gold/50 file:bg-gold/10 file:text-gold file:font-semibold" />
          </div>
          <button onClick={addBarber} disabled={busy} className="gold-btn rounded-2xl px-4 py-3 text-[15px]">
            {busy ? 'Adding…' : 'Add barber'}
          </button>
        </div>
      )}

      <div className="grid gap-2.5">
        {listed.map((b) => (
          <div key={b.id} className="card p-4 min-w-0 overflow-hidden">
            <div className="flex items-center gap-3">
              {b.photoUrl ? (
                <Image src={b.photoUrl} alt={b.name} width={48} height={48} className="rounded-full object-cover w-12 h-12 border border-gold/50 shrink-0" />
              ) : (
                <div className="rounded-full w-12 h-12 bg-[#ece2c9] border border-gold/40 flex items-center justify-center text-gold shrink-0">
                  <PoleIcon size={22} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <b className="text-[15px]">{b.name}</b>
                {b.email && <div className="text-xs text-neutral-500 truncate">{b.email}</div>}
                <div className="text-xs text-neutral-500 mt-0.5 truncate">{b.skills.join(' · ')}</div>
                {formatHours(b.workingHours) && (
                  <div className="text-xs text-neutral-400 mt-0.5 truncate">🕒 {formatHours(b.workingHours)}</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <button onClick={() => startEdit(b)} className="inline-flex items-center gap-1 text-gold underline underline-offset-2 text-sm"><PencilIcon size={14} /> Edit</button>
                {b.email && (
                  <button onClick={() => { setNotice(''); setResetBarberFor(b); }} className="inline-flex items-center gap-1 text-gold text-sm font-medium">
                    <LockIcon size={14} /> Reset password
                  </button>
                )}
                <button onClick={() => removeBarber(b.id, b.name)} className="inline-flex items-center gap-1 text-red-700/90 text-sm hover:text-red-800 shrink-0">
                  <TrashIcon size={15} /> Remove
                </button>
              </div>
            </div>
            {editing?.id === b.id && (
              <div className="mt-4 pt-4 border-t border-[#e6dabf] grid gap-4">
                <div>
                  <label className="label">Name</label>
                  <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Barber name" />
                </div>
                <div>
                  <label className="label">Skills (comma separated)</label>
                  <input className="input" value={editSkills} onChange={(e) => setEditSkills(e.target.value)} placeholder="Fades, Beard trim, Kids cuts" />
                </div>
                <div>
                  <label className="label">Branches</label>
                  <div className="flex flex-wrap gap-2">
                    {branches.map((br, i) => (
                      <button
                        key={br.id}
                        onClick={() => setEditBranchIds((p) => p.includes(br.id) ? p.filter((x) => x !== br.id) : [...p, br.id])}
                        className={`px-3.5 py-2 rounded-xl text-sm border font-medium transition-all min-h-[44px] ${
                          editBranchIds.includes(br.id)
                            ? 'border-[#1c1a15] bg-[#1c1a15] text-white font-bold'
                            : 'border-[#dccfae] bg-[#f4edda] text-neutral-700'
                        }`}
                      >
                        {i + 1} · {br.address.split(',')[0]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">Photo</label>
                  <div className="flex items-center gap-3">
                    {(editPhotoUrl || b.photoUrl) ? (
                      <Image src={editPhotoUrl || b.photoUrl || ''} alt="Photo preview" width={56} height={56} className="rounded-full object-cover w-14 h-14 border border-gold/50 shrink-0" />
                    ) : (
                      <div className="rounded-full w-14 h-14 bg-[#ece2c9] border border-gold/40 flex items-center justify-center text-gold shrink-0">
                        <PoleIcon size={24} />
                      </div>
                    )}
                    <input type="file" accept="image/*" onChange={(e) => onEditPhoto(e.target.files?.[0] || null)} className="text-sm text-neutral-600 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border file:border-gold/50 file:bg-gold/10 file:text-gold file:font-semibold" />
                  </div>
                  <p className="text-xs text-neutral-500 mt-1.5">Leave empty to keep the current photo.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={editBusy} className="gold-btn rounded-2xl px-5 py-3 text-[15px] flex-1">
                    {editBusy ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={cancelEdit} className="text-sm text-neutral-600 underline underline-offset-2 px-3 shrink-0">Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {listed.length === 0 && (
          <div className="card p-10 text-center fade-in">
            <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold mb-4">
              <PoleIcon size={26} />
            </div>
            <p className="font-bold text-[16px]">No barbers yet</p>
            <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
              Add your first barber above — they&apos;ll appear on the customer booking page right away.
            </p>
          </div>
        )}
      </div>

      {resetBarberFor && (
        <ConfirmDialog
          title={`Reset password for ${resetBarberFor.name}?`}
          message="They will be logged out everywhere and will need the new temporary password to log back in. Share it with them directly."
          confirmLabel="Reset password"
          busyLabel="Resetting…"
          cancelLabel="Cancel"
          busy={busy}
          onCancel={() => !busy && setResetBarberFor(null)}
          onConfirm={doBarberReset}
        />
      )}

      {barberTempPw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45" role="alertdialog" aria-modal="true" aria-label="Temporary password">
          <div className="card w-full max-w-sm p-6 fade-in">
            <h3 className="font-extrabold text-[17px]">Temporary password</h3>
            <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
              For <b>{barberTempPw.name}</b> ({barberTempPw.email}). This is shown <b>once</b> — copy it now and share it with the barber.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <code className="flex-1 text-center font-mono font-bold text-lg tracking-[0.15em] bg-[#f4edda] border border-[#dccfae] rounded-2xl px-4 py-3.5 select-all">
                {barberTempPw.password}
              </code>
            </div>
            <button
              onClick={copyBarberPw}
              className="gold-btn rounded-2xl px-4 py-3 text-[15px] w-full mt-3 inline-flex items-center justify-center gap-2"
            >
              {barberCopied ? <><CheckIcon size={17} /> Copied!</> : 'Copy password'}
            </button>
            <button
              onClick={() => setBarberTempPw(null)}
              className="w-full text-center text-sm text-neutral-600 underline underline-offset-2 mt-3"
            >
              Close
            </button>
          </div>
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
    const r = await fetch('/api/owner/services', {
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
    await fetch(`/api/owner/services/${s.id}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !s.active }),
    });
    reload();
  }

  async function remove(id: string) {
    if (!confirm('Delete this service?')) return;
    await fetch(`/api/owner/services/${id}`, { method: 'DELETE', headers: authHeaders() });
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

/* ---------------- Work photos (owner approval) ---------------- */
function PhotosTab() {
  const [photos, setPhotos] = useState<{ id: string; barberId: string; barberName: string; url: string; createdAt: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    fetch('/api/owner/photos', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.photos) setPhotos(d.photos); })
      .catch(() => {});
  };
  useEffect(load, []);

  async function act(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && !confirm('Reject and delete this photo?')) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/owner/photos/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Could not update the photo. Please try again.');
        return;
      }
      setPhotos((p) => p.filter((x) => x.id !== id));
    } finally {
      setBusy(null);
    }
  }

  if (!photos.length) {
    return (
      <div className="card p-10 text-center fade-in">
        <p className="text-sm text-neutral-500">No photos waiting for approval.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 fade-in">
      {photos.map((p) => (
        <div key={p.id} className="card p-4">
          <img src={p.url} alt={`${p.barberName} work`} className="w-full rounded-xl object-cover max-h-72" />
          <div className="flex items-center justify-between mt-3">
            <div>
              <p className="font-bold text-[15px]">{p.barberName}</p>
              <p className="text-[12px] text-neutral-500">{new Date(p.createdAt).toLocaleDateString()}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => act(p.id, 'reject')}
                disabled={busy === p.id}
                className="rounded-xl px-4 py-2.5 text-[13px] font-extrabold bg-red-600/10 text-red-700 border border-red-600/30"
              >
                Reject
              </button>
              <button
                onClick={() => act(p.id, 'approve')}
                disabled={busy === p.id}
                className="gold-btn rounded-xl px-4 py-2.5 text-[13px] font-extrabold"
              >
                {busy === p.id ? '…' : '✓ Approve'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Customer complaints ---------------- */
function ComplaintsTab() {
  const [complaints, setComplaints] = useState<{
    id: string;
    customerName: string;
    barberName: string;
    serviceName: string | null;
    text: string;
    photoUrl: string;
    status: 'open' | 'granted' | 'dismissed';
    createdAt: string;
  }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    fetch('/api/owner/complaints', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.complaints) setComplaints(d.complaints); })
      .catch(() => {});
  };
  useEffect(load, []);

  async function act(id: string, action: 'grant' | 'dismiss') {
    const msg = action === 'grant'
      ? 'Grant this customer a FREE haircut of the same value? (No cash refund.)'
      : 'Dismiss this complaint? The customer will see it as reviewed.';
    if (!confirm(msg)) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/owner/complaints/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Could not resolve.'); return; }
      setComplaints((p) => p.map((x) => x.id === id
        ? { ...x, status: action === 'grant' ? 'granted' : 'dismissed' }
        : x));
    } finally {
      setBusy(null);
    }
  }

  const openCount = complaints.filter((c) => c.status === 'open').length;
  if (!complaints.length) {
    return (
      <div className="card p-10 text-center fade-in">
        <p className="text-sm text-neutral-500">No complaints.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 fade-in">
      {openCount > 0 && (
        <p className="text-[13px] font-bold text-gold">{openCount} waiting for your review</p>
      )}
      {complaints.map((c) => (
        <div key={c.id} className="card p-4">
          <img src={c.photoUrl} alt="Complaint evidence" className="w-full rounded-xl object-cover max-h-72" />
          <p className="text-[14px] text-neutral-700 leading-relaxed mt-3">“{c.text}”</p>
          <div className="flex items-center justify-between mt-2.5">
            <div>
              <p className="font-bold text-[14px]">{c.customerName}</p>
              <p className="text-[12px] text-neutral-500">
                {c.serviceName ?? 'Haircut'} — {c.barberName} · {new Date(c.createdAt).toLocaleDateString()}
              </p>
            </div>
            {c.status !== 'open' && (
              <span className={c.status === 'granted'
                ? 'chip !border-green-600/40 !text-green-700 shrink-0'
                : 'chip !border-neutral-300 !text-neutral-500 shrink-0'}>
                {c.status === 'granted' ? 'Free haircut granted' : 'Dismissed'}
              </span>
            )}
          </div>
          {c.status === 'open' && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => act(c.id, 'dismiss')}
                disabled={busy === c.id}
                className="flex-1 rounded-xl px-4 py-3 text-[13px] font-extrabold bg-neutral-100 text-neutral-600 border border-neutral-300"
              >
                Dismiss
              </button>
              <button
                onClick={() => act(c.id, 'grant')}
                disabled={busy === c.id}
                className="flex-1 gold-btn rounded-xl px-4 py-3 text-[13px] font-extrabold"
              >
                {busy === c.id ? '…' : '✂️ Grant free haircut'}
              </button>
            </div>
          )}
          {c.status === 'open' && (
            <p className="text-[11px] text-neutral-500 mt-2 text-center">
              Granting gives the customer a free haircut of the same value — no cash refund.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Skill verifications ---------------- */
function SkillsTab() {
  const [vers, setVers] = useState<{
    id: string;
    barberId: string;
    barberName: string;
    skill: string;
    photos: string[];
    status: 'draft' | 'pending' | 'approved' | 'rejected';
    submittedAt: string | null;
  }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    fetch('/api/owner/skills', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.verifications) setVers(d.verifications); })
      .catch(() => {});
  };
  useEffect(load, []);

  async function act(id: string, skill: string, action: 'approve' | 'reject') {
    const msg = action === 'approve'
      ? `Verify "${skill}" for this barber? It will show with a ✓ badge to customers.`
      : `Reject "${skill}"? The barber can send better photos and try again.`;
    if (!confirm(msg)) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/owner/skills/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Could not review.'); return; }
      setVers((p) => p.map((x) => x.id === id
        ? { ...x, status: action === 'approve' ? 'approved' : 'rejected' }
        : x));
    } finally {
      setBusy(null);
    }
  }

  const pending = vers.filter((v) => v.status === 'pending');
  const history = vers.filter((v) => v.status !== 'pending');

  return (
    <div className="grid gap-3 fade-in">
      {pending.length === 0 && history.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-sm text-neutral-500">No skill verifications yet.</p>
        </div>
      )}
      {pending.length > 0 && (
        <p className="text-[13px] font-bold text-gold">{pending.length} skill{pending.length > 1 ? 's' : ''} waiting for your review</p>
      )}
      {pending.map((v) => (
        <div key={v.id} className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <b className="text-[15px]">{v.barberName}</b>
              <p className="text-[13px] text-gold font-bold">🎯 {v.skill}</p>
            </div>
            <span className="text-[11px] text-neutral-500 shrink-0">
              {v.submittedAt ? new Date(v.submittedAt).toLocaleDateString() : ''}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {v.photos.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={v.skill} className="w-full aspect-square object-cover rounded-xl border border-gold/30" />
              </a>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => act(v.id, v.skill, 'reject')}
              disabled={busy === v.id}
              className="flex-1 rounded-xl px-4 py-3 text-[13px] font-extrabold bg-neutral-100 text-neutral-600 border border-neutral-300"
            >
              ✗ Reject
            </button>
            <button
              onClick={() => act(v.id, v.skill, 'approve')}
              disabled={busy === v.id}
              className="flex-1 gold-btn rounded-xl px-4 py-3 text-[13px] font-extrabold"
            >
              {busy === v.id ? '…' : '✓ Verify skill'}
            </button>
          </div>
        </div>
      ))}
      {history.length > 0 && (
        <div className="card p-4">
          <b className="text-[14px]">Reviewed</b>
          <div className="grid gap-1.5 mt-2.5">
            {history.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate">{v.barberName} — <b>{v.skill}</b></span>
                <span className={v.status === 'approved'
                  ? 'chip !border-green-600/40 !text-green-700 shrink-0'
                  : 'chip !border-neutral-300 !text-neutral-500 shrink-0'}>
                  {v.status === 'approved' ? '✓ Verified' : v.status === 'rejected' ? '✗ Rejected' : v.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Reviews ---------------- */
function ReviewsTab({ reviews, reload }: { reviews: Review[]; reload: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [rating, setRating] = useState(5);

  async function save(id: string) {
    await fetch(`/api/owner/reviews/${id}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, rating }),
    });
    setEditing(null);
    reload();
  }

  async function remove(id: string) {
    if (!confirm('Delete this review?')) return;
    await fetch(`/api/owner/reviews/${id}`, { method: 'DELETE', headers: authHeaders() });
    reload();
  }

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
    <div className="grid gap-2.5">
      {reviews.map((r) => (
        <div key={r.id} className="card p-4">
          <div className="flex justify-between items-center text-sm">
            <b>{r.customerName}</b>
            <Stars rating={r.rating} />
          </div>
          {editing === r.id ? (
            <div className="grid gap-3 mt-3">
              <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex gap-2 items-center">
                <select className="input !w-28" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                  {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
                </select>
                <button onClick={() => save(r.id)} className="gold-btn rounded-xl px-4 py-2.5 text-sm">Save</button>
                <button onClick={() => setEditing(null)} className="text-sm text-neutral-600 underline">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-neutral-700 mt-1.5 leading-relaxed">{r.text}</p>
              <div className="flex gap-4 text-sm mt-2">
                <button onClick={() => { setEditing(r.id); setText(r.text); setRating(r.rating); }} className="inline-flex items-center gap-1 text-gold underline underline-offset-2"><PencilIcon size={14} /> Edit</button>
                <button onClick={() => remove(r.id)} className="inline-flex items-center gap-1 text-red-700/90 underline underline-offset-2"><TrashIcon size={14} /> Delete</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Customers ---------------- */
function CustomersTab({ customers, bookings, reload }: { customers: CustomerRow[]; bookings: FullBooking[]; reload: () => void }) {
  const [confirmFor, setConfirmFor] = useState<CustomerRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<CustomerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tempPw, setTempPw] = useState<{ name: string; email: string; password: string; kind: 'customer' | 'barber' } | null>(null);
  const [copied, setCopied] = useState(false);

  // How many times each customer booked (active bookings only).
  const bookingCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bookings) {
      if (b.customerId && b.status !== 'cancelled') m.set(b.customerId, (m.get(b.customerId) || 0) + 1);
    }
    return m;
  }, [bookings]);

  function fmtDate(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function doReset() {
    if (!confirmFor) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/owner/customers/${encodeURIComponent(confirmFor.id)}/reset`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || `reset failed (${r.status})`);
      setTempPw({ name: d.name, email: d.email, password: d.tempPassword, kind: 'customer' });
      setCopied(false);
      setConfirmFor(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!deleteFor) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/owner/customers/${encodeURIComponent(deleteFor.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || `delete failed (${r.status})`);
      setDeleteFor(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copyPw() {
    if (!tempPw) return;
    try {
      await navigator.clipboard.writeText(tempPw.password);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = tempPw.password;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
  }

  if (!customers.length)
    return (
      <div className="card p-10 text-center fade-in">
        <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold mb-4">
          <UserIcon size={26} />
        </div>
        <p className="font-bold text-[16px]">No customers yet</p>
        <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
          Customer accounts will appear here once people start signing up.
        </p>
      </div>
    );

  return (
    <div className="grid gap-2.5">
      {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3">{error}</p>}
      {customers.map((c) => {
        const n = bookingCount.get(c.id) || 0;
        return (
          <div key={c.id} className="card p-4 flex items-center gap-3">
            <div className="rounded-full w-11 h-11 bg-[#ece2c9] border border-gold/40 flex items-center justify-center text-gold shrink-0">
              <UserIcon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <b className="text-[15px] block truncate">{c.name}</b>
              <div className="text-sm text-neutral-600 truncate">{c.email}</div>
              <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1">
                <CalendarIcon size={12} className="text-gold" />
                <span className="font-semibold text-neutral-700">{n} {n === 1 ? 'booking' : 'bookings'}</span>
                {c.createdAt && <span>· Joined {fmtDate(c.createdAt)}</span>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <button
                onClick={() => { setError(''); setConfirmFor(c); }}
                className="inline-flex items-center gap-1.5 text-gold text-sm font-semibold shrink-0 min-h-[44px] px-2"
              >
                <LockIcon size={15} /> Reset password
              </button>
              <button
                onClick={() => { setError(''); setDeleteFor(c); }}
                className="inline-flex items-center gap-1.5 text-red-700/90 text-sm font-semibold shrink-0 min-h-[44px] px-2"
              >
                <TrashIcon size={15} /> Delete
              </button>
            </div>
          </div>
        );
      })}

      {deleteFor && (
        <ConfirmDialog
          title={`Delete ${deleteFor.name}'s account?`}
          message="Their account will be permanently deleted and they will be logged out everywhere. They can sign up again with the same email. Their past bookings stay in your records."
          confirmLabel="Delete account"
          busyLabel="Deleting…"
          cancelLabel="Cancel"
          busy={busy}
          onCancel={() => !busy && setDeleteFor(null)}
          onConfirm={doDelete}
        />
      )}

      {confirmFor && (
        <ConfirmDialog
          title={`Reset password for ${confirmFor.name}?`}
          message="They will be logged out everywhere and will need the new temporary password to log back in. Share it with them directly."
          confirmLabel="Reset password"
          busyLabel="Resetting…"
          cancelLabel="Cancel"
          busy={busy}
          onCancel={() => !busy && setConfirmFor(null)}
          onConfirm={doReset}
        />
      )}


      {tempPw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45" role="alertdialog" aria-modal="true" aria-label="Temporary password">
          <div className="card w-full max-w-sm p-6 fade-in">
            <h3 className="font-extrabold text-[17px]">Temporary password</h3>
            <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
              For <b>{tempPw.name}</b> ({tempPw.email}). This is shown <b>once</b> — copy it now and share it with the {tempPw.kind}.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <code className="flex-1 text-center font-mono font-bold text-lg tracking-[0.15em] bg-[#f4edda] border border-[#dccfae] rounded-2xl px-4 py-3.5 select-all">
                {tempPw.password}
              </code>
            </div>
            <button
              onClick={copyPw}
              className="gold-btn rounded-2xl px-4 py-3 text-[15px] w-full mt-3 inline-flex items-center justify-center gap-2"
            >
              {copied ? <><CheckIcon size={17} /> Copied!</> : 'Copy password'}
            </button>
            <button
              onClick={() => setTempPw(null)}
              className="w-full mt-2.5 px-4 py-3 rounded-2xl text-sm font-bold bg-[#f4edda] border border-[#dccfae] text-neutral-700 min-h-[48px]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Monthly plans ---------------- */
function PlansTab({ plans }: { plans: PlanRow[] }) {
  const active = plans.filter((p) => p.status === 'active');
  const pastDue = plans.filter((p) => p.status === 'past_due');
  if (!plans.length)
    return (
      <div className="card p-10 text-center fade-in">
        <p className="font-bold text-[16px]">No plan members yet</p>
        <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
          When customers subscribe to the $120/month plan, they appear here.
        </p>
      </div>
    );
  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return (
    <div className="grid gap-2.5 fade-in">
      <div className="card p-4">
        <b className="text-[15px]">Monthly Haircut Plan</b>
        <p className="text-xs text-neutral-500 mt-0.5">$120/month · 4 haircuts, one per week</p>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <div className="rounded-xl bg-[#f7f2e2] border border-[#e6dabf] py-2.5">
            <b className="text-gold text-[20px] block">{plans.length}</b>
            <span className="text-[11px] text-neutral-500 font-semibold">Total subscribers</span>
          </div>
          <div className="rounded-xl bg-[#f7f2e2] border border-[#e6dabf] py-2.5">
            <b className="text-green-700 text-[20px] block">{active.length}</b>
            <span className="text-[11px] text-neutral-500 font-semibold">Active</span>
          </div>
          <div className="rounded-xl bg-[#f7f2e2] border border-[#e6dabf] py-2.5">
            <b className="text-red-700 text-[20px] block">{pastDue.length}</b>
            <span className="text-[11px] text-neutral-500 font-semibold">Past due</span>
          </div>
        </div>
      </div>
      {plans.map((p) => (
        <div key={p.id} className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <b className="text-[15px] truncate">{p.customerName}</b>
            <span
              className={`chip shrink-0 ${
                p.status === 'active'
                  ? '!border-green-600/40 !text-green-700'
                  : p.status === 'past_due'
                    ? '!border-red-600/40 !text-red-700'
                    : '!border-neutral-300 !text-neutral-500'
              }`}
            >
              {p.status === 'active' ? (p.cancelAtPeriodEnd ? 'Ends soon' : 'Active') : p.status === 'past_due' ? 'Past due' : 'Canceled'}
            </span>
          </div>
          <p className="text-sm text-neutral-600 truncate mt-0.5">{p.customerEmail}</p>
          {p.planName && (
            <p className="text-xs font-bold text-gold mt-1">{p.planName}{p.planPrice ? ` · $${p.planPrice}/mo` : ''}</p>
          )}
          <p className="text-xs text-neutral-500 mt-1.5">
            Haircuts used this period: <b className="text-gold">{p.weeksUsed}/4</b>
            {' · '}renews {fmtDay(p.currentPeriodEnd)}
          </p>
        </div>
      ))}
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
        <p className="text-[10.5px] text-neutral-500 mt-3">Collected payments · plan haircuts count $30 each</p>
      </div>

      <div className="card p-4">
        <b className="text-[15px]">Top barbers — most haircuts ✂️</b>
        <p className="text-xs text-neutral-500 mt-0.5">Ranked by total haircuts</p>
        <div className="mt-3 grid gap-2">
          {[...data.perBarber]
            .sort((a, b) => b.haircuts.all - a.haircuts.all)
            .map((b, i) => (
              <div key={b.id} className="flex items-center gap-3">
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-extrabold shrink-0 ${
                    i === 0
                      ? 'bg-gold text-[#1c1a15] shadow-[0_0_12px_rgba(212,175,55,0.5)]'
                      : 'bg-[#f4edda] border border-[#dccfae] text-neutral-600'
                  }`}
                >
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 font-bold text-[14px] truncate">{b.name}</span>
                <span className="shrink-0">
                  <b className="text-gold text-[18px]">{b.haircuts.all}</b>
                  <span className="text-[11px] text-neutral-500 font-semibold"> haircuts</span>
                </span>
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
    </div>
  );
}

// Supply shop tab: the owner stocks real supplies (photo, name, description,
// price). Barbers buy with no card — the price is deducted from their earnings.
// The owner can pull any product or mark it out of stock anytime.
function ShopTab() {
  const [products, setProducts] = useState<{
    id: string; name: string; description: string; priceUsd: number;
    photoPath: string | null; inStock: boolean;
  }[]>([]);
  const [orders, setOrders] = useState<{
    id: string; barberId: string; barberName: string; productName: string;
    priceUsd: number; unitPriceUsd: number; quantity: number;
    deductedUsd: number; createdAt: string; photoPath: string | null;
    status: 'pending' | 'confirmed' | 'cancelled'; payMethod: 'earnings' | 'card';
  }[]>([]);
  const [debts, setDebts] = useState<Record<string, number>>({});
  const [barberBranches, setBarberBranches] = useState<Record<string, string[]>>({});
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    fetch('/api/owner/shop/products', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.products) setProducts(d.products); })
      .catch(() => {});
    fetch('/api/owner/shop/orders', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.orders) { setOrders(d.orders); setDebts(d.debts || {}); setBarberBranches(d.barberBranches || {}); } })
      .catch(() => {});
  };
  useEffect(load, []);

  async function addProduct() {
    if (!name.trim()) { setMsg('Enter a product name.'); return; }
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) { setMsg('Enter a valid price.'); return; }
    setBusy(true);
    setMsg('');
    try {
      const form = new FormData();
      form.set('name', name.trim());
      form.set('description', description.trim());
      form.set('price', String(p));
      if (photo) form.set('photo', photo);
      const r = await fetch('/api/owner/shop/products', { method: 'POST', headers: authHeaders(), body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not add product.');
      setProducts((ps) => [d.product, ...ps]);
      setName(''); setDescription(''); setPrice(''); setPhoto(null);
      setMsg('✓ Product added to the shop.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add product.');
    }
    setBusy(false);
  }

  async function toggleStock(id: string, inStock: boolean) {
    const r = await fetch(`/api/owner/shop/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ inStock }),
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || 'Could not update.'); return; }
    setProducts((ps) => ps.map((x) => (x.id === id ? d.product : x)));
  }

  async function removeProduct(id: string, productName: string) {
    if (!confirm(`Remove "${productName}" from the shop?\n\nPast orders are kept.`)) return;
    const r = await fetch(`/api/owner/shop/products/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Could not remove.'); return; }
    setProducts((ps) => ps.filter((x) => x.id !== id));
  }

  async function confirmOrder(id: string, productName: string, barberName: string, payMethod: string, priceUsd: number, quantity: number) {
    const extra = payMethod === 'earnings'
      ? `\n\n$${priceUsd.toFixed(2)} will be deducted from ${barberName}'s future payouts.`
      : '';
    if (!confirm(`Hand over ${quantity} x "${productName}" to ${barberName}?${extra}`)) return;
    const r = await fetch(`/api/owner/shop/orders/${id}/confirm`, { method: 'POST', headers: authHeaders() });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { alert(d.error || 'Could not confirm.'); return; }
    setOrders((os) => os.map((x) => (x.id === id ? { ...x, status: 'confirmed' as const } : x)));
    load();
  }

  async function cancelOrder(id: string, productName: string, barberName: string, status: string, payMethod: string) {
    const money = payMethod === 'card' ? '\n\nThe card payment will be refunded.' : '';
    if (!confirm(`Cancel the order for "${productName}" (${barberName})?${money}`)) return;
    const r = await fetch(`/api/owner/shop/orders/${id}/cancel`, { method: 'POST', headers: authHeaders() });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { alert(d.error || 'Could not cancel.'); return; }
    // The order is gone from the list — the API no longer returns cancelled orders.
    setOrders((os) => os.filter((x) => x.id !== id));
    load();
  }

  const photoUrl = (photoPath: string | null) =>
    photoPath ? `/api/photos/${encodeURIComponent(photoPath.split('/').pop() || '')}` : null;

  return (
    <div className="grid gap-4">
      <div className="card p-4">
        <h3 className="font-extrabold text-[15px] text-[#141414] mb-1">Add a supply</h3>
        <p className="text-[12px] text-neutral-500 mb-3 leading-relaxed">
          Barbers pay from their earnings or by card. Confirm each order when you hand the item over — after that it can't be cancelled.
        </p>
        <div className="grid gap-2.5">
          <label className="block">
            <span className="label">Photo</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPhoto(e.target.files?.[0] || null)}
              className="w-full text-sm text-neutral-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-[#1c1a15] file:text-white file:text-[13px] file:font-bold"
            />
          </label>
          <div>
            <span className="label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wahl Clipper Oil" className="input" maxLength={80} />
          </div>
          <div>
            <span className="label">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it for?" className="input" rows={2} maxLength={500} />
          </div>
          <div>
            <span className="label">Price (USD)</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="12" inputMode="decimal" className="input" />
          </div>
          {msg && (
            <p className={`text-sm px-4 py-2.5 rounded-xl border leading-relaxed ${
              msg.startsWith('✓')
                ? 'text-green-800 bg-green-600/10 border-green-600/25'
                : 'text-red-700 bg-red-600/10 border-red-600/25'
            }`}>{msg}</p>
          )}
          <button onClick={addProduct} disabled={busy} className="gold-btn rounded-2xl px-6 py-3 text-[15px] disabled:opacity-60">
            {busy ? 'Adding…' : '+ Add to shop'}
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-extrabold text-[15px] text-[#141414] mb-2">Products ({products.length})</h3>
        {products.length === 0 ? (
          <div className="card p-6 text-center"><p className="text-sm text-neutral-500">No supplies yet — add the first one above.</p></div>
        ) : (
          <div className="grid gap-2">
            {products.map((p) => {
              const url = photoUrl(p.photoPath);
              return (
                <div key={p.id} className="card p-3 flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-[#f4edda] border border-gold/30 flex items-center justify-center shrink-0">
                    {url ? <img src={url} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-2xl">✂️</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[14px] text-[#141414] truncate">{p.name}</p>
                    <p className="text-[12px] text-neutral-500">${p.priceUsd.toFixed(2)}</p>
                  </div>
                  <button
                    onClick={() => toggleStock(p.id, !p.inStock)}
                    className={`text-[11px] font-extrabold rounded-full px-3 py-1.5 border shrink-0 min-h-[36px] ${
                      p.inStock
                        ? 'text-green-800 bg-green-600/10 border-green-600/25'
                        : 'text-red-700 bg-red-600/10 border-red-600/25'
                    }`}
                    title={p.inStock ? 'Mark as out of stock' : 'Mark as back in stock'}
                  >
                    {p.inStock ? '✓ In stock' : 'Out of stock'}
                  </button>
                  <button
                    onClick={() => removeProduct(p.id, p.name)}
                    className="text-[12px] font-bold text-red-700 shrink-0 min-h-[36px] px-2"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-extrabold text-[15px] text-[#141414] mb-2">Orders ({orders.length})</h3>
        {orders.length === 0 ? (
          <div className="card p-6 text-center"><p className="text-sm text-neutral-500">No orders yet.</p></div>
        ) : (
          <div className="grid gap-2">
            {orders.map((o) => {
              const remaining = Math.round((o.priceUsd - o.deductedUsd) * 100) / 100;
              const url = photoUrl(o.photoPath);
              const status = o.status || 'pending';
              const branches = barberBranches[o.barberId] || [];
              return (
                <div key={o.id} className="card p-3 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-[#f4edda] border border-gold/30 flex items-center justify-center shrink-0">
                    {url ? <img src={url} alt={o.productName} className="w-full h-full object-cover" /> : <span className="text-xl">✂️</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[13px] text-[#141414] truncate">{(o.quantity || 1) > 1 ? `${o.quantity} x ` : ''}{o.productName}</p>
                    <p className="text-[11px] text-neutral-500">
                      {o.barberName}{branches.length > 0 ? ` · 📍 ${branches.join(', ')}` : ''} · {new Date(o.createdAt).toLocaleDateString()} · ${o.priceUsd.toFixed(2)} · {o.payMethod === 'card' ? '💳 Card' : '💰 Earnings'}
                    </p>
                    <p className="mt-1">
                      {status === 'pending' && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-gold bg-gold/10 border border-gold/30 rounded-full px-2 py-0.5">
                          ⏳ Waiting for handover
                        </span>
                      )}
                      {status === 'confirmed' && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-green-800 bg-green-600/10 border border-green-600/25 rounded-full px-2 py-0.5">
                          ✓ Handed over
                        </span>
                      )}
                      {status === 'cancelled' && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 bg-neutral-500/10 border border-neutral-500/25 rounded-full px-2 py-0.5">
                          ✗ Cancelled
                        </span>
                      )}
                    </p>
                  </div>
                  {status === 'pending' ? (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => confirmOrder(o.id, o.productName, o.barberName, o.payMethod, o.priceUsd, o.quantity || 1)}
                        className="gold-btn rounded-xl px-4 py-2 text-[12px] font-extrabold min-h-[40px]"
                      >
                        ✓ Hand over
                      </button>
                      <button
                        onClick={() => cancelOrder(o.id, o.productName, o.barberName, status, o.payMethod)}
                        className="text-[12px] font-bold text-red-700 min-h-[36px]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : status === 'confirmed' ? (
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${
                        remaining <= 0 || o.payMethod === 'card'
                          ? 'text-green-800 bg-green-600/10 border border-green-600/25'
                          : 'text-gold bg-gold/10 border border-gold/30'
                      }`}>
                        {o.payMethod === 'card' ? '✓ Paid' : remaining <= 0 ? '✓ Settled' : `$${remaining.toFixed(2)} owed`}
                      </span>
                      <button
                        onClick={() => cancelOrder(o.id, o.productName, o.barberName, status, o.payMethod)}
                        className="text-[12px] font-bold text-red-700 min-h-[36px] px-1"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] font-bold text-neutral-400 shrink-0">—</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {Object.keys(debts).length > 0 && (
          <div className="card p-4 mt-3">
            <h4 className="font-extrabold text-[13px] text-[#141414] mb-2">Outstanding per barber</h4>
            {Object.entries(debts).map(([barberId, d]) => {
              const o = orders.find((x) => x.barberId === barberId);
              const branches = barberBranches[barberId] || [];
              if (d <= 0) return null;
              return (
                <div key={barberId} className="flex items-center justify-between py-1.5 border-b border-gold/20 last:border-0">
                  <span className="text-[13px] font-bold text-[#141414]">
                    {o?.barberName || 'Barber'}
                    {branches.length > 0 && <span className="block text-[11px] font-medium text-neutral-500">📍 {branches.join(', ')}</span>}
                  </span>
                  <span className="text-[13px] font-extrabold text-gold">${d.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Partners tab: barbershop owners who requested their own MRC-style app
// through the public /partners page.
function PartnersTab() {
  const [leads, setLeads] = useState<{
    id: string; name: string; salonName: string; phone: string;
    email: string; city: string; createdAt: string;
  }[]>([]);

  const load = () => {
    fetch('/api/owner/partners/leads', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.leads) setLeads(d.leads); })
      .catch(() => {});
  };
  useEffect(load, []);

  async function removeLead(id: string, name: string) {
    if (!confirm(`Delete the request from ${name}?`)) return;
    const r = await fetch(`/api/owner/partners/leads/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) { alert('Could not delete.'); return; }
    setLeads((ls) => ls.filter((l) => l.id !== id));
  }

  return (
    <div className="grid gap-3">
      <div className="card p-4">
        <h3 className="font-extrabold text-[15px] text-[#141414]">Shop owners asking for their own app</h3>
        <p className="text-[12px] text-neutral-500 mt-1 leading-relaxed">
          Requests from the public <b>/partners</b> page — call them back and close the deal.
        </p>
      </div>
      {leads.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[15px] font-bold text-[#141414]">No requests yet</p>
          <p className="text-sm text-neutral-500 mt-1">Share your /partners link with shop owners.</p>
        </div>
      ) : (
        leads.map((l) => (
          <div key={l.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-extrabold text-[15px] text-[#141414]">{l.salonName}</p>
                <p className="text-[13px] text-neutral-600">{l.name}{l.city ? ` · ${l.city}` : ''}</p>
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  {new Date(l.createdAt).toLocaleDateString()} {new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <button onClick={() => removeLead(l.id, l.name)} className="text-[12px] font-bold text-red-700 shrink-0 min-h-[36px] px-2">
                Delete
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              <a href={`tel:${encodeURIComponent(l.phone)}`} className="gold-btn rounded-xl px-4 py-2.5 text-[13px] font-extrabold flex-1 text-center">
                📞 {l.phone}
              </a>
              {l.email && (
                <a href={`mailto:${encodeURIComponent(l.email)}`} className="gold-outline-btn rounded-xl px-4 py-2.5 text-[13px] font-extrabold">
                  ✉️ Email
                </a>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------- Salons (super-admin) ---------------- */
interface SalonRow {
  salon: Salon;
  ownerEmail: string;
  barberCount: number;
  bookingCount: number;
  pendingBookings: number;
}

function SalonsTab() {
  const [salons, setSalons] = useState<SalonRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/owner/salons', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) throw new Error('unauthorized');
        return r.json();
      })
      .then((d) => setSalons(d.salons || []))
      .catch(() => setErr('Could not load salons.'));
  }, []);

  useEffect(load, [load]);

  async function act(salonId: string, action: 'approve' | 'suspend' | 'activate' | 'dismiss') {
    if (action === 'approve' || action === 'dismiss') {
      const ok = confirm(
        action === 'approve'
          ? 'Approve this salon? It will go live immediately.'
          : 'Dismiss this request? It will be removed from the list.'
      );
      if (!ok) return;
    }
    setBusy(salonId + action);
    setErr('');
    try {
      const r = await fetch('/api/owner/salons', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId, action }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not update the salon. Please try again.');
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update the salon. Please try again.');
    }
    setBusy(null);
  }

  async function copyLinks(salon: Salon) {
    const links = `${location.origin}/customer?salon=${salon.slug}\n${location.origin}/salon`;
    try {
      await navigator.clipboard.writeText(links);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = links;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(salon.id);
    setTimeout(() => setCopied((c) => (c === salon.id ? null : c)), 2000);
  }

  const pending = salons.filter((s) => s.salon.status === 'pending');
  const active = salons.filter((s) => s.salon.status !== 'pending');

  return (
    <div className="grid gap-4 fade-in">
      {err && (
        <p className="text-sm font-semibold text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-2.5">{err}</p>
      )}

      <div>
        <h2 className="font-extrabold text-[15px] mb-2.5">Pending requests {pending.length > 0 && <span className="text-gold">({pending.length})</span>}</h2>
        {pending.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-neutral-500">No pending requests.</p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            {pending.map((s) => (
              <div key={s.salon.id} className="card p-4">
                <div className="flex justify-between items-center gap-2">
                  <b className="text-[15px]">{s.salon.name}</b>
                  <span className="chip shrink-0">📥 Pending</span>
                </div>
                <div className="text-sm text-neutral-600 mt-1.5">
                  {s.salon.ownerName} · {s.salon.city}
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">{s.ownerEmail} · {s.salon.ownerPhone}</div>
                <div className="flex gap-2.5 mt-3">
                  <button
                    onClick={() => act(s.salon.id, 'approve')}
                    disabled={busy !== null}
                    className="gold-btn rounded-xl px-4 py-2.5 text-[14px] font-bold flex-1"
                  >
                    {busy === s.salon.id + 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => act(s.salon.id, 'dismiss')}
                    disabled={busy !== null}
                    className="gold-outline-btn rounded-xl px-4 py-2.5 text-[14px] font-bold flex-1"
                  >
                    {busy === s.salon.id + 'dismiss' ? 'Dismissing…' : 'Dismiss'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-extrabold text-[15px] mb-2.5">Active salons {active.length > 0 && <span className="text-gold">({active.length})</span>}</h2>
        {active.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-neutral-500">No salons yet.</p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            {active.map((s) => (
              <div key={s.salon.id} className="card p-4">
                <div className="flex justify-between items-center gap-2">
                  <b className="text-[15px] truncate">{s.salon.name}</b>
                  <span className={`text-[10px] font-extrabold uppercase tracking-wide rounded-full px-2 py-0.5 shrink-0 ${s.salon.status === 'active' ? 'bg-green-600/10 text-green-700 border border-green-600/30' : 'bg-red-600/10 text-red-700 border border-red-600/30'}`}>
                    {s.salon.status}
                  </span>
                </div>
                <div className="text-sm text-neutral-600 mt-1.5">
                  {s.salon.city} · 💈 {s.barberCount} barber{s.barberCount === 1 ? '' : 's'} · 📅 {s.bookingCount} booking{s.bookingCount === 1 ? '' : 's'} ({s.pendingBookings} upcoming)
                </div>
                <div className="flex gap-2.5 mt-3">
                  <button
                    onClick={() => copyLinks(s.salon)}
                    className="gold-outline-btn rounded-xl px-4 py-2.5 text-[14px] font-bold flex-1"
                  >
                    {copied === s.salon.id ? 'Copied ✓' : 'Copy links'}
                  </button>
                  {s.salon.status === 'active' ? (
                    <button
                      onClick={() => act(s.salon.id, 'suspend')}
                      disabled={busy !== null}
                      className="text-sm font-semibold text-red-700/90 underline underline-offset-2 px-2 shrink-0"
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      onClick={() => act(s.salon.id, 'activate')}
                      disabled={busy !== null}
                      className="text-sm font-semibold text-gold underline underline-offset-2 px-2 shrink-0"
                    >
                      Activate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
