// Pure plan-window math (no I/O, no Stripe) — extracted from membership.ts
// so the weekly redemption windows can be unit-tested / simulated offline.
//
// Window model: a billing period is split into CYCLES, and each cycle into
// 4 weekly windows (one haircut per window, use-or-lose). Weeks 1–3 of a
// cycle are exactly 7 days; week 4 runs to the cycle end (7–10 days).
//   - Monthly / Mix & Match plans: ONE cycle = the whole Stripe period
//     (a calendar month) → 4 windows. This is the original behavior,
//     unchanged byte-for-byte.
//   - Yearly plan: the Stripe period is a calendar year, split into 12
//     cycles whose boundaries are the period start's monthly anniversaries
//     → 48 windows over 52 weeks, same 4-per-cycle rhythm.
//
// Cycle boundaries are anchored in SHOP TIME (America/New_York): a cycle
// that starts Oct 28 09:00 ET ends Nov 28 09:00 ET even across a DST
// transition. The final boundary is always the Stripe period end itself,
// used exactly as given (an absolute instant), so the windows tile the
// period with no gaps and no overlaps.
import type { Membership, MembershipRedemption } from './types';

export type PlanKind = 'standard' | 'custom' | 'yearly';

export const SHOP_TZ = 'America/New_York';
export const WINDOWS_PER_CYCLE = 4;
export const YEARLY_CYCLES = 12;
export const YEARLY_WINDOWS = WINDOWS_PER_CYCLE * YEARLY_CYCLES; // 48

const DAY_MS = 24 * 60 * 60 * 1000;

export function planKindOf(m: Pick<Membership, 'planKind'>): PlanKind {
  return m.planKind === 'custom' ? 'custom' : m.planKind === 'yearly' ? 'yearly' : 'standard';
}

/** Number of redemption windows in one billing period of this plan. */
export function planWindowCount(m: Pick<Membership, 'planKind'>): number {
  return planKindOf(m) === 'yearly' ? YEARLY_WINDOWS : WINDOWS_PER_CYCLE;
}

export interface PlanWindow {
  start: Date;
  end: Date;
  cycleIndex: number; // 0 for monthly plans; 0..11 for the yearly plan
}

/** Split ONE cycle into 4 weekly windows (the original monthly rule). */
export function cycleWindows(cycleStart: Date, cycleEnd: Date, cycleIndex = 0): PlanWindow[] {
  const out: PlanWindow[] = [];
  for (let i = 0; i < WINDOWS_PER_CYCLE; i++) {
    const start = new Date(cycleStart.getTime() + i * 7 * DAY_MS);
    const end = i === WINDOWS_PER_CYCLE - 1 ? cycleEnd : new Date(start.getTime() + 7 * DAY_MS);
    out.push({ start, end, cycleIndex });
  }
  return out;
}

/** Split a Stripe billing period into 4 weekly windows. Weeks 1-3 are 7 days;
 *  week 4 runs to the period end (7-10 days depending on the month).
 *  (Original monthly-plan function — behavior unchanged.) */
export function weekWindows(periodStart: Date, periodEnd: Date): { start: Date; end: Date }[] {
  return cycleWindows(periodStart, periodEnd, 0).map(({ start, end }) => ({ start, end }));
}

// --- Shop-time calendar arithmetic -------------------------------------------

/** UTC offset (ms) of `timeZone` at the given instant. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant whose wall-clock reading in `timeZone` equals `wallMs`
 *  (a timestamp whose UTC fields hold the desired wall-clock fields). */
function wallToInstant(wallMs: number, timeZone: string): Date {
  const first = wallMs - tzOffsetMs(new Date(wallMs), timeZone);
  const refined = wallMs - tzOffsetMs(new Date(first), timeZone);
  return new Date(refined);
}

/**
 * Add calendar months to an instant, keeping the SHOP-TIME wall clock
 * (same local time of day, same day-of-month clamped to the target month's
 * last day — e.g. Jan 31 + 1mo = Feb 28). Always computed from the ORIGINAL
 * date, so addShopMonths(start, k) never drifts across a long span.
 */
export function addShopMonths(date: Date, months: number): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const totalMonths = get('year') * 12 + (get('month') - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12; // 0-based
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(get('day'), lastDay);
  const wallMs =
    Date.UTC(targetYear, targetMonth, day, get('hour'), get('minute'), get('second')) +
    (date.getTime() % 1000);
  return wallToInstant(wallMs, SHOP_TZ);
}

/** The 13 boundaries of a yearly period: the start, its 11 monthly
 *  anniversaries in shop time, and the Stripe period end exactly. */
export function yearlyCycleBoundaries(periodStart: Date, periodEnd: Date): Date[] {
  const out: Date[] = [periodStart];
  for (let k = 1; k < YEARLY_CYCLES; k++) {
    const b = addShopMonths(periodStart, k);
    // Defensive: an anniversary must sit strictly inside the period.
    out.push(b > periodStart && b < periodEnd ? b : new Date(periodStart.getTime() + (periodEnd.getTime() - periodStart.getTime()) * (k / YEARLY_CYCLES)));
  }
  out.push(periodEnd);
  return out;
}

