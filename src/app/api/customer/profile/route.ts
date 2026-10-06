import { NextResponse } from 'next/server';
import { getCustomer, saveCustomer, getBarbers, savePhoto } from '@/lib/store';
import { requireCustomer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function photoUrlOf(c: { photoPath?: string | null }): string | null {
  return c.photoPath ? `/api/photos/${encodeURIComponent(c.photoPath.split('/').pop() || '')}` : null;
}

// Customer's own profile: name, email, photo, and favorite barber.
export async function GET(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = await getCustomer(session.customerId);
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let favoriteBarber: { id: string; name: string; photoUrl: string | null; branchIds: string[] } | null = null;
  if (c.favoriteBarberId) {
    const barbers = await getBarbers();
    const b = barbers.find((x) => x.id === c.favoriteBarberId);
    if (b) {
      favoriteBarber = {
        id: b.id,
        name: b.name,
        photoUrl: b.photoPath ? `/api/photos/${encodeURIComponent(b.photoPath.split('/').pop() || '')}` : null,
        branchIds: b.branchIds ?? [],
      };
    }
  }
  return NextResponse.json({
    profile: {
      id: c.id,
      name: c.name,
      email: c.email,
      photoUrl: photoUrlOf(c),
      favoriteBarberId: c.favoriteBarberId ?? null,
      favoriteBarber,
    },
  });
}

// Update name and/or favorite barber (JSON body).
export async function PATCH(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = await getCustomer(session.customerId);
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json().catch(() => null);

  if (typeof body?.name === 'string') {
    const name = body.name.trim().slice(0, 60);
    if (name.length < 2) return NextResponse.json({ error: 'Name is too short.' }, { status: 400 });
    c.name = name;
  }
  if (body?.favoriteBarberId !== undefined) {
    const fid = body.favoriteBarberId;
    if (fid === null) {
      c.favoriteBarberId = null;
    } else if (typeof fid === 'string' && fid.length > 0) {
      const barbers = await getBarbers();
      const b = barbers.find((x) => x.id === fid);
      if (!b) return NextResponse.json({ error: 'Barber not found.' }, { status: 404 });
      c.favoriteBarberId = b.id;
    } else {
      return NextResponse.json({ error: 'Invalid barber.' }, { status: 400 });
    }
  }
  await saveCustomer(c);
  return NextResponse.json({ ok: true, photoUrl: photoUrlOf(c), favoriteBarberId: c.favoriteBarberId ?? null, name: c.name });
}

// Upload/replace the profile photo (multipart form-data, field "photo").
export async function POST(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = await getCustomer(session.customerId);
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const path = await savePhoto(`customer-${c.id}.${ext}`, Buffer.from(ab), type);
  c.photoPath = path;
  await saveCustomer(c);
  return NextResponse.json({ ok: true, photoUrl: photoUrlOf(c) });
}
