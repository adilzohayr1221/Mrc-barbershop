import { NextResponse } from 'next/server';

import { listGifts, saveGift } from '@/lib/store';
import { rateLimitExceeded, clientIp, requireActiveCustomer } from "@/lib/guard";

export const dynamic = 'force-dynamic';

// Customer saves a gift into his own account so it shows up under
// "Received gifts". Claiming does NOT invalidate the bearer code — the
// QR/short code still redeems once at the shop. One gift can be claimed
// by only one account.
// Body: { shortCode }.
export async function POST(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  // Audit M11 (2026-10-22): claiming is a code-guessing surface — rate-limit
  // attempts per account + IP (10 per 10 minutes, shared store).
  if (await rateLimitExceeded(`gift-claim:${session.customerId}:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, { status: 429 });
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
      // Audit M11 (2026-10-22): the raw redeem token / QR is NOT returned
      // to the claimer — whoever typed the short code already holds the
      // bearer credential (the code itself redeems at the shop). Handing
      // out the strong token here would upgrade a guessed 6-char code
      // into the full QR credential. The BUYER still gets the QR from
      // his own purchase / "my gifts" (bought) views.
      expiresAt: gift.expiresAt,
    },
  });
}
