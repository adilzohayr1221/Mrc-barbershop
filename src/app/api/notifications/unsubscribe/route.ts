import { NextResponse } from 'next/server';
import { verifySession, bearerToken } from '@/lib/auth';
import { deletePushSubscriptionByEndpointForUser } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Remove this device's push subscription. Body: { endpoint }
// Audit L6 (2026-10-29): unsubscribe now requires a session and only
// removes a subscription that belongs to THAT session's identity —
// previously anyone who learned an endpoint could silently kill another
// user's notifications with an unauthenticated call.
export async function POST(req: Request) {
  const session = verifySession(bearerToken(req));
  if (!session || (session.role !== 'customer' && session.role !== 'barber')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.role === 'customer' ? session.customerId! : session.barberId!;
  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  }
  await deletePushSubscriptionByEndpointForUser(endpoint, session.role, userId);
  return NextResponse.json({ ok: true });
}