/** All redemption windows of a billing period, in order. */
export function planWindows(
  m: Pick<Membership, 'planKind'>,
  periodStart: Date,
  periodEnd: Date
): PlanWindow[] {
  if (planKindOf(m) !== 'yearly') return cycleWindows(periodStart, periodEnd, 0);
  const bounds = yearlyCycleBoundaries(periodStart, periodEnd);
  const out: PlanWindow[] = [];
  for (let c = 0; c < YEARLY_CYCLES; c++) {
    out.push(...cycleWindows(bounds[c], bounds[c + 1], c));
  }
  return out;
}

/** Current week index (0..3) inside a MONTHLY billing period, clamped.
 *  (Original function — behavior unchanged; monthly/custom plans only.) */
export function currentWeekIndex(periodStart: Date, periodEnd: Date, now = new Date()): number {
  if (now < periodStart) return 0;
  if (now >= periodEnd) return WINDOWS_PER_CYCLE - 1;
  return Math.min(
    WINDOWS_PER_CYCLE - 1,
    Math.floor((now.getTime() - periodStart.getTime()) / (7 * DAY_MS))
  );
}

/** Index of the window containing `now` for ANY plan kind (0..3 monthly,
 *  0..47 yearly), clamped to the first/last window outside the period. */
export function currentPlanWindowIndex(
  m: Pick<Membership, 'planKind'>,
  periodStart: Date,
  periodEnd: Date,
  now = new Date()
): number {
  const windows = planWindows(m, periodStart, periodEnd);
  if (now < periodStart) return 0;
  if (now >= periodEnd) return windows.length - 1;
  const idx = windows.findIndex((w) => now >= w.start && now < w.end);
  return idx >= 0 ? idx : windows.length - 1;
}

/**
 * YEARLY-PLAN GUEST SLOTS (owner rule, 2026-10-28): each weekly window of a
 * YEARLY plan carries ONE additional free guest cut, tied to the same window
 * (shop-time math identical to the member's own cut) and use-or-lose with
 * the week. Monthly / Mix & Match plans have NO guest slots.
 * A guest slot is spent by a guest-flagged redemption with the same
 * (weekIndex, periodStart) key as the member's own redemption for that
 * window — the two records are distinct and can never double-spend or be
 * confused with each other. Max lifetime guest cuts: 48 (one per window).
 */
export function buildGuestWeeks(
  m: Membership,
  redemptions: MembershipRedemption[],
  now = new Date()
): WeekState[] {
  if (planKindOf(m) !== 'yearly') return [];
  const start = new Date(m.currentPeriodStart);
  const end = new Date(m.currentPeriodEnd);
  const windows = planWindows(m, start, end);
  const cur = currentPlanWindowIndex(m, start, end, now);
  return windows.map((w, i) => {
    const red = redemptions.find(
      (r) => r.guest === true && r.weekIndex === i && r.periodStart === m.currentPeriodStart
    );
    let state: WeekState['state'];
    if (red) state = 'used';
    else if (i < cur) state = 'expired';
    else if (i === cur) state = 'available';
    else state = 'upcoming';
    return {
      index: i,
      cycleIndex: w.cycleIndex,
      label: `Week ${i + 1}`,
      start: w.start,
      end: w.end,
      state,
      redeemedAt: red?.redeemedAt ?? null,
    };
  });
}

/** The guest slot of the CURRENT window (yearly plans only). */
export function currentGuestSlot(
  m: Membership,
  redemptions: MembershipRedemption[],
  now = new Date()
): WeekState | null {
  const guests = buildGuestWeeks(m, redemptions, now);
  if (!guests.length) return null;
  const start = new Date(m.currentPeriodStart);
  const end = new Date(m.currentPeriodEnd);
  return guests[currentPlanWindowIndex(m, start, end, now)] ?? null;
}

// --- Week states (pure; moved from membership.ts unchanged in behavior) ------

export interface WeekState {
  index: number; // 0..3 monthly · 0..47 yearly (global within the period)
  cycleIndex: number; // 0 monthly · 0..11 yearly
  label: string; // "Week 1".."Week 4" monthly · "Week 1".."Week 48" yearly
  start: Date;
  end: Date;
  state: 'used' | 'available' | 'expired' | 'upcoming';
  redeemedAt: string | null;
}

export function buildWeeks(
  m: Membership,
  redemptions: MembershipRedemption[],
  now = new Date()
): WeekState[] {
  const start = new Date(m.currentPeriodStart);
  const end = new Date(m.currentPeriodEnd);
  const windows = planWindows(m, start, end);
  const cur = currentPlanWindowIndex(m, start, end, now);
  return windows.map((w, i) => {
    // The member's OWN cut only — guest-flagged redemptions are a separate
    // slot (see buildGuestWeeks) and must never consume the member's week.
    const red = redemptions.find(
      (r) => !r.guest && r.weekIndex === i && r.periodStart === m.currentPeriodStart
    );
    let state: WeekState['state'];
    if (red) state = 'used';
    else if (i < cur) state = 'expired';
    else if (i === cur) state = 'available';
    else state = 'upcoming';
    return {
      index: i,
      cycleIndex: w.cycleIndex,
      label: `Week ${i + 1}`,
      start: w.start,
      end: w.end,
      state,
      redeemedAt: red?.redeemedAt ?? null,
    };
  });
}
