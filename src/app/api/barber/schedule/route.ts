import { NextResponse } from 'next/server';
import { signPhotoUrl } from '@/lib/auth';
import { listBookings, listReviews, getServices, getBarbers, getCustomers, inSalon } from '@/lib/store';
import { requireActiveBarber } from '@/lib/guard';
import { barberSalonId } from '@/lib/salonScope';
import { shopToday } from '@/lib/earnings';
import { VIP_BARBER_PAYOUT_USD, vipPeopleOf } from '@/lib/vip';

export const dynamic = 'force-dynamic';

// Barber-only: today's schedule, next appointment, metrics, reviews.
// Customer PII is returned ONLY here, after the barber's PIN was verified.
export async function GET(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session || !session.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = await barberSalonId(session);

  const [bookings, reviews, services, barbers, customers] = await Promise.all([
    listBookings(),
    listReviews(),
    getServices(),
    getBarbers(),
    getCustomers(),
  ]);
  const myBookings = bookings.filter((b) => inSalon(b, salonId));
  const myReviews = reviews.filter((r) => inSalon(r, salonId));
  const myServices = services.filter((s) => inSalon(s, salonId));
  const myCustomers = customers.filter((c) => inSalon(c, salonId));
  const barber = barbers.find((b) => b.id === session.barberId);
  const mine = myBookings.filter((b) => b.barberId === session.barberId);
  // Shop-local "today" (America/New_York) — UTC here made evening bookings
  // vanish from the barber's schedule after 8 PM Eastern.
  const today = shopToday();
  const todayList = mine.filter((b) => b.date === today);
  // Audit L7 (2026-10-22): sort upcoming chronologically BEFORE capping —
  // unsorted storage order could push a nearer appointment past the cap.
  const upcoming = mine
    .filter((b) => b.date + b.time >= today + '00:00')
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .slice(0, 20);
  const barberReviews = myReviews.filter((r) => r.barberId === session.barberId);
  const serviceMap = new Map(myServices.map((s) => [s.id, s]));
  const photoMap = new Map(
    myCustomers.map((c) => [
      c.id,
      c.photoPath ? signPhotoUrl(c.photoPath.split('/').pop() || '') : null,
    ])
  );

  // Never leak the single-use collect token or Stripe customer/payment
  // method ids to clients — the barber receives the token only by scanning
  // the customer's QR code.
  const safe = (b: (typeof mine)[number]) => {
    // Audit L7 (2026-10-22): also strip the Stripe payment-intent ids and
    // refund bookkeeping — a leaked PI id is exactly what payment-reuse
    // attacks need, and the barber's device never needs them.
    const { collectToken, collectTokenExpiry, stripeCustomerId, stripePaymentMethodId, amountPaid, paymentIntentId, remainingPaymentIntentId, refundedLegs, ...rest } = b;
    return {
      ...rest,
      // The barber only ever sees his own share of the money: for a VIP home
      // visit the collected total ($100 per person) never reaches his
      // device — the payload carries his $60-per-person share instead.
      amountPaid: b.houseCall
        ? Math.min(VIP_BARBER_PAYOUT_USD * vipPeopleOf(b), amountPaid ?? 0)
        : amountPaid,
      serviceName: b.houseCall ? 'VIP Home Visit' : (serviceMap.get(b.serviceId)?.name ?? ''),
      servicePrice: serviceMap.get(b.serviceId)?.price ?? null,
      customerPhotoUrl: b.customerId ? photoMap.get(b.customerId) ?? null : null,
    };
  };

  return NextResponse.json({
    barberName: barber?.name ?? '',
    workingHours: barber?.workingHours ?? null,
    today: todayList.map(safe),
    upcoming: upcoming.map(safe),
    metrics: {
      totalBookings: mine.length,
      todayCount: todayList.length,
      reviewCount: barberReviews.length,
      avgRating: barberReviews.length
        ? Math.round((barberReviews.reduce((s, r) => s + r.rating, 0) / barberReviews.length) * 10) / 10
        : null,
    },
    reviews: barberReviews,
  });
}
