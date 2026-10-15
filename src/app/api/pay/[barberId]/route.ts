import { NextResponse } from 'next/server';
import { getBarbers, getBranches } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';

export const dynamic = 'force-dynamic';

// Public info for a barber's walk-in payment page (QR code target).
// Only exposes what a walk-in customer needs: the barber's name and shop.
// A barber is payable only when active, approved, and has connected a bank.
export async function GET(_req: Request, { params }: { params: Promise<{ barberId: string }> }) {
  await ensureSeeded();
  const { barberId } = await params;
  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === barberId);
  if (!barber || !barber.active || barber.approved === false || !barber.stripeAccountId) {
    return NextResponse.json({ error: 'This payment page is not available.' }, { status: 404 });
  }
  const branches = await getBranches().catch(() => []);
  const branch = branches.find((x) => barber.branchIds?.includes(x.id));
  return NextResponse.json({
    ok: true,
    barberName: barber.name,
    branchName: branch?.name ?? null,
  });
}
