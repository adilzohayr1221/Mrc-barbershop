import { NextResponse } from 'next/server';
import { generatePkpass } from '@/lib/wallet-pass';

export const dynamic = 'force-dynamic';

// GET /api/wallet/demo — public demo pass (for testing Add to Wallet)
export async function GET() {
  try {
    const buf = await generatePkpass({
      customerName: 'Demo Member',
      title: 'Monthly Membership',
      subtitle: 'Active until Nov 11, 2026',
      serialNumber: 'MRC-DEMO-001',
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Could not generate pass.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
