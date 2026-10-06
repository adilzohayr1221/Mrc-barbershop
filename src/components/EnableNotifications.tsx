'use client';

import { useEffect, useState } from 'react';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = 'checking' | 'unsupported' | 'denied' | 'off' | 'on';

/** Opt-in card for web-push notifications. Works for customers and barbers —
 *  pass the role's session token getter. On iPhone it needs the app installed
 *  to the home screen (iOS 16.4+). */
export function EnableNotifications({ getToken }: { getToken: () => string }) {
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window) ||
        !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      ) {
        setState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? 'on' : 'off');
      } catch {
        setState('unsupported');
      }
    })();
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState('denied');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      const r = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!r.ok) throw new Error('register failed');
      setState('on');
    } catch {
      setState('off');
    }
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch('/api/notifications/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
    } catch {
      /* noop */
    }
    setState('off');
    setBusy(false);
  }

  if (state === 'checking' || state === 'unsupported') return null;

  return (
    <div className="card p-4 flex items-center gap-3">
      <span className="rounded-full w-10 h-10 bg-gold/10 border border-gold/40 flex items-center justify-center text-gold shrink-0 text-[18px]">
        🔔
      </span>
      <span className="flex-1 min-w-0">
        <b className="text-[15px] block">Notifications</b>
        <span className="text-xs text-neutral-500 leading-relaxed block">
          {state === 'denied'
            ? 'Blocked — allow notifications in your browser settings to turn them on.'
            : state === 'on'
              ? 'On — you get booking and reminder alerts on this device.'
              : 'Get booking and reminder alerts on this device.'}
        </span>
      </span>
      {state !== 'denied' && (
        <button
          onClick={() => (state === 'on' ? void disable() : void enable())}
          disabled={busy}
          className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-bold min-h-[40px] disabled:opacity-50 ${
            state === 'on' ? 'bg-[#f4edda] border border-[#dccfae] text-neutral-700' : 'gold-btn'
          }`}
        >
          {busy ? '…' : state === 'on' ? 'On' : 'Enable'}
        </button>
      )}
    </div>
  );
}
