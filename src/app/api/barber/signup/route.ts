import { NextResponse } from 'next/server';
import { getBarbers, saveBarbers, newId } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { hashPassword, isValidEmail } from '@/lib/auth';
import type { Barber } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Simple in-memory throttle: 10 attempts / 5 min per IP.
const attempts = new Map<string, { count: number; resetAt: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return false;
  }
  rec.count += 1;
  return rec.count > 10;
}

// Public: barber self-signup. The barber provides ONLY name + email + password;
// they do NOT choose a salon — the platform owner assigns the salon when approving.
// Creates a PENDING barber (approved: false, no salonId); the owner approves from
// the owner dashboard and picks the salon there.
export async function POST(req: Request) {
  await ensureSeeded();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (throttled(ip)) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

  const contentType = req.headers.get('content-type') || '';
  let name = '', email = '', password = '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    name = String(form.get('name') || '');
    email = String(form.get('email') || '');
    password = String(form.get('password') || '');
  } else {
    const body = await req.json().catch(() => null);
    name = String(body?.name || '');
    email = String(body?.email || '');
    password = String(body?.password || '');
  }

  if (name.trim().length < 2 || name.trim().length > 60) {
    return NextResponse.json({ error: 'Enter your full name.' }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  const cleanEmail = email.trim().toLowerCase();

  const barbers = await getBarbers();
  if (barbers.some((b) => b.active && b.email && b.email.toLowerCase() === cleanEmail)) {
    return NextResponse.json(
      { error: 'An account with this email already exists. Try logging in instead.' },
      { status: 409 }
    );
  }

  const id = newId();
  const barber: Barber = {
    id,
    name: name.trim(),
    photoPath: null,
    skills: [],
    branchIds: [],
    active: true,
    approved: false,
    email: cleanEmail,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    // No salonId — the platform owner assigns the salon when approving.
  };
  barbers.push(barber);
  await saveBarbers(barbers);
  return NextResponse.json({ ok: true }, { status: 201 });
}
