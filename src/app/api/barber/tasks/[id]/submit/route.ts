import { NextResponse } from 'next/server';
import { getTask, saveTask, saveCompletionPhoto, inSalon } from '@/lib/store';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';

export const dynamic = 'force-dynamic';

// Barber: submit photo proof that the task is done.
// Multipart form with a `photo` field (camera). Sets my assignment to 'submitted'.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const salonId = await barberSalonId(session);
  const { id } = await params;

  const task = await getTask(id);
  if (!task || !inSalon(task, salonId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const a = task.assignments.find((x) => x.barberId === session.barberId);
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (a.status === 'approved') {
    return NextResponse.json({ error: 'Already approved.' }, { status: 400 });
  }

  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Photo required.' }, { status: 400 });
  }
  let photoPath: string;
  try {
    const form = await req.formData();
    photoPath = await saveCompletionPhoto(form, 'task');
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Photo required.' },
      { status: 400 }
    );
  }

  a.status = 'submitted';
  a.photoPath = photoPath;
  a.submittedAt = new Date().toISOString();
  a.approvedAt = null;
  await saveTask(task);
  return NextResponse.json({ ok: true });
}
