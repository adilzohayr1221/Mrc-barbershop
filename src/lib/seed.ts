// First-run seeding. Branches are the ONLY invented data — everything else
// (barbers, services, prices, reviews) is added by the owner in the dashboard.
// The owner PIN hash below is the bcrypt hash of the owner-chosen PIN;
// the plaintext PIN never appears in this codebase.
import { getDoc, putDoc } from './blob';
import type { Branch, PinsDoc } from './types';

const OWNER_PIN_HASH = '$2b$10$n6zG.SoUYMHzn9tcPIGpyuntZCEiW02C8ZJ8z4cQ/ADjaIaATeXA2';

const SEED_BRANCHES: Branch[] = [
  {
    id: 'branch-1',
    name: 'MRC Barbershop — S Broadway',
    address: '127 S Broadway, Baltimore, MD 21231',
    lat: 39.28954,
    lng: -76.5933,
  },
  {
    id: 'branch-2',
    name: "MRC Barbershop — O'Donnell St",
    address: "2904 O'Donnell St, Baltimore, MD 21224",
    lat: 39.28052,
    lng: -76.57518,
  },
];

let seeded: Promise<void> | null = null;

/** Idempotent: seeds branches + owner PIN on first run. */
export function ensureSeeded(): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      const existing = await getDoc<Branch[]>('data/branches.json');
      if (existing) return;
      await putDoc('data/branches.json', SEED_BRANCHES);
      await putDoc('data/barbers.json', []);
      await putDoc('data/services.json', []);
      const pins: PinsDoc = { ownerHash: OWNER_PIN_HASH, barbers: {} };
      await putDoc('data/pins.json', pins);
    })().catch((e) => {
      seeded = null;
      throw e;
    });
  }
  return seeded;
}
