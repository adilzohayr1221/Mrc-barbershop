// Shared pin artwork for the customer map, used by both map engines
// (Leaflet fallback and MapKit). These are the ORIGINAL shop pins the
// owner approved: black/gold teardrop, drawn shop in a cream medallion,
// gold number badge, tip landing exactly on the shop's coordinates
// (visual anchor point 17,41 inside the 34×47 box).

// Small drawn barbershop (storefront + barber pole), drawn bolder so it stays
// crisp at pin size.
export const SHOP_GLYPH = `<path d="M4 9 6.5 3h19L28 9Z" fill="#D4AF37"/><path d="M10.5 3.8 10 8.4M14.5 3.8l-.2 4.6M18.5 3.8v4.6M22.5 3.8l.2 4.6" stroke="#1C1A15" stroke-width="1.6" stroke-linecap="round"/><path d="M4 9h24v1q-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0Z" fill="#1C1A15"/><rect x="6.5" y="12" width="19" height="14.5" rx="1.2" fill="#1C1A15"/><rect x="8.6" y="15" width="4" height="5" rx=".8" fill="#FFFDF6"/><rect x="19.4" y="15" width="4" height="5" rx=".8" fill="#FFFDF6"/><rect x="13.8" y="17" width="4.4" height="9.5" rx=".8" fill="#FFFDF6"/><rect x="26.3" y="13" width="2.7" height="10" rx="1.35" fill="#FFFDF6" stroke="#1C1A15" stroke-width="1"/><path d="M26.3 16l2.7-1.3M26.3 19.2l2.7-1.3M26.3 22.4l2.7-1.3" stroke="#B8912F" stroke-width="1.1"/><rect x="26.3" y="11.6" width="2.7" height="1.8" rx=".9" fill="#D4AF37"/><rect x="26.3" y="23" width="2.7" height="1.8" rx=".9" fill="#D4AF37"/>`;

// Premium teardrop pin: black/gold, drawn shop in a cream medallion, gold
// number badge, tip landing exactly on the shop's coordinates.
export function shopPinSvg(n: number) {
  return `<svg viewBox="0 0 34 47" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle class="pin-pulse-ring" cx="17" cy="17" r="14" fill="none" stroke="#D4AF37" stroke-width="2"/><path d="M17 41C12 35 4 28 4 17A13 13 0 1 1 30 17C30 28 22 35 17 41Z" fill="#1C1A15" stroke="#D4AF37" stroke-width="2"/><circle cx="17" cy="17" r="11.5" fill="#FFFDF6"/><g transform="translate(5.8,5.8) scale(0.7)">${SHOP_GLYPH}</g><circle cx="27.5" cy="7" r="6.5" fill="#D4AF37" stroke="#1C1A15" stroke-width="1.5"/><text x="27.5" y="10.2" text-anchor="middle" font-family="Arial, sans-serif" font-size="9.5" font-weight="800" fill="#1C1A15">${n}</text></svg>`;
}

// Gold teardrop pin for platform salons — inverted colors vs the black/gold
// branch pins so customers can tell them apart at a glance.
export function salonPinSvg() {
  return `<svg viewBox="0 0 34 47" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle class="pin-pulse-ring" cx="17" cy="17" r="14" fill="none" stroke="#1C1A15" stroke-width="2"/><path d="M17 41C12 35 4 28 4 17A13 13 0 1 1 30 17C30 28 22 35 17 41Z" fill="#D4AF37" stroke="#1C1A15" stroke-width="2"/><circle cx="17" cy="17" r="11.5" fill="#1C1A15"/><g transform="translate(5.8,5.8) scale(0.7)">${SHOP_GLYPH}</g></svg>`;
}
