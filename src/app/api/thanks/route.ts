import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import {
  getBooking, getRedemption, getGift, getBarbers, getServices,
  listTips,
} from '@/lib/store';
import { getMembershipById } from '@/lib/membership';

export const dynamic = 'force-dynamic';

// GET /api/thanks?ref=booking:<id> | redemption:<id> | gift:<id>
// Resolves a completed haircut for the "How was your haircut?" page:
// who cut it, what service, and whether a tip can be charged.
export async function GET(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  const ref = new URL(req.url).searchParams.get('ref') || '';
  const [kind, id] = ref.split(':');
  if (!kind || !id) return NextResponse.json({ error: 'Invalid reference.' }, { status: 400 });

  let customerId: string | null = null;
  let barberId: string | null = null;
  let serviceName = 'Haircut';
  let source: 'booking' | 'redemption' | 'gift' | null = null;
  let sourceId: string | null = null;
  let canTip = false;

  const barbers = await getBarbers();
  const barberNameOf = (bid: string | null) => barbers.find((b) => b.id === bid)?.name ?? 'your barber';

  if (kind === 'booking') {
    const b = await getBooking(id);
    if (!b || b.customerId !== session.customerId) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    if (!b.completedAt) {
      return NextResponse.json({ error: 'This haircut is not finished yet.' }, { status: 400 });
    }
    customerId = b.customerId;
    barberId = b.barberId;
    source = 'booking';
    sourceId = b.id;
    const svc = (await getServices()).find((s) => s.id === b.serviceId);
    if (svc) serviceName = svc.name;
    canTip = !!(b.stripeCustomerId && b.stripePaymentMethodId);
  } else if (kind === 'redemption') {
    const r = await getRedemption(id);
    if (!r || r.customerId !== session.customerId) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    customerId = r.customerId;
    barberId = r.barberId;
    source = 'redemption';
    sourceId = r.id;
    const m = await getMembershipById(r.membershipId);
    if (m?.planKind === 'custom') {
      const ws = m.weeklyServices?.[r.weekIndex];
      if (ws) serviceName = ws.name;
    }
    // Tip card = the Stripe customer's default payment method on the subscription.
    canTip = !!m?.stripeSubscriptionId;
  } else if (kind === 'gift') {
    const g = await getGift(id);
    if (!g || g.claimedByCustomerId !== session.customerId) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    if (g.status !== 'redeemed') {
      return NextResponse.json({ error: 'This gift was not redeemed yet.' }, { status: 400 });
    }
    customerId = g.claimedByCustomerId;
    barberId = g.redeemedByBarberId;
    source = 'gift';
    sourceId = g.id;
    serviceName = g.serviceName;
    canTip = false; // gift recipients usually have no saved card
  } else {
    return NextResponse.json({ error: 'Invalid reference.' }, { status: 400 });
  }

  const alreadyTipped = source && sourceId
    ? (await listTips()).some((t) => t.source === source && t.sourceId === sourceId)
    : false;

  return NextResponse.json({
    ok: true,
    ref,
    barberId,
    barberName: barberNameOf(barberId),
    serviceName,
    canTip: canTip && !alreadyTipped,
    alreadyTipped,
  });
}
