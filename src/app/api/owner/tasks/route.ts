import { NextResponse } from 'next/server';
import { listTasks, saveTask, getBarbers, getSalon, newId, inSalon, salonOf } from '@/lib/store';
import { requireOwner } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { PLATFORM_SALON_ID } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Owner (super-admin): list tasks, optionally filtered by ?salon= (id or slug).
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonParam = new URL(req.url).searchParams.get('salon')?.trim() || PLATFORM_SALON_ID;
  const tasks = (await listTasks()).filter((t) => inSalon(t, salonParam));
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

// Owner (super-admin): create a task and assign it to barbers.
// Body: { title, description?, barberIds[], salonId? } — salonId defaults to 'mrc' (my shops).
export async function POST(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const title = String(body?.title || '').trim();
  const description = String(body?.description || '').trim();
  const barberIds = Array.isArray(body?.barberIds) ? body.barberIds.map(String) : [];
  const salonId = String(body?.salonId || PLATFORM_SALON_ID);

  if (title.length < 3 || title.length > 120) {
    return NextResponse.json({ error: 'Give the task a short title.' }, { status: 400 });
  }
  if (!barberIds.length) {
    return NextResponse.json({ error: 'Assign the task to at least one barber.' }, { status: 400 });
  }
  if (salonId !== PLATFORM_SALON_ID) {
    const salon = await getSalon(salonId);
    if (!salon || salon.status !== 'active') {
      return NextResponse.json({ error: 'Unknown or inactive salon.' }, { status: 400 });
    }
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
    createdBy: 'owner' as const,
    createdAt: now,
    salonId,
  };
  await saveTask(task);

  // Notify each assigned barber (never throws).
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
