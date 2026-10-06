import type { Booking, Gift, Tip } from './types';

// Money attributed to one booking for earnings reports.
// - Deposit/remainder payments: what was actually collected (amountPaid).
// - Membership haircuts: the plan's per-haircut value ($120 / 4).
// - Cancelled/refunded: never counted. No-shows keep the deposit, so they count.
export const PLAN_HAIRCUT_VALUE_USD = 30;

export function earningOf(b: Booking): number {
  if (b.status === 'cancelled') return 0;
  if (b.paymentStatus === 'refunded') return 0;
  if (b.paymentStatus === 'paid' || b.paymentStatus === 'paid_in_full') {
    const v = b.amountPaid ?? 0;
    return v > 0 ? Math.round(v * 100) / 100 : 0;
  }
  if (b.paymentStatus === 'membership_redeemed') return PLAN_HAIRCUT_VALUE_USD;
  return 0;
}

export interface PeriodTotals {
  today: number;
  week: number;
  month: number;
}

/** Today's date (YYYY-MM-DD) in the shop's timezone. */
export function shopToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/** Sum earnings by booking date: today, this calendar week (Mon–Sun), this month. */
export function summarizeEarnings(bookings: Booking[], today = shopToday()): PeriodTotals {
  const weekStart = mondayOf(today);
  const monthStart = today.slice(0, 7) + '-01';
  let day = 0;
  let week = 0;
  let month = 0;
  for (const b of bookings) {
    const v = earningOf(b);
    if (v <= 0) continue;
    const bd = b.date;
    if (bd < monthStart) continue;
    month += v;
    if (bd >= weekStart) week += v;
    if (bd === today) day += v;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { today: r(day), week: r(week), month: r(month) };
}

export function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** A haircut counts as done when the appointment wasn't cancelled/no-show and
 *  either its day already passed or it was paid/redeemed (money moved). */
export function isHaircutDone(b: Booking, today = shopToday()): boolean {
  if (b.status !== 'booked') return false;
  if (b.date < today) return true;
  return b.paymentStatus === 'paid_in_full' || b.paymentStatus === 'membership_redeemed';
}

export interface HaircutCounts {
  today: number;
  week: number;
  month: number;
  all: number;
}

/** Haircut counts by booking date: today, this week (Mon–Sun), this month, all time. */
export function countHaircuts(bookings: Booking[], today = shopToday()): HaircutCounts {
  const weekStart = mondayOf(today);
  const monthStart = today.slice(0, 7) + '-01';
  let t = 0;
  let w = 0;
  let m = 0;
  let a = 0;
  for (const b of bookings) {
    if (!isHaircutDone(b, today)) continue;
    a++;
    if (b.date < monthStart) continue;
    m++;
    if (b.date >= weekStart) w++;
    if (b.date === today) t++;
  }
  return { today: t, week: w, month: m, all: a };
}

export function addPeriods(a: PeriodTotals, b: PeriodTotals): PeriodTotals {
  const r = (n: number) => Math.round(n * 100) / 100;
  return { today: r(a.today + b.today), week: r(a.week + b.week), month: r(a.month + b.month) };
}

export function addCounts(a: HaircutCounts, b: HaircutCounts): HaircutCounts {
  return { today: a.today + b.today, week: a.week + b.week, month: a.month + b.month, all: a.all + b.all };
}

/** Redeemed gift haircuts contribute to earnings: a redeemed gift counts its
 *  full price on its redemption date (today/week/month, not all-time). */
export function summarizeGiftEarnings(gifts: Gift[], today = shopToday()): PeriodTotals {
  const weekStart = mondayOf(today);
  const monthStart = today.slice(0, 7) + '-01';
  let day = 0;
  let week = 0;
  let month = 0;
  for (const g of gifts) {
    if (g.status !== 'redeemed' || !g.redeemedAt) continue;
    const v = g.price;
    if (v <= 0) continue;
    const d = g.redeemedAt.slice(0, 10);
    if (d < monthStart) continue;
    month += v;
    if (d >= weekStart) week += v;
    if (d === today) day += v;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { today: r(day), week: r(week), month: r(month) };
}

/** Redeemed gift haircuts count as haircuts for the barber who redeemed them. */
export function countGiftHaircuts(gifts: Gift[], today = shopToday()): HaircutCounts {
  const weekStart = mondayOf(today);
  const monthStart = today.slice(0, 7) + '-01';
  let t = 0;
  let w = 0;
  let m = 0;
  let a = 0;
  for (const g of gifts) {
    if (g.status !== 'redeemed' || !g.redeemedAt) continue;
    a++;
    const d = g.redeemedAt.slice(0, 10);
    if (d < monthStart) continue;
    m++;
    if (d >= weekStart) w++;
    if (d === today) t++;
  }
  return { today: t, week: w, month: m, all: a };
}

/** Tips (بقشيش) contribute to the barber's earnings on the tip date. */
export function summarizeTipEarnings(tips: Tip[], today = shopToday()): PeriodTotals {
  const weekStart = mondayOf(today);
  const monthStart = today.slice(0, 7) + '-01';
  let day = 0;
  let week = 0;
  let month = 0;
  for (const t of tips) {
    const v = t.amount;
    if (v <= 0) continue;
    const d = t.createdAt.slice(0, 10);
    if (d < monthStart) continue;
    month += v;
    if (d >= weekStart) week += v;
    if (d === today) day += v;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { today: r(day), week: r(week), month: r(month) };
}
