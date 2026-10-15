import { NextResponse } from 'next/server';
import { listBookings, listGifts, listTips, listWalkinPayments, inSalon } from '@/lib/store';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';
import { summarizeEarnings, addPeriods, summarizeGiftEarnings, summarizeTipEarnings, summarizeWalkinEarnings } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

// Barber-only: my own earnings — today, this week (Mon–Sun), this month.
// Redeemed gift haircuts and customer tips count too.
export async function GET(req: Request) {
  const session = requireBarber(req);
  if (!session || !session.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = await barberSalonId(session);
  const [bookings, gifts, tips, walkins] = await Promise.all([listBookings(), listGifts(), listTips(), listWalkinPayments()]);
  const mine = bookings.filter((b) => inSalon(b, salonId) && b.barberId === session.barberId);
  const mineGifts = gifts.filter((g) => inSalon(g, salonId) && g.status === 'redeemed' && g.redeemedByBarberId === session.barberId);
  const mineTips = tips.filter((t) => inSalon(t, salonId) && t.barberId === session.barberId);
  const mineWalkins = walkins.filter((w) => inSalon(w, salonId) && w.barberId === session.barberId);
  return NextResponse.json({ ok: true, earnings: addPeriods(addPeriods(addPeriods(summarizeEarnings(mine), summarizeGiftEarnings(mineGifts)), summarizeTipEarnings(mineTips)), summarizeWalkinEarnings(mineWalkins)) });
}
