import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { listComplaints, saveComplaint, savePhoto, newId, listBookings } from '@/lib/store';

export const dynamic = 'force-dynamic';

function photoUrlOf(p: { photoPath: string }): string {
  return `/api/photos/${encodeURIComponent(p.photoPath.split('/').pop() || '')}`;
}

// POST /api/complaints — customer reports a problem with a haircut.
// Multipart: bookingId, text, photo (taken with the camera — the file input
// uses capture="environment" so the gallery picker is skipped on phones).
export async function POST(req: Request) {
  const session = requireCustomer(req);
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
  const type = photo.type || 'image/jpeg';
  if (!type.startsWith('image/')) {
    return NextResponse.json({ error: 'File must be an image.' }, { status: 400 });
  }
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const id = newId();
  const path = await savePhoto(`complaint-${id}.${ext}`, Buffer.from(ab), type);
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
  const session = requireCustomer(req);
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
