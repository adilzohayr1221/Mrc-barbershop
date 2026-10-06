import { NextResponse } from 'next/server';
import { listSalons, saveSalon, saveSalonOwner, getSalonOwnerByEmail, newId } from '@/lib/store';
import { hashPassword, isValidEmail } from '@/lib/auth';
import type { Salon, SalonOwner } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Simple in-memory throttle: 8 attempts / 5 min per IP.
const attempts = new Map<string, { count: number; resetAt: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return false;
  }
  rec.count += 1;
  return rec.count > 8;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Public: a salon owner registers his shop for the platform.
// Creates a PENDING Salon + an inactive SalonOwner; the platform owner
// approves from the owner dashboard.
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (throttled(ip)) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

  const body = await req.json().catch(() => null);
  const salonName = String(body?.salonName ?? '').trim();
  const ownerName = String(body?.ownerName ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  const phone = String(body?.phone ?? '').trim();
  const city = String(body?.city ?? '').trim();
  const password = String(body?.password ?? '');

  if (!salonName || !ownerName || !email || !phone || !city || !password) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }
  if (salonName.length > 60 || ownerName.length > 60 || city.length > 60 || phone.length > 30) {
    return NextResponse.json({ error: 'A field is too long.' }, { status: 400 });
  }

  const existingOwner = await getSalonOwnerByEmail(email);
  if (existingOwner) {
    return NextResponse.json(
      { error: 'This email is already registered. Try logging in instead.' },
      { status: 409 }
    );
  }

  const salons = await listSalons();
  const takenSlugs = new Set(salons.map((s) => s.slug));
  let slug = slugify(salonName) || 'salon';
  if (takenSlugs.has(slug)) {
    let n = 2;
    while (takenSlugs.has(`${slug}-${n}`)) n += 1;
    slug = `${slug}-${n}`;
  }

  const salonId = newId();
  const now = new Date().toISOString();
  const salon: Salon = {
    id: salonId,
    name: salonName,
    slug,
    ownerName,
    ownerEmail: email,
    ownerPhone: phone,
    city,
    status: 'pending',
    createdAt: now,
    approvedAt: null,
  };
  const owner: SalonOwner = {
    id: newId(),
    salonId,
    name: ownerName,
    email,
    passwordHash: hashPassword(password),
    active: false,
    createdAt: now,
  };
  await saveSalon(salon);
  await saveSalonOwner(owner);
  return NextResponse.json({ ok: true });
}
