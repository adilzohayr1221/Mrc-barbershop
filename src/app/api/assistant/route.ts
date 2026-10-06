import { NextResponse } from 'next/server';
import { getServices, getBranches, getBarbers } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';

export const dynamic = 'force-dynamic';

// HARD SCOPE: this assistant is Q&A + guidance only. It must NEVER control or
// change anything (no booking, no payments, no account changes, no tools).
// It may SUGGEST the best option when it genuinely fits the question — one
// short suggestion per reply, never pushy, never forced into unrelated answers.

// Light in-memory per-IP rate limit: 30 requests / 10 min (best-effort).
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 30;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_HITS) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  // Best-effort cleanup so the map can't grow forever.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.length === 0 || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
      if (hits.size <= 4000) break;
    }
  }
  return false;
}

interface InMsg {
  role: 'user' | 'assistant';
  text: string;
}

function validMessages(v: unknown): v is InMsg[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 12) return false;
  return v.every(
    (m) =>
      m &&
      typeof m === 'object' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.text === 'string' &&
      m.text.trim().length > 0 &&
      m.text.length <= 500
  );
}

// Gemini requires alternating user/model roles — merge consecutive same-role
// messages so a malformed history can't 400 the request.
function toGeminiContents(msgs: InMsg[]): { role: string; parts: { text: string }[] }[] {
  const out: { role: string; parts: { text: string }[] }[] = [];
  for (const m of msgs) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text: m.text.trim() });
    } else {
      out.push({ role, parts: [{ text: m.text.trim() }] });
    }
  }
  // Drop a leading model message — contents should start with the user.
  while (out.length > 0 && out[0].role !== 'user') out.shift();
  return out;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown';
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many messages — please wait a bit and try again, or call (443) 741-5820.' },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const messages = body?.messages;
  if (!validMessages(messages)) {
    return NextResponse.json({ error: 'Invalid messages.' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'The assistant is not set up yet.' }, { status: 503 });
  }
  const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  await ensureSeeded();
  const [services, branches, barbers] = await Promise.all([getServices(), getBranches(), getBarbers()]);

  const serviceLines = services
    .filter((s) => s.active)
    .map((s) => `- ${s.name} — $${s.price.toFixed(2)}`);
  const branchLines = branches.map((b) => `- ${b.name} — ${b.address}`);
  const barberLines = barbers
    .filter((b) => b.active)
    .map((b) => `- ${b.name}${b.skills && b.skills.length ? ` (skills: ${b.skills.join(', ')})` : ''}`);

  const systemPrompt = `You are the MRC Barbershop helper, a friendly assistant inside the customer's app.

RULES (never break these):
- Answer ONLY from the SHOP DATA below. NEVER invent barbers, services, prices, hours, or policies.
- If you don't know the answer, say so and suggest calling the shop at (443) 741-5820.
- You CANNOT book appointments, take payments, or change anything — you only answer questions and guide the customer to the right page in the app.
- Keep replies short: 1–3 sentences, friendly tone, plain English. At most one emoji.
- You may SUGGEST the best option when it genuinely fits the question — at most one short suggestion per reply, helpful not pushy, never forced into unrelated answers:
  - If the customer gets haircuts often or asks about saving money → suggest the Monthly Plan (4 haircuts for $120/month instead of $160, one haircut per weekly window, unused weeks expire).
  - If they're asking for someone else (son, friend, brother…) → suggest gift-a-haircut (buy any service at full price, share the gift code/link, valid 12 months, single-use, the recipient can save it to their own account).
  - If they ask who to book with → recommend barbers by matching skills from the shop data (e.g. fades, beard trim) without inventing anything.
- Be proactive like a good barber: when the customer wants a recommendation or seems unsure, FIRST ask one short question about what they want — e.g. "How do you like your hair cut — fade, classic, beard trim?" — then tell them which skills the barber needs for that style and match their answer to the barbers' skills in the shop data. Discover first, then recommend the best fit; don't dump the whole barber list.
- Persuade lightly, like a friendly barber recommending — never like a salesman pitching. One gentle nudge per conversation topic max: if the customer says no or ignores it, drop it and never repeat.
- Persuade with simple human logic: concrete savings ("4 haircuts for $120 instead of $160 — you save $40"), convenience ("one less thing to think about each week"), gifting warmth ("a fresh cut is a gift he'll actually use").
- Stay 100% honest: never invent fake scarcity ("only 2 left"), fake reviews, fake popularity, or any fact not in the shop data. Charm comes from clarity and relevance, not tricks.

SHOP DATA:
Services (bookable):
${serviceLines.length ? serviceLines.join('\n') : '- (none listed yet)'}
Branches:
${branchLines.length ? branchLines.join('\n') : '- (none listed yet)'}
Barbers:
${barberLines.length ? barberLines.join('\n') : '- (none listed yet)'}

Facts:
- Booking takes a $5 deposit (capped at the service price); the rest is paid at the shop after the haircut when the barber scans your payment code.
- Monthly Haircut Plan: $120/month for 4 haircuts — one per weekly window; an unused week expires and doesn't carry over. Plan bookings need no deposit; the barber scans your membership code at the shop.
- Gift a haircut: buy any service at full price and share the gift code/link with anyone; valid 12 months, single-use; the recipient can save it to their own account from the link.
- Booking only shows each barber's working hours; closed days are struck through.
- To book: open the Branches page, pick a branch and barber, choose a day/time, and pay the deposit. For the plan and gifts: see the Offers page. "My appointments" shows upcoming bookings.
- Support phone: (443) 741-5820. Shop city: Baltimore, MD.`;

  const contents = toGeminiContents(messages);
  if (contents.length === 0) {
    return NextResponse.json({ error: 'Invalid messages.' }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  // Fallback chain: 2.5-flash is retired for new API keys (404), so we try
  // the 3.x Flash family in order until one responds.
  const models = [primaryModel, 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'].filter(
    (m, i, a) => a.indexOf(m) === i
  );

  async function callGemini(model: string, key: string): Promise<string | null> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
        }),
      }
    );
    const data = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      error?: { message?: string; status?: string; code?: number };
    } | null;
    const reply = data?.candidates?.[0]?.content?.parts
      ?.map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (!res.ok || !reply) {
      console.error('[assistant] gemini failed', model, res.status, JSON.stringify(data?.error ?? null).slice(0, 200));
      return null;
    }
    return reply;
  }

  try {
    let reply: string | null = null;
    for (const model of models) {
      reply = await callGemini(model, apiKey);
      if (reply) break;
    }
    if (!reply) throw new Error('bad-gemini-reply');
    return NextResponse.json({ ok: true, reply });
  } catch {
    return NextResponse.json(
      { error: 'The assistant is having trouble right now. Please try again or call (443) 741-5820.' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
