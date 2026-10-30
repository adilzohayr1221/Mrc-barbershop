import { NextResponse } from 'next/server';
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

function base64url(data: Buffer | string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function GET() {
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
      JSON.stringify({ iss: teamId, iat: now, exp: now + TOKEN_TTL_SECONDS, origin: TOKEN_ORIGIN })
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
