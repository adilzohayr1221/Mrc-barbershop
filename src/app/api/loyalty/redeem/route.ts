import { NextResponse } from 'next/server';
import { requireBarber, sessionSalonId } from '@/lib/auth';
import { getLoyaltyReward, saveLoyaltyReward, getCustomers } from '@/lib/store';
import { recordHaircut } from '@/lib/loyalty';

export const dynamic = 'force-dynamic';

// Barber validates (preview=true) or redeems a loyalty free-haircut code
// (MRC5:<rewardId>:<token>). The customer pays nothing AND the barber gets no
// payout (like complaint comps) — but the haircut still counts toward the
// barber's milestone bonuses. Redeeming only marks the code used.
export async function POST(req: Request) {
  const session = requireBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const preview = body?.preview === true;
  const rewardId = body?.rewardId;
  const token = body?.token;
  if (typeof rewardId !== 'string' || !rewardId || typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'Invalid code.' }, { status: 400 });
  }
  const reward = await getLoyaltyReward(rewardId);
  if (!reward || reward.token !== token) {
    return NextResponse.json(
      { error: 'This free-haircut code is not valid. Ask for the code again.' },
      { status: 404 }
    );
  }
  if (reward.status === 'redeemed') {
    return NextResponse.json({ error: 'This free haircut was already used.' }, { status: 410 });
  }

  if (preview) {
    const customers = await getCustomers();
    const cust = customers.find((c) => c.id === reward.customerId);
    return NextResponse.json({
      ok: true,
      preview: {
        serviceName: reward.serviceName,
        customerName: cust?.name ?? 'Customer',
      },
    });
  }

  reward.status = 'redeemed';
  reward.redeemedAt = new Date().toISOString();
  reward.redeemedByBarberId = session.barberId;
  await saveLoyaltyReward(reward);

  // Counts toward the barber's milestone (work done), not the customer's
  // loyalty counter (it was free).
  await recordHaircut({
    barberId: session.barberId,
    customerId: reward.customerId,
    paid: false,
    salonId: sessionSalonId(session),
  });

  return NextResponse.json({
    ok: true,
    reward: { serviceName: reward.serviceName },
  });
}
