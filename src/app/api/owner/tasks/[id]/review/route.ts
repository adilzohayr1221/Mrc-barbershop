import { NextResponse } from 'next/server';
import { getTask, saveTask } from '@/lib/store';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Owner (super-admin): approve a barber's submitted photo proof, or reopen the task.
// Body: { barberId, action: 'approve' | 'reopen' }
// The super-admin sits above all salons, so he may review any task.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const barberId = String(body?.barberId || '');
  const action = body?.action;

  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const a = task.assignments.find((x) => x.barberId === barberId);
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  if (action === 'approve') {
    if (a.status !== 'submitted') {
      return NextResponse.json({ error: 'Nothing to approve yet.' }, { status: 400 });
    }
    a.status = 'approved';
    a.approvedAt = now;
  } else if (action === 'reopen') {
    a.status = 'pending';
    a.photoPath = null;
    a.submittedAt = null;
    a.approvedAt = null;
  } else {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  }
  await saveTask(task);
  return NextResponse.json({ ok: true, task });
}
