import { NextResponse } from 'next/server';

import { requireActiveCustomer } from "@/lib/guard";
import { getCustomer, saveCustomer, savePhoto, sniffImageType, deletePhoto } from '@/lib/store';

export const dynamic = 'force-dynamic';

// GET /api/customer/discount — the customer's own discount request/status.
export async function GET(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const customer = await getCustomer(session.customerId);
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ discount: customer.discount ?? null });
}

// POST /api/customer/discount — request the 15% student/military discount.
// formData: type ('student'|'military'), photo (ID image, max 5MB).
// The request goes to "pending"; the owner approves or rejects it.
export async function POST(req: Request) {
  const session = await requireActiveCustomer(req);
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
  // Audit M13: sniff the real image type from the bytes.
  const sniffed = sniffImageType(Buffer.from(ab));
  if (!sniffed) {
    return NextResponse.json({ error: 'File must be an image.' }, { status: 400 });
  }
  const previousPhotoPath = customer.discount?.photoPath;
  const path = await savePhoto(`discount-${customer.id}-${Date.now()}.${sniffed.ext}`, Buffer.from(ab), sniffed.mime);

  customer.discount = {
    type,
    status: 'pending',
    photoPath: path,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
  };
  await saveCustomer(customer);
  // Audit L9 (2026-10-29): a re-request (after a rejection) replaces the
  // ID photo — delete the old blob instead of orphaning it.
  if (previousPhotoPath && previousPhotoPath !== path) await deletePhoto(previousPhotoPath);
  return NextResponse.json({ ok: true, status: 'pending' });
}
