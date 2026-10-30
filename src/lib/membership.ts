import { getStripe } from './stripe';
import { getMembership, saveMembership, listRedemptions, getCustomer, saveCustomer } from './store';
import type { Booking, Membership } from './types';
import { randomUUID } from 'node:crypto';
import { planKindOf } from './planWindows';

// Weekly window math lives in ./planWindows (pure, simulation-tested).
// Re-exported here so existing imports keep working unchanged.
export {
  weekWindows,
  currentWeekIndex,
  currentPlanWindowIndex,
  buildWeeks,
  buildGuestWeeks,
  currentGuestSlot,
  planWindowCount,
  planWindows,
  yearlyCycleBoundaries,
  addShopMonths,
} from './planWindows';
export type { WeekState, PlanWindow } from './planWindows';

// Monthly haircut plan: $120 / month, 4 haircuts (one per week).
export const PLAN_PRICE_USD = 120;
export const PLAN_HAIRCUTS = 4;
export const PLAN_LOOKUP_KEY = 'mrc_monthly_plan';
export const PLAN_PRODUCT_NAME = 'MRC Monthly Haircut Plan';

// Yearly haircut plan: $1,300 / year, 48 haircuts (one per week — the same
// 4-per-cycle weekly rhythm as the monthly plan, over 12 monthly cycles).
export const YEARLY_PRICE_USD = 1300;
export const YEARLY_HAIRCUTS = 48;
export const YEARLY_LOOKUP_KEY = 'mrc_yearly_plan';
export const YEARLY_PRODUCT_NAME = 'MRC Master Yearly Plan';

// Mix & Match plan: the customer picks 4 services (one per week) and the
// monthly price is computed from the chosen services' real prices.
// The discount ratio below is INTERNAL — it is never shown to customers.
const CUSTOM_PLAN_KEEP_RATIO = 0.75;

/** Monthly price for a custom plan from the 4 chosen service prices. */
export function customPlanPrice(prices: number[]): number {
  const sum = prices.reduce((s, p) => s + (Number(p) || 0), 0);
  return Math.max(1, Math.round(sum * CUSTOM_PLAN_KEEP_RATIO));
}

/** What the customer pays per billing period for this membership
 *  (per month for monthly/custom plans, per year for the yearly plan). */
export function membershipPrice(m: Membership): number {
  if (m.planKind === 'custom' && m.planPriceUsd && m.planPriceUsd > 0) return m.planPriceUsd;
  if (planKindOf(m) === 'yearly') return YEARLY_PRICE_USD;
  return PLAN_PRICE_USD;
}

/** Billing interval of the plan ('month' | 'year') — drives /mo vs /yr
 *  suffixes in the UI; the two are never inferred from the price. */
export function membershipInterval(m: Membership): 'month' | 'year' {
  return planKindOf(m) === 'yearly' ? 'year' : 'month';
}

/** Barber payout per redeemed week for MONTHLY-family plans.
 *  - Standard plan: $30 (25% of the $120 monthly plan).
 *  - Mix & Match: 25% of its computed monthly price, so a custom plan's
 *    total payouts can never exceed what the customer paid for it.
 *  NOTE: yearly-plan redemptions do NOT use this — they pay a flat $25
 *  (member and guest) via membershipRedemptionPayout below. */
export function membershipPayoutPerWeek(m: Membership): number {
  if (m.planKind === 'custom' && m.planPriceUsd && m.planPriceUsd > 0) {
    return Math.round(m.planPriceUsd * 0.25 * 100) / 100;
  }
  return Math.round(PLAN_PRICE_USD * 0.25 * 100) / 100; // $30
}

/** Barber payout for a YEARLY-plan redemption: $25 — for BOTH the
 *  member's own cut and the guest cut (owner's rule, 2026-10-28).
 *  Deliberately different from the monthly plan's $30. */
export const YEARLY_PAYOUT_USD = 25;

/** Payout for one redemption, as a plan-kind rule:
 *  - Yearly plan: $25, member and guest alike.
 *  - Monthly / Mix & Match: the per-week amount ($30 standard; 25% of the
 *    custom price) via membershipPayoutPerWeek — unchanged. */
export function membershipRedemptionPayout(m: Membership, guest: boolean): number {
  void guest; // yearly pays $25 for both kinds; other plans have no guests
  if (planKindOf(m) === 'yearly') return YEARLY_PAYOUT_USD;
  return membershipPayoutPerWeek(m);
}

/** Stripe idempotency key for a plan payout. The guest segment keeps a
 *  yearly plan's GUEST payout for a window distinct from the member's own
 *  payout for the SAME window — without it the two $30 transfers for one
 *  week would collide and one barber would silently never be paid. */
export function membershipPayoutKey(
  membershipId: string,
  weekIndex: number,
  periodStart: string,
  guest: boolean
): string {
  return guest
    ? `payout-membership-guest-${membershipId}-${weekIndex}-${periodStart}`
    : `payout-membership-${membershipId}-${weekIndex}-${periodStart}`;
}

/** Ids of the YEARLY memberships behind a list of bookings. Earnings
 *  attribution (lib/earnings) values a yearly redemption at $25 instead
 *  of the monthly $30, and earningOf is synchronous — so callers resolve
 *  the yearly plan ids once and pass the set down. Reads the stored plan
 *  docs only: planKind is fixed at purchase, so no Stripe sync is needed
 *  and monthly/custom behavior is untouched. */
export async function yearlyMembershipIdsIn(bookings: Booking[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const b of bookings) {
    if (b.paymentStatus === 'membership_redeemed' && b.membershipId) ids.add(b.membershipId);
  }
  const yearly = new Set<string>();
  await Promise.all(
    [...ids].map(async (id) => {
      const m = await getMembership(id).catch(() => null);
      if (m && planKindOf(m) === 'yearly') yearly.add(id);
    })
  );
  return yearly;
}

/** Display name for the plan (customer-facing, no discount talk). */
export function membershipPlanName(m: Membership): string {
  if (m.planKind === 'custom') return 'Mix & Match Plan';
  if (planKindOf(m) === 'yearly') return 'Master Yearly Plan';
  return 'Monthly Plan';
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

/** The $1,300/year recurring price, created once (idempotent via lookup_key).
 *  Same mechanism as the monthly plan price — safe to call on every checkout. */
export async function getOrCreateYearlyPlanPrice(): Promise<string> {
  const stripe = getStripe();
  const existing = await stripe.prices.list({ lookup_keys: [YEARLY_LOOKUP_KEY], limit: 1 });
  if (existing.data.length) return existing.data[0].id;
  const product = await stripe.products.create({
    name: YEARLY_PRODUCT_NAME,
    description: 'Unlimited haircuts — one every week, all year. Unused weeks expire.',
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: YEARLY_PRICE_USD * 100,
    currency: 'usd',
    recurring: { interval: 'year' },
    lookup_key: YEARLY_LOOKUP_KEY,
    nickname: 'MRC Master Yearly Plan $1300/yr',
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
