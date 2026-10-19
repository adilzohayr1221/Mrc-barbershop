import { NextResponse } from 'next/server';
import { listTrainingSignups } from '@/lib/training';

export const dynamic = 'force-dynamic';

// Cron-secret only (same guard as /api/cron/*): returns the training
// signups so the enrollment watcher can tell the owner when someone
// signs up and when a payment lands.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const signups = await listTrainingSignups();
  return NextResponse.json({
    ok: true,
    signups: signups.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      dob: s.dob,
      address: s.address,
      status: s.status,
      createdAt: s.createdAt,
      paidAt: s.paidAt ?? null,
    })),
  });
}
