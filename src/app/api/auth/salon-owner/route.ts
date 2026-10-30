import { NextResponse } from 'next/server';
import { getSalonOwnerByEmail, getSalon } from '@/lib/store';
import { signSession, verifyPassword, isValidEmail } from '@/lib/auth';
import { rateLimitExceeded, clientIp } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Audit M11 (2026-10-29): shared-store throttle, per-account (IP + email)
// with a per-IP cap — replaces the per-instance in-memory map.
const WINDOW_MS = 5 * 60 * 1000;

// Public: salon-owner login (email + password). The salon must be approved
// (status 'active') and the owner account activated — otherwise 403.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { email, password } = body ?? {};
  const ip = clientIp(req);
  const accountKey = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const [overIp, overAccount] = await Promise.all([
    rateLimitExceeded(`salon-owner-auth-ip:${ip}`, 30, WINDOW_MS),
    rateLimitExceeded(`salon-owner-auth:${ip}:${accountKey}`, 10, WINDOW_MS),
  ]);
  if (overIp || overAccount) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
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
    token: signSession('salon_owner', owner.id, owner.salonId, owner.authVersion ?? 0),
    salonName: salon.name,
  });
}
