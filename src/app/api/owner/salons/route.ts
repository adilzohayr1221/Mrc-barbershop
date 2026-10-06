import { NextResponse } from 'next/server';
import {
  listSalons, getSalon, saveSalon,
  getSalonOwnerBySalon, saveSalonOwner,
  getBarbers, listBookings, inSalon,
} from '@/lib/store';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Super-admin: all registered salons, enriched with the stats needed to
// triage requests. Pending first, then newest.
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [salons, barbers, bookings] = await Promise.all([listSalons(), getBarbers(), listBookings()]);
  const today = new Date().toISOString().slice(0, 10);
  const enriched = await Promise.all(
    salons.map(async (salon) => {
      const owner = await getSalonOwnerBySalon(salon.id);
      const myBarbers = barbers.filter((b) => inSalon(b, salon.id));
      const myBookings = bookings.filter((b) => inSalon(b, salon.id));
      return {
        salon,
        ownerEmail: owner?.email ?? salon.ownerEmail,
        barberCount: myBarbers.length,
        bookingCount: myBookings.length,
        pendingBookings: myBookings.filter((b) => b.status === 'booked' && b.date >= today).length,
      };
    })
  );
  enriched.sort((a, b) => {
    const aPend = a.salon.status === 'pending' ? 0 : 1;
    const bPend = b.salon.status === 'pending' ? 0 : 1;
    if (aPend !== bPend) return aPend - bPend;
    return b.salon.createdAt.localeCompare(a.salon.createdAt);
  });
  return NextResponse.json({ salons: enriched });
}

type Action = 'approve' | 'suspend' | 'activate' | 'dismiss';

// Super-admin: approve / suspend / activate / dismiss a salon.
export async function POST(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const salonId = String(body?.salonId ?? '');
  const action = body?.action as Action | undefined;
  if (!salonId) return NextResponse.json({ error: 'salonId required' }, { status: 400 });
  if (action !== 'approve' && action !== 'suspend' && action !== 'activate' && action !== 'dismiss') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
  const salon = await getSalon(salonId);
  if (!salon) return NextResponse.json({ error: 'Salon not found.' }, { status: 404 });
  const now = new Date().toISOString();

  if (action === 'approve') {
    if (salon.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending salons can be approved.' }, { status: 400 });
    }
    salon.status = 'active';
    salon.approvedAt = now;
    await saveSalon(salon);
    const owner = await getSalonOwnerBySalon(salon.id);
    if (owner) {
      owner.active = true;
      await saveSalonOwner(owner);
    }
  } else if (action === 'suspend') {
    if (salon.status !== 'active') {
      return NextResponse.json({ error: 'Only active salons can be suspended.' }, { status: 400 });
    }
    salon.status = 'suspended';
    await saveSalon(salon);
  } else if (action === 'activate') {
    if (salon.status !== 'suspended') {
      return NextResponse.json({ error: 'Only suspended salons can be re-activated.' }, { status: 400 });
    }
    salon.status = 'active';
    await saveSalon(salon);
  } else {
    // dismiss: SalonStatus has no 'rejected' — use 'suspended' so the salon
    // no longer shows as pending and its owner cannot log in.
    if (salon.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending salons can be dismissed.' }, { status: 400 });
    }
    salon.status = 'suspended';
    await saveSalon(salon);
  }
  return NextResponse.json({ ok: true, salon });
}
