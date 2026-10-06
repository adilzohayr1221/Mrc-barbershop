import { NextResponse } from 'next/server';
import { getSalonOwnerByEmail, getSalon } from '@/lib/store';
import { signSession, verifyPassword, isValidEmail } from '@/lib/auth';

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

// Public: salon-owner login (email + password). The salon must be approved
// (status 'active') and the owner account activated — otherwise 403.
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (throttled(ip)) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

  const body = await req.json().catch(() => null);
  const { email, password } = body ?? {};
  if (!isValidEmail(email) || typeof password !== 'string' || !password.length) {
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
  }
  const owner = await getSalonOwnerByEmail(email);
  if (!owner || !verifyPassword(password, owner.passwordHash)) {
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
  }
  const salon = await getSalon(owner.salonId);
  if (!owner.active || !salon || salon.status !== 'active') {
    return NextResponse.json(
      { error: 'Your salon is not activated yet. We will contact you shortly.' },
      { status: 403 }
    );
  }
  return NextResponse.json({
    token: signSession('salon_owner', owner.id, owner.salonId),
    salonName: salon.name,
  });
}
