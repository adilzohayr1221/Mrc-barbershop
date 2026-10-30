import { NextResponse } from 'next/server';
import { verifySession, bearerToken } from '@/lib/auth';
import { savePushSubscription, deletePushSubscriptionByEndpoint, newId } from '@/lib/store';
import { isPushConfigured } from '@/lib/push';
import { validateCustomerSession, validateBarberSession } from '@/lib/guard';

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
  // Audit M7 (2026-10-29): the account behind the token must still exist
  // at the token's auth version.
  const stillValid =
    session.role === 'customer' ? await validateCustomerSession(session) : await validateBarberSession(session);
  if (!stillValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.role === 'customer' ? session.customerId! : session.barberId!;
  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  // Audit L6 (2026-10-29): validate the subscription shape properly — the
  // endpoint must be an https URL of bounded length and the keys bounded
  // base64url strings, not arbitrary blobs stored and later handed to the
  // push service.
  if (
    !sub ||
    typeof sub.endpoint !== 'string' ||
    sub.endpoint.length > 2048 ||
    !/^https:\/\//.test(sub.endpoint) ||
    typeof sub.keys?.p256dh !== 'string' ||
    sub.keys.p256dh.length < 20 ||
    sub.keys.p256dh.length > 200 ||
    typeof sub.keys?.auth !== 'string' ||
    sub.keys.auth.length < 8 ||
    sub.keys.auth.length > 100
  ) {
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
