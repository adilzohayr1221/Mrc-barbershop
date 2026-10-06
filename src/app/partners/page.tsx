'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  CalendarIcon,
  StarIcon,
  GearIcon,
  ClockIcon,
  CheckIcon,
  ArrowRightIcon,
  MapPinIcon,
} from '@/components/Icons';

const features = [
  {
    Icon: CalendarIcon,
    title: 'Online booking that fills chairs',
    desc: 'Customers book their barber, day and time in seconds — with a card deposit so no-shows cost them, not you.',
  },
  {
    Icon: StarIcon,
    title: 'Reviews that build your name',
    desc: 'Every haircut ends with a star rating prompt. Great work turns into public proof, automatically.',
  },
  {
    Icon: GearIcon,
    title: 'A real owner dashboard',
    desc: 'Bookings, barbers, services, prices, reviews and earnings — your whole shop on one phone screen.',
  },
  {
    Icon: ClockIcon,
    title: 'Plans, gifts & reminders',
    desc: 'Weekly membership plans, QR gift cards, and automatic appointment reminders keep customers coming back.',
  },
];

const apps = [
  {
    name: 'Customer app',
    desc: 'Find your shop on the map, pick a barber, book and pay the deposit. Installs on iPhone and Android.',
  },
  {
    name: 'Barber app',
    desc: 'Daily schedule, customer chat, instant payouts after every haircut, and earnings at a glance.',
  },
  {
    name: 'Owner app',
    desc: 'Approve barbers, set prices, read reviews, watch earnings grow — from anywhere.',
  },
];

const steps = [
  {
    n: '1',
    title: 'Request your setup',
    desc: 'Fill in the form below with your shop details. It takes less than a minute.',
  },
  {
    n: '2',
    title: 'We build your app',
    desc: 'Your branding, your services, your prices — set up and ready for your barbers.',
  },
  {
    n: '3',
    title: 'Invite your barbers',
    desc: 'Your team joins, customers start booking, and you watch it all from your phone.',
  },
];

