import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { listGifts, saveGift } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Customer saves a gift into his own account so it shows up under
// "Received gifts". Claiming does NOT invalidate the bearer code — the
// QR/short code still redeems once at the shop. One gift can be claimed
// by only one account.
// Body: { shortCode }.
export async function POST(req: Request) {
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const raw = body?.shortCode;
  if (typeof raw !== 'string' || !raw.trim()) {
    return NextResponse.json({ error: 'This gift code is not valid.' }, { status: 400 });
  }
  const code = raw.trim().toUpperCase();
  const gift = (await listGifts()).find((g) => g.shortCode.toUpperCase() === code) ?? null;

  if (!gift) {
    return NextResponse.json({ error: 'This gift code is not valid.' }, { status: 404 });
  }
  if (gift.status === 'redeemed') {
    return NextResponse.json({ error: 'This gift was already used.' }, { status: 410 });
  }
  if (new Date(gift.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This gift has expired.' }, { status: 410 });
  }
  const claimedBy = gift.claimedByCustomerId ?? null;
  if (claimedBy && claimedBy !== session.customerId) {
    return NextResponse.json(
      { error: "This gift is already in someone else's account." },
      { status: 409 }
    );
  }
  if (!claimedBy) {
    gift.claimedByCustomerId = session.customerId;
    gift.claimedAt = new Date().toISOString();
    await saveGift(gift);
  }
  return NextResponse.json({
    ok: true,
    gift: {
      id: gift.id,
      serviceName: gift.serviceName,
      price: gift.price,
      buyerName: gift.buyerName,
      recipientName: gift.recipientName,
      shortCode: gift.shortCode,
token: gift.token,
      qr: `MRC3:${gift.id}:${gift.token}`,
      expiresAt: gift.expiresAt,
    },
  });
}
