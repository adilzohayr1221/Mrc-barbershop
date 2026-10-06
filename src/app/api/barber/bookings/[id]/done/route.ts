import { NextResponse } from 'next/server';
import { getBooking, saveBooking, saveCompletionPhoto, inSalon } from '@/lib/store';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';
import { payoutToBarber } from '@/lib/payouts';

export const dynamic = 'force-dynamic';

// Barber marks a haircut as done. A proof-of-completion PHOTO (taken with the
// camera, multipart field `photo`) is REQUIRED — like DoorDash proof-of-delivery:
// no photo, no payout. The payout (full Stripe-collected amount) is transferred
// to the barber's connected account immediately after the photo is saved.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireBarber(req);
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

  const amount = Math.round((booking.amountPaid ?? 0) * 100) / 100;
  booking.completedAt = new Date().toISOString();
  booking.completionPhotoPath = photoPath;

  if (amount > 0) {
    const result = await payoutToBarber(booking.barberId, amount, {
      idempotencyKey: `payout-booking-${booking.id}`,
      description: `MRC Barbershop — haircut payout (${booking.date} ${booking.time})`,
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
        { ok: true, completed: true, payoutFailed: true, error: result.error },
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
  return NextResponse.json({ ok: true, completed: true, payoutAmount: booking.payoutAmount ?? 0 });
}
