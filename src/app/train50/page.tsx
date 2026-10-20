'use client';

import { useState } from 'react';
import Image from 'next/image';

// Public enrollment page for the barber training program at the $50/week
// plan: the trainee enters his info, then pays $50/week by card through
// Stripe Checkout. Same flow as /train, with plan 50 sent to checkout.
export default function Train50Page() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (name.trim().length < 2) { setError('Enter your full name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (phone.trim().length < 5) { setError('Enter a valid phone number.'); return; }
    if (!dob) { setError('Enter your date of birth.'); return; }
    if (address.trim().length < 5) { setError('Enter your home address.'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/training/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          dob,
          address: address.trim(),
          plan: 50,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || 'Something went wrong. Please try again.');
      window.location.href = d.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
      <div className="flex flex-col items-center mt-6 mb-7">
        <Image src="/logo.jpg" alt="MRC Barbershops" width={84} height={84} className="hero-logo" />
        <h1 className="page-title mt-4"><span className="gold-text">Barber Training Program</span></h1>
        <p className="page-sub mt-1 text-center">Learn barbering hands-on at MRC Barbershops.</p>
      </div>

      <div className="card p-5 mb-4">
        <p className="text-[15px] leading-relaxed">
          <b>$50 per week</b> — charged to your card automatically each week while you train.
          Fill in your information below, then continue to secure payment.
        </p>
      </div>

      <div className="card p-5 grid gap-5">
        <div>
          <label className="label">Full name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" autoComplete="name" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" autoComplete="email" type="email" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" autoComplete="tel" type="tel" />
        </div>
        <div>
          <label className="label">Date of birth</label>
          <input className="input" value={dob} onChange={(e) => setDob(e.target.value)} type="date" autoComplete="bday" />
        </div>
        <div>
          <label className="label">Home address</label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, City, State ZIP" autoComplete="street-address" />
        </div>

        {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 -mt-2">{error}</p>}

        <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl px-6 py-3.5 text-[16px]">
          {busy ? 'One moment…' : 'Continue to payment — $50/week'}
        </button>
        <p className="text-xs text-neutral-500 text-center -mt-2">
          Secure payment by card. Your card is charged $50 today, then $50 every week.
        </p>
      </div>
    </main>
  );
}
