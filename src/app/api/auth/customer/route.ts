import { NextResponse } from 'next/server';
import { getCustomerByEmail, getCustomer, saveCustomer, newId, claimOnce, releaseClaim, signupEmailClaimKey } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { signSession, hashPassword, verifyPassword, isValidEmail } from '@/lib/auth';
import { rateLimitExceeded, requireActiveCustomer, clientIp } from '@/lib/guard';
import type { Customer, PublicCustomer } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Audit M11 (2026-10-29): the throttle moved from a per-instance in-memory
// map to the shared store limiter, keyed per account (IP + email) with a
// broader per-IP cap on top — cold starts no longer reset it and one
// attacker IP can't burn another customer's budget.
const WINDOW_MS = 5 * 60 * 1000;
const PER_ACCOUNT_LIMIT = 10;
const PER_IP_LIMIT = 30;

function publicCustomer(c: Customer): PublicCustomer {
  return { id: c.id, name: c.name, email: c.email };
}

// GET /api/auth/customer — return the logged-in customer (session check).
// Audit M7: the session must still be valid (account exists, auth version
// matches) — a deleted account's token dies here too.
export async function GET(req: Request) {
  await ensureSeeded();
  const payload = await requireActiveCustomer(req);
  if (!payload?.customerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const customer = await getCustomer(payload.customerId);
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ customer: publicCustomer(customer) });
}

// POST /api/auth/customer — { mode: 'signup'|'login', name?, email, password }
export async function POST(req: Request) {
  await ensureSeeded();
  const body = await req.json().catch(() => null);
  const { mode, name, email, password } = body ?? {};

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  const cleanEmail = email.trim().toLowerCase();

  const ip = clientIp(req);
  const [overIp, overAccount] = await Promise.all([
    rateLimitExceeded(`customer-auth-ip:${ip}`, PER_IP_LIMIT, WINDOW_MS),
    rateLimitExceeded(`customer-auth:${ip}:${cleanEmail}`, PER_ACCOUNT_LIMIT, WINDOW_MS),
  ]);
  if (overIp || overAccount) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  if (typeof password !== 'string' || password.length === 0) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 400 });
  }

  if (mode === 'signup') {
    // Audit M11: new passwords are at least 8 characters (was 6). The rule
    // applies at set/change time only — existing shorter passwords still
    // log in below.
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
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
    // Audit M11: atomically claim the email BEFORE creating the record —
    // the old check-then-save raced (customer docs are listed, not keyed),
    // so two concurrent signups could split one email into two accounts.
    const claimKey = signupEmailClaimKey(cleanEmail);
    if (!(await claimOnce(claimKey))) {
      const raced = await getCustomerByEmail(cleanEmail);
      if (raced) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Try logging in instead.' },
          { status: 409 }
        );
      }
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
      authVersion: 0,
      createdAt: new Date().toISOString(),
    };
    try {
      await saveCustomer(customer);
    } catch (e) {
      await releaseClaim(claimKey);
      throw e;
    }
    return NextResponse.json(
      { token: signSession('customer', customer.id, undefined, customer.authVersion ?? 0), customer: publicCustomer(customer) },
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
      token: signSession('customer', customer.id, undefined, customer.authVersion ?? 0),
      customer: publicCustomer(customer),
    });
  }

  return NextResponse.json({ error: 'Invalid mode.' }, { status: 400 });
}
