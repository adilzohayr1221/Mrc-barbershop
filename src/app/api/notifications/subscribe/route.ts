import { NextResponse } from 'next/server';
import { verifySession, bearerToken } from '@/lib/auth';
import { savePushSubscription, deletePushSubscriptionByEndpoint, newId } from '@/lib/store';
import { isPushConfigured } from '@/lib/push';

export const dynamic = 'force-dynamic';

// Customer or barber: register this device for push notifications.
// Body: { subscription: { endpoint, keys: { p256dh, auth } } }
export async function POST(req: Request) {
  if (!isPushConfigured()) {
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 503 });
  }
  const session = verifySession(bearerToken(req));
  if (!session || (session.role !== 'customer' && session.role !== 'barber')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.role === 'customer' ? session.customerId! : session.barberId!;
  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription.' }, { status: 400 });
  }
  // One doc per endpoint — replace any previous registration of this device.
  await deletePushSubscriptionByEndpoint(sub.endpoint);
  await savePushSubscription({
    id: newId(),
    role: session.role,
    userId,
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
