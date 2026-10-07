'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOutIcon, StarIcon, CalendarIcon, ClockIcon, GearIcon } from '@/components/Icons';
import { BarberDashboardSkeleton } from '@/components/Loading';
import { CancelBookingButton, CancelledLabel, NoShowLabel } from '@/components/CancelBookingButton';
import { DeleteBookingButton } from '@/components/DeleteBookingButton';
import { CollectScanner } from '@/components/CollectScanner';
import PaymentStep from '@/components/PaymentStep';
import { EnableNotifications } from '@/components/EnableNotifications';
import { NoShowButton } from '@/components/NoShowButton';
import { ChatModal } from '@/components/ChatModal';
import { TeamChatModal } from '@/components/TeamChatModal';
import { BarberTasks } from '@/components/BarberTasks';
import { Leaderboard } from '@/components/Leaderboard';
import BonusCard from '@/components/BonusCard';
import type { Booking, Review, WorkingHours, ShopProduct, ShopOrder } from '@/lib/types';

interface ScheduleBooking extends Booking {
  serviceName: string;
  servicePrice: number | null;
  customerPhotoUrl?: string | null;
}

interface ScheduleData {
  barberName: string;
  workingHours: WorkingHours | null;
  today: ScheduleBooking[];
  upcoming: ScheduleBooking[];
  metrics: { totalBookings: number; todayCount: number; reviewCount: number; avgRating: number | null };
  reviews: Review[];
}

const WEEKDAYS: { day: string; num: string; label: string }[] = [
  { day: 'Monday', num: '1', label: 'Mon' },
  { day: 'Tuesday', num: '2', label: 'Tue' },
  { day: 'Wednesday', num: '3', label: 'Wed' },
  { day: 'Thursday', num: '4', label: 'Thu' },
  { day: 'Friday', num: '5', label: 'Fri' },
  { day: 'Saturday', num: '6', label: 'Sat' },
  { day: 'Sunday', num: '0', label: 'Sun' },
];

function fmtTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

// Small customer avatar (photo if set, else initial). Shown to the barber.
function CustomerAvatar({ b, size = 32 }: { b: { customerName: string; customerPhotoUrl?: string | null }; size?: number }) {
  if (b.customerPhotoUrl) {
    return (
      <img
        src={b.customerPhotoUrl}
        alt={b.customerName}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="rounded-full object-cover border border-gold/50 shrink-0"
      />
    );
  }
  return (
    <span
      className="rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold font-extrabold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {(b.customerName || '?').charAt(0).toUpperCase()}
    </span>
  );
}

// Remaining balance on an appointment (null when the price is unknown).
function remainingOf(b: ScheduleBooking): number | null {
  if (b.servicePrice == null) return null;
  const r = Math.round((b.servicePrice - (b.amountPaid ?? 0)) * 100) / 100;
  return r > 0 ? r : 0;
}

function PayState({ b }: { b: ScheduleBooking }) {
  if (b.status !== 'booked') return null;
  if (b.paymentStatus === 'membership_redeemed') {
    return <span className="inline-block mt-1.5 text-[12px] font-bold text-green-700 bg-green-600/10 border border-green-600/25 rounded-full px-2.5 py-1">Paid via plan</span>;
  }
  if (b.paymentStatus === 'membership_pending') {
    return <span className="inline-block mt-1.5 text-[12px] font-bold text-gold bg-gold/10 border border-gold/30 rounded-full px-2.5 py-1">Monthly plan — scan code</span>;
  }
  const remaining = remainingOf(b);
  if (b.paymentStatus === 'paid_in_full' || remaining === 0) {
    return <span className="inline-block mt-1.5 text-[12px] font-bold text-green-700 bg-green-600/10 border border-green-600/25 rounded-full px-2.5 py-1">Paid in full</span>;
  }
  if (remaining != null && remaining > 0) {
    return <span className="inline-block mt-1.5 text-[12px] font-bold text-gold bg-gold/10 border border-gold/30 rounded-full px-2.5 py-1">Collect ${remaining.toFixed(2)}</span>;
  }
  return null;
}

// Chat button with unread badge — opens the per-booking conversation.
function ChatBtn({ label, unreadCount, onOpen }: { label: string; unreadCount: number; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gold border border-gold/40 rounded-full px-3.5 py-2 min-h-[40px] card-hover"
    >
      💬 {label}
      {unreadCount > 0 && (
        <span className="bg-red-600 text-white text-[10px] font-extrabold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
          {unreadCount}
        </span>
      )}
    </button>
  );
}

// Payouts card: barber connects their bank via Stripe Connect to receive
// haircut payouts directly. We never see or store bank details.
function PayoutsCard({ token }: { token: string }) {
  const [status, setStatus] = useState<{ connected: boolean; payoutsEnabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    fetch('/api/barber/connect', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!d.error) setStatus({ connected: d.connected, payoutsEnabled: d.payoutsEnabled }); })
      .catch(() => {});
  };
  useEffect(load, [token]);

  // After returning from Stripe onboarding, refresh the status.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('payouts');
    if (p === 'done' || p === 'refresh') {
      load();
      window.history.replaceState({}, '', '/barber/dashboard');
    }
  }, []);

  async function connect() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/barber/connect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.url) throw new Error(d?.error || 'Could not start.');
      window.location.href = d.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start.');
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center text-xl shrink-0">
          💰
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-[16px] text-[#141414]">My payouts</div>
          <div className="text-[12px] text-neutral-500">
            {status?.payoutsEnabled
              ? 'Bank connected — haircut money goes straight to you'
              : 'Connect your bank to receive your haircut money'}
          </div>
        </div>
        {status?.payoutsEnabled ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-extrabold text-green-700 bg-green-600/10 border border-green-600/30 rounded-full px-3 py-1.5 shrink-0">
            ✓ Connected
          </span>
        ) : (
          <button
            onClick={connect}
            disabled={busy}
            className="gold-btn rounded-xl px-4 py-2.5 text-[13px] font-extrabold shrink-0"
          >
            {busy ? '…' : status?.connected ? 'Finish setup' : 'Connect bank'}
          </button>
        )}
      </div>
      {error && <p className="text-red-700 text-sm mt-3">{error}</p>}
      <p className="text-[11px] text-neutral-400 mt-3 leading-relaxed">
        You enter your bank details on Stripe&apos;s secure page — we never see or store them.
      </p>
    </div>
  );
}

