'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeftIcon, StarIcon, PoleIcon, ArrowRightIcon } from '@/components/Icons';
import { BarberListSkeleton } from '@/components/Loading';
import { useCustomerAuth } from '@/components/CustomerAuth';
import { useLang } from '@/components/LanguageContext';
import { withSalon } from '../salonQuery';
import type { PublicBarber, Branch } from '@/lib/types';

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

// VIP home visits: barbers who opted in to cutting hair at the customer's
// home. Flat $100, paid in full at booking; the barber comes to you.
export default function VipBarbers() {
  const { t } = useLang();
  const { checked } = useCustomerAuth();
  const [barbers, setBarbers] = useState<PublicBarber[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!checked) return;
    Promise.all([
      fetch(withSalon('/api/barbers'))
        .then((r) => r.json())
        .then((d) => setBarbers((d.barbers || []).filter((b: PublicBarber) => b.houseCalls)))
        .catch(() => {}),
      fetch(withSalon('/api/branches'))
        .then((r) => r.json())
        .then((d) => setBranches(d.branches || []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [checked]);

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '';

  return (
    <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
      {!checked ? (
        <BarberListSkeleton />
      ) : (
        <>
          <Link href="/customer" className="back-link"><ArrowLeftIcon size={16} /> {t('branch.backToBranches')}</Link>
          <h1 className="page-title mt-3 mb-1">
            <span className="gold-text">🏠 {t('vip.title')}</span>
          </h1>
          <p className="page-sub mb-5">{t('vip.sub')}</p>

          {loading && <BarberListSkeleton />}

          {!loading && barbers.length === 0 && (
            <div className="card p-10 text-center fade-in">
              <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold mb-4">
                <PoleIcon size={26} />
              </div>
              <p className="font-bold text-[16px]">{t('vip.empty')}</p>
              <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed max-w-xs mx-auto">
                {t('vip.emptySub')}
              </p>
            </div>
          )}

          <div className="grid gap-4">
            {barbers.map((b) => (
              <div key={b.id} className="card p-5">
                <div className="flex gap-4">
                  <div className="shrink-0">
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
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-lg tracking-tight">{b.name}</div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[#7a5b12] bg-gold/15 border border-gold/50 rounded-full px-2.5 py-1 mt-1.5">
                      {t('vip.homeBadge')}
                    </span>
                    {b.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {b.skills.slice(0, 4).map((s) => (
                          <span key={s} className="chip">{s}</span>
                        ))}
                      </div>
                    )}
                    <div className="inline-flex items-center gap-1.5 text-sm text-gold mt-2 font-medium">
                      <Stars rating={b.avgRating ?? 0} />
                      <span className="text-neutral-600">
                        {b.reviewCount === 1
                          ? t('book.reviewOne').replace('{n}', String(b.reviewCount))
                          : t('book.reviews').replace('{n}', String(b.reviewCount)).replace('{s}', b.reviewCount === 1 ? '' : 's')}
                        {b.avgRating !== null && <> · {b.avgRating.toFixed(1)}</>}
                      </span>
                    </div>
                    {b.branchIds[0] && (
                      <p className="text-[13px] text-neutral-500 mt-1 truncate">{branchName(b.branchIds[0])}</p>
                    )}
                  </div>
                </div>
                <Link
                  href={`/customer/book/${b.id}?branchId=${b.branchIds[0] ?? ''}&vip=1`}
                  className="gold-btn rounded-2xl px-4 py-3 text-center flex items-center justify-center gap-2 mt-4 text-[15px]"
                >
                  {t('vip.bookVip')} · $100 <ArrowRightIcon size={18} />
                </Link>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
