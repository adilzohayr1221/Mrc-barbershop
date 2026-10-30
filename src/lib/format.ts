const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Display helper: '2026-10-22' -> 'Oct 22, 2026' (US date format).
 *  Parses the ISO date parts directly — no timezone shifting. */
export function formatDateUS(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso;
  return `${MONTHS_SHORT[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Display helper: '4436910964' -> '(443) 691-0964' (US phone format).
 *  Anything that is not a 10-digit (or 1-prefixed 11-digit) number is
 *  returned unchanged. */
export function formatPhoneUS(phone: string): string {
  const d = (phone ?? '').replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return phone;
}

/** Display helper: '13:00' -> '1:00 PM' (US 12-hour format). Internal values stay 24h. */
export function formatTime12h(t: string): string {
  const [hStr, m] = t.split(':');
  const h = Number(hStr);
  if (!Number.isFinite(h)) return t;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m ?? '00'} ${suffix}`;
}
