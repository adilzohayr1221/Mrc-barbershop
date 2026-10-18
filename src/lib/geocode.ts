// Geocode a street address with Nominatim (OpenStreetMap). Never throws —
// returns null on any failure so callers decide how to proceed.
export async function geocodeAddress(
  address: string,
  city: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const q = encodeURIComponent(`${address}, ${city}`);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`,
      {
        headers: { 'User-Agent': 'MRC-Barbershop/1.0 (salon-onboarding)' },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    const first = Array.isArray(d) ? d[0] : null;
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (e) {
    console.warn('[geocode] failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// Geocode one free-form address string (e.g. a customer's full home
// address). Small in-memory cache: the same address is checked twice per
// booking (payment intent + booking create) on the same instance.
const freeformCache = new Map<string, { lat: number; lng: number } | null>();
export async function geocodeFreeform(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const key = address.trim().toLowerCase();
  if (freeformCache.has(key)) return freeformCache.get(key) ?? null;
  let result: { lat: number; lng: number } | null = null;
  try {
    const q = encodeURIComponent(address);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1&countrycodes=us`,
      {
        headers: { 'User-Agent': 'MRC-Barbershop/1.0 (vip-service-area)' },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (r.ok) {
      const d = await r.json().catch(() => null);
      const first = Array.isArray(d) ? d[0] : null;
      const lat = Number(first?.lat);
      const lng = Number(first?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) result = { lat, lng };
    }
  } catch (e) {
    console.warn('[geocode] freeform failed:', e instanceof Error ? e.message : e);
  }
  if (freeformCache.size > 500) freeformCache.clear();
  freeformCache.set(key, result);
  return result;
}

export function hasCoords(s: { lat?: number; lng?: number }): boolean {
  return (
    typeof s.lat === 'number' &&
    typeof s.lng === 'number' &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng) &&
    !(s.lat === 0 && s.lng === 0)
  );
}
