// Tenant scope for barber sessions. Server-side only.
// A barber's session token carries the salonId stamped at login; the barber
// record itself is the fallback source of truth (covers old tokens issued
// before the stamp, which verifySession backfills to 'mrc').
import { getBarbers, salonOf } from '@/lib/store';
import { sessionSalonId, type SessionPayload } from '@/lib/auth';

export async function barberSalonId(session: SessionPayload): Promise<string> {
  if (session.barberId) {
    const me = (await getBarbers()).find((b) => b.id === session.barberId);
    if (me) return salonOf(me);
  }
  return sessionSalonId(session);
}
