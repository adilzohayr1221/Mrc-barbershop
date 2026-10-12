import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getCustomers, getCustomer, saveCustomer } from '@/lib/store';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

function photoUrlOf(photoPath: string | null | undefined): string | null {
  if (!photoPath) return null;
  return `/api/photos/${encodeURIComponent(photoPath.split('/').pop() || '')}`;
}

// GET /api/owner/discounts — pending requests and approved discounts.
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const customers = await getCustomers();
  const withDiscount = customers
    .filter((c) => c.discount && (c.discount.status === 'pending' || c.discount.status === 'approved'))
    .map((c) => ({
      customerId: c.id,
      name: c.name,
      email: c.email,
      type: c.discount!.type,
      status: c.discount!.status,
      photoUrl: photoUrlOf(c.discount!.photoPath),
      requestedAt: c.discount!.requestedAt,
      decidedAt: c.discount!.decidedAt ?? null,
    }))
    .sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));
  return NextResponse.json({ discounts: withDiscount });
}

// POST /api/owner/discounts — { customerId, action: 'approve'|'reject'|'revoke' }.
export async function POST(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const customerId = body?.customerId;
  const action = body?.action;
  if (typeof customerId !== 'string' || !customerId) {
    return NextResponse.json({ error: 'customerId required' }, { status: 400 });
  }
  if (action !== 'approve' && action !== 'reject' && action !== 'revoke') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
  const customer = await getCustomer(customerId);
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

  const now = new Date().toISOString();
  if (action === 'revoke') {
    customer.discount = null;
  } else {
    if (!customer.discount || customer.discount.status !== 'pending') {
      return NextResponse.json({ error: 'No pending request for this customer.' }, { status: 409 });
    }
    customer.discount.status = action === 'approve' ? 'approved' : 'rejected';
    customer.discount.decidedAt = now;
  }
  await saveCustomer(customer);

  // The customer is notified of the decision (the owner has no push channel).
  if (action === 'approve') {
    void sendPushToUser('customer', customer.id, {
      title: 'Discount approved 🎓',
      body: 'Your 15% student/military discount is now active on all offers.',
      url: '/customer/profile',
    });
  } else if (action === 'reject') {
    void sendPushToUser('customer', customer.id, {
      title: 'Discount request reviewed',
      body: 'Your discount request was not approved. You can try again from your profile.',
      url: '/customer/profile',
    });
  }
  return NextResponse.json({ ok: true });
}
