'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export default function JoinPage() {
  const [salonName, setSalonName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setError('');
    if (salonName.trim().length < 2) { setError('Enter your salon name.'); return; }
    if (ownerName.trim().length < 2) { setError('Enter your name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (phone.trim().length < 5) { setError('Enter a valid phone number.'); return; }
    if (city.trim().length < 2) { setError('Enter your city.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/salons/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonName: salonName.trim(),
          ownerName: ownerName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          city: city.trim(),
          password,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
        <div className="flex flex-col items-center mt-10 mb-7">
          <Image src="/logo.jpg" alt="MRC Barbershop" width={84} height={84} className="hero-logo" />
          <h1 className="page-title mt-4"><span className="gold-text">Request received ✓</span></h1>
          <p className="page-sub mt-2 text-center leading-relaxed">
            We&apos;ll contact you shortly.
          </p>
        </div>
        <div className="card p-6 text-center">
          <p className="text-sm text-neutral-600 leading-relaxed">
            Your request is on its way. Once it&apos;s approved you&apos;ll be able to log in and manage your salon.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
      <div className="flex flex-col items-center mt-6 mb-7">
        <Image src="/logo.jpg" alt="MRC Barbershop" width={84} height={84} className="hero-logo" />
        <h1 className="page-title mt-4"><span className="gold-text">Grow your salon</span></h1>
        <p className="page-sub mt-1 text-center">Get your own MRC-style booking system for your salon.</p>
      </div>

      <div className="card p-5 grid gap-5">
        <div>
          <label className="label">Salon name</label>
          <input className="input" value={salonName} onChange={(e) => setSalonName(e.target.value)} placeholder="Your salon name" autoComplete="organization" />
        </div>
        <div>
          <label className="label">Your name</label>
          <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Your full name" autoComplete="name" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" autoComplete="email" type="email" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Phone</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" autoComplete="tel" type="tel" />
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" autoComplete="address-level2" />
          </div>
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" type="password" autoComplete="new-password" />
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat your password" type="password" autoComplete="new-password" />
        </div>

        {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 -mt-2">{error}</p>}

        <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl px-6 py-3.5 text-[16px]">
          {busy ? 'Sending…' : 'Request my booking system'}
        </button>

        <p className="text-sm text-neutral-600 text-center -mt-2">
          Already approved? <Link href="/salon" className="text-gold font-semibold underline underline-offset-2">Log in</Link>
        </p>
      </div>
    </main>
  );
}
