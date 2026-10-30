import { NextResponse } from 'next/server';
import { getBooking, saveBooking, saveCompletionPhoto, inSalon } from '@/lib/store';
import { requireActiveBarber } from '@/lib/guard';
import { barberSalonId } from '@/lib/salonScope';
import { payoutToBarber } from '@/lib/payouts';
import { payoutForBooking } from '@/lib/vip';
import { bookingStarted } from '@/lib/earnings';
import { chargeRemainingBalance } from '@/lib/balanceCharge';

export const dynamic = 'force-dynamic';

// Barber marks a haircut as done. A proof-of-completion PHOTO (taken with the
// camera, multipart field `photo`) is REQUIRED — like DoorDash proof-of-delivery:
// no photo, no payout. The payout (full Stripe-collected amount) is transferred
// to the barber's connected account immediately after the photo is saved.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  if (booking.barberId !== session.barberId) {
    return NextResponse.json({ error: 'Not your appointment.' }, { status: 403 });
  }
  const salonId = await barberSalonId(session);
  if (!inSalon(booking, salonId)) {
    return NextResponse.json({ error: 'Not your appointment.' }, { status: 403 });
  }
  if (booking.status !== 'booked') {
    return NextResponse.json({ error: 'Appointment is not active.' }, { status: 400 });
  }
  if (booking.completedAt) {
    return NextResponse.json({ ok: true, already: true, payoutAmount: booking.payoutAmount ?? 0 });
  }
  // Membership bookings are paid out at scan time ($30), not here.
  if (booking.paymentStatus === 'membership_pending' || booking.paymentStatus === 'membership_redeemed') {
    return NextResponse.json({ error: 'Plan haircuts are paid when the membership code is scanned.' }, { status: 400 });
  }
  // Audit H5 (2026-10-29): Done used to charge the remaining balance the
  // moment it was pressed — even for an appointment days in the future —
  // while the payout side already waited for the start. Completion (and
  // its charge) now requires the appointment to have started, on the
  // shop's wall clock (America/New_York) via bookingStarted().
  if (!bookingStarted(booking)) {
    return NextResponse.json({ error: 'This appointment has not started yet.' }, { status: 400 });
  }

  // Proof photo first — no photo, no payout.
  let photoPath: string;
  try {
    const form = await req.formData();
    photoPath = await saveCompletionPhoto(form, 'done');
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Take a photo of the finished haircut.' },
      { status: 400 }
    );
  }

  // The haircut is finished — charge the remaining balance to the customer's
  // saved card automatically (owner's order, 2026-10-25: the barber takes
  // no cash and scans no code; the rest comes off the card on its own).
  // This runs BEFORE the payout so the payout covers the full collected
  // amount. A failed charge never blocks completion: the failure is
  // recorded on the booking and surfaced to the barber, and the payout
  // sweep keeps retrying the charge for bookings whose start has passed.
  let balanceCharged = 0;
  let balanceError: string | undefined;
  try {
    const bc = await chargeRemainingBalance(booking);
    balanceCharged = bc.charged;
    if (bc.error) balanceError = bc.error;
  } catch (e) {
    console.error('[done] balance charge failed', e);
    balanceError = 'The automatic charge failed. The remaining amount is still owed.';
  }

  // Regular bookings pay out everything collected; a VIP home visit pays
  // the barber's fixed $60 share of the $100 (platform keeps $40).
  const amount = payoutForBooking(booking);
  booking.completedAt = new Date().toISOString();
  booking.completionPhotoPath = photoPath;

  // Loyalty & barber milestones: count this completed haircut FIRST, before
  // any payout attempt — a payout failure must never lose the count (the
  // payout-failure branch below returns early). The already-completed guard
  // above keeps this exactly-once.
  try {
    const { recordHaircut } = await import('@/lib/loyalty');
    await recordHaircut({
      barberId: booking.barberId,
      customerId: booking.customerId,
      paid: true,
      salonId,
    });
  } catch (e) {
    console.error('[done] loyalty hook failed', e);
  }

  // Audit M2 (2026-10-22): completion may be recorded any time, but money
  // only moves once the appointment's start has arrived. A future booking
  // marked done early (e.g. a VIP visit days out) keeps payoutAmount 0 and
  // the payout sweep pays it once its start passes — so a later full-refund
  // cancellation can never strand a payout that already left.
  if (amount > 0 && bookingStarted(booking)) {
    const result = await payoutToBarber(booking.barberId, amount, {
      idempotencyKey: `payout-booking-${booking.id}`,
      description: `MRC Barbershops — haircut payout (${booking.date} ${booking.time})`,
      metadata: { kind: 'booking_payout', bookingId: booking.id },
    });
    if (!result.ok) {
      // Record completion but surface the payout failure so it can be retried.
      booking.payoutAmount = 0;
      await saveBooking(booking);
      // Haircut is still done — ask the customer to rate + tip.
      if (booking.customerId) {
        try {
          const { sendPushToUser } = await import('@/lib/push');
          await sendPushToUser('customer', booking.customerId, {
            title: 'How was your haircut? ⭐',
            body: 'Rate your barber and leave a tip if you liked it.',
            url: `/customer/thanks?ref=${encodeURIComponent(`booking:${booking.id}`)}`,
          });
        } catch {}
      }
      return NextResponse.json(
        {
          ok: true,
          completed: true,
          payoutFailed: true,
          error: result.error,
          balanceCharged,
          ...(balanceError ? { balanceFailed: true, balanceError } : {}),
        },
        { status: 200 }
      );
    }
    booking.payoutTransferId = result.transferId ?? null;
    booking.payoutAmount = amount;
  } else {
    booking.payoutAmount = 0;
  }
  await saveBooking(booking);

  // The haircut is done (photo taken) — ask the customer to rate + tip.
  if (booking.customerId) {
    try {
      const { getBarbers } = await import('@/lib/store');
      const { sendPushToUser } = await import('@/lib/push');
      const barberName = (await getBarbers()).find((b) => b.id === booking.barberId)?.name ?? 'your barber';
      await sendPushToUser('customer', booking.customerId, {
        title: 'How was your haircut? ⭐',
        body: `Rate ${barberName} and leave a tip if you liked it.`,
        url: `/customer/thanks?ref=${encodeURIComponent(`booking:${booking.id}`)}`,
      });
    } catch (e) {
      console.error('[done] review push failed', e);
    }
  }
  return NextResponse.json({
    ok: true,
    completed: true,
    payoutAmount: booking.payoutAmount ?? 0,
    balanceCharged,
    ...(balanceError ? { balanceFailed: true, balanceError } : {}),
  });
}
