import { NextResponse } from 'next/server';
import { generatePkpass } from '@/lib/wallet-pass';
import { getCustomers, getBooking, getMembershipsByCustomer } from '@/lib/store';
import { getMembershipById } from '@/lib/membership';

import { requireActiveCustomer } from "@/lib/guard";

export const dynamic = 'force-dynamic';

// GET /api/wallet/pass?type=membership|service&ref=xxx
// Returns a signed .pkpass for Apple Wallet.
export async function GET(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'membership';
  const ref = searchParams.get('ref') || '';

  const customers = await getCustomers();
  const customer = customers.find((c) => c.id === session.customerId);
  if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });

  // Audit M14 (2026-10-29): a pass is minted ONLY for something the
  // session customer actually owns — previously any signed-in customer
  // could mint a valid-looking "Active member" pass for any ref (or no
  // ref at all) without holding a membership.
  let effectiveRef = ref;
  if (type === 'membership') {
    const mine = await getMembershipsByCustomer(customer.id);
    const target = ref ? await getMembershipById(ref) : mine.find((m) => m.status === 'active') ?? null;
    if (!target || target.customerId !== customer.id || target.status !== 'active') {
      return NextResponse.json({ error: 'No active membership found for this pass.' }, { status: 403 });
    }
    effectiveRef = target.id;
  } else {
    // Service pass: the ref is a booking id — it must be the customer's
    // own paid booking.
    const booking = ref ? await getBooking(ref) : null;
    if (
      !booking ||
      booking.customerId !== customer.id ||
      (booking.paymentStatus !== 'paid' && booking.paymentStatus !== 'paid_in_full')
    ) {
      return NextResponse.json({ error: 'No paid booking found for this pass.' }, { status: 403 });
    }
  }

  try {
    const serial = `MRC-${type.toUpperCase()}-${effectiveRef || customer.id}`.slice(0, 60);
    const buf = await generatePkpass({
      customerName: customer.name || 'Member',
      title: type === 'membership' ? 'Monthly Membership' : 'Haircut',
      subtitle: type === 'membership' ? 'Active member' : 'Paid in full',
      serialNumber: serial,
      membershipId: type === 'membership' ? effectiveRef || undefined : undefined,
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Could not generate pass.';
    console.error('[wallet] pkpass failed', msg);
    return NextResponse.json({ error: 'Could not generate the wallet pass right now.' }, { status: 500 });
  }
}
