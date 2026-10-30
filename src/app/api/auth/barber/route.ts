import { NextResponse } from 'next/server';
import { getBarbers, salonOf } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { signSession, verifyPassword, isValidEmail } from '@/lib/auth';
import { rateLimitExceeded, clientIp } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Audit M11 (2026-10-29): shared-store throttle, per-account (IP + email)
// with a per-IP cap — replaces the per-instance in-memory map.
const WINDOW_MS = 5 * 60 * 1000;

// Barber login: email + password only (barbers are approved by the owner
// after signup). No PIN.
export async function POST(req: Request) {
  await ensureSeeded();
  const body = await req.json().catch(() => null);
  const { email, password } = body ?? {};
  const ip = clientIp(req);
  const accountKey = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const [overIp, overAccount] = await Promise.all([
    rateLimitExceeded(`barber-auth-ip:${ip}`, 30, WINDOW_MS),
    rateLimitExceeded(`barber-auth:${ip}:${accountKey}`, 10, WINDOW_MS),
  ]);
  if (overIp || overAccount) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

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
  return NextResponse.json({ token: signSession('barber', barber.id, salonOf(barber), barber.authVersion ?? 0), barberName: barber.name });
}
