import type { Booking } from './types';

// VIP home visits (house calls). The owner's fixed model (2026-10-17):
// the customer pays a flat $100 PER PERSON — every haircut type included —
// paid in full at booking; the barber receives $60 per person on completion
// and $40 per person stays in the platform account. One visit can cover
// several people at the same home (family, friends), each at $100.
// A VIP booking also blocks TWO HOURS of the barber's day from its start
// time (travel + the visit), during which no other booking can start.
export const VIP_PRICE_USD = 100;
export const VIP_BARBER_PAYOUT_USD = 60;
export const VIP_MAX_PEOPLE = 6;
export const VIP_BLOCK_MINUTES = 120;

/** People covered by a VIP booking (1 when unset/invalid, capped). */
export function vipPeopleOf(b: { vipPeople?: number | null }): number {
  const n = Math.floor(Number(b.vipPeople ?? 1));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, VIP_MAX_PEOPLE) : 1;
}

/** Validate a client-supplied people count for a new VIP booking. */
export function parseVipPeople(v: unknown): number {
  const n = Math.floor(Number(v ?? 1));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, VIP_MAX_PEOPLE);
}

/** Customer total for a VIP visit with this many people. */
export function vipTotalUSD(people: number): number {
  return VIP_PRICE_USD * people;
}

/**
 * What the barber is paid when a booking completes: the full amount paid for
 * a normal in-shop booking; for a VIP home visit only his $60-per-person
 * share (the rest is the platform's cut, already in the platform balance).
 */
export function payoutForBooking(b: Booking): number {
  const paid = b.amountPaid ?? 0;
  if (!b.houseCall) return paid;
  return Math.min(VIP_BARBER_PAYOUT_USD * vipPeopleOf(b), paid);
}

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Slot starts (HH:MM) that a booking makes unavailable: its own start, plus
 * — for a VIP home visit — every 30-min start inside its 2-hour block.
 */
export function blockedStartsFor(b: Pick<Booking, 'time' | 'houseCall'>): string[] {
  if (!b.houseCall) return [b.time];
  const start = toMin(b.time);
  const out: string[] = [];
  for (let m = start; m < start + VIP_BLOCK_MINUTES; m += 30) out.push(toHHMM(m));
  return out;
}

/**
 * Does a new booking at `time` clash with an existing one? A VIP visit
 * occupies [start, start+2h); a normal booking occupies its start slot.
 * Intervals are half-open, and a normal booking still can't share another
 * booking's exact start (handled by the caller's exact-match check too).
 */
export function vipClash(
  bookings: Pick<Booking, 'barberId' | 'date' | 'time' | 'status' | 'houseCall'>[],
  barberId: string,
  date: string,
  time: string,
  newIsVip: boolean
): boolean {
  const ns = toMin(time);
  const ne = ns + (newIsVip ? VIP_BLOCK_MINUTES : 1);
  return bookings.some((b) => {
    if (b.barberId !== barberId || b.date !== date || b.status !== 'booked') return false;
    const s = toMin(b.time);
    const e = s + (b.houseCall ? VIP_BLOCK_MINUTES : 1);
    return ns < e && s < ne;
  });
}
