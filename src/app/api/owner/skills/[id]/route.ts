import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getSkillVerification, saveSkillVerification, getBarbers, saveBarber } from '@/lib/store';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

// POST /api/owner/skills/[id] — { action: 'approve' | 'reject' }.
// Approving marks the skill as owner-verified: it shows with a ✓ badge on the
// barber's public profile so customers trust it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  }
  const v = await getSkillVerification(id);
  if (!v) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (v.status !== 'pending') {
    return NextResponse.json({ error: 'Already reviewed.' }, { status: 409 });
  }

  v.status = action === 'approve' ? 'approved' : 'rejected';
  v.reviewedAt = new Date().toISOString();
  await saveSkillVerification(v);

  if (action === 'approve') {
    const barbers = await getBarbers();
    const barber = barbers.find((b) => b.id === v.barberId);
    if (barber && !(barber.verifiedSkills ?? []).includes(v.skill)) {
      await saveBarber({ ...barber, verifiedSkills: [...(barber.verifiedSkills ?? []), v.skill] });
    }
  }

  // Tell the barber the verdict.
  try {
    await sendPushToUser('barber', v.barberId, {
      title: action === 'approve' ? `✓ "${v.skill}" verified!` : `✗ "${v.skill}" not approved`,
      body:
        action === 'approve'
          ? 'Your skill now shows with a verified badge to customers.'
          : 'Add better photos and send it again.',
      url: '/barber/dashboard',
    });
  } catch (e) {
    console.error('[skills] verdict push failed', e);
  }
  return NextResponse.json({ ok: true });
}
