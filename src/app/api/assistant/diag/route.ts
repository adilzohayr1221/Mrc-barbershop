import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// TEMPORARY diagnostic: reports only Gemini HTTP status codes per model.
// Never returns the API key or error bodies.
export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ key: false });
  const results: Record<string, number | string> = {};
  const models = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
  ];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with the word ok.' }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      results[model] = res.status;
      if (res.ok) break;
    } catch {
      results[model] = 'fetch-error';
    }
  }
  return NextResponse.json({ key: true, results });
}
