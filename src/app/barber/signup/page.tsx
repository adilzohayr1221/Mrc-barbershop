'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { LockIcon, UserIcon } from '@/components/Icons';

function BarberSignupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setError('');
    if (name.trim().length < 2 || name.trim().length > 60) {
      setError('Enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/barber/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Something went wrong');
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
        <div className="flex flex-col items-center mt-10 mb-7">
          <Image src="/logo.jpg" alt="MRC Barbershop" width={84} height={84} className="hero-logo" />
          <h1 className="page-title mt-4"><span className="gold-text">Request sent!</span></h1>
          <p className="page-sub mt-2 text-center leading-relaxed">
            The owner will review and approve your account.<br />
            You&apos;ll be able to log in once approved.
          </p>
        </div>
        <div className="card p-6 text-center grid gap-4">
          <p className="text-sm text-neutral-600 leading-relaxed">
            Keep an eye on your email — or just try logging in later.
          </p>
          <Link href="/barber" className="gold-btn rounded-2xl px-6 py-3.5 text-[16px] text-center">
            Back to barber login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
      <div className="flex flex-col items-center mt-6 mb-7">
        <Image src="/logo.jpg" alt="MRC Barbershop" width={84} height={84} className="hero-logo" />
        <h1 className="page-title mt-4"><span className="gold-text">Join MRC</span></h1>
        <p className="page-sub mt-1 text-center">Just your name and email — the owner sets up the rest after approval.</p>
      </div>

      <div className="card p-5 grid gap-5">
        <div>
          <label className="label"><span className="inline-flex items-center gap-1.5"><UserIcon size={14} className="text-gold" /> Full name</span></label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            autoComplete="name"
          />
        </div>

        <div>
          <label className="label">Email</label>
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
            placeholder="At least 6 characters"
            type="password"
            autoComplete="new-password"
          />
        </div>

        {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 -mt-2">{error}</p>}

        <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl px-6 py-3.5 text-[16px]">
          {busy ? 'Sending…' : 'Send request'}
        </button>

        <p className="text-sm text-neutral-600 text-center -mt-2">
          Already approved? <Link href="/barber" className="text-gold font-semibold underline underline-offset-2">Log in</Link>
        </p>
      </div>
    </main>
  );
}

export default function BarberSignup() {
  return <BarberSignupForm />;
}
