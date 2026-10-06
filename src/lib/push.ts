import webpush from 'web-push';
import { listPushSubscriptions, deletePushSubscriptionByEndpoint } from './store';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@mrc-barbershop-mrc-0043.vercel.app';
  if (!pub || !priv) throw new Error('VAPID keys are not configured');
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export function isPushConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

/** Send a push notification to every subscribed device of a user.
 *  Never throws — a failed push must not break the booking/payment flow.
 *  Dead subscriptions (410/404) are cleaned up. */
export async function sendPushToUser(
  role: 'customer' | 'barber',
  userId: string,
  payload: PushPayload
): Promise<void> {
  if (!isPushConfigured()) return;
  let subs;
  try {
    subs = await listPushSubscriptions(role, userId);
  } catch (e) {
    console.error('push: list subscriptions failed', e);
    return;
  }
  if (!subs.length) return;
  try {
    ensureConfigured();
  } catch (e) {
    console.error('push: VAPID not configured', e);
    return;
  }
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
  });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.subscription.endpoint,
            keys: s.subscription.keys,
          },
          body,
          { TTL: 24 * 60 * 60 }
        );
      } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          try {
            await deletePushSubscriptionByEndpoint(s.subscription.endpoint);
          } catch {
            /* noop */
          }
        } else {
          console.error('push: send failed', status ?? e);
        }
      }
    })
  );
}
