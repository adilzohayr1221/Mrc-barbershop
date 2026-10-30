import { NextResponse } from 'next/server';
import { signPhotoUrl } from "@/lib/auth";
import { requireActiveCustomer } from "@/lib/guard";
import { listComplaints, saveComplaint, savePhoto, newId, listBookings, sniffImageType } from '@/lib/store';
import { shopToday } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

function photoUrlOf(p: { photoPath: string }): string {
  return signPhotoUrl(p.photoPath.split('/').pop() || '');
}

// POST /api/complaints — customer reports a problem with a haircut.
// Multipart: bookingId, text, photo (taken with the camera — the file input
// uses capture="environment" so the gallery picker is skipped on phones).
export async function POST(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const bookingId = form?.get('bookingId');
  const text = form?.get('text');
  const photo = form?.get('photo');
  if (typeof bookingId !== 'string' || !bookingId) {
    return NextResponse.json({ error: 'Pick the appointment.' }, { status: 400 });
  }
  if (typeof text !== 'string' || text.trim().length < 5) {
    return NextResponse.json({ error: 'Describe the problem (a few words).' }, { status: 400 });
  }
  if (!photo || typeof photo === 'string') {
    return NextResponse.json({ error: 'Take a photo of the problem with your camera.' }, { status: 400 });
  }
  const booking = (await listBookings()).find(
    (b) => b.id === bookingId && b.customerId === session.customerId
  );
  if (!booking) {
    return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });
  }
  // Audit L8 (2026-10-29): a complaint is about a haircut that happened —
  // the booking must be completed, not merely booked.
  if (!booking.completedAt) {
    return NextResponse.json({ error: 'Complaints are for completed haircuts.' }, { status: 400 });
  }
  // Audit M9 (2026-10-22): complaints are for a haircut within the last 14
  // days — the picker enforced this in the UI but the API accepted any
  // booking id. Calendar-day difference on shop-local dates (noon-anchored
  // so DST can never shrink/extend the window).
  {
    const dayMs = 24 * 3600 * 1000;
    const bookedDay = new Date(`${booking.date}T12:00:00Z`).getTime();
    const todayDay = new Date(`${shopToday()}T12:00:00Z`).getTime();
    const ageDays = Math.round((todayDay - bookedDay) / dayMs);
    if (ageDays < 0 || ageDays > 14) {
      return NextResponse.json(
        { error: 'Complaints can only be filed within 14 days of the appointment.' },
        { status: 400 }
      );
    }
  }
  // One open complaint per appointment.
  const existing = (await listComplaints()).find(
    (c) => c.bookingId === bookingId && c.status === 'open'
  );
  if (existing) {
    return NextResponse.json({ error: 'You already reported this appointment.' }, { status: 409 });
  }
  const ab = await photo.arrayBuffer();
  if (ab.byteLength > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Photo is too large (max 5MB).' }, { status: 400 });
  }
  // Audit M13 (2026-10-22): sniff the real image type from the bytes; the
  // client-supplied MIME type is not trusted.
  const sniffed = sniffImageType(Buffer.from(ab));
  if (!sniffed) {
    return NextResponse.json({ error: 'File must be an image.' }, { status: 400 });
  }
  const id = newId();
  const path = await savePhoto(`complaint-${id}.${sniffed.ext}`, Buffer.from(ab), sniffed.mime);
  const { getServices } = await import('@/lib/store');
  const svc = (await getServices()).find((s) => s.id === booking.serviceId);
  const complaint = {
    id,
    customerId: session.customerId,
    barberId: booking.barberId,
    bookingId: booking.id,
    serviceName: svc?.name,
    text: text.trim().slice(0, 1000),
    photoPath: path,
    status: 'open' as const,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    compId: null,
  };
  await saveComplaint(complaint);

  return NextResponse.json({ ok: true, id });
}

// GET /api/complaints/mine — my complaints + comp codes for granted ones.
export async function GET(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { getComp } = await import('@/lib/store');
  const mine = (await listComplaints()).filter((c) => c.customerId === session.customerId);
  const rows = await Promise.all(
    mine.map(async (c) => {
      let comp: { code: string; serviceName: string; value: number; status: string } | null = null;
      if (c.compId) {
        const cp = await getComp(c.compId);
        if (cp && cp.status === 'active') {
          comp = {
            code: `MRC4:${cp.id}:${cp.token}`,
            serviceName: cp.serviceName,
            value: cp.value,
            status: cp.status,
          };
        }
      }
      return {
        id: c.id,
        barberId: c.barberId,
        serviceName: c.serviceName ?? null,
        text: c.text,
        photoUrl: photoUrlOf(c),
        status: c.status,
        createdAt: c.createdAt,
        comp,
      };
    })
  );
  return NextResponse.json({ complaints: rows });
}
