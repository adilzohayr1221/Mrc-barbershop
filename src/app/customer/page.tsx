'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { MapPinIcon, CalendarIcon } from '@/components/Icons';
import { BranchPageSkeleton } from '@/components/Loading';
import DirectionsButton from '@/components/DirectionsButton';
import { useCustomerSession } from '@/components/CustomerAuth';
import { useLang } from '@/components/LanguageContext';
import ShopIllustration from '@/components/ShopIllustration';
import LoyaltyCard from '@/components/LoyaltyCard';
import type { Branch } from '@/lib/types';
import type { SalonPin } from '@/components/BranchMap';

const BranchMap = dynamic(() => import('@/components/BranchMap'), { ssr: false });

// Distance in miles between two lat/lng points (Haversine).
function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const a = s1 * s1 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtMiles(mi: number, t: (key: string) => string): string {
  return mi < 0.1 ? t('home.nearby') : mi < 10 ? t('home.miles').replace('{n}', mi.toFixed(1)) : t('home.miles').replace('{n}', String(Math.round(mi)));
}

// Small "tap here" hint pinned to the top corner of the subscription
// banners below: a bare four-point sparkle — the same ✦ mark the app
// draws beside its "New" labels (see SparkleIcon in AiAssistant) — in the
// page's own cream tone, so customers can tell the banner is pressable
// and not just an ad. No badge, no disc behind it. Purely decorative —
// the banner link itself stays exactly as it was.
function TapHintBadge() {
  return (
    <span aria-hidden="true" className="tap-hint-spark">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 1.5 14.3 9.7 22.5 12 14.3 14.3 12 22.5 9.7 14.3 1.5 12 9.7 9.7Z" />
      </svg>
    </span>
  );
}

