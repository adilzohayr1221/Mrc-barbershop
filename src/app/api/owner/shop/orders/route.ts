import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { listShopOrders, getShopDebt, getBarbers, getBranches } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Owner: all supply orders, newest first, with each barber's outstanding
// debt and the branch(es) each barber works at.
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [orders, barbers, branches] = await Promise.all([listShopOrders(), getBarbers(), getBranches()]);
  // Cancelled orders are hidden — cancelling removes the order from the list.
  const visible = orders.filter((o) => o.status !== 'cancelled');
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '';
  const debts: Record<string, number> = {};
  const barberBranches: Record<string, string[]> = {};
  for (const o of visible) {
    if (!(o.barberId in debts)) debts[o.barberId] = await getShopDebt(o.barberId);
    if (!(o.barberId in barberBranches)) {
      const b = barbers.find((x) => x.id === o.barberId);
      barberBranches[o.barberId] = (b?.branchIds || []).map(branchName).filter(Boolean);
    }
  }
  return NextResponse.json({ orders: visible, debts, barberBranches });
}
