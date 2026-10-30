import { NextResponse } from 'next/server';
import { listBookings, getBooking, getBarbers, getServices, getBranches, getSalon, salonOf } from '@/lib/store';

import { requireActiveCustomer } from "@/lib/guard";
import { remainingFor } from '@/lib/stripe';
import { PLATFORM_SALON_ID } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Customer-only: the logged-in customer's OWN bookings. Scoping is enforced
// server-side — a customer can never see another customer's bookings.
//
// Optional `?include=<bookingId>`: right after booking, Blob list() (used by
// listBookings) is eventually consistent and the new file may lag in listings.
// A direct getBooking() read of a new path is consistent immediately, so we
// merge that one booking in when it belongs to this customer.
export async function GET(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const include = new URL(req.url).searchParams.get('include')?.trim() || null;
  const [bookings, barbers, services, branches] = await Promise.all([
    listBookings(),
    getBarbers(),
    getServices(),
    getBranches(),
  ]);
  const mine = bookings.filter((b) => b.customerId === session.customerId);
  if (include && !mine.some((b) => b.id === include)) {
    const fresh = await getBooking(include);
    if (fresh && fresh.customerId === session.customerId) {
      mine.push(fresh);
    }
  }
  // The customer only ever sees UPCOMING appointments. Old ones vanish entirely:
  // no-show (deposit kept), cancelled, and past bookings never reach the
  // customer's app. Barber/owner views are unaffected (separate APIs).
  const visible = mine.filter((b) => b.status === 'booked');
  const barberMap = new Map(barbers.map((b) => [b.id, b.name]));
  const serviceMap = new Map(services.map((s) => [s.id, s]));
  const branchMap = new Map(branches.map((b) => [b.id, b]));
  // Salon names for receipts (multi-salon: a customer may book at any salon).
  const salonIds = [...new Set(mine.map((b) => salonOf(b)))];
  const salonNameMap = new Map<string, string>();
  await Promise.all(
    salonIds.map(async (sid) => {
      if (sid === PLATFORM_SALON_ID) {
        salonNameMap.set(sid, 'MRC Barbershops');
      } else {
        const s = await getSalon(sid);
        salonNameMap.set(sid, s?.name || 'Barbershop');
      }
    })
  );
  return NextResponse.json({
    bookings: visible.map((b) => {
      const price = serviceMap.get(b.serviceId)?.price ?? null;
      const isMembership = b.paymentStatus === 'membership_pending' || b.paymentStatus === 'membership_redeemed';
      return {
        id: b.id,
        date: b.date,
        time: b.time,
        status: b.status,
        createdAt: b.createdAt,
        customerName: b.customerName,
        barberName: barberMap.get(b.barberId) ?? '',
        serviceName: b.houseCall ? 'VIP Home Visit' : (serviceMap.get(b.serviceId)?.name ?? ''),
        // VIP home visits show the flat $100 package price agreed at booking.
        price: b.houseCall ? (b.servicePrice ?? price) : price,
        houseCall: b.houseCall === true,
        homeAddress: b.houseCall ? (b.homeAddress ?? null) : null,
        visitNotes: b.houseCall ? (b.visitNotes ?? null) : null,
        branchName: branchMap.get(b.branchId)?.name ?? '',
        branchAddress: branchMap.get(b.branchId)?.address ?? '',
        salonName: salonNameMap.get(salonOf(b)) ?? 'MRC Barbershops',
        // Payment state for in-shop collection of the remaining balance.
        paymentStatus: b.paymentStatus ?? null,
        depositPaid: b.amountPaid ?? null,
        remaining: isMembership ? 0 : price != null ? remainingFor(price, b.amountPaid) : null,
        hasSavedCard: !!(b.stripeCustomerId && b.stripePaymentMethodId),
        // True when the automatic charge of the remaining balance already
        // failed once — the customer then sees the payment-code fallback.
        balanceChargeFailed: b.paymentStatus === 'paid' && !!b.balanceChargeError,
        membership: isMembership ? (b.paymentStatus === 'membership_redeemed' ? 'redeemed' : 'pending') : null,
      };
    }),
  });
}
