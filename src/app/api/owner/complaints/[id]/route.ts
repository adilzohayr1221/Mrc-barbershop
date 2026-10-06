import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getComplaint, saveComplaint, saveComp, newId, getServices } from '@/lib/store';
import { sendPushToUser } from '@/lib/push';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';

// POST /api/owner/complaints/[id] — { action: 'grant' | 'dismiss' }.
// Grant = the customer gets a FREE haircut of the same value (comp code),
// never a cash refund.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== 'grant' && action !== 'dismiss') {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  }
  const c = await getComplaint(id);
  if (!c) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (c.status !== 'open') {
    return NextResponse.json({ error: 'Already resolved.' }, { status: 409 });
  }

  if (action === 'dismiss') {
    c.status = 'dismissed';
    c.resolvedAt = new Date().toISOString();
    await saveComplaint(c);
    return NextResponse.json({ ok: true });
  }

  // Grant: free haircut of the same value as the complained-about service.
  const services = await getServices();
  const svc = c.serviceName ? services.find((s) => s.name === c.serviceName) : null;
  const value = svc?.price ?? 40;
  const compId = newId();
  const token = randomUUID().replace(/-/g, '').slice(0, 24);
  await saveComp({
    id: compId,
    token,
    customerId: c.customerId,
    complaintId: c.id,
    serviceId: svc?.id ?? null,
    serviceName: svc?.name ?? c.serviceName ?? 'Haircut',
    value,
    status: 'active',
    createdAt: new Date().toISOString(),
    redeemedAt: null,
    redeemedByBarberId: null,
  });
  c.status = 'granted';
  c.resolvedAt = new Date().toISOString();
  c.compId = compId;
  await saveComplaint(c);

  // Tell the customer their free haircut is ready.
  try {
    await sendPushToUser('customer', c.customerId, {
      title: 'We made it right ✂️',
      body: `Your free ${svc?.name ?? 'haircut'} is ready — show the code at the shop.`,
      url: '/customer/profile',
    });
  } catch (e) {
    console.error('[complaint] grant push failed', e);
  }
  return NextResponse.json({ ok: true, compId });
}
