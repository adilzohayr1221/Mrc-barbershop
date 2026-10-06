import { NextResponse } from 'next/server';
import { verifySession, bearerToken } from '@/lib/auth';
import {
  getBooking, newId, getBarbers, getCustomer,
  getChatMessages, saveChatMessage, deleteChatMessage,
  getChatMeta, saveChatMeta,
} from '@/lib/store';
import { sendPushToUser } from '@/lib/push';
import type { ChatMessage, ChatMeta } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_LEN = 500;

// Only the customer or barber of this booking may read/write its chat thread.
async function authorize(req: Request, bookingId: string) {
  const session = verifySession(bearerToken(req));
  if (!session || (session.role !== 'customer' && session.role !== 'barber')) return { error: 'Unauthorized', status: 401 as const };
  const booking = await getBooking(bookingId);
  if (!booking) return { error: 'Not found', status: 404 as const };
  const isCustomer = session.role === 'customer' && booking.customerId === session.customerId;
  const isBarber = session.role === 'barber' && booking.barberId === session.barberId;
  if (!isCustomer && !isBarber) return { error: 'Forbidden', status: 403 as const };
  return { session, booking };
}

// GET /api/chats/[bookingId] → { messages } (also marks this party as read)
export async function GET(req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const auth = await authorize(req, bookingId);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const messages = await getChatMessages(bookingId);
  const now = new Date().toISOString();
  const meta = await getChatMeta(bookingId).catch((): ChatMeta => ({}));
  if (auth.session.role === 'customer') meta.customerLastRead = now;
  else meta.barberLastRead = now;
  await saveChatMeta(bookingId, meta).catch(() => null);
  return NextResponse.json({ messages });
}

// POST /api/chats/[bookingId] → { message } — send a message, notify the other party
// Body: { text }
export async function POST(req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const auth = await authorize(req, bookingId);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_LEN) : '';
  if (!text) return NextResponse.json({ error: 'Message is empty.' }, { status: 400 });
  if (auth.booking.status !== 'booked') {
    return NextResponse.json({ error: 'This appointment is closed.' }, { status: 400 });
  }

  let senderName = auth.session.role === 'customer' ? 'Customer' : 'Barber';
  if (auth.session.role === 'customer' && auth.session.customerId) {
    const c = await getCustomer(auth.session.customerId).catch(() => null);
    if (c?.name) senderName = c.name;
  } else if (auth.session.barberId) {
    const barbers = await getBarbers().catch(() => []);
    const b = barbers.find((x) => x.id === auth.session.barberId);
    if (b?.name) senderName = b.name;
  }

  const msg: ChatMessage = {
    id: newId(),
    senderRole: auth.session.role as 'customer' | 'barber',
    senderId: auth.session.role === 'customer' ? auth.session.customerId! : auth.session.barberId!,
    senderName,
    text,
    createdAt: new Date().toISOString(),
  };
  // Save as its own file (no overwrite → no CDN staleness → visible immediately).
  await saveChatMessage(bookingId, msg);

  const now = new Date().toISOString();
  const meta = await getChatMeta(bookingId).catch((): ChatMeta => ({}));
  if (auth.session.role === 'customer') meta.customerLastRead = now;
  else meta.barberLastRead = now;
  await saveChatMeta(bookingId, meta).catch(() => null);

  // Notify the other party — unless they're actively viewing the chat right now.
  const otherRole = auth.session.role === 'customer' ? 'barber' : 'customer';
  const otherLastRead = auth.session.role === 'customer' ? meta.barberLastRead : meta.customerLastRead;
  const viewingNow = otherLastRead ? Date.now() - new Date(otherLastRead).getTime() < 60_000 : false;
  if (!viewingNow) {
    const otherId = otherRole === 'customer' ? auth.booking.customerId : auth.booking.barberId;
    if (otherId) {
      sendPushToUser(otherRole, otherId, {
        title: `💬 New message from ${senderName}`,
        body: text.length > 120 ? text.slice(0, 120) + '…' : text,
        url: otherRole === 'customer' ? '/customer/appointments' : '/barber/dashboard',
      }).catch(() => null);
    }
  }

  return NextResponse.json({ message: msg });
}

// DELETE /api/chats/[bookingId] → { ok: true } — delete a message.
// Body: { messageId }. Either participant (customer or barber) may delete
// any message in their appointment chat.
export async function DELETE(req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const auth = await authorize(req, bookingId);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  const messageId = typeof body?.messageId === 'string' ? body.messageId : '';
  if (!messageId) return NextResponse.json({ error: 'Missing message.' }, { status: 400 });

  // Try the new per-message file first.
  const deleted = await deleteChatMessage(bookingId, messageId);
  if (!deleted) {
    // Fall back to the legacy single-file format.
    const { getChat, saveChat } = await import('@/lib/store');
    const chat = await getChat(bookingId);
    if (!chat) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const idx = chat.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    chat.messages.splice(idx, 1);
    await saveChat(chat);
  }
  return NextResponse.json({ ok: true });
}
