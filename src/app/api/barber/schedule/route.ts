import { NextResponse } from 'next/server';
import { listBookings, listReviews, getServices, getBarbers, getCustomers, inSalon } from '@/lib/store';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';

export const dynamic = 'force-dynamic';

// Barber-only: today's schedule, next appointment, metrics, reviews.
// Customer PII is returned ONLY here, after the barber's PIN was verified.
export async function GET(req: Request) {
  const session = requireBarber(req);
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
  const today = new Date().toISOString().slice(0, 10);
  const todayList = mine.filter((b) => b.date === today);
  const upcoming = mine.filter((b) => b.date + b.time >= today + '00:00').slice(0, 20);
  const barberReviews = myReviews.filter((r) => r.barberId === session.barberId);
  const serviceMap = new Map(myServices.map((s) => [s.id, s]));
  const photoMap = new Map(
    myCustomers.map((c) => [
      c.id,
      c.photoPath ? `/api/photos/${encodeURIComponent(c.photoPath.split('/').pop() || '')}` : null,
    ])
  );

  // Never leak the single-use collect token or Stripe customer/payment
  // method ids to clients — the barber receives the token only by scanning
  // the customer's QR code.
  const safe = (b: (typeof mine)[number]) => {
    const { collectToken, collectTokenExpiry, stripeCustomerId, stripePaymentMethodId, ...rest } = b;
    return {
      ...rest,
      serviceName: serviceMap.get(b.serviceId)?.name ?? '',
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
