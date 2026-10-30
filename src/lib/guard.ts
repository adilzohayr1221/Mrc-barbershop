// Active-account session guards + shared rate limiting (audit H5/H6/M11,
// 2026-10-22). requireBarber/requireSalonOwner in auth.ts only verify the
// token signature; these guards additionally check the account is still
// active/approved RIGHT NOW and that the token's auth version (`av`) matches
// the account's current authVersion — so deactivating a barber, deleting his
// account, resetting his password, or suspending a salon kills outstanding
// sessions immediately instead of at token expiry.
//
// Backward compatibility: tokens minted before this fix carry no `av`; those
// are accepted (they expire on the old schedule) — only tokens that DO carry
// an `av` are version-checked. New logins always stamp `av`.
import { requireBarber, requireCustomer, requireOwner, requireSalonOwner, type SessionPayload } from './auth';
import { getBarbers, getCustomer, getPins, getSalon, getSalonOwnerBySalon } from './store';
import { listDocs, delDoc, putDocCreateOnly } from './blob';
import { randomUUID } from 'node:crypto';

function versionOk(session: SessionPayload, current: number | undefined): boolean {
  if (session.av === undefined) return true; // pre-fix token — expires naturally
  return session.av === (current ?? 0);
}

/** Barber session + the barber is still active and approved. */
export async function requireActiveBarber(req: Request): Promise<SessionPayload | null> {
  const session = requireBarber(req);
  if (!session?.barberId) return null;
  const barber = (await getBarbers()).find((b) => b.id === session.barberId);
  if (!barber || !barber.active || barber.approved === false) return null;
  if (!versionOk(session, barber.authVersion)) return null;
  return session;
}

/** Salon-owner session + the owner account is active and the salon is not suspended. */
export async function requireActiveSalonOwner(req: Request): Promise<SessionPayload | null> {
  const session = requireSalonOwner(req);
  if (!session?.salonId) return null;
  const [owner, salon] = await Promise.all([
    getSalonOwnerBySalon(session.salonId),
    getSalon(session.salonId),
  ]);
  if (!owner || !owner.active || !salon || salon.status !== 'active') return null;
  if (!versionOk(session, owner.authVersion)) return null;
  return session;
}

/** Customer session + the customer still exists and the token's `av`
 *  matches (audit M7, 2026-10-29). Deleting the account or changing /
 *  resetting the password (which bumps authVersion) kills every
 *  outstanding customer session immediately. */
export async function requireActiveCustomer(req: Request): Promise<SessionPayload | null> {
  const session = requireCustomer(req);
  if (!session?.customerId) return null;
  const customer = await getCustomer(session.customerId);
  if (!customer) return null;
  if (!versionOk(session, customer.authVersion)) return null;
  return session;
}

/** Owner session + the token's `av` matches the pins doc (audit M10,
 *  2026-10-29). Pre-fix owner tokens carry no `av` and are accepted until
 *  they expire (they were minted for 30 days; new ones last 7). */
export async function requireActiveOwner(req: Request): Promise<SessionPayload | null> {
  const session = requireOwner(req);
  if (!session) return null;
  const pins = await getPins();
  if (!versionOk(session, pins?.authVersion)) return null;
  return session;
}

/** Session-validity helpers for routes that accept several roles and do
 *  their own participant checks (chats, push): the token must belong to a
 *  still-existing account at the current auth version. */
export async function validateCustomerSession(session: SessionPayload): Promise<boolean> {
  if (session.role !== 'customer' || !session.customerId) return false;
  const customer = await getCustomer(session.customerId);
  return !!customer && versionOk(session, customer.authVersion);
}

export async function validateBarberSession(session: SessionPayload): Promise<boolean> {
  if (session.role !== 'barber' || !session.barberId) return false;
  const barber = (await getBarbers()).find((b) => b.id === session.barberId);
  return !!barber && barber.active && barber.approved !== false && versionOk(session, barber.authVersion);
}

// ---------------------------------------------------------------------------
// Shared rate limiting backed by the doc store (the old per-route in-memory
// maps reset on every cold start and differ per instance).
//
// Audit H4 fix (2026-10-29): the previous implementation kept every counter
// in ONE JSON doc (data/rate-limits.json) updated read-modify-write — two
// concurrent invocations could both read the same snapshot and both write
// back, losing hits, so the owner-PIN limiter (and every other user) could
// be raced past its limit. Counters are now one CREATE-ONLY doc per hit
// under data/rl/<base64url(key)>/<ts>-<uuid>.json: recording a hit can
// never be lost to a racing write, and counting is a prefix list (the list
// API is not CDN-cached) + per-doc timestamp reads. Semantics are
// unchanged: rateLimitExceeded records a hit, then returns count > limit;
// rateLimitPeek only counts. Expired hit docs are swept opportunistically
// (bounded per call) so the prefix cannot grow forever.
// ---------------------------------------------------------------------------

const RL_PREFIX = 'data/rl/';

function rlDir(key: string): string {
  return `${RL_PREFIX}${Buffer.from(key, 'utf8').toString('base64url')}/`;
}

async function listHitTimes(dir: string, now: number, windowMs: number): Promise<{ path: string; t: number }[]> {
  const paths = await listDocs(dir).catch(() => [] as string[]);
  const out: { path: string; t: number }[] = [];
  for (const p of paths) {
    const base = p.slice(dir.length);
    const m = /^(\d+)-/.exec(base);
    if (!m) continue;
    const t = parseInt(m[1], 10);
    if (Number.isFinite(t) && now - t < windowMs) out.push({ path: p, t });
  }
  return out;
}

/** Best-effort sweep of expired hit docs for this key (bounded). */
async function sweepExpired(dir: string, now: number, windowMs: number): Promise<void> {
  const paths = await listDocs(dir).catch(() => [] as string[]);
  let swept = 0;
  for (const p of paths) {
    if (swept >= 25) break;
    const m = /^(\d+)-/.exec(p.slice(dir.length));
    if (!m) continue;
    const t = parseInt(m[1], 10);
    if (Number.isFinite(t) && now - t >= windowMs) {
      swept++;
      await delDoc(p).catch(() => {});
    }
  }
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function rateLimitExceeded(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  const dir = rlDir(key);
  // Record first (create-only: this hit can never be lost), then count.
  await putDocCreateOnly(`${dir}${now}-${randomUUID()}.json`, { t: now }).catch(() => false);
  const hits = await listHitTimes(dir, now, windowMs);
  if (Math.random() < 0.1) void sweepExpired(dir, now, windowMs);
  return hits.length > limit;
}

/** Read-only: how many hits a key has inside the window (no recording). */
export async function rateLimitPeek(key: string, windowMs: number): Promise<number> {
  const now = Date.now();
  const hits = await listHitTimes(rlDir(key), now, windowMs);
  return hits.length;
}
