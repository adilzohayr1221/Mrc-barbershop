'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { StarIcon, PoleIcon, ClockIcon, ArrowRightIcon } from '@/components/Icons';
import ReviewForm from '@/components/ReviewForm';
import type { PublicBarber, Review, WorkingHours } from '@/lib/types';

function Stars({ rating, size = 16 }: { rating: number; size?: number }) {
  const full = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5 text-gold">
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} size={size} className={i <= full ? '' : 'opacity-25'} />
      ))}
    </span>
  );
}

function fmtHour(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

// Compact working-hours summary, e.g. "Mon–Fri · 9 AM–9 PM".
function hoursSummary(wh?: WorkingHours | null): string {
  if (!wh) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
  const runs: { from: number; to: number; label: string }[] = [];
  for (const d of order) {
    const hours = wh[String(d) as keyof WorkingHours];
    if (!hours || !hours.length) continue;
    const sorted = [...hours].sort();
    const label = `${fmtHour(sorted[0])}–${fmtHour(sorted[sorted.length - 1])}`;
    const last = runs[runs.length - 1];
    if (last && last.label === label && d === last.to + 1) {
      last.to = d;
    } else {
      runs.push({ from: d, to: d, label });
    }
  }
  return runs
    .map((r) => `${days[r.from]}${r.to !== r.from ? `–${days[r.to]}` : ''} · ${r.label}`)
    .join('   ');
}

interface Props {
  barber: PublicBarber;
  branchId: string;
  reviews: Review[];
  loadingReviews: boolean;
  token: string;
  onClose: () => void;
  onReviewSubmitted: () => void;
}

// Star toggle: mark this barber as the customer's favorite (shown in profile).
function FavoriteStar({ barberId, token }: { barberId: string; token: string }) {
  const [isFav, setIsFav] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch('/api/customer/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d.profile) setIsFav(d.profile.favoriteBarberId === barberId); })
      .catch(() => {});
  }, [token, barberId]);

  async function toggle() {
    if (busy || !token) return;
    setBusy(true);
    try {
      const r = await fetch('/api/customer/profile', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ favoriteBarberId: isFav ? null : barberId }),
      });
      if (!r.ok) throw new Error();
      setIsFav(!isFav);
    } catch {
      // keep current state on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={isFav ? 'Remove from favorites' : 'Mark as favorite barber'}
      title={isFav ? 'Your favorite barber' : 'Mark as favorite'}
      className={`shrink-0 w-10 h-10 rounded-full border flex items-center justify-center transition-all active:scale-90 ${
        isFav
          ? 'bg-gold text-white border-gold shadow-[0_0_16px_rgba(212,175,55,0.5)]'
          : 'bg-white/60 text-gold/50 border-gold/40 hover:text-gold hover:border-gold'
      }`}
    >
      <StarIcon size={19} filled={isFav} />
    </button>
  );
}

