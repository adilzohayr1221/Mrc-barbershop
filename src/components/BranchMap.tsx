'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Branch } from '@/lib/types';
import type { SalonPin } from './BranchMapLeaflet';

export type { SalonPin };

const BranchMapLeaflet = dynamic(() => import('./BranchMapLeaflet'), { ssr: false });
const BranchMapMapKit = dynamic(() => import('./BranchMapMapKit'), { ssr: false });
const BranchMapNative = dynamic(() => import('./BranchMapNative'), { ssr: false });

// Customer map dispatcher. Three engines, one prop contract, one
// framed shell:
//  - Native (iOS App Store shell with the BranchMap plugin): a real
//    MKMapView floated over the placeholder — the exact native Apple
//    Maps. Selected ONLY when all three version-contract checks pass
//    (native platform + iOS + plugin available). The shell loads this
//    live website, and the v1.0 shell currently in App Review does NOT
//    contain the plugin, so there the check fails and the web engines
//    below render exactly as they always have.
//  - MapKit JS (everyone else): real Apple Maps on the web; primary.
//  - Leaflet: fallback, swapped in the moment MapKit can't load, can't
//    authorize, or doesn't render — a customer never sees a blank map.
export default function BranchMap({
  branches,
  selectedId,
  onSelect,
  salonPins = [],
  onSalonSelect,
  onUserLocated,
}: {
  branches: Branch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  salonPins?: SalonPin[];
  onSalonSelect?: (slug: string) => void;
  /** Native engine only: a successful native locate, fed into the
   *  page's existing userLoc state (distance chips / sorting). The web
   *  engines keep their locate state internal, as today. */
  onUserLocated?: (loc: { lat: number; lng: number }) => void;
}) {
  const [useFallback, setUseFallback] = useState(false);
  const [nativeAvailable, setNativeAvailable] = useState(false);

  // Fail-closed native detection. Browsers and PWAs have no injected
  // window.Capacitor at all, so they never even fetch the bridge chunk.
  // The gate below only decides whether loading the bridge chunk is
  // worth it: the injected native bridge may not expose
  // isNativePlatform() on window.Capacitor until some @capacitor/core
  // code has run, so the bridge's own presence (nativePromise) counts
  // as a shell signal too. Inside a shell, the bridge module makes the
  // authoritative check (isNativeBranchMapAvailable: isNativePlatform
  // + 'ios' + isPluginAvailable('BranchMap')); until it confirms, the
  // web engine below renders untouched — on the v1.0 shell (no
  // BranchMap plugin) it never confirms.
  useEffect(() => {
    let alive = true;
    try {
      const cap = (
        window as unknown as {
          Capacitor?: {
            isNativePlatform?: () => boolean;
            nativePromise?: unknown;
          };
        }
      ).Capacitor;
      if (!cap) return;
      const looksNative =
        cap.isNativePlatform?.() === true ||
        typeof cap.nativePromise === 'function';
      if (!looksNative) return;
    } catch {
      return;
    }
    import('@/lib/native-branch-map')
      .then((m) => {
        if (alive && m.isNativeBranchMapAvailable()) setNativeAvailable(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (branches.length === 0 && salonPins.length === 0) return null;

  if (nativeAvailable) {
    return (
      <BranchMapNative
        branches={branches}
        selectedId={selectedId}
        onSelect={onSelect}
        salonPins={salonPins}
        onSalonSelect={onSalonSelect}
        onUserLocated={onUserLocated}
      />
    );
  }

  if (useFallback) {
    return (
      <BranchMapLeaflet
        branches={branches}
        selectedId={selectedId}
        onSelect={onSelect}
        salonPins={salonPins}
        onSalonSelect={onSalonSelect}
      />
    );
  }
  return (
    <BranchMapMapKit
      branches={branches}
      selectedId={selectedId}
      onSelect={onSelect}
      salonPins={salonPins}
      onSalonSelect={onSalonSelect}
      onFallback={() => setUseFallback(true)}
    />
  );
}
