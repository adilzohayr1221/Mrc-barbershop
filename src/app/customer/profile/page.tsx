'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon, LockIcon, CheckIcon, LogOutIcon, PhoneIcon, StarIcon, CameraIcon, PencilIcon } from '@/components/Icons';
import { BranchPageSkeleton } from '@/components/Loading';
import { useCustomerAuth, clearCustomerSession } from '@/components/CustomerAuth';
import { EnableNotifications } from '@/components/EnableNotifications';
import { MyReportsSection } from '@/components/MyReportsSection';
import { useLang } from '@/components/LanguageContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

interface FavoriteBarber {
  id: string;
  name: string;
  photoUrl: string | null;
  branchIds: string[];
}

interface Profile {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
  favoriteBarberId: string | null;
  favoriteBarber: FavoriteBarber | null;
}

export default function CustomerProfile() {
  const { checked, token } = useCustomerAuth();
  const { t } = useLang();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!checked) return;
    fetch('/api/customer/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d.profile) setProfile(d.profile); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [checked, token]);

  function logout() {
    clearCustomerSession();
    router.replace('/customer/login');
  }

  if (!checked || loading) {
    return (
      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        <BranchPageSkeleton />
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
      <Link href="/customer" className="back-link"><ArrowLeftIcon size={16} /> {t('profile.backToBranches')}</Link>
      <h1 className="page-title mt-3 mb-1"><span className="gold-text">{t('profile.title')}</span></h1>
      <p className="page-sub mb-6">{t('profile.sub')}</p>

      <div className="grid gap-6 fade-in">
        {profile && (
          <ProfileCard
            profile={profile}
            token={token ?? ''}
            onUpdate={(p) => setProfile((prev) => (prev ? { ...prev, ...p } : prev))}
          />
        )}

        {profile && (
          <section>
            <h2 className="label !mb-2.5">{t('profile.favoriteBarber')}</h2>
            {profile.favoriteBarber ? (
              <Link
                href={`/customer/book/${profile.favoriteBarber.id}${profile.favoriteBarber.branchIds[0] ? `?branchId=${profile.favoriteBarber.branchIds[0]}` : ''}`}
                className="card p-4 flex items-center gap-3 card-hover"
              >
                {profile.favoriteBarber.photoUrl ? (
                  <img
                    src={profile.favoriteBarber.photoUrl}
                    alt={profile.favoriteBarber.name}
                    className="w-12 h-12 rounded-full object-cover border-2 border-gold/60 shrink-0"
                  />
                ) : (
                  <span className="w-12 h-12 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold font-extrabold text-lg shrink-0">
                    {profile.favoriteBarber.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <b className="text-[15px] block truncate">{profile.favoriteBarber.name}</b>
                  <span className="text-xs text-neutral-500">{t('profile.tapToBook').replace('{name}', profile.favoriteBarber.name.split(' ')[0])}</span>
                </span>
                <StarIcon size={20} className="text-gold shrink-0" filled />
                <span className="text-gold font-extrabold text-lg shrink-0">›</span>
              </Link>
            ) : (
              <div className="card p-4 flex items-center gap-3">
                <span className="rounded-full w-12 h-12 bg-gold/10 border border-gold/40 flex items-center justify-center text-gold/50 shrink-0">
                  <StarIcon size={20} />
                </span>
                <span className="flex-1">
                  <b className="text-[15px] block">{t('profile.noFavorite')}</b>
                  <span className="text-xs text-neutral-500">{t('profile.tapStar')}</span>
                </span>
              </div>
            )}
          </section>
        )}

        <EnableNotifications getToken={() => token ?? ''} />
        <LanguageSwitcher />
        <DiscountCard token={token} />
        <MyReportsSection token={token} />
        <a
          href="tel:+14437415820"
          className="card p-4 flex items-center gap-3 card-hover"
        >
          <span className="rounded-full w-10 h-10 bg-gold/10 border border-gold/40 flex items-center justify-center text-gold shrink-0">
            <PhoneIcon size={18} />
          </span>
          <span className="flex-1 min-w-0">
            <b className="text-[15px] block">{t('profile.needHelp')}</b>
            <span className="text-xs text-neutral-500 leading-relaxed block">
              {t('profile.callUs')} <b className="text-gold text-[14px]">(443) 741-5820</b>
            </span>
          </span>
        </a>
        <ChangePasswordSection token={token} />
        <button
          onClick={logout}
          className="w-full card p-4 flex items-center gap-3 text-left border-red-600/25 hover:border-red-600/50 transition-colors"
        >
          <span className="rounded-full w-10 h-10 bg-red-600/10 border border-red-600/30 flex items-center justify-center text-red-700 shrink-0">
            <LogOutIcon size={18} />
          </span>
          <span className="flex-1">
            <b className="text-[15px] block text-red-700">{t('profile.logOut')}</b>
            <span className="text-xs text-neutral-500">{t('profile.signOutDesc')}</span>
          </span>
        </button>
      </div>
    </main>
  );
}

function ProfileCard({ profile, token, onUpdate }: { profile: Profile; token: string; onUpdate: (p: Partial<Profile>) => void }) {
  const { t } = useLang();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(profile.name);
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveName() {
    const n = name.trim();
    if (n.length < 2) { setError(t('profile.nameTooShort')); return; }
    setSavingName(true);
    setError('');
    try {
      const r = await fetch('/api/customer/profile', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || t('profile.couldNotSave'));
      onUpdate({ name: n });
      setEditingName(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profile.couldNotSave'));
    } finally {
      setSavingName(false);
    }
  }

  async function uploadPhoto(file: File) {
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('photo', file);
      const r = await fetch('/api/customer/profile', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || t('profile.couldNotUpload'));
      onUpdate({ photoUrl: d.photoUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profile.couldNotUpload'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center gap-4">
        <button
          onClick={() => fileRef.current?.click()}
          className="relative shrink-0 group"
          aria-label={t('profile.changeProfilePhoto')}
          title={t('profile.changePhoto')}
        >
          {profile.photoUrl ? (
            <img
              src={profile.photoUrl}
              alt={profile.name}
              className="w-20 h-20 rounded-full object-cover border-2 border-gold/60"
            />
          ) : (
            <span className="w-20 h-20 rounded-full bg-gold/10 border-2 border-gold/40 flex items-center justify-center text-gold font-extrabold text-3xl">
              {profile.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-gold text-white flex items-center justify-center border-2 border-white shadow">
            {uploading ? <span className="text-[10px]">…</span> : <CameraIcon size={13} />}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadPhoto(f);
            e.target.value = '';
          }}
        />
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                className="input !py-2 font-bold"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
              />
              <button
                onClick={saveName}
                disabled={savingName}
                className="gold-btn rounded-xl px-3 py-2 text-sm shrink-0"
              >
                {savingName ? '…' : t('profile.save')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <b className="text-[18px] truncate">{profile.name}</b>
              <button
                onClick={() => { setName(profile.name); setEditingName(true); setError(''); }}
                className="text-gold/70 hover:text-gold shrink-0"
                aria-label={t('profile.editName')}
              >
                <PencilIcon size={15} />
              </button>
            </div>
          )}
          <p className="text-xs text-neutral-500 truncate mt-0.5">{profile.email}</p>
          <p className="text-[11px] text-neutral-400 mt-1">{t('profile.photoVisible')}</p>
        </div>
      </div>
      {error && <p className="text-red-700 text-sm mt-3">{error}</p>}
    </section>
  );
}

interface DiscountInfo {
  type: 'student' | 'military';
  status: 'pending' | 'approved' | 'rejected';
}

function DiscountCard({ token }: { token: string | null }) {
  const { t } = useLang();
  const [discount, setDiscount] = useState<DiscountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'student' | 'military'>('student');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetch('/api/customer/discount', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if ('discount' in d) setDiscount(d.discount); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function submit(file: File) {
    setSubmitting(true);
    setError('');
    try {
      const form = new FormData();
      form.append('type', type);
      form.append('photo', file);
      const r = await fetch('/api/customer/discount', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || t('profile.couldNotSubmit'));
      setDiscount({ type, status: 'pending' });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profile.couldNotSubmit'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center gap-3">
        <span className="rounded-full w-10 h-10 bg-gold/10 border border-gold/40 flex items-center justify-center text-gold text-lg shrink-0">
          🎓
        </span>
        <div className="flex-1">
          <b className="text-[15px] block">{t('profile.discountTitle')}</b>
          <span className="text-xs text-neutral-500">{t('profile.discountSub')}</span>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500 mt-4">{t('profile.loading')}</p>
      ) : discount?.status === 'approved' ? (
        <p className="mt-4 text-sm font-bold text-green-800 bg-green-600/10 border border-green-600/25 rounded-xl px-4 py-3">
          ✓ {t('profile.discountActive').replace('{type}', discount.type === 'student' ? t('profile.student') : t('profile.military'))}
        </p>
      ) : discount?.status === 'pending' ? (
        <p className="mt-4 text-sm font-bold text-gold bg-gold/10 border border-gold/30 rounded-xl px-4 py-3">
          ⏳ {t('profile.underReview')}
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {discount?.status === 'rejected' && (
            <p className="text-sm text-red-700 bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3">
              {t('profile.notApproved')}
            </p>
          )}
          <p className="text-[13px] text-neutral-600 leading-relaxed">
            {t('profile.discountPitch')}
          </p>
          <div className="flex gap-2">
            {(['student', 'military'] as const).map((kind) => (
              <button
                key={kind}
                onClick={() => setType(kind)}
                className={`flex-1 rounded-xl px-4 py-3 text-[13px] font-extrabold border transition-all ${
                  type === kind
                    ? 'bg-[#1c1a15] text-white border-[#1c1a15]'
                    : 'bg-[#f4edda] border-[#dccfae] text-neutral-700'
                }`}
              >
                {kind === 'student' ? t('profile.studentBtn') : t('profile.militaryBtn')}
              </button>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) submit(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={submitting}
            className="gold-btn rounded-2xl py-3 font-bold"
          >
            {submitting ? t('profile.uploading') : t('profile.takeIdPhoto')}
          </button>
          {error && <p className="text-red-700 text-sm">{error}</p>}
        </div>
      )}
    </section>
  );
}

function ChangePasswordSection({ token }: { token: string | null }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setSuccess('');
    if (next.length < 6) {
      setError(t('profile.passwordTooShort'));
      return;
    }
    if (next !== confirm) {
      setError(t('profile.passwordsNoMatch'));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/customer/password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || t('profile.couldNotChangePassword'));
      setSuccess(t('profile.passwordChanged'));
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profile.couldNotChangePassword'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <button
        onClick={() => { setOpen(!open); setError(''); setSuccess(''); }}
        className="w-full card p-4 flex items-center gap-3 text-left"
      >
        <span className="rounded-full w-10 h-10 bg-gold/10 border border-gold/40 flex items-center justify-center text-gold shrink-0">
          <LockIcon size={18} />
        </span>
        <span className="flex-1">
          <b className="text-[15px] block">{t('profile.changePassword')}</b>
          <span className="text-xs text-neutral-500">{t('profile.updatePasswordDesc')}</span>
        </span>
        <span className={`text-gold transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="card p-5 mt-2.5 grid gap-4 fade-in">
          <div>
            <label className="label">{t('profile.currentPassword')}</label>
            <input
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder={t('profile.currentPasswordPh')}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label">{t('profile.newPassword')}</label>
            <input
              className="input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={t('profile.newPasswordPh')}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">{t('profile.confirmNewPassword')}</label>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t('profile.confirmNewPasswordPh')}
              autoComplete="new-password"
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
          </div>
          {error && <p className="text-red-700 text-sm bg-red-600/10 border border-red-600/25 rounded-xl px-4 py-3">{error}</p>}
          {success && <p className="text-green-800 text-sm bg-green-600/10 border border-green-600/25 rounded-xl px-4 py-3 font-semibold inline-flex items-center gap-2"><CheckIcon size={16} /> {success}</p>}
          <button onClick={submit} disabled={busy} className="gold-btn rounded-2xl py-3 font-bold">
            {busy ? t('profile.saving') : t('profile.saveNewPassword')}
          </button>
        </div>
      )}
    </section>
  );
}
