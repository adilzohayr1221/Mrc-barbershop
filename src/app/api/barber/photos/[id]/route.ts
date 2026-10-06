import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { getWorkPhoto, deleteWorkPhoto } from '@/lib/store';

export const dynamic = 'force-dynamic';

// DELETE /api/barber/photos/[id] → barber deletes their own work photo.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = await getWorkPhoto(id);
  if (!p || p.barberId !== session.barberId) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  await deleteWorkPhoto(id);
  return NextResponse.json({ ok: true });
}