export default function CustomerHome() {
  const { checked } = useCustomerSession();
  const { t } = useLang();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [salonPins, setSalonPins] = useState<SalonPin[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!checked) return;
    // Salon context (multi-salon platform): read ?salon= once on load, persist
    // it, and pass it to the public list fetches. Default 'mrc' keeps the
    // existing MRC customer link working untouched (no param appended then).
    let salonParam = 'mrc';
    try {
      const q = new URLSearchParams(window.location.search).get('salon');
      if (q && q.trim()) {
        salonParam = q.trim();
        localStorage.setItem('mrc-customer-salon', salonParam);
      } else {
        // Plain /customer (no ?salon=) always means MRC — drop any stale salon.
        localStorage.removeItem('mrc-customer-salon');
      }
    } catch {}
    const salonQs = salonParam === 'mrc' ? '' : `?salon=${encodeURIComponent(salonParam)}`;
    fetch(`/api/branches${salonQs}`)
      .then((r) => r.json())
      .then((d) => {
        const list: Branch[] = d.branches || [];
        setBranches(list);
        if (list.length) setSelectedId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // Platform salon discovery pins (approved salons with coordinates).
    // Excludes the salon currently being viewed, if any.
    fetch('/api/salons/map')
      .then((r) => r.json())
      .then((d) => {
        const pins: SalonPin[] = (d.salons || []).filter(
          (s: SalonPin) => s.slug !== salonParam
        );
        setSalonPins(pins);
      })
      .catch(() => {});
    // Get the customer's location once (for nearest-first sorting).
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 8000, maximumAge: 600000 }
      );
    }
  }, [checked]);

  // Nearest branch first when we know the customer's location.
  const sorted = userLoc
    ? [...branches].sort(
        (a, b) =>
          milesBetween(userLoc.lat, userLoc.lng, a.lat, a.lng) -
          milesBetween(userLoc.lat, userLoc.lng, b.lat, b.lng)
      )
    : branches;

  if (!checked) {
    return (
      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        <BranchPageSkeleton />
      </main>
    );
  }

  return (
    <main className="flex-1 w-full">
      <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto w-full">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.3em] uppercase text-gold/90">MRC Barbershops</p>
            <h1 className="page-title mt-1"><span className="gold-text">{t('home.chooseBranch')}</span></h1>
            <p className="page-sub mt-1.5">{t('home.tapPin')}</p>
          </div>
          <Link
            href="/customer/vip"
            aria-label="VIP home visits"
            className="relative shrink-0 w-[104px] h-[104px] rounded-2xl border border-gold/50 shadow-[0_10px_30px_rgba(0,0,0,0.35)] flex flex-col items-center justify-center text-center px-1.5 active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(140deg, #1c1a16 0%, #0e0d0b 100%)' }}
          >
            <TapHintBadge />
            <span className="text-[15px] leading-none">🏠</span>
            <span className="gold-text font-black text-[26px] leading-none tracking-wide mt-1">VIP</span>
            <span className="text-[9.5px] font-semibold text-neutral-300 leading-tight mt-1.5">{t('home.vipTag')}</span>
            <span className="text-gold font-extrabold text-[13px] leading-none mt-1">$100</span>
          </Link>
        </div>

        <Link
          href="/customer/offers"
          className="block rounded-2xl p-4 mb-4 relative overflow-hidden border border-gold/40 shadow-[0_10px_30px_rgba(0,0,0,0.35)] active:scale-[0.99] transition-transform"
          style={{ background: 'linear-gradient(120deg, #1c1a16 0%, #0e0d0b 100%)' }}
        >
          <TapHintBadge />
          <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-gold">🔥 {t('home.specialOffer')}</p>
          <p className="font-extrabold text-[17px] mt-1 text-white">{t('home.monthlyDeal')}</p>
          <p className="text-[13px] text-neutral-400 mt-0.5">{t('home.onePerWeek')} <span className="text-gold font-bold">→</span></p>
        </Link>

        <Link
          href="/customer/offers"
          className="block rounded-2xl p-4 mb-4 relative overflow-hidden border border-gold/40 shadow-[0_10px_30px_rgba(0,0,0,0.35)] active:scale-[0.99] transition-transform"
          style={{ background: 'linear-gradient(120deg, #1c1a16 0%, #0e0d0b 100%)' }}
        >
          <TapHintBadge />
          <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-gold">✨ {t('home.new')}</p>
          <p className="font-extrabold text-[17px] mt-1 text-white">{t('home.mixMatch')}</p>
          <p className="text-[13px] text-neutral-400 mt-0.5">{t('home.mixMatchDesc')} <span className="text-gold font-bold">→</span></p>
        </Link>

        <LoyaltyCard />

        {loading ? (
          <BranchPageSkeleton />
        ) : (
          <div className="fade-in">
            <div className="mx-4">
              <BranchMap
                branches={sorted}
                selectedId={selectedId}
                onSelect={setSelectedId}
                salonPins={salonPins}
                onSalonSelect={(slug) => {
                  window.location.href = `/customer?salon=${encodeURIComponent(slug)}`;
                }}
                onUserLocated={({ lat, lng }) => setUserLoc({ lat, lng })}
              />
            </div>

            <div className="mt-4">
              <ShopIllustration />
            </div>

            <div className="mt-4 grid gap-3">
              {sorted.map((b, i) => (
                <div
                  key={b.id}
                  className={`card p-4 transition-all ${
                    selectedId === b.id ? 'card-selected' : 'card-hover'
                  }`}
                >
                  <button
                    onClick={() => setSelectedId(b.id)}
                    className="w-full text-left flex items-center gap-4"
                  >
                    <span className="branch-marker shrink-0" style={{ width: 36, height: 36, fontSize: 16 }}>
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-bold text-[16px]">{b.name}</span>
                        {userLoc && (
                          <span className="text-[11px] font-extrabold text-gold bg-gold/10 border border-gold/30 rounded-full px-2 py-0.5 shrink-0">
                            {fmtMiles(milesBetween(userLoc.lat, userLoc.lng, b.lat, b.lng), t)}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-1 text-sm text-neutral-600 mt-0.5">
                        <MapPinIcon size={14} className="shrink-0 text-gold/70" />
                        <span className="truncate">{b.address}</span>
                      </span>
                    </span>
                  </button>
                  <div className="grid grid-cols-2 gap-2.5 mt-3.5">
                    <DirectionsButton
                      lat={b.lat}
                      lng={b.lng}
                      className="gold-btn rounded-xl px-3 py-2.5 text-center flex items-center justify-center gap-1.5 text-[14px]"
                    />
                    <Link
                      href={`/customer/branch/${b.id}`}
                      className="gold-outline-btn rounded-xl px-3 py-2.5 text-center flex items-center justify-center gap-1.5 text-[14px]"
                    >
                      <CalendarIcon size={16} /> {t('home.bookAppointment')}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
