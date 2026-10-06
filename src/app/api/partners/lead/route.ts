import { NextResponse } from 'next/server';
import { savePartnerLead, newId } from '@/lib/store';

export const dynamic = 'force-dynamic';

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Public: a barbershop owner requests his own MRC-style app.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = clean(body?.name, 60);
  const salonName = clean(body?.salonName, 80);
  const phone = clean(body?.phone, 30);
  const email = clean(body?.email, 80);
  const city = clean(body?.city, 60);
  if (!name || !salonName || !phone) {
    return NextResponse.json({ error: 'Please fill in your name, salon name and phone.' }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'That email does not look right.' }, { status: 400 });
  }
  const lead = {
    id: newId(),
    name,
    salonName,
    phone,
    email,
    city,
    createdAt: new Date().toISOString(),
  };
  await savePartnerLead(lead);
  return NextResponse.json({ ok: true });
}
