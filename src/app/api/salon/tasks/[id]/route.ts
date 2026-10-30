import { NextResponse } from 'next/server';
import { getTask, deleteTask, inSalon } from '@/lib/store';
import { sessionSalonId } from '@/lib/auth';
import { requireActiveSalonOwner } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Salon owner: delete one of my own salon's tasks (e.g. after it's done and reviewed).
// The task disappears from the barbers' lists too.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const { id } = await params;
  const task = await getTask(id);
  if (!task || !inSalon(task, salonId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await deleteTask(id);
  return NextResponse.json({ ok: true });
}
