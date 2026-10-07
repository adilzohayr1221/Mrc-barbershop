import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { getBarberMilestone } from '@/lib/store';
import { BONUS_10_AT, BONUS_10_USD, BONUS_100_AT, BONUS_100_USD } from '@/lib/loyalty';

export const dynamic = 'force-dynamic';

// Barber's milestone progress: haircuts done, $100/$500 bonus states.
export async function GET(req: Request) {
  const session = requireBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const m = await getBarberMilestone(session.barberId);
  return NextResponse.json({
    ok: true,
    milestone: {
      completedHaircuts: m?.completedHaircuts ?? 0,
      bonus10: {
        at: BONUS_10_AT,
        usd: BONUS_10_USD,
        state: m?.bonus10 ?? 'none',
      },
      bonus100: {
        at: BONUS_100_AT,
        usd: BONUS_100_USD,
        state: m?.bonus100 ?? 'none',
      },
    },
  });
}
