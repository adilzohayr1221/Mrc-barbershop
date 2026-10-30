import type { Booking, Gift, Tip, WalkinPayment } from './types';
import { VIP_BARBER_PAYOUT_USD, vipPeopleOf } from './vip';

// Money attributed to one booking for earnings reports.
// - Deposit/remainder payments: what was actually collected (amountPaid).
// - Membership haircuts: the plan's per-haircut value ($120 / 4 = $30 for
//   monthly-family plans; $25 for yearly-plan redemptions — member and
//   guest — matching what those redemptions actually pay the barber).
// - Cancelled/refunded: never counted. No-shows keep the deposit, so they count.
// - Barber view only: once the barber completes a haircut (proof photo), its
//   full agreed price counts as earned immediately — the barber watches this
//   card all day, and the unpaid remainder is tracked by the Collect chips,
//   not by hiding the earned value until the money lands. Payouts are a
//   separate engine (lib/payouts) and stay strictly on collected amounts.
export const PLAN_HAIRCUT_VALUE_USD = 30;

/** Per-haircut value attributed to a YEARLY-plan redemption (the member's
 *  own cut and the guest cut alike): the yearly plan pays the barber $25
 *  per redemption (YEARLY_PAYOUT_USD in lib/membership), so earnings
 *  reports show $25 for those — never the monthly plan's $30. Kept as a
 *  local constant (not imported from lib/membership) so this module stays
 *  free of store/Stripe imports for its client-side consumers. */
export const YEARLY_HAIRCUT_VALUE_USD = 25;

/** Earnings value of one redeemed plan booking. Yearly-plan redemptions
 *  (member AND guest) attribute at $25; every other plan keeps the flat
 *  monthly value — including Mix & Match, whose attribution has always
 *  been this flat $30 (its per-plan payout math lives in lib/payouts and
 *  is deliberately not mirrored in this display value).
 *  A booking counts as yearly when its membership id is in
 *  `yearlyMembershipIds` (resolved by the caller via yearlyMembershipIdsIn
 *  in lib/membership), or when it is a guest booking — guest cuts exist
 *  only on yearly plans. */
export function planHaircutValueOf(b: Booking, yearlyMembershipIds?: ReadonlySet<string>): number {
  if (b.membershipGuest === true) return YEARLY_HAIRCUT_VALUE_USD;
  if (b.membershipId && yearlyMembershipIds?.has(b.membershipId)) return YEARLY_HAIRCUT_VALUE_USD;
  return PLAN_HAIRCUT_VALUE_USD;
}

export function earningOf(b: Booking, forBarber = false, yearlyMembershipIds?: ReadonlySet<string>): number {
  if (b.status === 'cancelled') return 0;
  if (b.paymentStatus === 'refunded') return 0;
  if (forBarber && b.completedAt) {
    if (b.houseCall) return VIP_BARBER_PAYOUT_USD * vipPeopleOf(b);
    if (b.paymentStatus === 'membership_redeemed') return planHaircutValueOf(b, yearlyMembershipIds);
    const paidV = b.paymentStatus === 'paid' || b.paymentStatus === 'paid_in_full' ? (b.amountPaid ?? 0) : 0;
    const full = b.servicePrice ?? paidV;
    return Math.round(Math.max(paidV, full) * 100) / 100;
  }
  if (b.paymentStatus === 'paid' || b.paymentStatus === 'paid_in_full') {
    const v = b.amountPaid ?? 0;
    if (v <= 0) return 0;
    // VIP home visit: the customer pays $100 per person, but the barber's
    // share is $60 per person — barber-facing earnings only ever show his
    // share (owner's rule).
    if (forBarber && b.houseCall) return Math.min(VIP_BARBER_PAYOUT_USD * vipPeopleOf(b), Math.round(v * 100) / 100);
    return Math.round(v * 100) / 100;
  }
  if (b.paymentStatus === 'membership_redeemed') return planHaircutValueOf(b, yearlyMembershipIds);
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

/** Shop-local date (YYYY-MM-DD) of an ISO timestamp. */
export function shopDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** Current wall-clock time (HH:MM, 24h) in the shop's timezone. */
export function shopNowTime(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

/** Has this booking's appointment start arrived (shop-local wall clock)?
 *  Used to gate payouts (audit M2/H3, 2026-10-22): a booking whose start is
 *  still in the future must not pay out yet — a same-day Done tap on a
 *  future VIP visit would otherwise pay the barber for a visit that can
 *  still be cancelled with a full refund. */
export function bookingStarted(b: Pick<Booking, 'date' | 'time'>): boolean {
  const today = shopToday();
  if (b.date < today) return true;
  if (b.date > today) return false;
  return b.time <= shopNowTime();
}

export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/** Sum earnings by booking date: today, this calendar week (Mon–Sun), this month. */
export function summarizeEarnings(bookings: Booking[], today = shopToday(), forBarber = false, yearlyMembershipIds?: ReadonlySet<string>): PeriodTotals {
  const weekStart = mondayOf(today);
  const monthStart = today.slice(0, 7) + '-01';
  let day = 0;
  let week = 0;
  let month = 0;
  for (const b of bookings) {
    const v = earningOf(b, forBarber, yearlyMembershipIds);
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
 *  the barber completed it (proof photo), its day already passed, or it was
 *  paid/redeemed (money moved). */
export function isHaircutDone(b: Booking, today = shopToday()): boolean {
  if (b.status !== 'booked') return false;
  // The barber marked it done — completion is server-gated on the
  // proof-of-completion photo, so the haircut happened and counts
  // immediately, the same day, before any Collect step.
  if (b.completedAt) return true;
  if (b.date < today) return true;
  // A VIP home visit is paid in full at booking time — that alone does not
  // make it done. It counts once the barber completes it (proof photo).
  if (b.houseCall) return false;
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
    const d = shopDateOf(g.redeemedAt);
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
    const d = shopDateOf(g.redeemedAt);
    if (d < monthStart) continue;
    m++;
    if (d >= weekStart) w++;
    if (d === today) t++;
  }
  return { today: t, week: w, month: m, all: a };
}

/** Walk-in QR payments contribute to the barber's earnings on the payment date. */
export function summarizeWalkinEarnings(payments: WalkinPayment[], today = shopToday()): PeriodTotals {
  const weekStart = mondayOf(today);
  const monthStart = today.slice(0, 7) + '-01';
  let day = 0;
  let week = 0;
  let month = 0;
  for (const p of payments) {
    const v = p.amount;
    if (v <= 0) continue;
    const d = shopDateOf(p.createdAt);
    if (d < monthStart) continue;
    month += v;
    if (d >= weekStart) week += v;
    if (d === today) day += v;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { today: r(day), week: r(week), month: r(month) };
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
    const d = shopDateOf(t.createdAt);
    if (d < monthStart) continue;
    month += v;
    if (d >= weekStart) week += v;
    if (d === today) day += v;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { today: r(day), week: r(week), month: r(month) };
}
