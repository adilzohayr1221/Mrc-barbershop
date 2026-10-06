import { NextResponse } from 'next/server';
import { requireBarber, requireOwner } from '@/lib/auth';
import { getBarbers, getTeamChat } from '@/lib/store';

export const dynamic = 'force-dynamic';

// GET /api/team-chat/unread → { unread: number } — lightweight badge count.
// Barbers: messages newer than their lastRead. Owner: messages newer than
// ownerLastRead (ghost read position — never exposed to barbers).
export async function GET(req: Request) {
  const barberSession = requireBarber(req);
  const ownerSession = barberSession ? null : requireOwner(req);
  if ((!barberSession || !barberSession.barberId) && !ownerSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const [barbers, doc] = await Promise.all([getBarbers(), getTeamChat()]);
  const d = doc ?? { messages: [], lastRead: {} as Record<string, string>, ownerLastRead: null as string | null };

  if (ownerSession) {
    const unread = d.messages.filter((m) => !d.ownerLastRead || m.createdAt > d.ownerLastRead).length;
    return NextResponse.json({ unread });
  }

  const me = barbers.find((x) => x.id === barberSession!.barberId);
  if (!me || !me.active || me.approved === false) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const lastRead = d.lastRead[barberSession!.barberId!];
  const unread = d.messages.filter(
    (m) => m.senderBarberId !== barberSession!.barberId && (!lastRead || m.createdAt > lastRead)
  ).length;
  return NextResponse.json({ unread });
}
