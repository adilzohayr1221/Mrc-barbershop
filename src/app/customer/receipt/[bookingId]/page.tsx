'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useCustomerAuth } from '@/components/CustomerAuth';
import { ArrowLeftIcon, ShareIcon, PrintIcon, CheckSealIcon } from '@/components/Icons';

interface ReceiptBooking {
  id: string;
  date: string;
  time: string;
  status: string;
  createdAt: string;
  customerName: string;
  barberName: string;
  serviceName: string;
  price: number | null;
  branchName: string;
  branchAddress: string;
  salonName: string;
  paymentStatus: string | null;
  depositPaid: number | null;
  remaining: number | null;
  membership: 'pending' | 'redeemed' | null;
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtIssued(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ReceiptPage() {
  const { checked, token } = useCustomerAuth();
  const params = useParams();
  const router = useRouter();
  const bookingId = typeof params.bookingId === 'string' ? params.bookingId : '';
  const [booking, setBooking] = useState<ReceiptBooking | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!checked || !token || !bookingId) return;
    fetch(`/api/customer/bookings?include=${encodeURIComponent(bookingId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const b = (d?.bookings || []).find((x: ReceiptBooking) => x.id === bookingId) || null;
        setBooking(b);
        setNotFound(!b);
      })
      .catch(() => setNotFound(true));
  }, [checked, token, bookingId]);

  if (!checked) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <div className="card p-10 text-center text-neutral-500">Loading…</div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <div className="card p-10 mt-10 text-center">
          <p className="font-bold text-lg">Receipt not found</p>
          <p className="page-sub mt-1">This booking is no longer available.</p>
          <Link href="/customer/appointments" className="gold-btn rounded-2xl px-8 py-3 inline-block mt-6 text-[15px]">
            My appointments
          </Link>
        </div>
      </main>
    );
  }

  if (!booking) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <div className="card p-10 text-center text-neutral-500">Loading receipt…</div>
      </main>
    );
  }

  const bookingData = booking as ReceiptBooking;
  const receiptNo = `MRC-${bookingData.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const price = bookingData.price ?? 0;
  const deposit = bookingData.depositPaid ?? 0;
  const remaining = bookingData.remaining ?? Math.max(0, price - deposit);
  const viaPlan = bookingData.membership !== null;

  async function share() {
    const text =
      `${bookingData.salonName} — Receipt ${receiptNo}\n` +
      `${bookingData.serviceName} with ${bookingData.barberName}\n` +
      `${fmtDate(bookingData.date)} at ${bookingData.time}\n` +
      (viaPlan ? `Paid via monthly plan` : `Deposit paid: $${deposit.toFixed(2)}${remaining > 0.005 ? ` · Due at shop: $${remaining.toFixed(2)}` : ''}`);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Receipt ${receiptNo}`, text });
      } else {
        await navigator.clipboard.writeText(text);
        alert('Receipt copied.');
      }
    } catch {
      /* user cancelled */
    }
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
      <button onClick={() => router.back()} className="back-link">
        <ArrowLeftIcon size={16} /> Back
      </button>

      {/* Paper receipt */}
      <div className="card mt-4 overflow-hidden fade-in">
        <div className="bg-gradient-to-b from-[#f7efdc] to-[#fbf7ea] px-6 pt-7 pb-5 text-center border-b-2 border-dashed border-[#d9c793]">
          <Image src="/logo.jpg" alt="" width={56} height={56} className="hero-logo mx-auto" />
          <h1 className="font-extrabold text-xl mt-3 tracking-wide">{bookingData.salonName}</h1>
          <p className="text-[13px] text-neutral-500 mt-0.5">{bookingData.branchAddress}</p>
          <p className="text-[13px] font-bold text-gold mt-2 tracking-[0.2em]">RECEIPT</p>
        </div>

        <div className="px-6 py-5 text-[14px]">
          <div className="flex justify-between text-neutral-500 text-[13px]">
            <span>Receipt no.</span>
            <b className="text-neutral-800">{receiptNo}</b>
          </div>
          <div className="flex justify-between text-neutral-500 text-[13px] mt-1.5">
            <span>Issued</span>
            <b className="text-neutral-800">{fmtIssued(booking.createdAt)}</b>
          </div>
          <div className="flex justify-between text-neutral-500 text-[13px] mt-1.5">
            <span>Customer</span>
            <b className="text-neutral-800">{bookingData.customerName}</b>
          </div>

          <div className="border-t-2 border-dashed border-[#e6dabf] my-4" />

          <div className="flex justify-between gap-3">
            <div className="min-w-0">
              <b>{bookingData.serviceName}</b>
              <p className="text-neutral-500 text-[13px] mt-0.5">
                with {bookingData.barberName} · {fmtDate(booking.date)} at {bookingData.time}
              </p>
              <p className="text-neutral-500 text-[13px]">{bookingData.branchName}</p>
            </div>
            <b className="shrink-0">${price.toFixed(2)}</b>
          </div>

          <div className="border-t-2 border-dashed border-[#e6dabf] my-4" />

          {viaPlan ? (
            <div className="flex justify-between font-bold">
              <span>Paid via monthly plan</span>
              <span className="text-gold">$0.00 due</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-neutral-600">
                <span>Deposit paid</span>
                <span className="font-semibold text-neutral-800">${deposit.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-neutral-600 mt-1.5">
                <span>Due at the shop</span>
                <span className="font-semibold text-neutral-800">${remaining.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-extrabold text-[16px] mt-2.5">
                <span>Total</span>
                <span className="text-gold">${price.toFixed(2)}</span>
              </div>
            </>
          )}

          <div className="border-t-2 border-dashed border-[#e6dabf] my-4" />
          <p className="text-center text-neutral-500 text-[13px]">
            <CheckSealIcon size={18} className="inline-block -mt-0.5 mr-1" />
            Thank you — we&apos;ll see you soon.
          </p>
        </div>
      </div>

      <div className="flex gap-3 mt-5 no-print">
        <button onClick={share} className="gold-btn rounded-2xl px-6 py-3.5 text-[15px] flex-1 inline-flex items-center justify-center gap-2">
          <ShareIcon size={16} /> Share
        </button>
        <button onClick={() => window.print()} className="gold-outline-btn rounded-2xl px-6 py-3.5 text-[15px] flex-1 inline-flex items-center justify-center gap-2">
          <PrintIcon size={16} /> Print
        </button>
      </div>
    </main>
  );
}
