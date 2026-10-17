'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { LockIcon, UserIcon } from '@/components/Icons';
import { useLang } from '@/components/LanguageContext';

function BarberSignupForm() {
  const { t } = useLang();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setError('');
    if (name.trim().length < 2 || name.trim().length > 60) {
      setError(t('barber.signup.error_name'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('barber.signup.error_email'));
      return;
    }
    if (password.length < 6) {
      setError(t('barber.signup.error_password'));
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
      if (!r.ok) throw new Error(d.error || t('barber.signup.error_generic'));
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('barber.signup.error_generic'));
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
        <div className="flex flex-col items-center mt-10 mb-7">
          <Image src="/logo.jpg" alt="MRC Barbershops" width={84} height={84} className="hero-logo" />
          <h1 className="page-title mt-4"><span className="gold-text">{t('barber.signup.sent_title')}</span></h1>
          <p className="page-sub mt-2 text-center leading-relaxed">
            {t('barber.signup.sent_body1')}<br />
            {t('barber.signup.sent_body2')}
          </p>
        </div>
        <div className="card p-6 text-center grid gap-4">
          <p className="text-sm text-neutral-600 leading-relaxed">
            {t('barber.signup.sent_hint')}
          </p>
          <Link href="/barber" className="gold-btn rounded-2xl px-6 py-3.5 text-[16px] text-center">
            {t('barber.signup.back_to_login')}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
      <div className="flex flex-col items-center mt-6 mb-7">
        <Image src="/logo.jpg" alt="MRC Barbershops" width={84} height={84} className="hero-logo" />
        <h1 className="page-title mt-4"><span className="gold-text">{t('barber.signup.title')}</span></h1>
        <p className="page-sub mt-1 text-center">{t('barber.signup.subtitle')}</p>
      </div>

      <div className="card p-5 grid gap-5">
        <div>
          <label className="label"><span className="inline-flex items-center gap-1.5"><UserIcon size={14} className="text-gold" /> {t('barber.signup.name_label')}</span></label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('barber.signup.name_placeholder')}
            autoComplete="name"
          />
        </div>

        <div>
          <label className="label">{t('barber.signup.email_label')}</label>
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('barber.signup.email_placeholder')}
            inputMode="email"
            autoComplete="email"
            type="email"
          />
        </div>

        <div>
          <label className="label"><span className="inline-flex items-center gap-1.5"><LockIcon size={14} className="text-gold" /> {t('barber.signup.password_label')}</span></label>
          <input
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('barber.signup.password_placeholder')}
            type="password"
            autoComplete="new-password"
          />
        </div>

        {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 -mt-2">{error}</p>}

        <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl px-6 py-3.5 text-[16px]">
          {busy ? t('barber.signup.submitting') : t('barber.signup.submit')}
        </button>

        <p className="text-sm text-neutral-600 text-center -mt-2">
          {t('barber.signup.have_account')} <Link href="/barber" className="text-gold font-semibold underline underline-offset-2">{t('barber.signup.login_link')}</Link>
        </p>
      </div>
    </main>
  );
}

export default function BarberSignup() {
  return <BarberSignupForm />;
}
