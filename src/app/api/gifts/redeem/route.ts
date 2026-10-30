import { NextResponse } from 'next/server';
import { requireActiveBarber, rateLimitExceeded, clientIp } from '@/lib/guard';
import { getGift, listGifts, saveGift, saveCompletionPhoto, salonOf, claimOnce, releaseClaim } from '@/lib/store';
import { barberSalonId } from '@/lib/salonScope';
import type { Gift } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Barber validates (preview=true) or redeems a gift code.
// - Scan the QR (MRC3:<giftId>:<token>) → pass giftId + token.
// - Type the short code (8 chars on new gifts; older 6-char codes still work) → pass shortCode only.
// Non-preview redeem requires the proof-of-completion PHOTO (multipart field
// `photo`, like DoorDash proof-of-delivery): NO PHOTO = NO PAYOUT.
export async function POST(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const ct = req.headers.get('content-type') || '';
  let giftId: unknown;
  let token: unknown;
  let shortCode: unknown;
  let preview = false;
  let form: FormData | null = null;
  if (ct.includes('multipart/form-data')) {
    form = await req.formData().catch(() => null);
    giftId = form?.get('giftId');
    token = form?.get('token');
    shortCode = form?.get('shortCode');
    preview = form?.get('preview') === 'true';
  } else {
    const body = await req.json().catch(() => null);
    giftId = body?.giftId;
    token = body?.token;
    shortCode = body?.shortCode;
    preview = body?.preview === true;
  }

  let gift: Gift | null = null;
  if (typeof shortCode === 'string' && shortCode.trim()) {
    // Audit M11 (2026-10-22): the short code alone redeems, so attempts are
    // rate-limited per barber + IP (10 per 10 minutes, shared store).
    if (await rateLimitExceeded(`gift-code:${session.barberId}:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many code attempts. Wait a few minutes and try again.' }, { status: 429 });
    }
    const code = shortCode.trim().toUpperCase();
    gift = (await listGifts()).find((g) => g.shortCode.toUpperCase() === code) ?? null;
  } else {
    if (typeof giftId !== 'string' || !giftId || typeof token !== 'string' || !token) {
      return NextResponse.json({ error: 'Invalid code.' }, { status: 400 });
    }
    const g = await getGift(giftId);
    if (g && g.token === token) gift = g;
  }

  if (!gift) {
    return NextResponse.json(
      { error: 'This gift code is not valid. Ask for the gift code again.' },
      { status: 404 }
    );
  }
  if (gift.status === 'redeemed') {
    return NextResponse.json({ error: 'This gift was already used.' }, { status: 410 });
  }
  if (new Date(gift.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This gift has expired.' }, { status: 410 });
  }
  // Audit M10 (2026-10-22): a gift can only be redeemed inside its own
  // salon (platform gifts = the platform salon).
  if (salonOf(gift) !== (await barberSalonId(session))) {
    return NextResponse.json({ error: 'This gift belongs to a different salon.' }, { status: 403 });
  }

  if (preview) {
    // Audit M11: preview no longer returns the buyer's/recipient's names —
    // anyone holding the code could read them before redeeming.
    return NextResponse.json({
      ok: true,
      preview: {
        serviceName: gift.serviceName,
        price: gift.price,
        expiresAt: gift.expiresAt,
      },
    });
  }

  // Audit M3 (2026-10-29): claim + flip-and-SAVE as redeemed BEFORE the
  // photo and payout. The old flow flipped the status in memory, paid out,
  // and only then saved — two concurrent redeems could both pass the
  // status check (stale list reads) and both proceed. The claim makes the
  // flip atomic; the save makes it visible to every other reader (and to
  // the payout sweep) before any money moves.
  if (!(await claimOnce(`redeem-gift-${gift.id}`))) {
    const fresh = await getGift(gift.id);
    if (fresh?.status === 'redeemed') {
      return NextResponse.json({ error: 'This gift was already used.' }, { status: 410 });
    }
    return NextResponse.json({ error: 'This gift is being redeemed right now. Try again in a moment.' }, { status: 409 });
  }
  gift.status = 'redeemed';
  gift.redeemedAt = new Date().toISOString();
  gift.redeemedByBarberId = session.barberId;
  await saveGift(gift);

  // Proof photo first — no photo, no payout. A photo failure rolls the
  // redemption back (status + claim) so the gift is not burned.
  try {
    if (!form) throw new Error('Take a photo of the finished haircut to get paid.');
    gift.completionPhotoPath = await saveCompletionPhoto(form, 'gift');
  } catch (e) {
    gift.status = 'active';
    gift.redeemedAt = null;
    gift.redeemedByBarberId = null;
    gift.completionPhotoPath = null;
    await saveGift(gift).catch(() => {});
    await releaseClaim(`redeem-gift-${gift.id}`);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Take a photo of the finished haircut to get paid.' },
      { status: 400 }
    );
  }

  // Gift haircut payout: the full gift value goes to the redeeming barber
  // immediately. If the gift is never redeemed, the money stays with the owner.
  let payoutFailed: string | null = null;
  let payoutAmount = 0;
  try {
    const { payoutToBarber } = await import('@/lib/payouts');
    const result = await payoutToBarber(session.barberId, gift.price, {
      idempotencyKey: `payout-gift-${gift.id}`,
      description: `MRC Barbershops — gift haircut payout (${gift.serviceName})`,
      metadata: { kind: 'gift_payout', giftId: gift.id },
    });
    if (result.ok) {
      gift.payoutTransferId = result.transferId ?? null;
      gift.payoutAmount = gift.price;
      payoutAmount = gift.price;
    } else {
      // Audit L4: raw payout errors stay in the server log only.
      console.error('[payout] gift payout failed', result.error);
      payoutFailed = 'Payout failed — it will be retried automatically.';
    }
  } catch (e) {
    console.error('[payout] gift payout failed', e);
    payoutFailed = 'Payout failed — it will be retried automatically.';
  }
  await saveGift(gift);

  // Loyalty & barber milestones: count this completed gift haircut.
  try {
    const { recordHaircut } = await import('@/lib/loyalty');
    await recordHaircut({
      barberId: session.barberId,
      customerId: gift.claimedByCustomerId,
      paid: true,
      salonId: salonOf(gift),
    });
  } catch (e) {
    console.error('[gifts/redeem] loyalty hook failed', e);
  }

  // Ask the recipient to rate + tip (the haircut is done — photo taken).
  try {
    const { getBarbers, getCustomers } = await import('@/lib/store');
    const { sendPushToUser } = await import('@/lib/push');
    const barberName = (await getBarbers()).find((b) => b.id === session.barberId)?.name ?? 'your barber';
    const recipient = gift.claimedByCustomerId
      ? await getCustomers().then((cs) => cs.find((c) => c.id === gift.claimedByCustomerId))
      : null;
    if (recipient) {
      await sendPushToUser('customer', recipient.id, {
        title: 'How was your haircut? ⭐',
        body: `Rate ${barberName} and leave a tip if you liked it.`,
        url: `/customer/thanks?ref=${encodeURIComponent(`gift:${gift.id}`)}`,
      });
    }
  } catch (e) {
    console.error('[gift] review push failed', e);
  }

  return NextResponse.json({
    ok: true,
    payoutFailed,
    payoutAmount,
    gift: {
      serviceName: gift.serviceName,
      price: gift.price,
      buyerName: gift.buyerName,
      recipientName: gift.recipientName,
    },
  });
}
