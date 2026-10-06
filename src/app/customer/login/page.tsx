'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { LockIcon, UserIcon } from '@/components/Icons';
import { CUSTOMER_TOKEN_KEY, CUSTOMER_NAME_KEY } from '@/components/CustomerAuth';

type Mode = 'login' | 'signup';

/** Safe post-login destination: only a relative in-app path. */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/customer';
}

function CustomerLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  // Already logged in? Go straight to the destination.
  useEffect(() => {
    const token = localStorage.getItem(CUSTOMER_TOKEN_KEY);
    if (!token) return;
    fetch('/api/auth/customer', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.ok) router.replace(next);
      })
      .catch(() => {});
  }, [router, next]);

  async function submit() {
    setError('');
    setSuccess('');
    const cleanEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (mode === 'signup' && (name.trim().length < 2 || name.trim().length > 60)) {
      setError('Enter your name.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          name: name.trim(),
          email: cleanEmail,
          password,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Something went wrong');
      if (mode === 'signup') {
        // Auto-login: the signup response already carries a session token.
        if (d.token) {
          localStorage.setItem(CUSTOMER_TOKEN_KEY, d.token);
          localStorage.setItem(CUSTOMER_NAME_KEY, d.customer?.name || '');
          setSuccess(`Account created — welcome${d.customer?.name ? `, ${d.customer.name}` : ''}! Taking you to the shop…`);
          setBusy(false);
          // Brief pause so the success message is actually seen before navigating.
          setTimeout(() => router.replace(next), 1100);
          return;
        }
        // Signup succeeded but no token came back (shouldn't happen):
        // show it clearly and drop to the login tab with the email prefilled.
        setSuccess('Account created! Please log in with your new credentials.');
        setMode('login');
        setPassword('');
        setBusy(false);
        return;
      }
      localStorage.setItem(CUSTOMER_TOKEN_KEY, d.token);
      localStorage.setItem(CUSTOMER_NAME_KEY, d.customer?.name || '');
      router.replace(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
    setBusy(false);
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
      <div className="flex flex-col items-center mt-6 mb-7">
        <Image src="/logo.jpg" alt="MRC Barbershop" width={84} height={84} className="hero-logo" />
        <h1 className="page-title mt-4"><span className="gold-text">Welcome to MRC</span></h1>
        <p className="page-sub mt-1">Log in or create an account to book your cut.</p>
      </div>

      <div className="card p-5 grid gap-5">
        <div className="grid grid-cols-2 gap-2 bg-[#f4edda] border border-[#e6dabf] rounded-2xl p-1.5">
          {(['login', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); setSuccess(''); setPassword(''); }}
              className={`rounded-xl py-2.5 text-sm font-bold transition-all min-h-[44px] ${
                mode === m
                  ? 'bg-[#1c1a15] text-white shadow-[0_4px_14px_rgba(0,0,0,0.18)]'
                  : 'text-neutral-600'
              }`}
            >
              {m === 'login' ? 'Log in' : 'Sign up'}
            </button>
          ))}
        </div>

        {mode === 'signup' && (
          <div>
            <label className="label"><span className="inline-flex items-center gap-1.5"><UserIcon size={14} className="text-gold" /> Your name</span></label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              autoComplete="name"
            />
          </div>
        )}

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
            placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
        </div>

        {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 -mt-2">{error}</p>}
        {success && <p className="text-green-800 text-sm bg-green-600/10 border border-green-600/25 rounded-xl px-4 py-3 -mt-2 font-semibold">{success}</p>}

        <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl px-6 py-3.5 text-[16px]">
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>

        <p className="text-xs text-neutral-500 text-center leading-relaxed -mt-2">
          Your bookings stay private to your account.
        </p>
      </div>
    </main>
  );
}

export default function CustomerLogin() {
  return (
    <Suspense>
      <CustomerLoginInner />
    </Suspense>
  );
}
