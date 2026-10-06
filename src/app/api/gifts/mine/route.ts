import { NextResponse } from 'next/server';
import { listGifts } from '@/lib/store';
import { requireCustomer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Customer-only: gifts this customer bought plus gifts he claimed
// (received) into his account — newest first.
export async function GET(req: Request) {
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  const me = session.customerId;
  const gifts = (await listGifts()).filter(
    (g) => g.buyerCustomerId === me || (g.claimedByCustomerId ?? null) === me
  );
  return NextResponse.json({
    ok: true,
    gifts: gifts.map((g) => ({
      id: g.id,
      serviceName: g.serviceName,
      price: g.price,
      buyerName: g.buyerName,
      recipientName: g.recipientName,
      status: g.status,
      shortCode: g.shortCode,
token: g.token,
      qr: `MRC3:${g.id}:${g.token}`,
      expiresAt: g.expiresAt,
      createdAt: g.createdAt,
      redeemedAt: g.redeemedAt,
      role: g.buyerCustomerId === me ? 'bought' : 'received',
      claimed: !!(g.claimedByCustomerId ?? null),
    })),
  });
}
