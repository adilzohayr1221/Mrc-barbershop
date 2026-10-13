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

export function hasCoords(s: { lat?: number; lng?: number }): boolean {
  return (
    typeof s.lat === 'number' &&
    typeof s.lng === 'number' &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng) &&
    !(s.lat === 0 && s.lng === 0)
  );
}
