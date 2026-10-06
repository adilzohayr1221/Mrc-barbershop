import { NextResponse } from 'next/server';
import { deletePushSubscriptionByEndpoint } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Remove this device's push subscription. Body: { endpoint }
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  }
  await deletePushSubscriptionByEndpoint(endpoint);
  return NextResponse.json({ ok: true });
}
