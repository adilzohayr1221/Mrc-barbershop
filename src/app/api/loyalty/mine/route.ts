import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { getCustomerLoyalty, getLoyaltyReward } from '@/lib/store';
import { LOYALTY_PAID_FOR_FREE } from '@/lib/loyalty';

export const dynamic = 'force-dynamic';

// Customer's loyalty progress: paid haircuts toward the one-time free 5th
// haircut, plus the active MRC5 reward QR when earned.
export async function GET(req: Request) {
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const l = await getCustomerLoyalty(session.customerId);
  const paidHaircuts = l?.paidHaircuts ?? 0;
  const freeEarned = l?.freeEarned ?? false;
  let reward: { id: string; qr: string; status: string } | null = null;
  if (freeEarned && l?.freeRewardId) {
    const r = await getLoyaltyReward(l.freeRewardId);
    if (r && r.status === 'active') {
      reward = { id: r.id, qr: `MRC5:${r.id}:${r.token}`, status: r.status };
    }
  }
  return NextResponse.json({
    ok: true,
    loyalty: {
      paidHaircuts,
      needed: LOYALTY_PAID_FOR_FREE,
      freeEarned,
      freeUsed: freeEarned && !reward,
      reward,
    },
  });
}