function LeadForm() {
  const [name, setName] = useState('');
  const [salonName, setSalonName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    setError('');
    if (!name.trim() || !salonName.trim() || !phone.trim()) {
      setError('Please fill in your name, salon name and phone.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/partners/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), salonName: salonName.trim(), phone: phone.trim(), email: email.trim(), city: city.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not send your request.');
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your request.');
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="card p-8 text-center fade-in">
        <div className="w-14 h-14 mx-auto rounded-full bg-green-600/10 border border-green-600/30 flex items-center justify-center text-green-700">
          <CheckIcon size={26} />
        </div>
        <h3 className="font-extrabold text-[20px] text-[#141414] mt-4">Request received ✓</h3>
        <p className="text-[14px] text-neutral-600 mt-2 leading-relaxed">
          Thanks, {name.split(' ')[0]}. We&apos;ll call you soon about getting <b>{salonName}</b> its own app.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="grid gap-3.5">
        <div>
          <span className="label">Your name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Karim Haddad" className="input" maxLength={60} />
        </div>
        <div>
          <span className="label">Salon name *</span>
          <input value={salonName} onChange={(e) => setSalonName(e.target.value)} placeholder="e.g. Fade Factory" className="input" maxLength={80} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="label">Phone *</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(410) 555-0134" inputMode="tel" className="input" maxLength={30} />
          </div>
          <div>
            <span className="label">City</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Baltimore" className="input" maxLength={60} />
          </div>
        </div>
        <div>
          <span className="label">Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@salon.com" inputMode="email" className="input" maxLength={80} />
        </div>
        {error && (
          <p className="text-sm text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-2.5">{error}</p>
        )}
        <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl px-6 py-4 text-[16px] font-extrabold disabled:opacity-60 flex items-center justify-center gap-2">
          {busy ? 'Sending…' : (<>Request my app <ArrowRightIcon size={18} /></>)}
        </button>
        <p className="text-[12px] text-neutral-500 text-center leading-relaxed">
          No commitment. We&apos;ll call you, show you how it works, and talk pricing.
        </p>
      </div>
    </div>
  );
}

export default function PartnersPage() {
  return (
    <main className="flex-1 w-full">
      {/* Hero */}
      <section className="px-6 pt-12 pb-10 text-center max-w-2xl mx-auto">
        <div className="relative inline-block">
          <Image src="/logo.jpg" alt="MRC" width={96} height={96} className="hero-logo mx-auto" priority />
        </div>
        <p className="mt-6 text-[11px] font-bold tracking-[0.32em] uppercase text-gold">
          For barbershop owners
        </p>
        <h1 className="mt-3 text-[38px] leading-[1.1] font-extrabold tracking-tight text-[#141414]">
          Your shop,<br />
          <span className="gold-text">in every customer&apos;s pocket.</span>
        </h1>
        <div className="ornament w-48 mt-5 mx-auto">
          <span className="ornament-diamond" />
        </div>
        <p className="mt-4 text-neutral-600 text-[15px] leading-relaxed max-w-md mx-auto">
          The same booking system MRC Barbershop runs on — your own customer app,
          barber app and owner dashboard, with your name on it.
        </p>
        <a href="#request" className="gold-btn rounded-2xl px-8 py-4 text-[16px] font-extrabold inline-flex items-center gap-2 mt-7">
          Get my own app <ArrowRightIcon size={18} />
        </a>
      </section>

      {/* Features */}
      <section className="px-4 py-10 max-w-2xl mx-auto w-full">
        <p className="text-[11px] font-bold tracking-[0.32em] uppercase text-gold text-center">What you get</p>
        <h2 className="text-[26px] font-extrabold tracking-tight text-[#141414] text-center mt-2">
          Everything runs itself
        </h2>
        <div className="grid gap-3 mt-7">
          {features.map((f) => (
            <div key={f.title} className="card p-5 flex items-start gap-4">
              <span className="flex items-center justify-center w-11 h-11 rounded-full shrink-0 bg-gold/10 border border-gold/40 text-gold">
                <f.Icon size={22} />
              </span>
              <span>
                <span className="block font-extrabold text-[16px] text-[#141414]">{f.title}</span>
                <span className="block text-[14px] text-neutral-600 mt-1 leading-relaxed">{f.desc}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Three apps */}
      <section className="px-4 py-10 max-w-2xl mx-auto w-full">
        <div className="rounded-3xl p-7 relative overflow-hidden border border-gold/40 shadow-[0_10px_30px_rgba(168,130,31,0.15)]" style={{ background: 'linear-gradient(135deg, #fdf8ea 0%, #f6ead0 100%)' }}>
          <p className="text-[11px] font-bold tracking-[0.32em] uppercase text-gold">One system</p>
          <h2 className="text-[24px] font-extrabold tracking-tight mt-2 text-[#141414]">Three apps, working together</h2>
          <div className="grid gap-4 mt-6">
            {apps.map((a, i) => (
              <div key={a.name} className="flex gap-4 items-start">
                <span className="w-8 h-8 rounded-full bg-gold text-white font-extrabold text-[14px] flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-extrabold text-[16px] text-[#141414]">{a.name}</span>
                  <span className="block text-[14px] text-neutral-600 mt-1 leading-relaxed">{a.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="px-4 py-10 max-w-2xl mx-auto w-full">
        <p className="text-[11px] font-bold tracking-[0.32em] uppercase text-gold text-center">How it works</p>
        <h2 className="text-[26px] font-extrabold tracking-tight text-[#141414] text-center mt-2">
          Live in three steps
        </h2>
        <div className="grid gap-3 mt-7">
          {steps.map((s) => (
            <div key={s.n} className="card p-5 flex items-start gap-4">
              <span className="w-10 h-10 rounded-2xl bg-[#1c1a15] text-gold font-extrabold text-[16px] flex items-center justify-center shrink-0">
                {s.n}
              </span>
              <span>
                <span className="block font-extrabold text-[16px] text-[#141414]">{s.title}</span>
                <span className="block text-[14px] text-neutral-600 mt-1 leading-relaxed">{s.desc}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Form */}
      <section id="request" className="px-4 py-10 max-w-2xl mx-auto w-full scroll-mt-20">
        <p className="text-[11px] font-bold tracking-[0.32em] uppercase text-gold text-center">Request a setup</p>
        <h2 className="text-[26px] font-extrabold tracking-tight text-[#141414] text-center mt-2 mb-6">
          Tell us about your shop
        </h2>
        <LeadForm />
        <p className="text-center mt-8">
          <Link href="/" className="text-sm text-neutral-500 underline underline-offset-4">
            ← Back to MRC Barbershop
          </Link>
        </p>
      </section>

      <footer className="px-6 py-8 text-center">
        <p className="text-[12px] text-neutral-400 flex items-center justify-center gap-1.5">
          <MapPinIcon size={13} className="text-gold/60" /> Powered by MRC Barbershop · Baltimore, MD
        </p>
      </footer>
    </main>
  );
}
