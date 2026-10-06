import { NextResponse } from 'next/server';
import { getSalon, getBarbers, listBookings, inSalon } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';
import { summarizeEarnings } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

// Salon-owner: my salon's profile + quick stats.
export async function GET(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const salon = await getSalon(salonId);
  if (!salon) return NextResponse.json({ error: 'Salon not found.' }, { status: 404 });

  const [barbers, bookings] = await Promise.all([getBarbers(), listBookings()]);
  const myBarbers = barbers.filter((b) => inSalon(b, salonId));
  const myBookings = bookings.filter((b) => inSalon(b, salonId));
  const today = new Date().toISOString().slice(0, 10);
  const upcomingBookings = myBookings.filter(
    (b) => b.status === 'booked' && b.date >= today
  ).length;
  const monthEarnings = summarizeEarnings(myBookings).month;

  return NextResponse.json({
    salon,
    stats: {
      barberCount: myBarbers.filter((b) => b.active).length,
      upcomingBookings,
      monthEarnings,
    },
  });
}
