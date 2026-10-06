import { NextResponse } from 'next/server';
import { getBarbers, salonOf } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
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

// Barber login: email + password only (barbers are approved by the owner
// after signup). No PIN.
export async function POST(req: Request) {
  await ensureSeeded();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (throttled(ip)) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

  const body = await req.json().catch(() => null);
  const { email, password } = body ?? {};

  if (!isValidEmail(email) || typeof password !== 'string' || !password.length) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  const barbers = await getBarbers();
  const barber = barbers.find(
    (b) => b.email && b.email.toLowerCase() === String(email).trim().toLowerCase()
  );
  if (!barber || !barber.active || !barber.passwordHash || !verifyPassword(password, barber.passwordHash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  if (barber.approved === false) {
    return NextResponse.json(
      { error: 'Your account is waiting for owner approval.' },
      { status: 403 }
    );
  }
  return NextResponse.json({ token: signSession('barber', barber.id, salonOf(barber)), barberName: barber.name });
}
