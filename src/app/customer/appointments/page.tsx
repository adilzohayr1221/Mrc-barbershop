'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, CalendarIcon, MapPinIcon, ScissorsIcon, ClockIcon } from '@/components/Icons';
import { BranchPageSkeleton } from '@/components/Loading';
import { useCustomerAuth } from '@/components/CustomerAuth';
import { CollectCodeButton } from '@/components/CollectCodeButton';
import { ChatModal } from '@/components/ChatModal';
import { ReportProblemButton } from '@/components/ReportProblemButton';

interface MyBooking {
  id: string;
  date: string;
  time: string;
  status: 'booked';
  customerName: string;
  barberName: string;
  serviceName: string;
  price: number | null;
  branchName: string;
  branchAddress: string;
  paymentStatus: 'paid' | 'refunded' | 'paid_in_full' | null;
  depositPaid: number | null;
  remaining: number | null;
  hasSavedCard: boolean;
  membership: 'pending' | 'redeemed' | null;
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtShort(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function BookingCard({ b, getToken, unread, onChat }: { b: MyBooking; getToken: () => string; unread: number; onChat: () => void }) {
  const inactive = b.status !== 'booked';
  const remaining = b.remaining ?? 0;
  const showCode = !inactive && remaining > 0 && b.hasSavedCard;
  const payAtShop = !inactive && remaining > 0 && !b.hasSavedCard;
  const paidInFull = !inactive && b.paymentStatus === 'paid_in_full';
  const planPending = !inactive && b.membership === 'pending';
  const planRedeemed = !inactive && b.membership === 'redeemed';
  return (
    <div className={`card p-4 min-w-0 ${inactive ? 'opacity-60' : ''}`}>
      <div className="flex justify-between items-center gap-2 min-w-0">
        <b className={`text-[15px] min-w-0 ${inactive ? 'text-neutral-500 line-through' : ''}`}>
          {b.serviceName}{b.price != null && <span className="text-gold font-semibold"> · ${b.price}</span>}
        </b>
        {paidInFull ? (
          <span className="chip !border-green-600/40 !text-green-700 shrink-0">Paid in full</span>
        ) : planRedeemed ? (
          <span className="chip !border-green-600/40 !text-green-700 shrink-0">Paid via plan</span>
        ) : planPending ? (
          <span className="chip !border-gold/60 !text-gold shrink-0">Monthly plan</span>
        ) : (
          <span className="chip shrink-0">{fmtShort(b.date)} · {b.time}</span>
        )}
      </div>
      <div className={`text-sm mt-1.5 ${inactive ? 'text-neutral-400' : 'text-neutral-600'}`}>
        <span className="inline-flex items-center gap-1"><ScissorsIcon size={13} className="text-gold/70" /> {b.barberName}</span>
        {' · '}
        <span className="inline-flex items-center gap-1"><ClockIcon size={13} className="text-gold/70" /> {fmtDate(b.date)} at {b.time}</span>
      </div>
      <div className={`text-xs mt-1 flex items-center gap-1 ${inactive ? 'text-neutral-400' : 'text-neutral-500'}`}>
        <MapPinIcon size={12} className="text-gold/60 shrink-0" />
        <span className="truncate">{b.branchName} — {b.branchAddress}</span>
      </div>
      {!inactive && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            onClick={onChat}
            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gold border border-gold/40 rounded-full px-3.5 py-2 min-h-[40px] card-hover"
          >
            💬 Chat with {b.barberName}
            {unread > 0 && (
              <span className="bg-red-600 text-white text-[10px] font-extrabold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {unread}
              </span>
            )}
          </button>
          <Link
            href={`/customer/receipt/${b.id}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gold border border-gold/40 rounded-full px-3.5 py-2 min-h-[40px] card-hover"
          >
            🧾 Receipt
          </Link>
        </div>
      )}
      {!inactive && (
        <ReportProblemButton bookingId={b.id} barberName={b.barberName} getToken={getToken} />
      )}
      {!inactive && b.depositPaid != null && remaining > 0 && (
        <p className="text-[13px] text-neutral-500 mt-2">
          Deposit paid <b className="text-neutral-700">${b.depositPaid.toFixed(2)}</b>
          {' · '}remaining <b className="text-gold">${remaining.toFixed(2)}</b>
        </p>
      )}
      {showCode && (
        <CollectCodeButton
          bookingId={b.id}
          serviceName={b.serviceName}
          remaining={remaining}
          getToken={getToken}
        />
      )}
      {planPending && (
        <p className="text-[13px] text-neutral-500 mt-2 bg-[#f7f2e2] border border-[#e6dabf] rounded-xl px-3 py-2">
          Covered by your <b className="text-gold">monthly plan</b> — show your membership code at the shop (Offers page).
        </p>
      )}
      {payAtShop && (
        <p className="text-[13px] text-neutral-500 mt-2 bg-[#f7f2e2] border border-[#e6dabf] rounded-xl px-3 py-2">
          Remaining <b className="text-gold">${remaining.toFixed(2)}</b> is paid at the shop.
        </p>
      )}
    </div>
  );
}

function MyAppointmentsInner() {
  const { checked, token } = useCustomerAuth();
  const searchParams = useSearchParams();
  // After a fresh booking the confirmation screen links here with ?new=<id>.
  // Passed through as ?include= so a just-created booking shows instantly
  // even if Blob list() hasn't caught up yet.
  const newId = searchParams.get('new')?.trim() || null;
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [chatBooking, setChatBooking] = useState<MyBooking | null>(null);

  useEffect(() => {
    if (!checked) return;
    const url = newId
      ? `/api/customer/bookings?include=${encodeURIComponent(newId)}`
      : '/api/customer/bookings';
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setBookings(d.bookings || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch('/api/chats/unread', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setUnread(d.unread || {}))
      .catch(() => {});
  }, [checked, token, newId]);

  if (!checked) {
    return (
      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        <BranchPageSkeleton />
      </main>
    );
  }

  const today = todayISO();
  const byDateTimeAsc = (a: MyBooking, b: MyBooking) => (a.date + a.time).localeCompare(b.date + b.time);
  // The customer only sees upcoming appointments — old ones (past, cancelled,
  // no-show) vanish entirely and are never rendered.
  // 1-hour grace: an appointment stays visible until 60 minutes after its start
  // time, then disappears from the customer's view (the $5 deposit is kept).
  const upcoming = bookings
    .filter((b) => {
      if (b.status !== 'booked') return false;
      const start = new Date(`${b.date}T${b.time}:00`).getTime();
      if (isNaN(start)) return b.date >= today; // fallback to date-only
      return start + 60 * 60 * 1000 > Date.now();
    })
    .sort(byDateTimeAsc);

  return (
    <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
      <Link href="/customer" className="back-link"><ArrowLeftIcon size={16} /> Branches</Link>
      <h1 className="page-title mt-3 mb-1"><span className="gold-text">My appointments</span></h1>
      <p className="page-sub mb-6">Your bookings, all in one place.</p>

      {loading ? (
        <BranchPageSkeleton />
      ) : upcoming.length === 0 ? (
        <div className="card p-10 text-center fade-in">
          <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold mb-4">
            <CalendarIcon size={26} />
          </div>
          <p className="font-bold text-[16px]">No appointments yet</p>
          <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
            Pick a branch and book your first cut — it will show up here.
          </p>
          <Link href="/customer" className="gold-btn rounded-2xl px-8 py-3 inline-block mt-6 text-[15px]">
            Book now
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 fade-in">
          {upcoming.length > 0 && (
            <section>
              <h2 className="label !mb-2.5">Upcoming</h2>
              <div className="grid gap-2.5">
                {upcoming.map((b) => (
                  <BookingCard key={b.id} b={b} getToken={() => token ?? ''} unread={unread[b.id] ?? 0} onChat={() => setChatBooking(b)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {chatBooking && (
        <ChatModal
          bookingId={chatBooking.id}
          title={`Chat with ${chatBooking.barberName}`}
          subtitle={`${fmtShort(chatBooking.date)} · ${chatBooking.time}`}
          me="customer"
          getToken={() => token ?? ''}
          onClose={() => {
            setChatBooking(null);
            // Refresh unread badges after closing the chat.
            fetch('/api/chats/unread', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
              .then((r) => r.json())
              .then((d) => setUnread(d.unread || {}))
              .catch(() => {});
          }}
        />
      )}

    </main>
  );
}

export default function MyAppointments() {
  return (
    <Suspense
      fallback={
        <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
          <BranchPageSkeleton />
        </main>
      }
    >
      <MyAppointmentsInner />
    </Suspense>
  );
}
