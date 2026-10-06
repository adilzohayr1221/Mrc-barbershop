import { getStripe } from './stripe';
import { getMembership, saveMembership, listRedemptions, getCustomer, saveCustomer } from './store';
import type { Membership, MembershipRedemption } from './types';
import { randomUUID } from 'node:crypto';

// Monthly haircut plan: $120 / month, 4 haircuts (one per week).
export const PLAN_PRICE_USD = 120;
export const PLAN_HAIRCUTS = 4;
export const PLAN_LOOKUP_KEY = 'mrc_monthly_plan';
export const PLAN_PRODUCT_NAME = 'MRC Monthly Haircut Plan';

// Mix & Match plan: the customer picks 4 services (one per week) and the
// monthly price is computed from the chosen services' real prices.
// The discount ratio below is INTERNAL — it is never shown to customers.
const CUSTOM_PLAN_KEEP_RATIO = 0.75;

/** Monthly price for a custom plan from the 4 chosen service prices. */
export function customPlanPrice(prices: number[]): number {
  const sum = prices.reduce((s, p) => s + (Number(p) || 0), 0);
  return Math.max(1, Math.round(sum * CUSTOM_PLAN_KEEP_RATIO));
}

/** What the customer pays per month for this membership. */
export function membershipPrice(m: Membership): number {
  return m.planKind === 'custom' && m.planPriceUsd && m.planPriceUsd > 0 ? m.planPriceUsd : PLAN_PRICE_USD;
}

/** Barber payout per redeemed week: same economics as the standard plan
 *  ($30 = 25% of $120) — total payouts can never exceed the plan price. */
export function membershipPayoutPerWeek(m: Membership): number {
  return Math.round(membershipPrice(m) * 0.25 * 100) / 100;
}

/** Display name for the plan (customer-facing, no discount talk). */
export function membershipPlanName(m: Membership): string {
  return m.planKind === 'custom' ? 'Mix & Match Plan' : 'Monthly Plan';
}

export interface WeekState {
  index: number; // 0..3
  label: string; // "Week 1".."Week 4"
  start: Date;
  end: Date;
  state: 'used' | 'available' | 'expired' | 'upcoming';
  redeemedAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Split a Stripe billing period into 4 weekly windows. Weeks 1-3 are 7 days;
 *  week 4 runs to the period end (7-10 days depending on the month). */
export function weekWindows(periodStart: Date, periodEnd: Date): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  for (let i = 0; i < PLAN_HAIRCUTS; i++) {
    const start = new Date(periodStart.getTime() + i * 7 * DAY_MS);
    const end = i === PLAN_HAIRCUTS - 1 ? periodEnd : new Date(start.getTime() + 7 * DAY_MS);
    out.push({ start, end });
  }
  return out;
}

/** Current week index (0..3) inside the billing period, clamped. */
export function currentWeekIndex(periodStart: Date, periodEnd: Date, now = new Date()): number {
  if (now < periodStart) return 0;
  if (now >= periodEnd) return PLAN_HAIRCUTS - 1;
  return Math.min(PLAN_HAIRCUTS - 1, Math.floor((now.getTime() - periodStart.getTime()) / (7 * DAY_MS)));
}

export function buildWeeks(m: Membership, redemptions: MembershipRedemption[], now = new Date()): WeekState[] {
  const start = new Date(m.currentPeriodStart);
  const end = new Date(m.currentPeriodEnd);
  const windows = weekWindows(start, end);
  const cur = currentWeekIndex(start, end, now);
  return windows.map((w, i) => {
    const red = redemptions.find((r) => r.weekIndex === i && r.periodStart === m.currentPeriodStart);
    let state: WeekState['state'];
    if (red) state = 'used';
    else if (i < cur) state = 'expired';
    else if (i === cur) state = 'available';
    else state = 'upcoming';
    return {
      index: i,
      label: `Week ${i + 1}`,
      start: w.start,
      end: w.end,
      state,
      redeemedAt: red?.redeemedAt ?? null,
    };
  });
}

/** The $120/month recurring price, created once (idempotent via lookup_key). */
export async function getOrCreatePlanPrice(): Promise<string> {
  const stripe = getStripe();
  const existing = await stripe.prices.list({ lookup_keys: [PLAN_LOOKUP_KEY], limit: 1 });
  if (existing.data.length) return existing.data[0].id;
  const product = await stripe.products.create({
    name: PLAN_PRODUCT_NAME,
    description: '4 haircuts per month — one per week. Unused weekly haircuts expire.',
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: PLAN_PRICE_USD * 100,
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: PLAN_LOOKUP_KEY,
    nickname: 'MRC Monthly Plan $120/mo',
  });
  return price.id;
}

