'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeftIcon, StarIcon, PoleIcon, ArrowRightIcon } from '@/components/Icons';
import { BarberListSkeleton } from '@/components/Loading';
import DirectionsButton from '@/components/DirectionsButton';
import { useCustomerAuth } from '@/components/CustomerAuth';
import ReviewForm from '@/components/ReviewForm';
import BarberProfileModal from '@/components/BarberProfileModal';
import { withSalon } from '../../salonQuery';
import type { PublicBarber, Review, Branch } from '@/lib/types';

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5 text-gold">
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} size={14} className={i <= full ? '' : 'opacity-25'} />
      ))}
    </span>
  );
}

export default function BranchBarbers() {
  const { branchId } = useParams<{ branchId: string }>();
  const { checked, token } = useCustomerAuth();
  const [barbers, setBarbers] = useState<PublicBarber[]>([]);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [openReviews, setOpenReviews] = useState<string | null>(null);
  const [profileFor, setProfileFor] = useState<PublicBarber | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!checked) return;
    Promise.all([
      fetch(withSalon(`/api/barbers?branchId=${branchId}`))
        .then((r) => r.json())
        .then((d) => setBarbers(d.barbers || []))
        .catch(() => {}),
      fetch(withSalon('/api/branches'))
        .then((r) => r.json())
        .then((d) => {
          const b = (d.branches || []).find((x: Branch) => x.id === branchId);
          setBranch(b || null);
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [branchId, checked]);

  async function loadReviews(barberId: string) {
    setLoadingReviews(true);
    try {
      const r = await fetch(`/api/reviews?barberId=${barberId}`).then((x) => x.json());
      setReviews(r.reviews || []);
    } catch {
      setReviews([]);
    }
    setLoadingReviews(false);
  }

  async function loadBarbers() {
    try {
      const d = await fetch(`/api/barbers?branchId=${branchId}`).then((r) => r.json());
      setBarbers(d.barbers || []);
    } catch {}
  }

  async function openProfile(b: PublicBarber) {
    setProfileFor(b);
    setReviews([]);
    await loadReviews(b.id);
  }

  async function toggleReviews(barberId: string) {
    if (openReviews === barberId) {
      setOpenReviews(null);
      return;
    }
    setOpenReviews(barberId);
    await loadReviews(barberId);
  }

  return (
    <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
      {!checked ? (
        <BarberListSkeleton />
      ) : (
      <>
      <div className="flex items-center justify-between gap-3">
        <Link href="/customer" className="back-link"><ArrowLeftIcon size={16} /> Branches</Link>
        {branch && (
          <DirectionsButton
            lat={branch.lat}
            lng={branch.lng}
            className="gold-outline-btn rounded-xl px-3.5 py-2 text-sm inline-flex items-center gap-1.5 shrink-0"
            iconSize={15}
          />
        )}
      </div>
      <h1 className="page-title mt-3 mb-1">
        <span className="gold-text">Choose your barber</span>
      </h1>
      <p className="page-sub mb-5">Master craftsmen at this branch.</p>

      {loading && <BarberListSkeleton />}

      {!loading && barbers.length === 0 && (
        <div className="card p-10 text-center fade-in">
          <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold mb-4">
            <PoleIcon size={26} />
          </div>
          <p className="font-bold text-[16px]">No barbers listed here yet</p>
          <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
            Our lineup is being set up. The shop owner can add barbers anytime from the owner panel.
          </p>
        </div>
      )}

      <div className="grid gap-4">
        {barbers.map((b) => (
          <div key={b.id} className="card p-5">
            <div className="flex gap-4">
              <button
                onClick={() => openProfile(b)}
                aria-label={`View ${b.name}'s profile`}
                className="shrink-0 rounded-full transition-transform active:scale-95"
              >
                {b.photoUrl ? (
                  <Image
                    src={b.photoUrl}
                    alt={b.name}
                    width={76}
                    height={76}
                    className="rounded-full object-cover w-[76px] h-[76px] border-2 border-gold/60 shadow-[0_0_18px_rgba(212,175,55,0.25)]"
                  />
                ) : (
                  <div className="rounded-full w-[76px] h-[76px] bg-[#ece2c9] border-2 border-gold/40 flex items-center justify-center text-gold">
                    <PoleIcon size={30} />
                  </div>
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-lg tracking-tight">{b.name}</div>
                {b.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {b.skills.slice(0, 4).map((s) => (
                      <span key={s} className="chip">{s}</span>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => toggleReviews(b.id)}
                  className="inline-flex items-center gap-1.5 text-sm text-gold mt-2 font-medium"
                >
                  <Stars rating={b.avgRating ?? 0} />
                  <span className="underline underline-offset-2 decoration-gold/40">
                    {b.reviewCount} review{b.reviewCount === 1 ? '' : 's'}
                    {b.avgRating !== null && <span className="text-neutral-600 no-underline"> · {b.avgRating.toFixed(1)}</span>}
                  </span>
                </button>
              </div>
            </div>

            {openReviews === b.id && (
              <div className="mt-4 border-t border-gold/10 pt-3 grid gap-2">
                {loadingReviews && <p className="text-sm text-neutral-500">Loading reviews…</p>}
                {!loadingReviews && reviews.length === 0 && (
                  <p className="text-sm text-neutral-500">No reviews yet.</p>
                )}
                {reviews.map((r) => (
                  <div key={r.id} className="bg-[#f4edda] border border-[#e6dabf] rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{r.customerName}</span>
                      <Stars rating={r.rating} />
                    </div>
                    <p className="text-sm text-neutral-700 mt-1 leading-relaxed">{r.text}</p>
                  </div>
                ))}
                <ReviewForm
                  barberId={b.id}
                  barberName={b.name.split(' ')[0]}
                  token={token}
                  onSubmitted={() => {
                    loadReviews(b.id);
                    loadBarbers();
                  }}
                />
              </div>
            )}

            <Link
              href={`/customer/book/${b.id}?branchId=${branchId}`}
              className="gold-btn rounded-2xl px-4 py-3 text-center flex items-center justify-center gap-2 mt-4 text-[15px]"
            >
              Book with {b.name.split(' ')[0]} <ArrowRightIcon size={18} />
            </Link>
          </div>
        ))}
      </div>
            {profileFor && (
        <BarberProfileModal
          barber={profileFor}
          branchId={branchId}
          reviews={reviews}
          loadingReviews={loadingReviews}
          token={token}
          onClose={() => setProfileFor(null)}
          onReviewSubmitted={() => {
            loadReviews(profileFor.id);
            loadBarbers();
          }}
        />
      )}
</>
      )}
    </main>
  );
}
