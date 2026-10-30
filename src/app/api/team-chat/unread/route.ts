import { NextResponse } from 'next/server';

import { requireActiveBarber, requireActiveOwner } from "@/lib/guard";
import { getBarbers, getTeamChat } from '@/lib/store';
import { sessionSalonId } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';

export const dynamic = 'force-dynamic';

// GET /api/team-chat/unread → { unread: number } — lightweight badge count.
// Barbers: messages newer than their lastRead. Owner: messages newer than
// ownerLastRead (ghost read position — never exposed to barbers).
export async function GET(req: Request) {
  const barberSession = await requireActiveBarber(req);
  const ownerSession = barberSession ? null : await requireActiveOwner(req);
  if ((!barberSession || !barberSession.barberId) && !ownerSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Audit L2 (2026-10-29): the unread count must read the caller's OWN
  // salon thread — the unscoped call always read the platform salon's doc,
  // so salon barbers saw platform unread counts (and vice versa).
  const salonId = ownerSession ? sessionSalonId(ownerSession) : await barberSalonId(barberSession!);
  const [barbers, doc] = await Promise.all([getBarbers(), getTeamChat(salonId)]);
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
