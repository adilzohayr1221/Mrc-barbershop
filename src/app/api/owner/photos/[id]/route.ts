import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getWorkPhoto, saveWorkPhoto, deleteWorkPhoto } from '@/lib/store';

export const dynamic = 'force-dynamic';

// POST /api/owner/photos/[id] → { action: 'approve' | 'reject' }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  }
  const p = await getWorkPhoto(id);
  if (!p) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (action === 'approve') {
    p.status = 'approved';
    await saveWorkPhoto(p);
  } else {
    await deleteWorkPhoto(id);
  }
  return NextResponse.json({ ok: true });
}
