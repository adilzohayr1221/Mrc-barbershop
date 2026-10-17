import { NextResponse } from 'next/server';
import { getBarbers, listBookings } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { blockedStartsFor } from '@/lib/vip';

export const dynamic = 'force-dynamic';

// Public: which 30-min slots are already booked for a barber on a given date.
// Returns only times — no customer data. Used so a booked slot can't be booked twice.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded();
  const { id } = await params;
  const date = new URL(req.url).searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  const [barbers, bookings] = await Promise.all([getBarbers(), listBookings()]);
  const barber = barbers.find((b) => b.id === id && b.active && b.approved !== false);
  if (!barber) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // A VIP home visit blocks its full 2-hour window, not just its start.
  const booked = bookings
    .filter((b) => b.barberId === id && b.date === date && b.status === 'booked')
    .flatMap((b) => blockedStartsFor(b));
  return NextResponse.json({ booked: [...new Set(booked)] });
}
