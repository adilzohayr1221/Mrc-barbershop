'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

export default function TrainSuccessPage() {
  const [state, setState] = useState<'checking' | 'active' | 'pending'>('checking');
  const [name, setName] = useState('');
  const [weeklyUsd, setWeeklyUsd] = useState(100);

  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get('session_id');
    if (!sid) { setState('pending'); return; }
    let tries = 0;
    let stop = false;
    async function check() {
      try {
        const r = await fetch(`/api/training/verify?session_id=${encodeURIComponent(sid!)}`);
        const d = await r.json().catch(() => ({}));
        if (stop) return;
        if (d.name) setName(d.name);
        if (d.weeklyUsd) setWeeklyUsd(d.weeklyUsd);
        if (d.active) { setState('active'); return; }
      } catch { /* keep trying below */ }
      tries += 1;
      if (!stop && tries < 6) setTimeout(check, 2500);
      else if (!stop) setState('pending');
    }
    check();
    return () => { stop = true; };
  }, []);

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
      <div className="flex flex-col items-center mt-10 mb-7">
        <Image src="/logo.jpg" alt="MRC Barbershops" width={84} height={84} className="hero-logo" />
        {state === 'active' ? (
          <>
            <h1 className="page-title mt-4"><span className="gold-text">You&apos;re enrolled 🎉</span></h1>
            <p className="page-sub mt-2 text-center leading-relaxed">
              {name ? `Welcome, ${name.split(' ')[0]}. ` : ''}Your first {'$'}{weeklyUsd} weekly payment went through —
              your spot in the MRC Barber Training Program is confirmed.
            </p>
          </>
        ) : state === 'checking' ? (
          <>
            <h1 className="page-title mt-4"><span className="gold-text">Confirming your payment…</span></h1>
            <p className="page-sub mt-2 text-center">One moment while we confirm with the bank.</p>
          </>
        ) : (
          <>
            <h1 className="page-title mt-4"><span className="gold-text">Payment is processing</span></h1>
            <p className="page-sub mt-2 text-center leading-relaxed">
              Your payment is still being confirmed. Keep this page — or just come by the shop and we&apos;ll check it together.
            </p>
          </>
        )}
      </div>
      {state === 'active' && (
        <div className="card p-6 text-center">
          <p className="text-sm text-neutral-600 leading-relaxed">
            Your card will be charged {'$'}{weeklyUsd} every week while you train. Questions? Call MRC Barbershops at (443) 741-5820.
          </p>
        </div>
      )}
    </main>
  );
}
