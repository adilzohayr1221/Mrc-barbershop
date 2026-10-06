import { NextResponse } from 'next/server';
import { verifySession, bearerToken } from '@/lib/auth';
import { listBookings, getChatMessages, getChatMeta } from '@/lib/store';
import type { ChatMeta } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/chats/unread → { unread: { [bookingId]: count } } for the requester's active bookings.
export async function GET(req: Request) {
  const session = verifySession(bearerToken(req));
  if (!session || (session.role !== 'customer' && session.role !== 'barber')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const bookings = await listBookings();
  const mine = bookings.filter(
    (b) =>
      b.status === 'booked' &&
      ((session.role === 'customer' && b.customerId === session.customerId) ||
        (session.role === 'barber' && b.barberId === session.barberId))
  );
  const unread: Record<string, number> = {};
  await Promise.all(
    mine.map(async (b) => {
      const [messages, meta] = await Promise.all([
        getChatMessages(b.id).catch(() => []),
        getChatMeta(b.id).catch((): ChatMeta => ({})),
      ]);
      if (!messages.length) return;
      const lastRead = session.role === 'customer' ? meta.customerLastRead : meta.barberLastRead;
      const otherRole = session.role === 'customer' ? 'barber' : 'customer';
      const n = messages.filter(
        (m) => m.senderRole === otherRole && (!lastRead || m.createdAt > lastRead)
      ).length;
      if (n > 0) unread[b.id] = n;
    })
  );
  return NextResponse.json({ unread });
}
