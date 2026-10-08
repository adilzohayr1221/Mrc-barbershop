/** Display helper: '13:00' -> '1:00 PM' (US 12-hour format). Internal values stay 24h. */
export function formatTime12h(t: string): string {
  const [hStr, m] = t.split(':');
  const h = Number(hStr);
  if (!Number.isFinite(h)) return t;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m ?? '00'} ${suffix}`;
}
