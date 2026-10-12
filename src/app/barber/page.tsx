'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { LockIcon } from '@/components/Icons';
import { useLang } from '@/components/LanguageContext';

export default function BarberLogin() {
  const { t } = useLang();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Already logged in? Go straight to the dashboard — the dashboard itself
  // bounces back here if the stored token is invalid/expired.
  useEffect(() => {
    if (localStorage.getItem('mrc_barber_token')) {
      router.replace('/barber/dashboard');
    }
  }, [router]);

  async function submit() {
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('barber.login.error_email'));
      return;
    }
    if (!password.length) {
      setError(t('barber.login.error_password'));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/barber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('barber.login.error_failed'));
      localStorage.setItem('mrc_barber_token', d.token);
      localStorage.setItem('mrc_barber_name', d.barberName || '');
      router.push('/barber/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('barber.login.error_failed'));
    }
    setBusy(false);
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
      <div className="flex flex-col items-center mt-6 mb-7">
        <Image src="/logo.jpg" alt="MRC Barbershop" width={84} height={84} className="hero-logo" />
        <h1 className="page-title mt-4"><span className="gold-text">{t('barber.login.title')}</span></h1>
        <p className="page-sub mt-1">{t('barber.login.subtitle')}</p>
      </div>

      <div className="card p-5 grid gap-5">
        <div>
          <label className="label">{t('barber.login.email_label')}</label>
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('barber.login.email_placeholder')}
            inputMode="email"
            autoComplete="email"
            type="email"
          />
        </div>
        <div>
          <label className="label"><span className="inline-flex items-center gap-1.5"><LockIcon size={14} className="text-gold" /> {t('barber.login.password_label')}</span></label>
          <input
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('barber.login.password_placeholder')}
            type="password"
            autoComplete="current-password"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
        </div>

        {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3 -mt-2">{error}</p>}

        <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl px-6 py-3.5 text-[16px]">
          {busy ? t('barber.login.submitting') : t('barber.login.submit')}
        </button>

        <p className="text-sm text-neutral-600 text-center -mt-2">
          {t('barber.login.no_account')} <Link href="/barber/signup" className="text-gold font-semibold underline underline-offset-2">{t('barber.login.create_account')}</Link>
        </p>
      </div>
    </main>
  );
}
