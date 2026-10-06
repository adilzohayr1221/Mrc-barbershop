import { NextResponse } from 'next/server';
import { getPins } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { signSession, verifyPin, isValidPinFormat } from '@/lib/auth';

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

export async function POST(req: Request) {
  await ensureSeeded();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (throttled(ip)) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

  const body = await req.json().catch(() => null);
  const { pin } = body ?? {};
  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }
  const pins = await getPins();
  if (!pins || !verifyPin(pin, pins.ownerHash)) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }
  return NextResponse.json({ token: signSession('owner') });
}
