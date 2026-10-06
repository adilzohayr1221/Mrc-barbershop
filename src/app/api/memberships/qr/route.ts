import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { saveMembership } from '@/lib/store';
import { getMembershipById, mintQrToken } from '@/lib/membership';

export const dynamic = 'force-dynamic';

// Customer-only: mint a short-lived membership QR code (MRC2) for the barber
// to scan at the shop. Rotates every 10 minutes, like payment codes.
// Body: { membershipId } — one account can hold several plans.
export async function POST(req: Request) {
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const membershipId = body?.membershipId;
  if (typeof membershipId !== 'string' || !membershipId) {
    return NextResponse.json({ error: 'Pick which plan to show.' }, { status: 400 });
  }
  const membership = await getMembershipById(membershipId);
  if (!membership || membership.customerId !== session.customerId) {
    return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
  }
  if (membership.status !== 'active') {
    return NextResponse.json({ error: 'This plan is not active.' }, { status: 403 });
  }
  const { token, expiry } = mintQrToken();
  await saveMembership({ ...membership, qrToken: token, qrTokenExpiry: expiry });
  return NextResponse.json({ ok: true, code: `MRC2:${membership.id}:${token}`, expiresAt: expiry });
}
