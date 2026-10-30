import { NextResponse } from 'next/server';
import { listBookings, saveBooking, getBarbers, getServices } from '@/lib/store';
import { sendPushToUser, isPushConfigured } from '@/lib/push';
import { secretMatches } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Called every ~30 min by the scheduler (x-cron-secret). Sends:
// - ~24h before: reminder to customer + barber
// - ~2h before: reminder to customer + barber
// Each reminder is sent once per booking (reminded24h / reminded2h flags).
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secretMatches(req.headers.get('x-cron-secret'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Retry barber payouts that failed when a haircut completed (usually
  // Stripe had not released the funds yet). Idempotent and double-pay
  // safe — see retryFailedPayouts. Runs even if push is not configured.
  let payoutRetry: unknown = null;
  try {
    const { retryFailedPayouts } = await import('@/lib/payouts');
    payoutRetry = await retryFailedPayouts();
  } catch (e) {
    console.error('[cron] payout retry failed', e);
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'push not configured', payoutRetry });
  }

  const nowNY = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${nowNY.getFullYear()}-${pad(nowNY.getMonth() + 1)}-${pad(nowNY.getDate())}`;
  const tomorrow = new Date(nowNY);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  const nowMin = nowNY.getHours() * 60 + nowNY.getMinutes();

  const [bookings, barbers, services] = await Promise.all([listBookings(), getBarbers(), getServices()]);
  const barberName = new Map(barbers.map((b) => [b.id, b.name]));
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  let sent = 0;
  for (const b of bookings) {
    if (b.status !== 'booked') continue;
    const mins = (() => {
      const m = /^(\d{2}):(\d{2})$/.exec(b.time);
      return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
    })();
    if (mins === null) continue;
    const svc = serviceName.get(b.serviceId) ?? 'haircut';
    const barber = barberName.get(b.barberId) ?? 'your barber';

    let changed = false;
    // ~24h reminder: tomorrow's appointments.
    if (b.date === tomorrowStr && !b.reminded24h) {
      const when = `tomorrow at ${b.time}`;
      if (b.customerId) {
        await sendPushToUser('customer', b.customerId, {
          title: 'Appointment tomorrow ✂️',
          body: `${svc} with ${barber} ${when}.`,
          url: '/customer/appointments',
        });
      }
      await sendPushToUser('barber', b.barberId, {
        title: 'Haircut tomorrow ✂️',
        body: `${svc} with ${b.customerName} ${when}.`,
        url: '/barber/dashboard',
      });
      b.reminded24h = true;
      changed = true;
      sent++;
    }
    // ~2h reminder: today's appointments starting within the next 2 hours.
    if (b.date === todayStr && !b.reminded2h) {
      const diff = mins - nowMin;
      if (diff > 0 && diff <= 120) {
        if (b.customerId) {
          await sendPushToUser('customer', b.customerId, {
            title: 'Haircut soon ✂️',
            body: `${svc} with ${barber} at ${b.time} today.`,
            url: '/customer/appointments',
          });
        }
        await sendPushToUser('barber', b.barberId, {
          title: 'Haircut soon ✂️',
          body: `${svc} with ${b.customerName} at ${b.time} today.`,
          url: '/barber/dashboard',
        });
        b.reminded2h = true;
        changed = true;
        sent++;
      }
    }
    if (changed) {
      try {
        await saveBooking(b);
      } catch (e) {
        console.error('reminders: saveBooking failed', e);
      }
    }
  }
  return NextResponse.json({ ok: true, sent, payoutRetry });
}
