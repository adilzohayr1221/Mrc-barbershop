import { NextResponse } from 'next/server';
import {
  listSalons, getSalon, saveSalon,
  getSalonOwnerBySalon, saveSalonOwner,
  getBarbers, listBookings, inSalon,
  getBranches, saveBranches, newId,
} from '@/lib/store';

import { requireActiveOwner } from "@/lib/guard";
import { geocodeAddress, hasCoords } from '@/lib/geocode';
import { shopToday } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

// Super-admin: all registered salons, enriched with the stats needed to
// triage requests. Pending first, then newest.
export async function GET(req: Request) {
  if (!(await requireActiveOwner(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [salons, barbers, bookings] = await Promise.all([listSalons(), getBarbers(), listBookings()]);
  const today = shopToday();
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
  if (!(await requireActiveOwner(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    // Registration geocodes once and a failure is silent — retry here so an
    // approved salon never goes live without a map location.
    if (!hasCoords(salon) && salon.address) {
      const coords = await geocodeAddress(salon.address, salon.city);
      if (coords) {
        salon.lat = coords.lat;
        salon.lng = coords.lng;
      }
    }
    salon.status = 'active';
    salon.approvedAt = now;
    await saveSalon(salon);
    const owner = await getSalonOwnerBySalon(salon.id);
    if (owner) {
      owner.active = true;
      await saveSalonOwner(owner);
    }
    // One shop per salon owner: auto-create their single branch from the
    // salon's registered address. Salon owners cannot add branches themselves.
    // Only create the branch when we have real coordinates — a 0,0 branch
    // would pin the shop in the ocean and break distance sorting.
    try {
      if (hasCoords(salon)) {
        const branches = await getBranches();
        const mine = branches.filter((b) => inSalon(b, salon.id));
        if (mine.length === 0) {
          branches.push({
            id: newId(),
            name: salon.name,
            address: salon.address || salon.city || '',
            lat: salon.lat as number,
            lng: salon.lng as number,
            salonId: salon.id,
          });
          await saveBranches(branches);
        } else {
          // Repair a branch created earlier with placeholder 0,0 coords.
          let changed = false;
          for (const b of mine) {
            if (!hasCoords(b)) {
              b.lat = salon.lat as number;
              b.lng = salon.lng as number;
              changed = true;
            }
          }
          if (changed) await saveBranches(branches);
        }
      } else {
        console.warn(
          '[salon-approve] no coordinates for salon',
          salon.id,
          '— branch not created; salon will not appear on the customer map until its address geocodes.'
        );
      }
    } catch (e) {
      console.error('auto-branch creation failed for salon', salon.id, e);
    }
  } else if (action === 'suspend') {
    if (salon.status !== 'active') {
      return NextResponse.json({ error: 'Only active salons can be suspended.' }, { status: 400 });
    }
    salon.status = 'suspended';
    await saveSalon(salon);
    // Audit H6: suspension kills the salon owner's outstanding sessions.
    const sOwner = await getSalonOwnerBySalon(salon.id);
    if (sOwner) {
      sOwner.authVersion = (sOwner.authVersion ?? 0) + 1;
      await saveSalonOwner(sOwner);
    }
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
