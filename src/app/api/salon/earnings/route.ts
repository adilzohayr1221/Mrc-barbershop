import { NextResponse } from 'next/server';
import { listBookings, getBarbers, listGifts, listTips, inSalon } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';
import { summarizeEarnings, countHaircuts, addPeriods, addCounts, summarizeGiftEarnings, countGiftHaircuts, summarizeTipEarnings } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

// Salon-owner: HIS salon's earnings — totals plus per-barber breakdown,
// each for today, this week (Mon–Sun) and this month.
// Mirrors the super-admin owner earnings route, scoped to the salon.
export async function GET(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const [bookings, barbers, gifts, tips] = await Promise.all([listBookings(), getBarbers(), listGifts(), listTips()]);
  const myBookings = bookings.filter((b) => inSalon(b, salonId));
  const myGifts = gifts.filter((g) => inSalon(g, salonId));
  const myTips = tips.filter((t) => inSalon(t, salonId));
  const redeemedGifts = myGifts.filter((g) => g.status === 'redeemed');
  const perBarber = barbers
    .filter((b) => b.active && inSalon(b, salonId))
    .map((b) => {
      const mine = myBookings.filter((x) => x.barberId === b.id);
      const mineGifts = redeemedGifts.filter((g) => g.redeemedByBarberId === b.id);
      const mineTips = myTips.filter((t) => t.barberId === b.id);
      return {
        id: b.id,
        name: b.name,
        earnings: addPeriods(addPeriods(summarizeEarnings(mine), summarizeGiftEarnings(mineGifts)), summarizeTipEarnings(mineTips)),
        haircuts: addCounts(countHaircuts(mine), countGiftHaircuts(mineGifts)),
      };
    })
    .sort((a, b) => b.earnings.month - a.earnings.month);
  const totals = addPeriods(addPeriods(summarizeEarnings(myBookings), summarizeGiftEarnings(redeemedGifts)), summarizeTipEarnings(myTips));
  return NextResponse.json({ ok: true, totals, perBarber });
}
