import { NextResponse } from 'next/server';
import { requireActiveBarber } from '@/lib/guard';
import { barberSalonId } from '@/lib/salonScope';
import { listWorkPhotos, saveWorkPhoto, newId, savePhoto, sniffImageType } from '@/lib/store';

export const dynamic = 'force-dynamic';

function photoUrlOf(p: { photoPath: string }): string {
  return `/api/photos/${encodeURIComponent(p.photoPath.split('/').pop() || '')}`;
}

// GET /api/barber/photos → the barber's own work photos (with status).
export async function GET(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const all = await listWorkPhotos();
  const mine = all
    .filter((p) => p.barberId === session.barberId)
    .map((p) => ({ id: p.id, url: photoUrlOf(p), status: p.status, createdAt: p.createdAt }));
  return NextResponse.json({ photos: mine });
}

// POST /api/barber/photos → upload a work photo (goes to "pending", owner must approve).
export async function POST(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const photo = form?.get('photo');
  if (!photo || typeof photo === 'string') {
    return NextResponse.json({ error: 'No photo provided.' }, { status: 400 });
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
  const mine = (await listWorkPhotos()).filter((p) => p.barberId === session.barberId);
  if (mine.length >= 20) {
    return NextResponse.json({ error: 'You can upload up to 20 photos.' }, { status: 400 });
  }
  const id = newId();
  const path = await savePhoto(`work-${session.barberId}-${id}.${sniffed.ext}`, Buffer.from(ab), sniffed.mime);
  await saveWorkPhoto({
    id,
    barberId: session.barberId,
    photoPath: path,
    status: 'pending',
    createdAt: new Date().toISOString(),
    salonId: await barberSalonId(session),
  });
  return NextResponse.json({ ok: true, status: 'pending' });
}
