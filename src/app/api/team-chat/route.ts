import { NextResponse } from 'next/server';
import { requireBarber, requireOwner, sessionSalonId } from '@/lib/auth';
import { getBarbers, getTeamChat, saveTeamChat, newId, inSalon } from '@/lib/store';
import { barberSalonId } from '@/lib/salonScope';
import { sendPushToUser } from '@/lib/push';
import type { Barber, TeamChatDoc, TeamChatMessage } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_LEN = 500;
const MAX_MSGS = 200;

function emptyDoc(): TeamChatDoc {
  return { messages: [], lastRead: {}, ownerLastRead: null };
}

function activeBarber(barbers: Barber[], id: string): Barber | null {
  const b = barbers.find((x) => x.id === id);
  return b && b.active && b.approved !== false ? b : null;
}

type Actor = { kind: 'barber'; barberId: string; salonId: string } | { kind: 'owner'; salonId: string };

// Either a barber session or the owner session. The owner reads in ghost mode:
// invisible — no presence, no read receipts visible to barbers, no push.
// Each salon has its own thread: barbers only ever see their salon's chat.
async function actorOf(req: Request): Promise<Actor | null> {
  const b = requireBarber(req);
  if (b && b.barberId) return { kind: 'barber', barberId: b.barberId, salonId: await barberSalonId(b) };
  const o = requireOwner(req);
  if (o) return { kind: 'owner', salonId: sessionSalonId(o) };
  return null;
}

// GET /api/team-chat → { messages, unread } (+ barberId for barbers)
// Read-only: never mutates the doc, so the owner's reads leave zero trace.
export async function GET(req: Request) {
  const actor = await actorOf(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [barbers, doc] = await Promise.all([getBarbers(), getTeamChat(actor.salonId)]);
  const myBarbers = barbers.filter((b) => inSalon(b, actor.salonId));
  const d = doc ?? emptyDoc();

  if (actor.kind === 'owner') {
    const unread = d.messages.filter((m) => !d.ownerLastRead || m.createdAt > d.ownerLastRead).length;
    return NextResponse.json({ messages: d.messages, unread });
  }

  if (!activeBarber(myBarbers, actor.barberId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const lastRead = d.lastRead[actor.barberId];
  const unread = d.messages.filter(
    (m) => m.senderBarberId !== actor.barberId && (!lastRead || m.createdAt > lastRead)
  ).length;
  // NOTE: ownerLastRead is deliberately never included in barber responses.
  return NextResponse.json({ messages: d.messages, barberId: actor.barberId, unread });
}

// POST /api/team-chat → { message } | { ok: true }
// Body: { text } to send (barbers only — the owner is read-only),
// or { markRead: true } (barbers update their lastRead, the owner updates
// ownerLastRead only — barber-visible state is never touched by the owner).
export async function POST(req: Request) {
  const actor = await actorOf(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const now = new Date().toISOString();

  if (body?.markRead === true) {
    const d = (await getTeamChat(actor.salonId)) ?? emptyDoc();
    if (actor.kind === 'owner') {
      d.ownerLastRead = now;
    } else {
      const barbers0 = (await getBarbers()).filter((b) => inSalon(b, actor.salonId));
      if (!activeBarber(barbers0, actor.barberId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      d.lastRead[actor.barberId] = now;
    }
    await saveTeamChat(d, actor.salonId);
    return NextResponse.json({ ok: true });
  }

  // Sending is barber-only. The owner cannot send (that would reveal him).
  if (actor.kind !== 'barber') {
    return NextResponse.json({ error: 'Read-only.' }, { status: 403 });
  }
  // Fetch doc + barbers in parallel — every Blob round-trip counts.
  const [doc, barbers] = await Promise.all([getTeamChat(actor.salonId), getBarbers()]);
  const myBarbers = barbers.filter((b) => inSalon(b, actor.salonId));
  const d = doc ?? emptyDoc();
  const me = activeBarber(myBarbers, actor.barberId);
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_LEN) : '';
  if (!text) return NextResponse.json({ error: 'Message is empty.' }, { status: 400 });

  const msg: TeamChatMessage = {
    id: newId(),
    senderBarberId: actor.barberId,
    senderName: me.name,
    text,
    createdAt: now,
  };
  d.messages.push(msg);
  if (d.messages.length > MAX_MSGS) d.messages = d.messages.slice(-MAX_MSGS);
  d.lastRead[actor.barberId] = now;
  await saveTeamChat(d, actor.salonId);

  // Notify every other active approved barber — unless they're viewing it now.
  // The owner is never pushed (he reads on demand, invisibly).
  // Fire-and-forget: the response goes out immediately after saving so the
  // sender sees their message instantly. Push is best-effort (polling
  // delivers the message itself).
  const others = myBarbers.filter(
    (b) => b.id !== actor.barberId && b.active && b.approved !== false
  );
  Promise.all(
    others.map(async (b) => {
      const lr = d.lastRead[b.id];
      const viewingNow = lr ? Date.now() - new Date(lr).getTime() < 60_000 : false;
      if (viewingNow) return;
      await sendPushToUser('barber', b.id, {
        title: `💬 ${me.name} (team chat)`,
        body: text.length > 120 ? text.slice(0, 120) + '…' : text,
        url: '/barber/dashboard',
      }).catch(() => null);
    })
  ).catch(() => null);

  return NextResponse.json({ message: msg });
}
