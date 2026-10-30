import { NextResponse } from 'next/server';
import { sessionSalonId } from "@/lib/auth";
import { requireActiveOwner } from "@/lib/guard";
import { listBarberMilestones, listLoyaltyRewards, getBarbers, inSalon } from '@/lib/store';
import { BONUS_10_USD, BONUS_100_USD, healedBarberMilestone } from '@/lib/loyalty';

export const dynamic = 'force-dynamic';

// Owner overview: every barber's milestone progress + bonus states,
// plus loyalty free-haircut stats.
export async function GET(req: Request) {
  const session = await requireActiveOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const [, barbers, rewards] = await Promise.all([
    listBarberMilestones(),
    getBarbers(),
    listLoyaltyRewards(),
  ]);
  const activeBarbers = barbers.filter((b) => b.active && inSalon(b, salonId));
  // Heal every shown barber's count from the real completed haircuts first,
  // so the owner's numbers match what each barber sees.
  await Promise.all(activeBarbers.map((b) => healedBarberMilestone(b.id)));
  const milestones = await listBarberMilestones();
  const rows = activeBarbers
    .map((b) => {
      const m = milestones.find((x) => x.barberId === b.id);
      return {
        barberId: b.id,
        barberName: b.name,
        completedHaircuts: m?.completedHaircuts ?? 0,
        bonus10: m?.bonus10 ?? 'none',
        bonus10EarnedAt: m?.bonus10EarnedAt ?? null,
        bonus10PaidAt: m?.bonus10PaidAt ?? null,
        bonus100: m?.bonus100 ?? 'none',
        bonus100EarnedAt: m?.bonus100EarnedAt ?? null,
        bonus100PaidAt: m?.bonus100PaidAt ?? null,
      };
    })
    .sort((a, b) => b.completedHaircuts - a.completedHaircuts);
  const salonRewards = rewards.filter((r) => !r.salonId || r.salonId === salonId);
  return NextResponse.json({
    ok: true,
    barbers: rows,
    bonus10Usd: BONUS_10_USD,
    bonus100Usd: BONUS_100_USD,
    loyalty: {
      freeEarned: salonRewards.length,
      freeRedeemed: salonRewards.filter((r) => r.status === 'redeemed').length,
    },
  });
}
