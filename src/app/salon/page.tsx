'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { LockIcon, UserIcon } from '@/components/Icons';

export default function SalonLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Already logged in? Go straight to the dashboard — the dashboard itself
  // bounces back here if the stored token is invalid/expired.
  useEffect(() => {
    if (localStorage.getItem('mrc-salon-owner-token')) {
      router.replace('/salon/dashboard');
    }
  }, [router]);

  async function submit() {
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/salon-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Login failed');
      localStorage.setItem('mrc-salon-owner-token', d.token);
      router.push('/salon/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    }
    setBusy(false);
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
      <div className="flex flex-col items-center mt-6 mb-7">
        <Image src="/logo.jpg" alt="MRC Barbershop" width={84} height={84} className="hero-logo" />
        <h1 className="page-title mt-4"><span className="gold-text">Salon owner login</span></h1>
        <p className="page-sub mt-1">Log in to manage your salon.</p>
      </div>

      <div className="card p-5 grid gap-5">
        <div>
          <label className="label"><span className="inline-flex items-center gap-1.5"><UserIcon size={14} className="text-gold" /> Email</span></label>
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            inputMode="email"
            autoComplete="email"
            type="email"
          />
        </div>
        <div>
          <label className="label"><span className="inline-flex items-center gap-1.5"><LockIcon size={14} className="text-gold" /> Password</span></label>
          <input
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            type="password"
            autoComplete="current-password"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
        </div>

        {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 -mt-2">{error}</p>}

        <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl px-6 py-3.5 text-[16px]">
          {busy ? 'Logging in…' : 'Log in'}
        </button>

        <p className="text-sm text-neutral-600 text-center -mt-2">
          Don&apos;t have an account? <Link href="/join" className="text-gold font-semibold underline underline-offset-2">Request yours</Link>
        </p>
      </div>
    </main>
  );
}
