import { NextResponse } from 'next/server';
import { getSalon, getBarbers, listBookings, inSalon } from '@/lib/store';
import { sessionSalonId } from '@/lib/auth';
import { requireActiveSalonOwner } from '@/lib/guard';
import { summarizeEarnings, shopToday } from '@/lib/earnings';
import { yearlyMembershipIdsIn } from '@/lib/membership';

export const dynamic = 'force-dynamic';

// Salon-owner: my salon's profile + quick stats.
export async function GET(req: Request) {
  const session = await requireActiveSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const salon = await getSalon(salonId);
  if (!salon) return NextResponse.json({ error: 'Salon not found.' }, { status: 404 });

  const [barbers, bookings] = await Promise.all([getBarbers(), listBookings()]);
  const myBarbers = barbers.filter((b) => inSalon(b, salonId));
  const myBookings = bookings.filter((b) => inSalon(b, salonId));
  const today = shopToday();
  const upcomingBookings = myBookings.filter(
    (b) => b.status === 'booked' && b.date >= today
  ).length;
  const yearlyIds = await yearlyMembershipIdsIn(myBookings);
  const monthEarnings = summarizeEarnings(myBookings, today, false, yearlyIds).month;

  return NextResponse.json({
    salon,
    stats: {
      barberCount: myBarbers.filter((b) => b.active).length,
      upcomingBookings,
      monthEarnings,
    },
  });
}
