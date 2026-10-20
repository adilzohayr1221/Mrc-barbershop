// Barber training program ($100/week) — Stripe price + signup records.
// Signups are stored as one JSON doc; the trainee is NOT an app customer
// account — this is a standalone enrollment paid by card via Stripe Checkout.
import { getDoc, putDoc } from './blob';
import { getStripe } from './stripe';

export const TRAINING_PRICE_USD = 100;
export const TRAINING_WEEKLY_OPTIONS = [100, 50] as const;
export type TrainingWeeklyUsd = (typeof TRAINING_WEEKLY_OPTIONS)[number];
const SIGNUPS_PATH = 'data/training-signups.json';

export interface TrainingSignup {
  id: string;
  name: string;
  email: string;
  phone: string;
  dob: string; // YYYY-MM-DD
  address: string;
  status: 'pending' | 'active';
  weeklyUsd?: number; // plan price per week (100 default, 50 via /train50)
  sessionId?: string;
  subscriptionId?: string;
  stripeCustomerId?: string;
  createdAt: string;
  paidAt?: string;
}

export async function listTrainingSignups(): Promise<TrainingSignup[]> {
  return (await getDoc<TrainingSignup[]>(SIGNUPS_PATH)) ?? [];
}

export async function saveTrainingSignup(s: TrainingSignup): Promise<void> {
  const all = await listTrainingSignups();
  const i = all.findIndex((x) => x.id === s.id);
  if (i >= 0) all[i] = s;
  else all.push(s);
  await putDoc(SIGNUPS_PATH, all);
}

export async function getTrainingSignupBySession(sessionId: string): Promise<TrainingSignup | null> {
  const all = await listTrainingSignups();
  return all.find((x) => x.sessionId === sessionId) ?? null;
}

/** A weekly training price ($100 standard, $50 via /train50), created once in Stripe and reused. */
export async function getOrCreateTrainingPrice(weeklyUsd: TrainingWeeklyUsd = TRAINING_PRICE_USD): Promise<string> {
  const stripe = getStripe();
  const lookupKey = `mrc_training_weekly_${weeklyUsd}`;
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (existing.data.length) return existing.data[0].id;
  const product = await stripe.products.create({
    name: 'MRC Barber Training',
    description: 'Hands-on barber training at MRC Barbershops — billed weekly.',
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: weeklyUsd * 100,
    currency: 'usd',
    recurring: { interval: 'week' },
    lookup_key: lookupKey,
    nickname: `MRC Training $${weeklyUsd}/week`,
  });
  return price.id;
}