/** Ensure the customer has a Stripe customer record (shared with deposits). */
export async function ensureStripeCustomer(customerId: string): Promise<string> {
  const customer = await getCustomer(customerId);
  if (!customer) throw new Error('Customer not found');
  let stripeCustomerId = customer.stripeCustomerId ?? null;
  if (stripeCustomerId) {
    try {
      await getStripe().customers.retrieve(stripeCustomerId);
    } catch {
      stripeCustomerId = null;
    }
  }
  if (!stripeCustomerId) {
    const sc = await getStripe().customers.create({
      email: customer.email,
      name: customer.name,
      metadata: { customerId: customer.id },
    });
    stripeCustomerId = sc.id;
    await saveCustomer({ ...customer, stripeCustomerId });
  }
  return stripeCustomerId;
}

/** Billing period of a subscription, robust across Stripe API versions
 *  (newer versions moved current_period_* onto the subscription items). */
export function subscriptionPeriod(sub: unknown): { start: Date; end: Date } {
  const s = sub as {
    current_period_start?: number;
    current_period_end?: number;
    items?: { data?: { current_period_start?: number; current_period_end?: number }[] };
  };
  if (s.current_period_start && s.current_period_end) {
    return { start: new Date(s.current_period_start * 1000), end: new Date(s.current_period_end * 1000) };
  }
  const item = s.items?.data?.[0];
  if (item?.current_period_start && item?.current_period_end) {
    return { start: new Date(item.current_period_start * 1000), end: new Date(item.current_period_end * 1000) };
  }
  throw new Error('Cannot determine subscription billing period');
}

/**
 * Sync a membership doc from its Stripe subscription (no webhooks in test
 * mode — we reconcile on read). Returns the up-to-date membership, or null
 * when the subscription is gone (then it is marked canceled locally).
 */
export async function syncMembershipFromStripe(m: Membership): Promise<Membership | null> {
  let sub;
  try {
    sub = await getStripe().subscriptions.retrieve(m.stripeSubscriptionId);
  } catch {
    if (m.status !== 'canceled') {
      const updated = { ...m, status: 'canceled' as const };
      await saveMembership(updated);
      return updated;
    }
    return m;
  }
  const { start, end } = subscriptionPeriod(sub);
  const periodStart = start.toISOString();
  const periodEnd = end.toISOString();
  const status: Membership['status'] =
    sub.status === 'active' || sub.status === 'trialing'
      ? 'active'
      : sub.status === 'past_due' || sub.status === 'unpaid'
        ? 'past_due'
        : 'canceled';
  const updated: Membership = {
    ...m,
    status,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
  // Only write when something changed, to avoid needless blob writes.
  if (
    updated.status !== m.status ||
    updated.currentPeriodStart !== m.currentPeriodStart ||
    updated.currentPeriodEnd !== m.currentPeriodEnd ||
    updated.cancelAtPeriodEnd !== m.cancelAtPeriodEnd
  ) {
    await saveMembership(updated);
  }
  return updated;
}

/** Load the customer's membership, synced from Stripe. Null when none exists. */
export async function getActiveMembership(customerId: string): Promise<Membership | null> {
  const all = await listActiveMemberships(customerId);
  return all[0] ?? null;
}

/** All of the customer's memberships, each synced from Stripe (newest first).
 *  One account can hold several plans — e.g. one for himself, one for his son. */
export async function listActiveMemberships(customerId: string): Promise<Membership[]> {
  const { getMembershipsByCustomer } = await import('./store');
  const all = await getMembershipsByCustomer(customerId);
  const synced = await Promise.all(all.map((m) => syncMembershipFromStripe(m)));
  return (synced.filter(Boolean) as Membership[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Short-lived QR token for the membership code (MRC2), like payment codes. */
export function mintQrToken(): { token: string; expiry: string } {
  const token = randomUUID().replace(/-/g, '').slice(0, 24);
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  return { token, expiry };
}

export async function getMembershipById(id: string): Promise<Membership | null> {
  const m = await getMembership(id);
  if (!m) return null;
  return syncMembershipFromStripe(m);
}
