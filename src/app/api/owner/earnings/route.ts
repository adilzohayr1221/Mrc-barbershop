import { NextResponse } from 'next/server';
import { listBookings, getBarbers, listGifts, listTips } from '@/lib/store';
import { requireOwner } from '@/lib/auth';
import { summarizeEarnings, countHaircuts, addPeriods, addCounts, summarizeGiftEarnings, countGiftHaircuts, summarizeTipEarnings } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

// Owner-only: shop earnings — totals plus per-barber breakdown,
// each for today, this week (Mon–Sun) and this month.
// Also includes per-barber haircut counts (today/week/month/all time)
// so the owner can see who cut the most hair.
// Redeemed gift haircuts count toward the redeeming barber's earnings and haircut counts.
// Customer tips count toward the tipped barber's earnings.
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [bookings, barbers, gifts, tips] = await Promise.all([listBookings(), getBarbers(), listGifts(), listTips()]);
  const redeemedGifts = gifts.filter((g) => g.status === 'redeemed');
  const perBarber = barbers
    .filter((b) => b.active)
    .map((b) => {
      const mine = bookings.filter((x) => x.barberId === b.id);
      const mineGifts = redeemedGifts.filter((g) => g.redeemedByBarberId === b.id);
      const mineTips = tips.filter((t) => t.barberId === b.id);
      return {
        id: b.id,
        name: b.name,
        earnings: addPeriods(addPeriods(summarizeEarnings(mine), summarizeGiftEarnings(mineGifts)), summarizeTipEarnings(mineTips)),
        haircuts: addCounts(countHaircuts(mine), countGiftHaircuts(mineGifts)),
      };
    })
    .sort((a, b) => b.earnings.month - a.earnings.month);
  const totals = addPeriods(addPeriods(summarizeEarnings(bookings), summarizeGiftEarnings(redeemedGifts)), summarizeTipEarnings(tips));
  return NextResponse.json({ ok: true, totals, perBarber });
}
