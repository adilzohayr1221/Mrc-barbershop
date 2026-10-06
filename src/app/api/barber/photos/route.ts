import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';
import { listWorkPhotos, saveWorkPhoto, newId, savePhoto } from '@/lib/store';

export const dynamic = 'force-dynamic';

function photoUrlOf(p: { photoPath: string }): string {
  return `/api/photos/${encodeURIComponent(p.photoPath.split('/').pop() || '')}`;
}

// GET /api/barber/photos → the barber's own work photos (with status).
export async function GET(req: Request) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const all = await listWorkPhotos();
  const mine = all
    .filter((p) => p.barberId === session.barberId)
    .map((p) => ({ id: p.id, url: photoUrlOf(p), status: p.status, createdAt: p.createdAt }));
  return NextResponse.json({ photos: mine });
}

// POST /api/barber/photos → upload a work photo (goes to "pending", owner must approve).
export async function POST(req: Request) {
  const session = requireBarber(req);
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
  const type = photo.type || 'image/jpeg';
  if (!type.startsWith('image/')) {
    return NextResponse.json({ error: 'File must be an image.' }, { status: 400 });
  }
  const mine = (await listWorkPhotos()).filter((p) => p.barberId === session.barberId);
  if (mine.length >= 20) {
    return NextResponse.json({ error: 'You can upload up to 20 photos.' }, { status: 400 });
  }
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const id = newId();
  const path = await savePhoto(`work-${session.barberId}-${id}.${ext}`, Buffer.from(ab), type);
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
