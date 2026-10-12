import { NextResponse } from 'next/server';
import { getBranches, saveBranches, newId, inSalon } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';
import type { Branch } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Salon-owner: list branches of HIS salon.
export async function GET(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const branches = (await getBranches()).filter((b) => inSalon(b, salonId));
  return NextResponse.json({ branches });
}

// Salon-owner: add a branch to HIS salon.
// DISABLED: one shop per salon owner. The single branch is auto-created when
// the platform owner approves the salon. A second shop needs a new registration.
export async function POST(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(
    { error: 'Each salon has one shop. To open another shop, register a new salon account.' },
    { status: 403 }
  );
}
