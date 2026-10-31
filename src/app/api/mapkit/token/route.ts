import { NextResponse, type NextRequest } from 'next/server';
import { createPrivateKey, sign } from 'node:crypto';

export const dynamic = 'force-dynamic';

// MapKit JS authorization token (JWT, ES256) for the customer map.
// Signed server-side with the Maps private key from env — the key itself
// never leaves the server. Payload follows Apple's MapKit JS token spec:
// iss = Team ID, kid (header) = Key ID, origin = the site origin the token
// is valid for. 30-minute lifetime; MapKit re-calls the authorization
// callback before expiry, and the response is cacheable (privately) for
// most of that window.
const TOKEN_TTL_SECONDS = 1800;
const TOKEN_ORIGIN = 'https://mrc-barbershop.vercel.app';
// MapKit JS tokens are origin-bound, and the app is served from more
// than one of our own origins: the customer site at the main domain,
// and the iOS app shell (Capacitor server.url) at the alias domain
// below. A token minted for the wrong origin makes Apple refuse the
// street tiles — the map frame and pins render over an empty grid —
// so the token is minted for the requesting page's origin,
// allowlisted to exactly our own origins; anything else gets the
// main-domain token.
const ALLOWED_TOKEN_ORIGINS = new Set([
  TOKEN_ORIGIN,
  'https://mrc-barbershop-mrc-0043.vercel.app',
]);

function tokenOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_TOKEN_ORIGINS.has(origin)) return origin;
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (ALLOWED_TOKEN_ORIGINS.has(refererOrigin)) return refererOrigin;
    } catch {
      // Unparseable referer — fall through to the default origin.
    }
  }
  return TOKEN_ORIGIN;
}

function base64url(data: Buffer | string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function GET(request: NextRequest) {
  const teamId = process.env.MAPKIT_TEAM_ID;
  const keyId = process.env.MAPKIT_KEY_ID;
  const rawKey = process.env.MAPKIT_PRIVATE_KEY;
  if (!teamId || !keyId || !rawKey) {
    // Not configured — the client map treats this as "use the fallback map".
    return NextResponse.json({ error: 'Map tokens are not configured.' }, { status: 503 });
  }

  try {
    // Env values are often stored with literal "\n" escapes.
    const pem = rawKey.replace(/\\n/g, '\n');
    const key = createPrivateKey(pem);
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({ iss: teamId, iat: now, exp: now + TOKEN_TTL_SECONDS, origin: tokenOrigin(request) })
    );
    const signingInput = `${header}.${payload}`;
    // JWS requires the raw R||S signature form (IEEE P1363), not DER.
    const signature = sign('sha256', Buffer.from(signingInput), {
      key,
      dsaEncoding: 'ieee-p1363',
    });
    const token = `${signingInput}.${base64url(signature)}`;
    return new Response(token, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, max-age=1200',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Could not issue a map token.' }, { status: 500 });
  }
}
