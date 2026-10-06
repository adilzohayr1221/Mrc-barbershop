'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { LockIcon } from '@/components/Icons';

export default function OwnerLogin() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (!/^\d{4}$/.test(pin)) {
      setError('Enter the 4-digit owner PIN.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Login failed');
      localStorage.setItem('mrc_owner_token', d.token);
      router.push('/owner/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    }
    setBusy(false);
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
      <div className="flex flex-col items-center mt-6 mb-7">
        <Image src="/logo.jpg" alt="MRC Barbershop" width={84} height={84} className="hero-logo" />
        <h1 className="page-title mt-4"><span className="gold-text">Owner access</span></h1>
        <p className="page-sub mt-1">Enter the owner PIN to open shop management.</p>
      </div>

      <div className="card p-5 grid gap-5">
        <div>
          <label className="label"><span className="inline-flex items-center gap-1.5"><LockIcon size={14} className="text-gold" /> Owner PIN</span></label>
          <input
            className="input text-center text-3xl tracking-[0.6em] font-bold !py-4"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            type="password"
            inputMode="numeric"
            placeholder="••••"
            autoComplete="off"
          />
        </div>
        {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 -mt-2">{error}</p>}
        <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl px-6 py-3.5 text-[16px]">
          {busy ? 'Checking…' : 'Open management'}
        </button>
      </div>
    </main>
  );
}
