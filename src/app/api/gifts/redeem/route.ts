import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { getGift, listGifts, saveGift, saveCompletionPhoto } from '@/lib/store';
import type { Gift } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Barber validates (preview=true) or redeems a gift code.
// - Scan the QR (MRC3:<giftId>:<token>) → pass giftId + token.
// - Type the 6-character code → pass shortCode only.
// Non-preview redeem requires the proof-of-completion PHOTO (multipart field
// `photo`, like DoorDash proof-of-delivery): NO PHOTO = NO PAYOUT.
export async function POST(req: Request) {
  const session = requireBarber(req);
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

  if (preview) {
    return NextResponse.json({
      ok: true,
      preview: {
        serviceName: gift.serviceName,
        price: gift.price,
        buyerName: gift.buyerName,
        recipientName: gift.recipientName,
        expiresAt: gift.expiresAt,
      },
    });
  }

  gift.status = 'redeemed';
  gift.redeemedAt = new Date().toISOString();
  gift.redeemedByBarberId = session.barberId;

  // Proof photo first — no photo, no payout.
  try {
    if (!form) throw new Error('Take a photo of the finished haircut to get paid.');
    gift.completionPhotoPath = await saveCompletionPhoto(form, 'gift');
  } catch (e) {
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
      description: `MRC Barbershop — gift haircut payout (${gift.serviceName})`,
      metadata: { kind: 'gift_payout', giftId: gift.id },
    });
    if (result.ok) {
      gift.payoutTransferId = result.transferId ?? null;
      gift.payoutAmount = gift.price;
      payoutAmount = gift.price;
    } else {
      payoutFailed = result.error ?? 'Payout failed.';
    }
  } catch (e) {
    payoutFailed = e instanceof Error ? e.message : 'Payout failed.';
    console.error('[payout] gift payout failed', payoutFailed);
  }
  await saveGift(gift);

  // Loyalty & barber milestones: count this completed gift haircut.
  try {
    const { recordHaircut } = await import('@/lib/loyalty');
    const { sessionSalonId } = await import('@/lib/auth');
    await recordHaircut({
      barberId: session.barberId,
      customerId: gift.claimedByCustomerId,
      paid: true,
      salonId: sessionSalonId(session),
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
