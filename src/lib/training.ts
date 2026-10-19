// Barber training program ($100/week) — Stripe price + signup records.
// Signups are stored as one JSON doc; the trainee is NOT an app customer
// account — this is a standalone enrollment paid by card via Stripe Checkout.
import { getDoc, putDoc } from './blob';
import { getStripe } from './stripe';

export const TRAINING_PRICE_USD = 100;
const TRAINING_LOOKUP_KEY = 'mrc_training_weekly_100';
const SIGNUPS_PATH = 'data/training-signups.json';

export interface TrainingSignup {
  id: string;
  name: string;
  email: string;
  phone: string;
  dob: string; // YYYY-MM-DD
  address: string;
  status: 'pending' | 'active';
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

/** The $100/week training price, created once in Stripe and reused. */
export async function getOrCreateTrainingPrice(): Promise<string> {
  const stripe = getStripe();
  const existing = await stripe.prices.list({ lookup_keys: [TRAINING_LOOKUP_KEY], limit: 1 });
  if (existing.data.length) return existing.data[0].id;
  const product = await stripe.products.create({
    name: 'MRC Barber Training',
    description: 'Hands-on barber training at MRC Barbershops — billed weekly.',
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: TRAINING_PRICE_USD * 100,
    currency: 'usd',
    recurring: { interval: 'week' },
    lookup_key: TRAINING_LOOKUP_KEY,
    nickname: 'MRC Training $100/week',
  });
  return price.id;
}
