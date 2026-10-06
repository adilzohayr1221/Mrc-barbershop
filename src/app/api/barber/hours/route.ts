import { NextResponse } from 'next/server';
import { getBarbers, saveBarbers } from '@/lib/store';
import { requireBarber } from '@/lib/auth';
import type { WorkingHours } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Working hours are a per-weekday list of "HH:00" hours the barber works
// (shop slots run 9 AM – 8:30 PM). A day with no hours = closed.
function sanitizeHours(input: unknown): WorkingHours | null {
  if (typeof input !== 'object' || input === null) return null;
  const out: WorkingHours = {};
  for (const [day, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(day)) return null;
    if (!Array.isArray(v)) return null;
    const hours: string[] = [];
    for (const h of v) {
      if (typeof h !== 'string' || !/^([01]\d|2[0-3]):00$/.test(h)) return null;
      const hh = Number(h.slice(0, 2));
      if (hh < 9 || hh > 20) return null;
      if (!hours.includes(h)) hours.push(h);
    }
    hours.sort();
    if (hours.length) out[day as keyof WorkingHours] = hours;
  }
  return out;
}

// Barber-only: read his own working hours.
export async function GET(req: Request) {
  const session = requireBarber(req);
  if (!session || !session.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === session.barberId);
  return NextResponse.json({ workingHours: barber?.workingHours ?? null });
}

// Barber-only: set his own working hours. He decides when he works, hour by hour.
// Shop policy (owner's rule): at most 2 days off per week (min 5 open days),
// and at least 6 working hours on each open day.
export async function PUT(req: Request) {
  const session = requireBarber(req);
  if (!session || !session.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const workingHours = sanitizeHours(body?.workingHours);
  if (!workingHours) return NextResponse.json({ error: 'Invalid working hours' }, { status: 400 });
  const openDays = Object.keys(workingHours);
  if (openDays.length < 5) {
    return NextResponse.json({ error: 'You can take at most 2 days off per week.' }, { status: 400 });
  }
  for (const d of openDays) {
    if ((workingHours[d as keyof WorkingHours] ?? []).length < 6) {
      return NextResponse.json({ error: 'Work at least 6 hours on each open day.' }, { status: 400 });
    }
  }
  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === session.barberId && b.active);
  if (!barber) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  barber.workingHours = workingHours;
  await saveBarbers(barbers);
  return NextResponse.json({ ok: true, workingHours });
}
