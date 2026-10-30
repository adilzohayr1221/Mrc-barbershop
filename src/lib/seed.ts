// First-run seeding. Branches are the ONLY invented data — everything else
// (barbers, services, prices, reviews) is added by the owner in the dashboard.
// The plaintext owner PIN never appears in this codebase.
//
// Audit H8 (2026-10-22): the seeded owner PIN hash now comes from the
// OWNER_PIN_HASH environment variable when set. The literal below is a
// LEGACY FALLBACK kept only so an existing install can never be locked out:
// production's data/pins.json was seeded long ago and is never re-seeded,
// so this value is not what production verifies against. FLAGGED for the
// owner: rotate the PIN, set OWNER_PIN_HASH in the deployment env, then
// delete the fallback literal.
import { getDoc, putDoc } from './blob';
import type { Branch, PinsDoc } from './types';

const LEGACY_OWNER_PIN_HASH_FALLBACK = '$2b$10$n6zG.SoUYMHzn9tcPIGpyuntZCEiW02C8ZJ8z4cQ/ADjaIaATeXA2';

function ownerPinHash(): string {
  return process.env.OWNER_PIN_HASH || LEGACY_OWNER_PIN_HASH_FALLBACK;
}

const SEED_BRANCHES: Branch[] = [
  {
    id: 'branch-1',
    name: 'MRC Barbershops — S Broadway',
    address: '127 S Broadway, Baltimore, MD 21231',
    lat: 39.28954,
    lng: -76.5933,
  },
  {
    id: 'branch-2',
    name: "MRC Barbershops — O'Donnell St",
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
      const pins: PinsDoc = { ownerHash: ownerPinHash(), barbers: {} };
      await putDoc('data/pins.json', pins);
    })().catch((e) => {
      seeded = null;
      throw e;
    });
  }
  return seeded;
}
