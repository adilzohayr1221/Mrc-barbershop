import { NextResponse } from 'next/server';
import { generatePkpass } from '@/lib/wallet-pass';
import { getCustomers } from '@/lib/store';
import { requireCustomer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/wallet/pass?type=membership|service&ref=xxx
// Returns a signed .pkpass for Apple Wallet.
export async function GET(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'membership';
  const ref = searchParams.get('ref') || '';

  const customers = await getCustomers();
  const customer = customers.find((c) => c.id === session.customerId);
  if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });

  try {
    const serial = `MRC-${type.toUpperCase()}-${ref || customer.id}`.slice(0, 60);
    const buf = await generatePkpass({
      customerName: customer.name || 'Member',
      title: type === 'membership' ? 'Monthly Membership' : 'Haircut',
      subtitle: type === 'membership' ? 'Active member' : 'Paid in full',
      serialNumber: serial,
      membershipId: type === 'membership' ? ref || undefined : undefined,
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
