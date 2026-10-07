'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { MapPinIcon, CalendarIcon } from '@/components/Icons';
import { BranchPageSkeleton } from '@/components/Loading';
import DirectionsButton from '@/components/DirectionsButton';
import { useCustomerAuth } from '@/components/CustomerAuth';
import ShopIllustration from '@/components/ShopIllustration';
import LoyaltyCard from '@/components/LoyaltyCard';
import type { Branch } from '@/lib/types';

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

function fmtMiles(mi: number): string {
  return mi < 0.1 ? 'Nearby' : mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

export default function CustomerHome() {
  const { checked } = useCustomerAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
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
        <p className="text-[11px] font-semibold tracking-[0.3em] uppercase text-gold/90">MRC Barbershop</p>
        <h1 className="page-title mt-1"><span className="gold-text">Choose your branch</span></h1>
        <p className="page-sub mt-1.5 mb-4">Tap a numbered pin on the map or a branch below.</p>

        <Link
          href="/customer/offers"
          className="block rounded-2xl p-4 mb-4 relative overflow-hidden border border-gold/40 shadow-[0_10px_30px_rgba(0,0,0,0.35)] active:scale-[0.99] transition-transform"
          style={{ background: 'linear-gradient(120deg, #1c1a16 0%, #0e0d0b 100%)' }}
        >
          <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-gold">🔥 Special offer</p>
          <p className="font-extrabold text-[17px] mt-1 text-white">4 haircuts for $120<span className="text-neutral-400 font-semibold text-[14px]">/month</span></p>
          <p className="text-[13px] text-neutral-400 mt-0.5">One per week · cancel anytime <span className="text-gold font-bold">→</span></p>
        </Link>

        <Link
          href="/customer/offers"
          className="block rounded-2xl p-4 mb-4 relative overflow-hidden border border-gold/40 shadow-[0_10px_30px_rgba(0,0,0,0.35)] active:scale-[0.99] transition-transform"
          style={{ background: 'linear-gradient(120deg, #1c1a16 0%, #0e0d0b 100%)' }}
        >
          <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-gold">✨ New</p>
          <p className="font-extrabold text-[17px] mt-1 text-white">Mix &amp; Match Weekly Plan</p>
          <p className="text-[13px] text-neutral-400 mt-0.5">Pick any 4 services in any order — save 25% every month <span className="text-gold font-bold">→</span></p>
        </Link>

        <LoyaltyCard />

        {loading ? (
          <BranchPageSkeleton />
        ) : (
          <div className="fade-in">
            <div className="mx-4">
              <BranchMap branches={sorted} selectedId={selectedId} onSelect={setSelectedId} />
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
                            {fmtMiles(milesBetween(userLoc.lat, userLoc.lng, b.lat, b.lng))}
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
                      <CalendarIcon size={16} /> Book appointment
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
