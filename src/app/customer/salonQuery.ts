// Client helper: appends ?salon=<value> to public API URLs when the customer
// arrived via a non-MRC salon link. The salon key is stored in localStorage
// by /customer when ?salon= is present (and cleared when it isn't).
// When the key is missing or 'mrc', the URL is returned unchanged, so the
// existing MRC customer requests stay byte-identical.
export function withSalon(url: string): string {
  if (typeof window === 'undefined') return url;
  let salon: string | null = null;
  try {
    salon = localStorage.getItem('mrc-customer-salon');
  } catch {
    salon = null;
  }
  if (!salon || salon === 'mrc') return url;
  return url + (url.includes('?') ? '&' : '?') + 'salon=' + encodeURIComponent(salon);
}
