// Loyalty & barber milestone bonuses — core logic.
// Server-only. Called once per completed haircut from every completion path
// (booking done, plan redemption, gift redemption, comp redemption,
// loyalty-free redemption).
//
// - Barber: every completed haircut counts toward milestones:
//   $100 at 10 haircuts, $500 at 100 (one-time each). The owner pays the
//   bonus and marks it paid from the owner dashboard.
// - Customer: paid haircuts only. At 4 paid haircuts the customer earns ONE
//   free haircut (MRC5 QR). The barber scans it for no payout (like complaint
//   comps); the haircut still counts toward the barber's milestone.
import {
  getBarberMilestone,
  saveBarberMilestone,
  getCustomerLoyalty,
  saveCustomerLoyalty,
  saveLoyaltyReward,
  newId,
} from './store';
import type { BarberMilestone, CustomerLoyalty } from './types';
import { PLATFORM_SALON_ID } from './types';
import { randomBytes } from 'node:crypto';

export const BONUS_10_AT = 10;
export const BONUS_10_USD = 100;
export const BONUS_100_AT = 100;
export const BONUS_100_USD = 500;
export const LOYALTY_PAID_FOR_FREE = 4; // 4 paid haircuts -> 5th free

function nowIso() {
  return new Date().toISOString();
}

async function pushToBarber(barberId: string, title: string, body: string, url?: string) {
  try {
    const { sendPushToUser } = await import('./push');
    await sendPushToUser('barber', barberId, { title, body, url });
  } catch (e) {
    console.error('[loyalty] barber push failed', e);
  }
}

async function pushToCustomer(customerId: string, title: string, body: string, url?: string) {
  try {
    const { sendPushToUser } = await import('./push');
    await sendPushToUser('customer', customerId, { title, body, url });
  } catch (e) {
    console.error('[loyalty] customer push failed', e);
  }
}

export async function recordHaircut(opts: {
  barberId: string;
  customerId?: string | null;
  paid: boolean; // customer paid for this haircut (false = free: comp / loyalty reward)
  salonId?: string;
}): Promise<void> {
  const salonId = opts.salonId ?? PLATFORM_SALON_ID;
  const now = nowIso();

  // ---- Barber milestone ----
  try {
    let m: BarberMilestone | null = await getBarberMilestone(opts.barberId);
    if (!m) {
      m = {
        id: opts.barberId,
        barberId: opts.barberId,
        salonId,
        completedHaircuts: 0,
        bonus10: 'none',
        bonus100: 'none',
        updatedAt: now,
      };
    }
    m.completedHaircuts += 1;
    m.updatedAt = now;

    if (m.completedHaircuts >= BONUS_10_AT && m.bonus10 === 'none') {
      m.bonus10 = 'earned';
      m.bonus10EarnedAt = now;
      await pushToBarber(
        opts.barberId,
        `🎉 You earned a $${BONUS_10_USD} bonus!`,
        `${BONUS_10_AT} haircuts done in the app — the owner will pay your $${BONUS_10_USD} bonus soon.`,
        '/barber'
      );
      // The owner sees the earned bonus in the dashboard (Bonuses tab).
    }
    if (m.completedHaircuts >= BONUS_100_AT && m.bonus100 === 'none') {
      m.bonus100 = 'earned';
      m.bonus100EarnedAt = now;
      await pushToBarber(
        opts.barberId,
        `🏆 You earned a $${BONUS_100_USD} bonus!`,
        `${BONUS_100_AT} haircuts done in the app — the owner will pay your $${BONUS_100_USD} bonus soon.`,
        '/barber'
      );
    }
    await saveBarberMilestone(m);
  } catch (e) {
    console.error('[loyalty] barber milestone failed', e);
  }

  // ---- Customer loyalty (paid haircuts only) ----
  if (opts.paid && opts.customerId) {
    try {
      let l: CustomerLoyalty | null = await getCustomerLoyalty(opts.customerId);
      if (!l) {
        l = {
          id: opts.customerId,
          customerId: opts.customerId,
          salonId,
          paidHaircuts: 0,
          freeEarned: false,
          updatedAt: now,
        };
      }
      // One-time reward: never count past the earn point.
      if (!l.freeEarned) {
        l.paidHaircuts += 1;
        l.updatedAt = now;
        if (l.paidHaircuts >= LOYALTY_PAID_FOR_FREE) {
          const rewardId = newId();
          const token = randomBytes(16).toString('hex');
          l.freeEarned = true;
          l.freeRewardId = rewardId;
          await saveLoyaltyReward({
            id: rewardId,
            token,
            customerId: opts.customerId,
            salonId,
            serviceName: 'Free haircut',
            status: 'active',
            createdAt: now,
          });
          await pushToCustomer(
            opts.customerId,
            '🎉 Your 5th haircut is FREE!',
            'You got 4 haircuts — show your free-haircut code at the shop.',
            '/customer/profile'
          );
        }
        await saveCustomerLoyalty(l);
      }
    } catch (e) {
      console.error('[loyalty] customer loyalty failed', e);
    }
  }
}

/** Short public code for manual entry (like gift short codes). */
export function loyaltyShortCode(rewardId: string): string {
  return rewardId.replace(/-/g, '').slice(0, 6).toUpperCase();
}
