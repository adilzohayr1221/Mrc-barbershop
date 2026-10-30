// Session + PIN auth. Server-side only. No plaintext PINs or passwords are ever stored.
import { createHmac, createHash, timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export interface SessionPayload {
  role: 'owner' | 'barber' | 'customer' | 'salon_owner';
  barberId?: string;
  customerId?: string;
  /** Tenant scope. 'mrc' for the platform owner; the salon's id for salon owners.
   *  Missing on old tokens = 'mrc' (backward compatible). */
  salonId?: string;
  /** Auth version stamped at login (audit H5/H6, 2026-10-22). When the
   *  account's authVersion is bumped server-side (deactivation, deletion,
   *  password reset, salon suspension), older tokens are rejected by the
   *  active-account guards. Missing on pre-fix tokens = not enforced. */
  av?: number;
  exp: number; // epoch ms
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — stay logged in across app restarts
// Audit H5/H6: staff roles (barber, salon owner) get a shorter 7-day token
// on top of the authVersion revocation checks.
// Audit M10 (2026-10-29): the OWNER token joins the 7-day schedule too — a
// 30-day all-powerful token with no revocation was the outlier. Owner
// tokens are also `av`-stamped (pins doc authVersion) so they can be
// revoked server-side like staff tokens.
const STAFF_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not configured');
  return s;
}

function b64urlEncode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function b64urlDecode<T>(s: string): T {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as T;
}

/** Create a signed session token. `id` is the barberId for barbers, the customerId for customers.
 *  `authVersion` is stamped as `av` so the account can revoke outstanding
 *  tokens by bumping it server-side (barbers, salon owners, and — audit
 *  M7/M10, 2026-10-29 — customers and the owner too). */
export function signSession(
  role: 'owner' | 'barber' | 'customer' | 'salon_owner',
  id?: string,
  salonId?: string,
  authVersion?: number
): string {
  const staff = role === 'barber' || role === 'salon_owner' || role === 'owner';
  const payload: SessionPayload = {
    role,
    barberId: role === 'barber' ? id : undefined,
    customerId: role === 'customer' ? id : undefined,
    salonId: salonId || (role === 'owner' ? 'mrc' : undefined),
    av: authVersion !== undefined ? authVersion : staff ? 0 : undefined,
    exp: Date.now() + (staff ? STAFF_TOKEN_TTL_MS : TOKEN_TTL_MS),
  };
  const body = b64urlEncode(payload);
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify a session token. Returns the payload or null. */
export function verifySession(token: string | null | undefined): SessionPayload | null {
  try {
    if (!token) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', secret()).update(body).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (expected.length !== actual.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;
    const payload = b64urlDecode<SessionPayload>(body);
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (payload.role !== 'owner' && payload.role !== 'barber' && payload.role !== 'customer' && payload.role !== 'salon_owner') return null;
    if (payload.role === 'barber' && typeof payload.barberId !== 'string') return null;
    if (payload.role === 'customer' && typeof payload.customerId !== 'string') return null;
    if (payload.role === 'salon_owner' && typeof payload.salonId !== 'string') return null;
    // Backward compat: old tokens predate salonId — they belong to the platform salon.
    if (!payload.salonId) payload.salonId = 'mrc';
    return payload;
  } catch {
    return null;
  }
}

/** Extract Bearer token from a request. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

/** Require an owner session; returns payload or null. */
export function requireOwner(req: Request): SessionPayload | null {
  const s = verifySession(bearerToken(req));
  return s && s.role === 'owner' ? s : null;
}

/** Require a salon-owner session (a shop owner under the platform owner). */
export function requireSalonOwner(req: Request): SessionPayload | null {
  const s = verifySession(bearerToken(req));
  return s && s.role === 'salon_owner' && s.salonId ? s : null;
}

/** Tenant scope of a session: which salon's data it may touch. */
export function sessionSalonId(s: SessionPayload): string {
  return s.salonId || 'mrc';
}

/** Require a barber session; returns payload or null. */
export function requireBarber(req: Request): SessionPayload | null {
  const s = verifySession(bearerToken(req));
  return s && s.role === 'barber' && s.barberId ? s : null;
}

/** Require a customer session; returns payload or null. */
export function requireCustomer(req: Request): SessionPayload | null {
  const s = verifySession(bearerToken(req));
  return s && s.role === 'customer' && s.customerId ? s : null;
}

export function hashPin(pin: string): string {
  return bcrypt.hashSync(pin, 10);
}

export function verifyPin(pin: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(pin, hash);
  } catch {
    return false;
  }
}

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

/** Constant-time comparison of a shared secret header against the configured
 *  value (audit M14, 2026-10-22). Both sides are SHA-256 hashed first so the
 *  timingSafeEqual inputs are always the same length. */
export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Signed URL for a private photo (audit H7, 2026-10-22). Dashboards embed
 *  photos with plain <img> tags (no Authorization header), so private files
 *  (ID photos, complaint photos, completion photos, profile photos) are
 *  handed out only as HMAC-signed URLs minted by an authorized API response,
 *  or to a request carrying a valid session.
 *  Audit M9 (2026-10-29): signed URLs now carry an EXPIRY (`e`, epoch ms;
 *  default 60 minutes) so a leaked link dies on its own. verifyPhotoSig
 *  still accepts the legacy no-expiry signature so URLs minted before this
 *  change (e.g. inside already-delivered pages) keep working until their
 *  pages refresh; new mints always expire. */
export const PHOTO_URL_TTL_MS = 60 * 60 * 1000;

export function signPhotoUrl(name: string, ttlMs: number = PHOTO_URL_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const sig = createHmac('sha256', secret()).update(`photo:${name}:${exp}`).digest('base64url');
  return `/api/photos/${encodeURIComponent(name)}?s=${sig}&e=${exp}`;
}

export function verifyPhotoSig(
  name: string,
  sig: string | null | undefined,
  exp?: string | number | null
): boolean {
  if (!sig) return false;
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, 'base64url');
  } catch {
    return false;
  }
  const matches = (msg: string): boolean => {
    const expected = createHmac('sha256', secret()).update(msg).digest();
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  };
  if (exp !== undefined && exp !== null && exp !== '') {
    const expMs = typeof exp === 'number' ? exp : parseInt(exp, 10);
    if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
    return matches(`photo:${name}:${expMs}`);
  }
  // Legacy pre-expiry signature (no `e` param).
  return matches(`photo:${name}`);
}

// ---- Customer password hashing (node:crypto scrypt, no extra deps) ----

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 32 * 1024 * 1024,
  }).toString('hex');
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${key}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = parts[4];
    if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || !salt) return false;
    const expected = Buffer.from(parts[5], 'hex');
    const actual = scryptSync(password, salt, SCRYPT_KEYLEN, {
      N: n,
      r,
      p,
      maxmem: 32 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 120;
}
