import { NextResponse } from 'next/server';
import { getCustomerByEmail, getCustomer, saveCustomer, newId } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import {
  signSession,
  verifySession,
  bearerToken,
  hashPassword,
  verifyPassword,
  isValidEmail,
} from '@/lib/auth';
import type { Customer, PublicCustomer } from '@/lib/types';

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

function publicCustomer(c: Customer): PublicCustomer {
  return { id: c.id, name: c.name, email: c.email };
}

function ipOf(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// GET /api/auth/customer — return the logged-in customer (session check).
export async function GET(req: Request) {
  await ensureSeeded();
  const payload = verifySession(bearerToken(req));
  if (!payload || payload.role !== 'customer' || !payload.customerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const customer = await getCustomer(payload.customerId);
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ customer: publicCustomer(customer) });
}

// POST /api/auth/customer — { mode: 'signup'|'login', name?, email, password }
export async function POST(req: Request) {
  await ensureSeeded();
  if (throttled(ipOf(req))) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const { mode, name, email, password } = body ?? {};

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  const cleanEmail = email.trim().toLowerCase();

  if (mode === 'signup') {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
      return NextResponse.json({ error: 'Enter your name.' }, { status: 400 });
    }
    const existing = await getCustomerByEmail(cleanEmail);
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Try logging in instead.' },
        { status: 409 }
      );
    }
    const customer: Customer = {
      id: newId(),
      name: name.trim(),
      email: cleanEmail,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    await saveCustomer(customer);
    return NextResponse.json(
      { token: signSession('customer', customer.id), customer: publicCustomer(customer) },
      { status: 201 }
    );
  }

  if (mode === 'login') {
    const customer = await getCustomerByEmail(cleanEmail);
    // Generic error — don't reveal whether the email exists.
    if (!customer || !verifyPassword(password, customer.passwordHash)) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }
    return NextResponse.json({
      token: signSession('customer', customer.id),
      customer: publicCustomer(customer),
    });
  }

  return NextResponse.json({ error: 'Invalid mode.' }, { status: 400 });
}
