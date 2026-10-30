import { NextResponse } from 'next/server';
import {
  getPhoto,
  listBookings,
  listGifts,
  listAllRedemptions,
  listComplaints,
  listTasks,
  listSkillVerifications,
} from '@/lib/store';
import { verifySession, bearerToken, verifyPhotoSig, type SessionPayload } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';

export const dynamic = 'force-dynamic';

// Serves files under photos/. Portfolio/business images (barber profile +
// work photos, shop products) are public. PRIVATE files — discount ID
// photos, complaint photos, completion proof photos, task photos and
// customer profile photos — require either a valid session (scoped below)
// or an HMAC-signed URL minted by an authorized API response (dashboards
// embed photos with plain <img> tags, which can't carry an Authorization
// header). Signed URLs expire (audit M9, 2026-10-29).
// Audit H7 (2026-10-22): previously EVERYTHING here was public —
// anyone who learned or guessed a filename could read ID photos.
// Audit M9 (2026-10-29): session access to STAFF photos is no longer "any
// signed-in role reads everything" — the file is resolved to its owning
// record and the session must belong to that record's salon or be one of
// its participants. The platform owner keeps full access.
const PRIVATE_PREFIXES = ['discount-', 'complaint-', 'customer-', 'done-', 'plan-', 'gift-', 'task-', 'skill-'];
// Files owned by one customer: only the owner or that customer may read.
const CUSTOMER_OWNED_PREFIXES = ['discount-', 'customer-'];

function isPrivate(name: string): boolean {
  return PRIVATE_PREFIXES.some((p) => name.startsWith(p));
}

interface PhotoOwner {
  salonId: string;
  barberId?: string | null;
  customerId?: string | null;
}

function baseOf(path: string | null | undefined): string {
  return path ? path.split('/').pop() || '' : '';
}

/** Resolve a staff-photo file name to the record that owns it, so access
 *  can be scoped to that record's salon and participants. Returns null when
 *  no record references the file (orphan) — non-owner sessions are then
 *  denied (fail closed). */
async function resolvePhotoOwner(name: string): Promise<PhotoOwner | null> {
  if (name.startsWith('done-')) {
    const b = (await listBookings()).find((x) => baseOf(x.completionPhotoPath) === name);
    return b ? { salonId: b.salonId ?? 'mrc', barberId: b.barberId, customerId: b.customerId } : null;
  }
  if (name.startsWith('gift-')) {
    const g = (await listGifts()).find((x) => baseOf(x.completionPhotoPath) === name);
    return g
      ? { salonId: g.salonId ?? 'mrc', barberId: g.redeemedByBarberId, customerId: g.claimedByCustomerId ?? g.buyerCustomerId }
      : null;
  }
  if (name.startsWith('plan-')) {
    const r = (await listAllRedemptions()).find((x) => baseOf(x.photoPath) === name);
    return r ? { salonId: r.salonId ?? 'mrc', barberId: r.barberId, customerId: r.customerId } : null;
  }
  if (name.startsWith('complaint-')) {
    const c = (await listComplaints()).find((x) => baseOf(x.photoPath) === name);
    return c ? { salonId: c.salonId ?? 'mrc', barberId: c.barberId, customerId: c.customerId } : null;
  }
  if (name.startsWith('task-')) {
    const t = (await listTasks()).find((x) => (x.assignments ?? []).some((a) => baseOf(a.photoPath) === name));
    return t ? { salonId: t.salonId ?? 'mrc' } : null;
  }
  if (name.startsWith('skill-')) {
    const v = (await listSkillVerifications()).find((x) => (x.photoPaths ?? []).some((p) => baseOf(p) === name));
    return v ? { salonId: v.salonId ?? 'mrc', barberId: v.barberId } : null;
  }
  return null;
}

async function authorized(req: Request, name: string): Promise<boolean> {
  const params = new URL(req.url).searchParams;
  if (verifyPhotoSig(name, params.get('s'), params.get('e'))) return true;
  const session: SessionPayload | null = verifySession(bearerToken(req));
  if (!session) return false;
  if (session.role === 'owner') return true;
  if (CUSTOMER_OWNED_PREFIXES.some((p) => name.startsWith(p))) {
    // discount-<customerId>-<ts>.<ext> / customer-<customerId>.<ext>
    return session.role === 'customer' && name.includes(`-${session.customerId}`);
  }
  // Staff photos: scope to the owning record's salon / participants.
  const rec = await resolvePhotoOwner(name);
  if (!rec) return false;
  if (session.role === 'customer') return !!session.customerId && rec.customerId === session.customerId;
  if (session.role === 'salon_owner') return rec.salonId === (session.salonId || 'mrc');
  if (session.role === 'barber') {
    if (rec.barberId && rec.barberId === session.barberId) return true;
    return rec.salonId === (await barberSalonId(session));
  }
  return false;
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const name = (path || []).join('/');
  if (!name || name.includes('..') || name.length > 120) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const base = name.split('/').pop() || name;
  const priv = isPrivate(base);
  if (priv && !(await authorized(req, base))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const file = await getPhoto(name);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(file.data, {
    headers: {
      'Content-Type': file.contentType,
      // Audit M13: never let a browser sniff a different type than served.
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': priv ? 'private, no-store' : 'public, max-age=86400',
    },
  });
}
