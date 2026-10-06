import { NextResponse } from 'next/server';
import { listTasks, saveTask, getBarbers, newId, inSalon, salonOf } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

// Salon owner: list my salon's tasks.
export async function GET(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const tasks = (await listTasks()).filter((t) => inSalon(t, salonId));
  const barbers = await getBarbers();
  const barberName = new Map(barbers.map((b) => [b.id, b.name]));
  return NextResponse.json({
    tasks: tasks.map((t) => ({
      ...t,
      assignments: t.assignments.map((a) => ({
        ...a,
        barberName: barberName.get(a.barberId) ?? '',
        photoUrl: a.photoPath ? `/api/photos/${encodeURIComponent(a.photoPath.split('/').pop() || '')}` : null,
      })),
    })),
  });
}

// Salon owner: create a task for my own salon's barbers.
// Body: { title, description?, barberIds[] }
export async function POST(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const body = await req.json().catch(() => null);
  const title = String(body?.title || '').trim();
  const description = String(body?.description || '').trim();
  const barberIds = Array.isArray(body?.barberIds) ? body.barberIds.map(String) : [];

  if (title.length < 3 || title.length > 120) {
    return NextResponse.json({ error: 'Give the task a short title.' }, { status: 400 });
  }
  if (!barberIds.length) {
    return NextResponse.json({ error: 'Assign the task to at least one barber.' }, { status: 400 });
  }
  const barbers = await getBarbers();
  const valid = barberIds.filter((id: string) => {
    const b = barbers.find((x) => x.id === id);
    return b && b.active && salonOf(b) === salonId;
  });
  if (!valid.length) {
    return NextResponse.json({ error: 'No valid barbers selected.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const task = {
    id: newId(),
    title,
    description: description || undefined,
    assignments: valid.map((barberId: string) => ({ barberId, status: 'pending' as const })),
    createdBy: 'salon_owner' as const,
    createdAt: now,
    salonId,
  };
  await saveTask(task);

  await Promise.all(
    valid.map((barberId: string) =>
      sendPushToUser('barber', barberId, {
        title: 'New task ✅',
        body: title,
        url: '/barber/dashboard',
      })
    )
  );
  return NextResponse.json({ ok: true, task }, { status: 201 });
}