// Barber's work portfolio: upload photos of their work (owner must approve).
function WorkPhotosSection({ token }: { token: string }) {
  const [photos, setPhotos] = useState<{ id: string; url: string; status: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    fetch('/api/barber/photos', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.photos) setPhotos(d.photos); })
      .catch(() => {});
  };
  useEffect(load, [token]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('photo', file);
      const r = await fetch('/api/barber/photos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || 'Upload failed.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this photo?')) return;
    try {
      const r = await fetch(`/api/barber/photos/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error();
      setPhotos((p) => p.filter((x) => x.id !== id));
    } catch {
      alert('Could not delete the photo. Please try again.');
    }
  }

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center text-xl shrink-0">
          📸
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-[16px] text-[#141414]">My work photos</div>
          <div className="text-[12px] text-neutral-500">Show customers your work — the owner approves each photo</div>
        </div>
        <label className="gold-btn rounded-xl px-4 py-2.5 text-[13px] font-extrabold shrink-0 cursor-pointer">
          {busy ? '…' : '+ Add'}
          <input type="file" accept="image/*" className="hidden" onChange={upload} disabled={busy} />
        </label>
      </div>
      {error && <p className="text-red-700 text-sm mt-3">{error}</p>}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-4">
          {photos.map((p) => (
            <div key={p.id} className="relative rounded-xl overflow-hidden border border-gold/30">
              <img src={p.url} alt="Work" className="w-full aspect-square object-cover" />
              <span className={`absolute top-1 left-1 text-[10px] font-extrabold rounded-full px-2 py-0.5 ${
                p.status === 'approved' ? 'bg-green-600/90 text-white' : 'bg-amber-500/90 text-white'
              }`}>
                {p.status === 'approved' ? '✓ Live' : '⏳ Review'}
              </span>
              <button
                onClick={() => remove(p.id)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-[12px] font-bold flex items-center justify-center"
                aria-label="Delete photo"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// My skills: the barber collects photos per skill (a "box" per skill) and sends
// the batch to the owner. Owner approves → the skill shows with a ✓ verified
// badge on the barber's public profile.
interface SkillRow {
  name: string;
  verified: boolean;
  status: 'none' | 'draft' | 'pending' | 'approved' | 'rejected';
  photos: string[];
}

function MySkillsSection({ token }: { token: string }) {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    fetch('/api/barber/skills', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.skills) setSkills(d.skills); })
      .catch(() => {});
  };
  useEffect(load, [token]);

  async function upload(skill: string, files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(skill);
    setError('');
    try {
      const form = new FormData();
      form.append('skill', skill);
      Array.from(files).slice(0, 10).forEach((f) => form.append('photos', f));
      const r = await fetch('/api/barber/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || 'Upload failed.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(null);
    }
  }

  async function submit(skill: string) {
    if (!confirm(`Send your "${skill}" photos to the owner for verification?`)) return;
    setBusy(skill);
    setError('');
    try {
      const r = await fetch('/api/barber/skills/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ skill }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || 'Could not submit.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit.');
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto(skill: string, photoUrl: string) {
    if (!confirm('Delete this photo?')) return;
    setBusy(skill);
    try {
      await fetch('/api/barber/skills/photo', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ skill, photoUrl }),
      }).catch(() => {});
      load();
    } finally {
      setBusy(null);
    }
  }

  const statusChip = (s: SkillRow) => {
    if (s.verified || s.status === 'approved')
      return <span className="chip !border-green-600/40 !text-green-700 shrink-0">✓ Verified</span>;
    if (s.status === 'pending')
      return <span className="chip !border-gold/60 !text-gold shrink-0">⏳ Under review</span>;
    if (s.status === 'rejected')
      return <span className="chip !border-red-600/40 !text-red-700 shrink-0">✗ Not approved</span>;
    return <span className="chip shrink-0">Not submitted</span>;
  };

  if (!skills.length) return null;

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center text-xl shrink-0">
          🎯
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-[16px] text-[#141414]">My skills</div>
          <div className="text-[12px] text-neutral-500">Collect photos per skill — the owner verifies them</div>
        </div>
      </div>
      {error && <p className="text-red-700 text-sm mt-3">{error}</p>}
      <div className="grid gap-2.5 mt-4">
        {skills.map((s) => {
          const isOpen = expanded === s.name;
          const canEdit = s.status === 'none' || s.status === 'draft' || s.status === 'rejected';
          return (
            <div key={s.name} className="rounded-2xl border border-[#e6dabf] bg-[#f7f2e2] overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : s.name)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
              >
                <b className="text-[14px] flex-1 truncate">{s.name}</b>
                {statusChip(s)}
                <span className={`text-gold text-[12px] transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 fade-in">
                  {s.status === 'rejected' && (
                    <p className="text-[12px] text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-3 py-2 mb-2.5">
                      Not approved — add better photos and send again.
                    </p>
                  )}
                  {s.photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mb-2.5">
                      {s.photos.map((url) => (
                        <div key={url} className="relative rounded-xl overflow-hidden border border-gold/30">
                          <img src={url} alt={s.name} className="w-full aspect-square object-cover" />
                          {canEdit && (
                            <button
                              onClick={() => void removePhoto(s.name, url)}
                              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-[12px] font-bold flex items-center justify-center"
                              aria-label="Delete photo"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {canEdit && (
                    <div className="flex gap-2">
                      <label className="flex-1 gold-btn rounded-xl px-4 py-2.5 text-[13px] font-extrabold text-center cursor-pointer">
                        {busy === s.name ? '…' : `+ Photos (${s.photos.length}/10)`}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          disabled={busy === s.name}
                          onChange={(e) => { void upload(s.name, e.target.files); e.target.value = ''; }}
                        />
                      </label>
                      <button
                        onClick={() => void submit(s.name)}
                        disabled={busy === s.name || s.photos.length < 3}
                        className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-extrabold bg-green-600 text-white disabled:opacity-40"
                      >
                        {busy === s.name ? '…' : '✓ Send for verification'}
                      </button>
                    </div>
                  )}
                  {canEdit && s.photos.length < 3 && (
                    <p className="text-[11px] text-neutral-500 mt-1.5 text-center">
                      Collect at least 3 photos, then send the batch to the owner.
                    </p>
                  )}
                  {s.status === 'pending' && (
                    <p className="text-[12px] text-neutral-500 text-center py-1">
                      Waiting for the owner's review…
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Supply shop: the barber buys shop supplies here. No card, no Apple Pay —
// every purchase is deducted from his earnings (next payouts settle it first).
function ShopModal({ onClose, getToken }: { onClose: () => void; getToken: () => string | null }) {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [debt, setDebt] = useState(0);
  const [buying, setBuying] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [loaded, setLoaded] = useState(false);
  // Payment-method choice + card payment state.
  const [payProduct, setPayProduct] = useState<ShopProduct | null>(null);
  const [qty, setQty] = useState(1);
  const [cardSecret, setCardSecret] = useState('');
  const [cardBusy, setCardBusy] = useState(false);
  const [cardTotal, setCardTotal] = useState(0);

  useEffect(() => {
    const t = getToken();
    if (!t) return;
    Promise.all([
      fetch('/api/barber/shop/products', { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/barber/shop/orders', { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([p, o]) => {
        setProducts(p.products || []);
        setOrders(o.orders || []);
        setDebt(o.debt || 0);
      })
      .catch(() => setMsg('Could not load the shop.'))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buyWithEarnings(p: ShopProduct, quantity: number) {
    const total = Math.round(p.priceUsd * quantity * 100) / 100;
    if (!window.confirm(`Buy ${quantity} x "${p.name}" for $${total.toFixed(2)}?\n\nIt will be deducted from your earnings — no card needed.`)) return;
    setBuying(p.id);
    setMsg('');
    try {
      const r = await fetch('/api/barber/shop/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ productId: p.id, quantity, payMethod: 'earnings' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not buy.');
      setOrders((os) => [j.order, ...os]);
      setDebt(j.debt || 0);
      setPayProduct(null);
      setMsg(`✓ ${quantity} x "${p.name}" ordered — $${total.toFixed(2)} will be deducted from your earnings when the owner hands it over.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not buy.');
    }
    setBuying(null);
  }

  async function buyWithCard(p: ShopProduct, quantity: number) {
    setCardBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/barber/shop/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ productId: p.id, quantity }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start the card payment.');
      setCardTotal(j.amount);
      setCardSecret(j.clientSecret);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not start the card payment.');
    }
    setCardBusy(false);
  }

  async function finishCardPurchase(paymentIntentId: string) {
    const p = payProduct;
    if (!p) return;
    setBuying(p.id);
    try {
      const r = await fetch('/api/barber/shop/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ productId: p.id, quantity: qty, payMethod: 'card', paymentIntentId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not complete the order.');
      setOrders((os) => [j.order, ...os]);
      setPayProduct(null);
      setCardSecret('');
      setMsg(`✓ ${qty} x "${p.name}" paid — the owner will hand it over soon.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Payment went through — show this to the owner.');
    }
    setBuying(null);
  }

  async function cancelOrder(id: string, productName: string) {
    if (!window.confirm(`Cancel your order for "${productName}"?`)) return;
    setCancelling(id);
    try {
      const r = await fetch(`/api/barber/shop/orders/${id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not cancel.');
      setOrders((os) => os.filter((o) => o.id !== id));
      setDebt(j.debt || 0);
      setMsg(j.refunded ? '✓ Order cancelled — your card was refunded.' : '✓ Order cancelled.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not cancel.');
    }
    setCancelling(null);
  }

  const photoUrl = (photoPath: string | null) =>
    photoPath ? `/api/photos/${encodeURIComponent(photoPath.split('/').pop() || '')}` : null;

  return (
    <div className="fixed inset-0 z-50 bg-[#f7f2e2] overflow-y-auto fade-in">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-[22px] font-extrabold tracking-tight text-[#141414]">Supply shop 🛒</h1>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white border border-gold/40 flex items-center justify-center text-[18px] font-bold text-neutral-600 card-hover"
            aria-label="Close shop"
          >
            ✕
          </button>
        </div>
        <p className="text-[12px] text-neutral-500 leading-relaxed mb-4">
          Barber supplies from the shop storage. Pay from your earnings, or with card / Apple Pay.
        </p>

        {payProduct && !cardSecret && (
          <div className="card p-5 mb-4 fade-in">
            <h3 className="font-extrabold text-[16px] text-[#141414]">{payProduct.name}</h3>
            <p className="text-[13px] text-neutral-500 mt-1 mb-3">
              <b className="text-[#141414]">${payProduct.priceUsd.toFixed(2)}</b> each
            </p>
            <div className="flex items-center gap-4 mb-4">
              <span className="text-[13px] font-bold text-neutral-600">Quantity</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-10 h-10 rounded-full bg-[#f4edda] border border-gold/40 text-[18px] font-extrabold text-[#141414]"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="text-[18px] font-extrabold text-[#141414] min-w-[28px] text-center">{qty}</span>
                <button
                  onClick={() => setQty((q) => Math.min(99, q + 1))}
                  className="w-10 h-10 rounded-full bg-[#f4edda] border border-gold/40 text-[18px] font-extrabold text-[#141414]"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <span className="ml-auto text-[16px] font-extrabold text-gold">
                ${(payProduct.priceUsd * qty).toFixed(2)}
              </span>
            </div>
            <h3 className="font-extrabold text-[15px] text-[#141414] mb-2">How do you want to pay?</h3>
            <div className="grid gap-2.5">
              <button
                onClick={() => buyWithEarnings(payProduct, qty)}
                disabled={buying === payProduct.id}
                className="gold-btn rounded-2xl px-6 py-3.5 text-[15px] disabled:opacity-60 text-left"
              >
                <span className="block font-extrabold">💰 Deduct from my earnings</span>
                <span className="block text-[12px] font-medium opacity-80 mt-0.5">No card needed — settled from your next payouts</span>
              </button>
              <button
                onClick={() => buyWithCard(payProduct, qty)}
                disabled={cardBusy}
                className="rounded-2xl px-6 py-3.5 text-[15px] font-extrabold bg-[#1c1a15] text-white disabled:opacity-60 text-left"
              >
                <span className="block font-extrabold">💳 Card / Apple Pay</span>
                <span className="block text-[12px] font-medium opacity-70 mt-0.5">Pay ${(payProduct.priceUsd * qty).toFixed(2)} now with Stripe</span>
              </button>
              <button
                onClick={() => setPayProduct(null)}
                disabled={buying === payProduct.id || cardBusy}
                className="text-sm text-neutral-500 font-medium py-1"
              >
                ← Back to the shop
              </button>
            </div>
          </div>
        )}

        {payProduct && cardSecret && (
          <div className="mb-4 fade-in">
            <PaymentStep
              clientSecret={cardSecret}
              amount={cardTotal}
              summary={{
                serviceName: `${qty} x ${payProduct.name}`,
                totalPrice: cardTotal,
                amountLabel: 'Due now',
              }}
              onSuccess={finishCardPurchase}
              onBack={() => setCardSecret('')}
              onError={(m) => setMsg(m)}
            />
          </div>
        )}

        {debt > 0 && (
          <div className="rounded-2xl border border-gold/50 bg-[#fff8e6] px-4 py-3 mb-4">
            <p className="text-[13px] font-bold text-[#141414]">
              You owe <span className="text-gold">${debt.toFixed(2)}</span> for supplies — it will be deducted from your next payouts.
            </p>
          </div>
        )}

        {msg && (
          <p className={`text-sm px-4 py-2.5 rounded-xl border leading-relaxed mb-4 ${
            msg.startsWith('✓') || msg.startsWith('Could not')
              ? msg.startsWith('✓')
                ? 'text-green-800 bg-green-600/10 border-green-600/25'
                : 'text-red-700 bg-red-600/10 border-red-600/25'
              : 'text-neutral-700 bg-white border-gold/40'
          }`}>{msg}</p>
        )}

        {!loaded ? (
          <p className="text-sm text-neutral-500 text-center py-8">Loading…</p>
        ) : products.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-[15px] font-bold text-[#141414]">The shop is empty for now</p>
            <p className="text-sm text-neutral-500 mt-1">The owner will add supplies here soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {products.map((p) => {
              const url = photoUrl(p.photoPath);
              return (
                <div key={p.id} className={`card p-3 flex flex-col ${!p.inStock ? 'opacity-70' : ''}`}>
                  <div className="w-full aspect-square rounded-xl overflow-hidden bg-[#f4edda] border border-gold/30 flex items-center justify-center">
                    {url ? (
                      <img src={url} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <span className="text-3xl">✂️</span>
                    )}
                  </div>
                  <p className="font-extrabold text-[14px] text-[#141414] mt-2 leading-tight">{p.name}</p>
                  {p.description && <p className="text-[11px] text-neutral-500 mt-0.5 leading-snug line-clamp-2">{p.description}</p>}
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-extrabold text-[15px] text-[#141414]">${p.priceUsd.toFixed(2)}</span>
                    {!p.inStock && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-red-700 bg-red-600/10 border border-red-600/25 rounded-full px-2 py-0.5">
                        Out of stock
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => { setPayProduct(p); setQty(1); setCardSecret(''); setMsg(''); }}
                    disabled={!p.inStock || buying === p.id}
                    className={`mt-2 rounded-xl px-4 py-2.5 text-[13px] font-extrabold min-h-[40px] transition-all ${
                      p.inStock
                        ? 'gold-btn'
                        : 'bg-[#ece2c9] text-neutral-400 cursor-not-allowed'
                    } disabled:opacity-60`}
                  >
                    {buying === p.id ? '…' : p.inStock ? 'Buy' : 'Not available'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {orders.length > 0 && (
          <>
            <h2 className="font-extrabold mt-7 mb-3 text-[16px] tracking-tight text-[#141414]">My purchases</h2>
            <div className="grid gap-2">
              {orders.map((o) => {
                const remaining = Math.round((o.priceUsd - o.deductedUsd) * 100) / 100;
                const url = photoUrl(o.photoPath);
                const status = o.status || 'pending';
                return (
                  <div key={o.id} className="card p-3 flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-[#f4edda] border border-gold/30 flex items-center justify-center shrink-0">
                      {url ? <img src={url} alt={o.productName} className="w-full h-full object-cover" /> : <span className="text-xl">✂️</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-[13px] text-[#141414] truncate">{(o.quantity || 1) > 1 ? `${o.quantity} x ` : ''}{o.productName}</p>
                      <p className="text-[11px] text-neutral-500">
                        {new Date(o.createdAt).toLocaleDateString()} · ${o.priceUsd.toFixed(2)} · {o.payMethod === 'card' ? '💳 Card' : '💰 Earnings'}
                      </p>
                      <p className="mt-1">
                        {status === 'pending' && (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-gold bg-gold/10 border border-gold/30 rounded-full px-2 py-0.5">
                            ⏳ Waiting for the owner
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
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {status === 'confirmed' && (
                        <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${
                          remaining <= 0
                            ? 'text-green-800 bg-green-600/10 border border-green-600/25'
                            : 'text-gold bg-gold/10 border border-gold/30'
                        }`}>
                          {o.payMethod === 'card' ? '✓ Paid' : remaining <= 0 ? '✓ Paid off' : `$${remaining.toFixed(2)} owed`}
                        </span>
                      )}
                      {status === 'pending' && (
                        <button
                          onClick={() => cancelOrder(o.id, o.productName)}
                          disabled={cancelling === o.id}
                          className="text-[12px] font-bold text-red-700 border border-red-600/30 bg-red-600/5 rounded-full px-3 py-1.5 min-h-[36px] disabled:opacity-50"
                        >
                          {cancelling === o.id ? '…' : 'Cancel order'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Settings modal: team chat, notifications, and payouts — all in one place.
function SettingsModal({
  onClose,
  getToken,
  teamUnread,
  onOpenTeamChat,
}: {
  onClose: () => void;
  getToken: () => string | null;
  teamUnread: number;
  onOpenTeamChat: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-[#f7f2e2] overflow-y-auto fade-in">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[22px] font-extrabold tracking-tight text-[#141414]">Settings</h1>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white border border-gold/40 flex items-center justify-center text-[18px] font-bold text-neutral-600 card-hover"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <button
          onClick={onOpenTeamChat}
          className="card p-5 w-full text-left relative overflow-hidden card-hover"
        >
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center text-xl shrink-0">
              💬
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-[16px] text-[#141414]">Team chat</div>
              <div className="text-[12px] text-neutral-500">Talk with all the barbers</div>
            </div>
            {teamUnread > 0 && (
              <span className="bg-red-600 text-white text-[11px] font-extrabold rounded-full min-w-[20px] h-[20px] flex items-center justify-center px-1.5 shrink-0">
                {teamUnread}
              </span>
            )}
            <span className="text-neutral-400 font-extrabold text-lg shrink-0">›</span>
          </div>
        </button>

        <div className="mt-4">
          <BonusCard token={getToken() ?? ''} />
        </div>

        <div className="mt-4">
          <EnableNotifications getToken={() => getToken() ?? ''} />
        </div>

        <PayoutsCard token={getToken() ?? ''} />

        <WorkPhotosSection token={getToken() ?? ''} />

        <MySkillsSection token={getToken() ?? ''} />
      </div>
    </div>
  );
}

// "Done" button: barber takes a proof-of-completion PHOTO with the camera
// (like DoorDash proof-of-delivery) → payout is sent. No photo = no payout.
function DoneButton({ bookingId, token, onDone }: { bookingId: string; token: string; onDone: (payoutAmount: number) => void }) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('That file is not an image.'); return; }
    if (f.size > 5 * 1024 * 1024) { setError('Photo is too large (max 5MB).'); return; }
    setPhoto(f);
    setError('');
    setPreview(URL.createObjectURL(f));
  }

  async function confirm() {
    if (!photo) { setError('Take a photo of the finished haircut.'); return; }
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('photo', photo, 'done.jpg');
      const r = await fetch(`/api/barber/bookings/${bookingId}/done`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || 'Could not mark as done.');
      if (d.payoutFailed) {
        setError(`Done ✓ but payout failed: ${d.error || 'try again later.'}`);
      }
      onDone(d.payoutAmount ?? 0);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark as done.');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setPhoto(null);
    setPreview(null);
    setError('');
  }

  return (
    <span className="inline-block">
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        className="inline-flex items-center gap-1 text-[13px] font-extrabold text-white bg-green-600 rounded-full px-4 py-2 min-h-[40px] card-hover disabled:opacity-50"
      >
        ✓ Done
      </button>
      {error && !open && <span className="block text-red-700 text-xs mt-1">{error}</span>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="absolute inset-0 bg-black/60" onClick={close} />
          <div className="relative card w-full max-w-sm p-5 fade-in max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-extrabold text-[17px]">Finish haircut ✂️</h3>
              <button
                onClick={close}
                aria-label="Close"
                className="w-9 h-9 shrink-0 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-600 font-bold text-[15px] leading-none"
              >
                ✕
              </button>
            </div>
            <p className="text-[13px] text-neutral-500 mb-4">
              Take a photo of the finished haircut — <b>your payout is sent when the photo is taken</b>.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={pickPhoto}
              className="hidden"
            />
            {preview ? (
              <div className="relative rounded-2xl overflow-hidden border-2 border-gold/50">
                <img src={preview} alt="Finished haircut" className="w-full max-h-[260px] object-cover" />
                <button
                  onClick={() => { setPhoto(null); setPreview(null); }}
                  className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 text-white font-bold text-[15px]"
                  aria-label="Retake photo"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-2xl border-2 border-dashed border-gold/50 bg-[#f7f2e2] py-10 text-center card-hover"
              >
                <div className="text-[36px]">📷</div>
                <p className="text-[14px] font-bold text-gold mt-1">Take a photo</p>
                <p className="text-[12px] text-neutral-500 mt-0.5">Opens your camera directly</p>
              </button>
            )}
            {error && (
              <p className="text-[13px] text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-3.5 py-2.5 mt-3 text-center leading-relaxed">
                {error}
              </p>
            )}
            <button
              onClick={() => void confirm()}
              disabled={busy || !photo}
              className="gold-btn rounded-2xl w-full font-extrabold text-[15px] py-3.5 mt-4 disabled:opacity-50"
            >
              {busy ? 'Sending…' : '✓ Confirm & get paid'}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
const WORK_HOURS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-gold">
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} size={13} className={i <= Math.round(rating) ? '' : 'opacity-25'} />
      ))}
    </span>
  );
}

export default function BarberDashboard() {
  const router = useRouter();
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState('');
  const [earnings, setEarnings] = useState<{ today: number; week: number; month: number } | null>(null);
  const [hoursForm, setHoursForm] = useState<Record<string, string[]>>({});
  const [hoursInit, setHoursInit] = useState(false);
  const [hoursBusy, setHoursBusy] = useState(false);
  const [hoursMsg, setHoursMsg] = useState('');
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [chatBooking, setChatBooking] = useState<ScheduleBooking | null>(null);
  const [teamUnread, setTeamUnread] = useState(0);
  const [teamChatOpen, setTeamChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);

  const loadTeamUnread = useCallback(() => {
    const token = localStorage.getItem('mrc_barber_token');
    if (!token) return;
    fetch('/api/team-chat/unread', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setTeamUnread(typeof d.unread === 'number' ? d.unread : 0))
      .catch(() => {});
  }, []);

  const loadUnread = useCallback(() => {
    const token = localStorage.getItem('mrc_barber_token');
    if (!token) return;
    fetch('/api/chats/unread', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setUnread(d.unread || {}))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    const token = localStorage.getItem('mrc_barber_token');
    if (!token) {
      router.replace('/barber');
      return;
    }
    fetch('/api/barber/schedule', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (r.status === 401) {
          localStorage.removeItem('mrc_barber_token');
          router.replace('/barber');
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch(() => setError('Could not load schedule.'));
  }, [router]);

  const loadEarnings = useCallback(() => {
    const token = localStorage.getItem('mrc_barber_token');
    if (!token) return;
    fetch('/api/barber/earnings', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.earnings) setEarnings(d.earnings);
      })
      .catch(() => {});
  }, []);

  const reloadAll = useCallback(() => {
    load();
    loadEarnings();
  }, [load, loadEarnings]);

  useEffect(() => {
    load();
    loadEarnings();
    loadUnread();
    loadTeamUnread();
    const t = setInterval(loadTeamUnread, 30000);
    return () => clearInterval(t);
  }, [load, loadEarnings, loadUnread, loadTeamUnread]);

  useEffect(() => {
    if (data && !hoursInit) {
      const f: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(data.workingHours ?? {})) {
        if (Array.isArray(v) && v.length) f[k] = [...v];
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHoursForm(f);
      setHoursInit(true);
    }
  }, [data, hoursInit]);

  function toggleDay(num: string) {
    const isOpen = !!hoursForm[num];
    // Shop policy: at most 2 days off per week (min 5 open days).
    if (isOpen && Object.keys(hoursForm).length <= 5) {
      setHoursMsg('You can take at most 2 days off per week.');
      return;
    }
    setHoursForm((f) => {
      const n = { ...f };
      if (n[num]) delete n[num];
      else n[num] = [...WORK_HOURS];
      return n;
    });
    setHoursMsg('');
  }

  function toggleHour(num: string, hour: string) {
    const cur = hoursForm[num] || [];
    // Shop policy: at least 6 working hours on each open day.
    if (cur.includes(hour) && cur.length <= 6) {
      setHoursMsg('Work at least 6 hours on each open day.');
      return;
    }
    setHoursForm((f) => {
      const cur2 = f[num] || [];
      const n = { ...f };
      n[num] = cur2.includes(hour) ? cur2.filter((h) => h !== hour) : [...cur2, hour].sort();
      return n;
    });
    setHoursMsg('');
  }

  async function saveHours() {
    setHoursMsg('');
    setHoursBusy(true);
    try {
      const r = await fetch('/api/barber/hours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${barberToken()}` },
        body: JSON.stringify({ workingHours: hoursForm }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not save hours.');
      setData((d) => (d ? { ...d, workingHours: j.workingHours } : d));
      setHoursMsg('Saved — customers can now book you only during your open hours.');
    } catch (e) {
      setHoursMsg(e instanceof Error ? e.message : 'Could not save hours.');
    }
    setHoursBusy(false);
  }

  function barberToken() {
    return localStorage.getItem('mrc_barber_token') || '';
  }

  // Optimistic local updates: the mutation responses are authoritative, so the
  // schedule updates instantly without waiting on a re-fetch (blob reads can
  // lag briefly behind overwrites).
  function markCancelledLocal(id: string) {
    setData((d) => d && ({
      ...d,
      today: d.today.map((b) => (b.id === id ? { ...b, status: 'cancelled' as const } : b)),
      upcoming: d.upcoming.map((b) => (b.id === id ? { ...b, status: 'cancelled' as const } : b)),
    }));
  }
  function markNoShowLocal(id: string) {
    setData((d) => d && ({
      ...d,
      today: d.today.map((b) => (b.id === id ? { ...b, status: 'no_show' as const } : b)),
      upcoming: d.upcoming.map((b) => (b.id === id ? { ...b, status: 'no_show' as const } : b)),
    }));
  }
  function markDoneLocal(id: string, payoutAmount: number) {
    setData((d) => d && ({
      ...d,
      today: d.today.map((b) => (b.id === id ? { ...b, completedAt: new Date().toISOString(), payoutAmount } : b)),
      upcoming: d.upcoming.map((b) => (b.id === id ? { ...b, completedAt: new Date().toISOString(), payoutAmount } : b)),
    }));
  }
  function removeBookingLocal(id: string) {
    setData((d) => d && ({
      ...d,
      today: d.today.filter((b) => b.id !== id),
      upcoming: d.upcoming.filter((b) => b.id !== id),
    }));
  }

  function logout() {
    localStorage.removeItem('mrc_barber_token');
    localStorage.removeItem('mrc_barber_name');
    router.replace('/barber');
  }

  if (error) return <main className="flex-1 p-6 text-center text-red-700">{error}</main>;
  if (!data) return <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full"><BarberDashboardSkeleton /></main>;

  const next = data.upcoming.find((b) => b.status === 'booked');

  return (
    <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full fade-in">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold tracking-[0.32em] uppercase text-gold">Barber dashboard</p>
          <h1 className="mt-1.5 text-[32px] leading-tight font-extrabold tracking-tight text-[#141414]">{data.barberName}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShopOpen(true)}
            className="w-10 h-10 rounded-full bg-white border border-gold/40 flex items-center justify-center text-[18px] card-hover"
            aria-label="Supply shop"
            title="Supply shop"
          >
            🛒
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-10 h-10 rounded-full bg-white border border-gold/40 flex items-center justify-center text-neutral-700 card-hover relative"
            aria-label="Settings"
          >
            <GearIcon size={20} />
            {teamUnread > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-extrabold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {teamUnread}
              </span>
            )}
          </button>
          <button onClick={logout} className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-gold transition-colors">
            <LogOutIcon size={16} /> Log out
          </button>
        </div>
      </div>

      <div className="mt-5 card p-4 border-gold/50 !bg-gradient-to-b !from-[#fffdf6] !to-[#faf3df]">
        <CollectScanner getToken={barberToken} onCollected={reloadAll} />
        <p className="text-[12px] text-neutral-500 text-center mt-2 leading-relaxed">
          Before starting the haircut, scan the customer&apos;s payment code to collect the remaining balance.
        </p>
      </div>

      <div
        className="mt-4 rounded-3xl p-5 relative overflow-hidden border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]"
        style={{ background: 'linear-gradient(135deg, #fdf8ea 0%, #f6ead0 100%)' }}
      >
        <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-gold">My earnings</p>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          {[
            { label: 'Today', value: earnings?.today },
            { label: 'This week', value: earnings?.week },
            { label: 'This month', value: earnings?.month },
          ].map((e) => (
            <div key={e.label}>
              <div className="text-[19px] font-extrabold text-gold-dark">{e.value != null ? `$${e.value.toFixed(2)}` : '—'}</div>
              <div className="text-[10px] text-neutral-500 uppercase tracking-[0.12em] mt-0.5 font-semibold">{e.label}</div>
            </div>
          ))}
        </div>
        <p className="text-[10.5px] text-white/40 mt-3">Paid haircuts · plan haircuts count $30 each</p>
      </div>

      <div className="grid grid-cols-4 gap-2.5 mt-5">
        {[
          { label: 'Today', value: data.metrics.todayCount },
          { label: 'Bookings', value: data.metrics.totalBookings },
          { label: 'Reviews', value: data.metrics.reviewCount },
          { label: 'Rating', value: data.metrics.avgRating !== null ? data.metrics.avgRating.toFixed(1) : '—' },
        ].map((m) => (
          <div key={m.label} className="card p-3 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
            <div className="text-[22px] font-extrabold text-[#141414] leading-tight">{m.value}</div>
            <div className="text-[10px] text-neutral-500 uppercase tracking-[0.14em] mt-1 font-semibold">{m.label}</div>
          </div>
        ))}
      </div>

      <h2 className="font-extrabold mt-7 mb-3 text-[18px] tracking-tight text-[#141414]">My working hours</h2>
      <div className="card p-5">
        <p className="text-[12px] text-neutral-500 leading-relaxed mb-4">
          Shop policy: at most <b className="text-neutral-700">2 days off</b> per week, and at least <b className="text-neutral-700">6 hours</b> on each working day.
        </p>
        {!data.workingHours && (
          <p className="text-sm text-neutral-600 leading-relaxed mb-4">
            You haven&apos;t set your hours yet — customers can currently book you at any time. Tap the hours you work each day, then save. You decide, hour by hour.
          </p>
        )}
        <div className="grid gap-2">
          {WEEKDAYS.map((w) => {
            const selected = hoursForm[w.num] || [];
            const open = selected.length > 0;
            return (
              <div
                key={w.num}
                className={`rounded-xl border px-3 py-2.5 transition-colors ${
                  open ? 'border-[#dccfae] bg-[#fbf7ea]' : 'border-[#e6dabf] bg-[#f7f2e2]/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-10 text-sm font-extrabold text-[#141414]">{w.label}</span>
                  <button
                    onClick={() => toggleDay(w.num)}
                    className={`px-3.5 py-1.5 rounded-full text-[13px] font-bold min-h-[36px] transition-all ${
                      open
                        ? 'bg-[#1c1a15] text-white shadow-[0_4px_12px_rgba(0,0,0,0.18)]'
                        : 'bg-[#ece2c9] text-neutral-500'
                    }`}
                  >
                    {open ? 'Open' : 'Closed'}
                  </button>
                  {open && <span className="ml-auto text-xs text-neutral-500 font-semibold">{selected.length} {selected.length === 1 ? 'hr' : 'hrs'}</span>}
                </div>
                {open && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {WORK_HOURS.map((h) => {
                      const on = selected.includes(h);
                      return (
                        <button
                          key={h}
                          onClick={() => toggleHour(w.num, h)}
                          className={`px-3 py-2 rounded-xl border text-[13px] font-bold min-h-[40px] transition-all ${
                            on
                              ? 'border-[#1c1a15] bg-[#1c1a15] text-white shadow-[0_4px_12px_rgba(0,0,0,0.18)]'
                              : 'border-[#dccfae] bg-[#f4edda] text-neutral-600'
                          }`}
                        >
                          {fmtTime(h)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {hoursMsg && (
          <p className={`text-sm mt-3 px-4 py-2.5 rounded-xl border leading-relaxed ${
            hoursMsg.startsWith('Saved')
              ? 'text-green-800 bg-green-600/10 border-green-600/25'
              : 'text-red-700 bg-red-600/10 border-red-600/25'
          }`}>{hoursMsg}</p>
        )}
        <button onClick={saveHours} disabled={hoursBusy} className="gold-btn rounded-2xl px-6 py-3 mt-4 text-[15px] w-full sm:w-auto">
          {hoursBusy ? 'Saving…' : 'Save my hours'}
        </button>
      </div>

      {next && (
        <div className="card card-selected p-5 mt-5 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
          <div className="label !mb-2 !text-gold/90">Next appointment</div>
          <div className="flex items-center gap-3">
            <CustomerAvatar b={next} size={44} />
            <div className="min-w-0">
              <div className="font-extrabold text-xl tracking-tight text-[#141414] truncate">{next.customerName}</div>
              <div className="text-sm text-neutral-600 mt-0.5">{next.customerPhone}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-neutral-700 mt-2">
            <CalendarIcon size={14} className="text-gold" /> {next.date}
            <span className="text-neutral-600">·</span>
            <ClockIcon size={14} className="text-gold" /> {next.time}
            <span className="text-neutral-600">·</span> {next.serviceName}
          </div>
          <PayState b={next} />
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <ChatBtn label={`Chat with ${next.customerName}`} unreadCount={unread[next.id] ?? 0} onOpen={() => setChatBooking(next)} />
            <CancelBookingButton bookingId={next.id} getToken={barberToken} onCancelled={() => markCancelledLocal(next.id)} />
          </div>
        </div>
      )}

      <h2 className="font-extrabold mt-7 mb-3 text-[18px] tracking-tight text-[#141414]">Today&apos;s schedule</h2>
      {data.today.length === 0 && (
        <div className="card p-6 text-center"><p className="text-sm text-neutral-500">Nothing booked today.</p></div>
      )}
      <div className="grid gap-2.5">
        {data.today.map((b) => b.status !== 'booked' ? (
          <div key={b.id} className="card p-4 opacity-55">
            <div className="flex items-center gap-4">
              <span className="text-neutral-500 font-bold text-[15px] w-14 shrink-0">{b.time}</span>
              <span className="h-10 w-px bg-neutral-300 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-[15px] text-neutral-500 line-through">{b.customerName}</span>
                <span className="block text-sm text-neutral-400 truncate">{b.serviceName} · {b.customerPhone}</span>
              </span>
              {b.status === 'cancelled' ? <CancelledLabel /> : <NoShowLabel />}
            </div>
            <div className="mt-1 ml-[4.5rem]">
              <DeleteBookingButton bookingId={b.id} getToken={barberToken} onDeleted={() => removeBookingLocal(b.id)} />
            </div>
          </div>
        ) : (
          <div key={b.id} className="card p-4">
            <div className="flex items-center gap-4">
              <span className="text-gold font-bold text-[15px] w-14 shrink-0">{b.time}</span>
              <span className="h-10 w-px bg-gold/15 shrink-0" />
              <span className="min-w-0 flex-1 flex items-center gap-2.5">
                <CustomerAvatar b={b} size={34} />
                <span className="min-w-0">
                  <span className="block font-bold text-[15px] text-[#141414] truncate">{b.customerName}</span>
                  <span className="block text-sm text-neutral-600 truncate">{b.serviceName} · {b.customerPhone}</span>
                </span>
                <PayState b={b} />
                {b.completedAt && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-green-700 bg-green-600/10 border border-green-600/30 rounded-full px-2.5 py-1 shrink-0">
                    ✓ Done{b.payoutAmount ? ` · $${b.payoutAmount.toFixed(2)}` : ''}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 ml-[4.5rem] flex items-center gap-5 flex-wrap">
              {b.status === 'booked' && !b.completedAt && (
                <DoneButton bookingId={b.id} token={barberToken()} onDone={(amt) => markDoneLocal(b.id, amt)} />
              )}
              <NoShowButton bookingId={b.id} getToken={barberToken} onMarked={() => markNoShowLocal(b.id)} />
              <CancelBookingButton bookingId={b.id} getToken={barberToken} onCancelled={() => markCancelledLocal(b.id)} />
              <ChatBtn label="Chat" unreadCount={unread[b.id] ?? 0} onOpen={() => setChatBooking(b)} />
            </div>
          </div>
        ))}
      </div>

      <h2 className="font-extrabold mt-7 mb-3 text-[18px] tracking-tight text-[#141414]">Upcoming</h2>
      {data.upcoming.length === 0 && (
        <div className="card p-6 text-center"><p className="text-sm text-neutral-500">No upcoming bookings.</p></div>
      )}
      <div className="grid gap-2.5">
        {data.upcoming.slice(0, 10).map((b) => b.status !== 'booked' ? (
          <div key={b.id} className="card p-4 opacity-55">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[15px] text-neutral-500 line-through">{b.date} · {b.time}</span>
              {b.status === 'cancelled' ? <CancelledLabel /> : <NoShowLabel />}
            </div>
            <span className="block text-sm text-neutral-400 mt-0.5">{b.customerName} — {b.serviceName}</span>
            <div className="mt-1">
              <DeleteBookingButton bookingId={b.id} getToken={barberToken} onDeleted={() => removeBookingLocal(b.id)} />
            </div>
          </div>
        ) : (
          <div key={b.id} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[15px]">{b.date} · <span className="text-gold">{b.time}</span></span>
            </div>
            <span className="block text-sm text-neutral-600 mt-0.5">{b.customerName} — {b.serviceName}</span>
            <PayState b={b} />
            <div className="mt-1 flex items-center gap-5 flex-wrap">
              <NoShowButton bookingId={b.id} getToken={barberToken} onMarked={() => markNoShowLocal(b.id)} />
              <CancelBookingButton bookingId={b.id} getToken={barberToken} onCancelled={() => markCancelledLocal(b.id)} />
              <ChatBtn label="Chat" unreadCount={unread[b.id] ?? 0} onOpen={() => setChatBooking(b)} />
            </div>
          </div>
        ))}
      </div>

      <BarberTasks getToken={barberToken} />

      <h2 className="font-extrabold mt-7 mb-3 text-[18px] tracking-tight text-[#141414]">🏆 Leaderboard</h2>
      <Leaderboard apiBase="/api/barber/leaderboard" getToken={barberToken} />

      <h2 className="font-extrabold mt-7 mb-3 text-[18px] tracking-tight text-[#141414]">Reviews</h2>      {data.reviews.length === 0 && (
        <div className="card p-6 text-center"><p className="text-sm text-neutral-500">No reviews yet.</p></div>
      )}
      <div className="grid gap-2.5">
        {data.reviews.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex justify-between items-center text-sm">
              <b className="text-[#141414]">{r.customerName}</b>
              <Stars rating={r.rating} />
            </div>
            <p className="text-sm text-neutral-700 mt-1.5 leading-relaxed">{r.text}</p>
          </div>
        ))}
      </div>

      {chatBooking && (
        <ChatModal
          bookingId={chatBooking.id}
          title={`Chat with ${chatBooking.customerName}`}
          subtitle={`${chatBooking.date} · ${fmtTime(chatBooking.time)}`}
          me="barber"
          getToken={barberToken}
          onClose={() => {
            setChatBooking(null);
            loadUnread();
          }}
        />
      )}

      {teamChatOpen && (
        <TeamChatModal
          getToken={barberToken}
          onClose={() => {
            setTeamChatOpen(false);
            loadTeamUnread();
          }}
        />
      )}

      {shopOpen && (
        <ShopModal onClose={() => setShopOpen(false)} getToken={barberToken} />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          getToken={barberToken}
          teamUnread={teamUnread}
          onOpenTeamChat={() => {
            setSettingsOpen(false);
            setTeamChatOpen(true);
          }}
        />
      )}

    </main>
  );
}
