import { NextResponse } from 'next/server';
import { getTask, deleteTask } from '@/lib/store';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Owner (super-admin): delete a task entirely (e.g. after it's done and reviewed).
// The task disappears from the barbers' lists too. Proof photos are tiny Blob
// objects and are left in place, same as deleted work photos.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteTask(id);
  return NextResponse.json({ ok: true });
}
