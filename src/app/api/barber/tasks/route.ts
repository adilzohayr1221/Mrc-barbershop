import { NextResponse } from 'next/server';
import { listTasks, inSalon } from '@/lib/store';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';

export const dynamic = 'force-dynamic';

// Barber: my assigned tasks (with their status and my proof photo).
export async function GET(req: Request) {
  const session = requireBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const salonId = await barberSalonId(session);
  const tasks = (await listTasks()).filter((t) => inSalon(t, salonId));
  const mine = tasks
    .map((t) => {
      const a = t.assignments.find((x) => x.barberId === session.barberId);
      if (!a) return null;
      return {
        id: t.id,
        title: t.title,
        description: t.description || '',
        createdAt: t.createdAt,
        status: a.status,
        photoUrl: a.photoPath ? `/api/photos/${encodeURIComponent(a.photoPath.split('/').pop() || '')}` : null,
        submittedAt: a.submittedAt || null,
        approvedAt: a.approvedAt || null,
      };
    })
    .filter(Boolean);
  return NextResponse.json({ tasks: mine });
}
