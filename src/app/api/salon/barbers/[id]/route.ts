import { NextResponse } from 'next/server';
import { getBarbers, saveBarber, salonOf } from '@/lib/store';
import { sessionSalonId } from '@/lib/auth';
import { requireActiveSalonOwner } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Salon-owner: activate/deactivate one of HIS barbers. Deactivation is the
// "barber left" action — the record is kept (history, past bookings stay).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.active !== 'boolean') {
    return NextResponse.json({ error: 'active must be a boolean.' }, { status: 400 });
  }
  const barber = (await getBarbers()).find((b) => b.id === id);
  if (!barber || salonOf(barber) !== salonId) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const updated = {
    ...barber,
    active: body.active,
    // Audit H5: deactivation kills the barber's outstanding sessions.
    authVersion: body.active ? barber.authVersion : (barber.authVersion ?? 0) + 1,
  };
  await saveBarber(updated);
  const { passwordHash: _ph, ...safe } = updated;
  return NextResponse.json({ barber: safe });
}