export default function BarberProfileModal({
  barber,
  branchId,
  reviews,
  loadingReviews,
  token,
  onClose,
  onReviewSubmitted,
}: Props) {
  // Lock background scroll + close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const hours = hoursSummary(barber.workingHours);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${barber.name} profile`}>
      <div className="absolute inset-0 bg-black/45 fade-in" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 flex justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md bg-[#faf6ea] rounded-t-[1.75rem] max-h-[92dvh] overflow-y-auto no-scrollbar sheet-up shadow-[0_-12px_48px_rgba(0,0,0,0.25)]">
          <div className="sticky top-0 bg-[#faf6ea]/95 backdrop-blur-sm pt-2.5 pb-1 z-10">
            <div className="mx-auto w-10 h-1.5 rounded-full bg-[#dccfae]" />
            <button
              onClick={onClose}
              aria-label="Close profile"
              className="absolute top-3 right-4 w-9 h-9 rounded-full bg-[#f4edda] border border-[#e6dabf] text-neutral-600 text-lg leading-none flex items-center justify-center"
            >
              ×
            </button>
          </div>

          <div className="px-6 pb-6 -mt-1">
            {/* Photo */}
            <div className="flex justify-center">
              {barber.photoUrl ? (
                <Image
                  src={barber.photoUrl}
                  alt={barber.name}
                  width={128}
                  height={128}
                  className="rounded-full object-cover w-32 h-32 border-4 border-gold/70 shadow-[0_0_36px_rgba(212,175,55,0.4)]"
                />
              ) : (
                <div className="rounded-full w-32 h-32 bg-[#ece2c9] border-4 border-gold/40 flex items-center justify-center text-gold">
                  <PoleIcon size={52} />
                </div>
              )}
            </div>

            {/* Name + rating + favorite star */}
            <div className="flex items-center justify-center gap-2 mt-4">
              <h2 className="font-extrabold text-[24px] tracking-tight">{barber.name}</h2>
              <FavoriteStar barberId={barber.id} token={token} />
            </div>
            <div className="flex items-center justify-center gap-2 mt-2">
              <Stars rating={barber.avgRating ?? 0} />
              <span className="text-sm text-neutral-600 font-medium">
                {barber.avgRating !== null ? barber.avgRating.toFixed(1) : 'New'} · {barber.reviewCount} review{barber.reviewCount === 1 ? '' : 's'}
              </span>
            </div>

            {/* Skills under the photo — verified ones get a ✓ badge */}
            {barber.skills.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5 mt-4">
                {barber.skills.map((s) => (
                  <span
                    key={s}
                    className={`chip ${(barber.verifiedSkills ?? []).includes(s) ? '!border-green-600/50 !text-green-700 font-bold' : ''}`}
                    title={(barber.verifiedSkills ?? []).includes(s) ? 'Verified by MRC' : undefined}
                  >
                    {(barber.verifiedSkills ?? []).includes(s) ? '✓ ' : ''}{s}
                  </span>
                ))}
              </div>
            )}

            {hours && (
              <p className="text-center text-[13px] text-neutral-500 mt-3 flex items-center justify-center gap-1.5">
                <ClockIcon size={14} className="text-gold shrink-0" /> {hours}
              </p>
            )}

            {/* Work photos (owner-approved) */}
            {barber.workPhotos && barber.workPhotos.length > 0 && (
              <div className="px-5 mt-5">
                <h3 className="font-extrabold text-[17px]">Work <span className="text-neutral-400 font-semibold text-sm">({barber.workPhotos.length})</span></h3>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {barber.workPhotos.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" className="rounded-xl overflow-hidden border border-gold/30 block">
                      <img src={url} alt={`${barber.name} work ${i + 1}`} className="w-full aspect-square object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Reviews */}
            <div className="mt-6 pt-5 border-t border-[#e6dabf]">
              <h3 className="font-extrabold text-[17px]">Reviews <span className="text-neutral-400 font-semibold text-sm">({reviews.length})</span></h3>
              <div className="grid gap-2.5 mt-3">
                {loadingReviews && <p className="text-sm text-neutral-500">Loading reviews…</p>}
                {!loadingReviews && reviews.length === 0 && (
                  <p className="text-sm text-neutral-500">No reviews yet — be the first to review {barber.name.split(' ')[0]}.</p>
                )}
                {reviews.map((r) => (
                  <div key={r.id} className="bg-[#f4edda] border border-[#e6dabf] rounded-2xl p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate">{r.customerName}</span>
                      <Stars rating={r.rating} size={13} />
                    </div>
                    <p className="text-sm text-neutral-700 mt-1 leading-relaxed">{r.text}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <ReviewForm
                  barberId={barber.id}
                  barberName={barber.name.split(' ')[0]}
                  token={token}
                  onSubmitted={onReviewSubmitted}
                />
              </div>
            </div>

            {/* Book */}
            <Link
              href={`/customer/book/${barber.id}?branchId=${branchId}`}
              className="gold-btn rounded-2xl px-4 py-3.5 text-center flex items-center justify-center gap-2 mt-6 text-[16px] font-bold"
            >
              Book with {barber.name.split(' ')[0]} <ArrowRightIcon size={18} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
