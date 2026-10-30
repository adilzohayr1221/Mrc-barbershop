import { NextResponse } from 'next/server';
import { listTrainingSignups } from '@/lib/training';
import { secretMatches } from "@/lib/auth";
import { requireActiveOwner } from "@/lib/guard";

export const dynamic = 'force-dynamic';

// Two authorized readers (audit M14, 2026-10-22):
// - the enrollment-watcher cron (x-cron-secret, constant-time compared):
//   gets the fields it needs to notify the owner — name/email/phone,
//   status, plan, timestamps. It NO LONGER receives the trainees' dates
//   of birth or home addresses.
// - the owner himself (full session): gets the complete records.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const viaCron = secretMatches(req.headers.get('x-cron-secret'), secret);
  const viaOwner = !viaCron && !!(await requireActiveOwner(req));
  if (!viaCron && !viaOwner) {
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
      ...(viaOwner ? { dob: s.dob, address: s.address } : {}),
      status: s.status,
      weeklyUsd: s.weeklyUsd ?? 100,
      createdAt: s.createdAt,
      paidAt: s.paidAt ?? null,
    })),
  });
}
