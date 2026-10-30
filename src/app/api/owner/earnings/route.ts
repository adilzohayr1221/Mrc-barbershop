import { NextResponse } from 'next/server';
import { listBookings, getBarbers, listGifts, listTips, listWalkinPayments } from '@/lib/store';

import { requireActiveOwner } from "@/lib/guard";
import { summarizeEarnings, countHaircuts, addPeriods, addCounts, summarizeGiftEarnings, countGiftHaircuts, summarizeTipEarnings, summarizeWalkinEarnings, shopToday } from '@/lib/earnings';
import { yearlyMembershipIdsIn } from '@/lib/membership';

export const dynamic = 'force-dynamic';

// Owner-only: shop earnings — totals plus per-barber breakdown,
// each for today, this week (Mon–Sun) and this month.
// Also includes per-barber haircut counts (today/week/month/all time)
// so the owner can see who cut the most hair.
// Redeemed gift haircuts count toward the redeeming barber's earnings and haircut counts.
// Customer tips count toward the tipped barber's earnings.
export async function GET(req: Request) {
  if (!(await requireActiveOwner(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [bookings, barbers, gifts, tips, walkins] = await Promise.all([listBookings(), getBarbers(), listGifts(), listTips(), listWalkinPayments()]);
  const redeemedGifts = gifts.filter((g) => g.status === 'redeemed');
  const yearlyIds = await yearlyMembershipIdsIn(bookings);
  const perBarber = barbers
    .filter((b) => b.active)
    .map((b) => {
      const mine = bookings.filter((x) => x.barberId === b.id);
      const mineGifts = redeemedGifts.filter((g) => g.redeemedByBarberId === b.id);
      const mineTips = tips.filter((t) => t.barberId === b.id);
      const mineWalkins = walkins.filter((w) => w.barberId === b.id);
      return {
        id: b.id,
        name: b.name,
        earnings: addPeriods(addPeriods(addPeriods(summarizeEarnings(mine, shopToday(), true, yearlyIds), summarizeGiftEarnings(mineGifts)), summarizeTipEarnings(mineTips)), summarizeWalkinEarnings(mineWalkins)),
        haircuts: addCounts(countHaircuts(mine), countGiftHaircuts(mineGifts)),
      };
    })
    .sort((a, b) => b.earnings.month - a.earnings.month);
  const totals = addPeriods(addPeriods(addPeriods(summarizeEarnings(bookings, shopToday(), false, yearlyIds), summarizeGiftEarnings(redeemedGifts)), summarizeTipEarnings(tips)), summarizeWalkinEarnings(walkins));
  return NextResponse.json({ ok: true, totals, perBarber });
}
