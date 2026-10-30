import { NextResponse } from 'next/server';
import { listGifts } from '@/lib/store';

import { requireActiveCustomer } from "@/lib/guard";

export const dynamic = 'force-dynamic';

// Customer-only: gifts this customer bought plus gifts he claimed
// (received) into his account — newest first.
export async function GET(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  const me = session.customerId;
  const gifts = (await listGifts()).filter(
    (g) => g.buyerCustomerId === me || (g.claimedByCustomerId ?? null) === me
  );
  return NextResponse.json({
    ok: true,
    gifts: gifts.map((g) => {
      const bought = g.buyerCustomerId === me;
      return {
        id: g.id,
        serviceName: g.serviceName,
        price: g.price,
        buyerName: g.buyerName,
        recipientName: g.recipientName,
        status: g.status,
        shortCode: g.shortCode,
        // Audit M11 (2026-10-22): the strong token / MRC3 QR is only handed
        // to the BUYER (he is the gift giver). A customer who received the
        // gift by claiming its short code redeems with the code itself —
        // his page renders a QR of the code, which the barber scanner
        // accepts — so a guessed code can't be upgraded into the token.
        ...(bought ? { token: g.token, qr: `MRC3:${g.id}:${g.token}` } : {}),
        expiresAt: g.expiresAt,
        createdAt: g.createdAt,
        redeemedAt: g.redeemedAt,
        role: bought ? 'bought' : 'received',
        claimed: !!(g.claimedByCustomerId ?? null),
      };
    }),
  });
}
