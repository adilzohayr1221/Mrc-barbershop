import { NextResponse } from 'next/server';
import { getPins } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { signSession, verifyPin, isValidPinFormat } from '@/lib/auth';
import { rateLimitExceeded, rateLimitPeek, clientIp } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Audit H8 (2026-10-22): the throttle moved from a per-instance in-memory
// map (reset on every cold start) to the shared store, counts FAILED
// attempts only, and adds a global budget on top of the per-IP one — a
// 4-digit PIN must not be grindable by rotating IPs. 20 failures across all
// IPs in 15 minutes locks owner login for the rest of the window; the
// legitimate owner simply waits it out (his correct PIN is not affected
// once the window passes, and successful logins never consume budget).
const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 8;
const GLOBAL_LIMIT = 20;

export async function POST(req: Request) {
  await ensureSeeded();
  const ip = clientIp(req);
  const [ipFails, globalFails] = await Promise.all([
    rateLimitPeek(`owner-login-fail:${ip}`, WINDOW_MS),
    rateLimitPeek('owner-login-fail:global', WINDOW_MS),
  ]);
  if (ipFails >= PER_IP_LIMIT || globalFails >= GLOBAL_LIMIT) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const { pin } = body ?? {};
  const pins = await getPins();
  const ok = isValidPinFormat(pin) && !!pins && verifyPin(pin, pins.ownerHash);
  if (!ok) {
    await rateLimitExceeded(`owner-login-fail:${ip}`, PER_IP_LIMIT, WINDOW_MS);
    await rateLimitExceeded('owner-login-fail:global', GLOBAL_LIMIT, WINDOW_MS);
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }
  // Audit M10 (2026-10-29): owner tokens now last 7 days (was 30) and are
  // stamped with the pins doc auth version so they can be revoked.
  return NextResponse.json({ token: signSession('owner', undefined, undefined, pins.authVersion ?? 0) });
}
