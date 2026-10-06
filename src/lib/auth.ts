// Session + PIN auth. Server-side only. No plaintext PINs or passwords are ever stored.
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export interface SessionPayload {
  role: 'owner' | 'barber' | 'customer' | 'salon_owner';
  barberId?: string;
  customerId?: string;
  /** Tenant scope. 'mrc' for the platform owner; the salon's id for salon owners.
   *  Missing on old tokens = 'mrc' (backward compatible). */
  salonId?: string;
  exp: number; // epoch ms
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — stay logged in across app restarts

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

/** Create a signed session token. `id` is the barberId for barbers, the customerId for customers. */
export function signSession(
  role: 'owner' | 'barber' | 'customer' | 'salon_owner',
  id?: string,
  salonId?: string
): string {
  const payload: SessionPayload = {
    role,
    barberId: role === 'barber' ? id : undefined,
    customerId: role === 'customer' ? id : undefined,
    salonId: salonId || (role === 'owner' ? 'mrc' : undefined),
    exp: Date.now() + TOKEN_TTL_MS,
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
