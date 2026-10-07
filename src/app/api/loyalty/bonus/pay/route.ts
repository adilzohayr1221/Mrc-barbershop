import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getBarberMilestone, saveBarberMilestone } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Owner marks a barber's earned milestone bonus as paid.
// Body: { barberId: string, which: 'bonus10' | 'bonus100' }
export async function POST(req: Request) {
  const session = requireOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const barberId: unknown = body?.barberId;
  const which: unknown = body?.which;
  if (typeof barberId !== 'string' || (which !== 'bonus10' && which !== 'bonus100')) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const m = await getBarberMilestone(barberId);
  if (!m || m[which] !== 'earned') {
    return NextResponse.json({ error: 'No earned bonus to pay.' }, { status: 409 });
  }
  const now = new Date().toISOString();
  m[which] = 'paid';
  if (which === 'bonus10') m.bonus10PaidAt = now;
  else m.bonus100PaidAt = now;
  m.updatedAt = now;
  await saveBarberMilestone(m);

  // Tell the barber the bonus was paid.
  try {
    const { sendPushToUser } = await import('@/lib/push');
    const usd = which === 'bonus10' ? 100 : 500;
    await sendPushToUser('barber', barberId, {
      title: `💰 Your $${usd} bonus was paid!`,
      body: 'The owner marked your milestone bonus as paid.',
      url: '/barber',
    });
  } catch (e) {
    console.error('[loyalty] bonus-paid push failed', e);
  }
  return NextResponse.json({ ok: true });
}
