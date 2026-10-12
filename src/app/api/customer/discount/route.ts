import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { getCustomer, saveCustomer, savePhoto } from '@/lib/store';

export const dynamic = 'force-dynamic';

// GET /api/customer/discount — the customer's own discount request/status.
export async function GET(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const customer = await getCustomer(session.customerId);
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ discount: customer.discount ?? null });
}

// POST /api/customer/discount — request the 15% student/military discount.
// formData: type ('student'|'military'), photo (ID image, max 5MB).
// The request goes to "pending"; the owner approves or rejects it.
export async function POST(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const customer = await getCustomer(session.customerId);
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const st = customer.discount?.status;
  if (st === 'pending') {
    return NextResponse.json({ error: 'Your discount request is already under review.' }, { status: 409 });
  }
  if (st === 'approved') {
    return NextResponse.json({ error: 'Your 15% discount is already active.' }, { status: 409 });
  }

  const form = await req.formData().catch(() => null);
  const type = form?.get('type');
  if (type !== 'student' && type !== 'military') {
    return NextResponse.json({ error: 'Choose Student or Military.' }, { status: 400 });
  }
  const photo = form?.get('photo');
  if (!photo || typeof photo === 'string') {
    return NextResponse.json({ error: 'Please upload a photo of your ID.' }, { status: 400 });
  }
  const ab = await photo.arrayBuffer();
  if (ab.byteLength > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Photo is too large (max 5MB).' }, { status: 400 });
  }
  const mime = photo.type || 'image/jpeg';
  if (!mime.startsWith('image/')) {
    return NextResponse.json({ error: 'File must be an image.' }, { status: 400 });
  }
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const path = await savePhoto(`discount-${customer.id}-${Date.now()}.${ext}`, Buffer.from(ab), mime);

  customer.discount = {
    type,
    status: 'pending',
    photoPath: path,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
  };
  await saveCustomer(customer);
  return NextResponse.json({ ok: true, status: 'pending' });
}
