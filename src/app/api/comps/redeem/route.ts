import { NextResponse } from 'next/server';
import { requireActiveBarber } from '@/lib/guard';
import { getComp, saveComp, getCustomers, salonOf } from '@/lib/store';
import { barberSalonId } from '@/lib/salonScope';

export const dynamic = 'force-dynamic';

// Barber validates (preview=true) or redeems a comp code (MRC4:<compId>:<token>).
// A comp is a FREE haircut granted by the owner for a complaint — the customer
// pays nothing AND the barber gets no payout (the owner decided the redo is
// unpaid). Redeeming only marks the code used; no Stripe transfer happens.
export async function POST(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const preview = body?.preview === true;
  const compId = body?.compId;
  const token = body?.token;
  if (typeof compId !== 'string' || !compId || typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'Invalid code.' }, { status: 400 });
  }
  const comp = await getComp(compId);
  if (!comp || comp.token !== token) {
    return NextResponse.json(
      { error: 'This comp code is not valid. Ask for the code again.' },
      { status: 404 }
    );
  }
  if (comp.status === 'redeemed') {
    return NextResponse.json({ error: 'This free haircut was already used.' }, { status: 410 });
  }
  // Audit M10 (2026-10-22): a comp can only be redeemed inside its own salon.
  if (salonOf(comp) !== (await barberSalonId(session))) {
    return NextResponse.json({ error: 'This code belongs to a different salon.' }, { status: 403 });
  }

  if (preview) {
    const customers = await getCustomers();
    const cust = customers.find((c) => c.id === comp.customerId);
    return NextResponse.json({
      ok: true,
      preview: {
        serviceName: comp.serviceName,
        value: comp.value,
        customerName: cust?.name ?? 'Customer',
      },
    });
  }

  comp.status = 'redeemed';
  comp.redeemedAt = new Date().toISOString();
  comp.redeemedByBarberId = session.barberId;
  await saveComp(comp);

  // Barber milestone: a comp haircut is still work done in the app.
  // The customer loyalty counter does NOT move (the haircut was free).
  try {
    const { recordHaircut } = await import('@/lib/loyalty');
    await recordHaircut({
      barberId: session.barberId,
      customerId: comp.customerId,
      paid: false,
      salonId: salonOf(comp),
    });
  } catch (e) {
    console.error('[comps/redeem] loyalty hook failed', e);
  }
  return NextResponse.json({
    ok: true,
    comp: { serviceName: comp.serviceName, value: comp.value },
  });
}
