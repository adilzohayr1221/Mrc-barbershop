'use client';

import { useEffect, useRef, useState } from 'react';
import type { Branch } from '@/lib/types';
import type { SalonPin } from './BranchMapLeaflet';
import {
  NativeBranchMapController,
  toNativeBranches,
  toNativeSalons,
} from '@/lib/native-branch-map';

// Native Apple Maps engine — iOS App Store shell ONLY. The dispatcher
// (BranchMap.tsx) mounts this component solely when
// isNativeBranchMapAvailable() passes, which requires the BranchMap
// plugin inside the native binary; in every other context (browser,
// PWA, the v1.0 shell in App Review) this component is never mounted
// and the web engines render exactly as before.
//
// The web owns the page. This component renders the framed .modern-map
// placeholder (layout space only) and keeps the native plugin fed with
// the same branches / salons / selection state the web engines use:
//   pin tap (native) → onSelect / onSalonSelect, the page's own handlers
//   card tap (page)  → controller.setSelected(id, flyTo: true)
//   native locate    → onUserLocated → the page's userLoc state
//   locate failure   → the same .map-toast the web engines show
export interface BranchMapNativeProps {
  branches: Branch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  salonPins?: SalonPin[];
  onSalonSelect?: (slug: string) => void;
  onUserLocated?: (loc: { lat: number; lng: number }) => void;
}

// Value key for the pin payload — badge numbers follow array order, so
// order is part of the key. The page re-creates its sorted array on
// every render; comparing by value keeps setData calls to real changes
// only (a re-render with identical data must not rebuild native pins).
function dataKeyOf(branches: Branch[], salonPins: SalonPin[]): string {
  return (
    branches.map((b) => `${b.id}@${b.lat},${b.lng}`).join('|') +
    '#' +
    salonPins.map((s) => `${s.id}@${s.lat},${s.lng}`).join('|')
  );
}

export default function BranchMapNative({
  branches,
  selectedId,
  onSelect,
  salonPins = [],
  onSalonSelect,
  onUserLocated,
}: BranchMapNativeProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<NativeBranchMapController | null>(null);
  const attachPromiseRef = useRef<Promise<void> | null>(null);
  const lastDataKeyRef = useRef<string | null>(null);
  const lastSelectedRef = useRef<string | null | undefined>(undefined);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  // Latest callbacks, read by the mount-once controller wiring.
  const callbacksRef = useRef({ onSelect, onSalonSelect, onUserLocated });
  callbacksRef.current = { onSelect, onSalonSelect, onUserLocated };

  // ---- Mount once: attach the native map to the placeholder ----
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const controller = new NativeBranchMapController({
      onBranchTap: (id) => callbacksRef.current.onSelect(id),
      onSalonTap: (slug) => callbacksRef.current.onSalonSelect?.(slug),
      onUserLocated: (e) =>
        callbacksRef.current.onUserLocated?.({ lat: e.lat, lng: e.lng }),
      onLocateError: (message) => {
        setLocError(message);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setLocError(null), 4000);
      },
      onReady: () => setReady(true),
    });
    controllerRef.current = controller;
    lastDataKeyRef.current = dataKeyOf(branches, salonPins);
    lastSelectedRef.current = selectedId;
    attachPromiseRef.current = controller.attach(el, {
      branches: toNativeBranches(branches),
      salons: toNativeSalons(salonPins),
      selectedId,
    });
    // Full navigations (the salon switch uses window.location) don't run
    // React cleanup — make sure the floating native map never survives
    // the page. detach() is idempotent; the unmount cleanup below calls
    // it again on ordinary route changes.
    const onPageHide = () => {
      void controller.detach();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      controllerRef.current = null;
      attachPromiseRef.current = null;
      void controller.detach();
    };
    // Mount-once: the initial props are the attach snapshot; later
    // changes flow through the sync effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Data sync (prop changes after attach) ----
  const dataKey = dataKeyOf(branches, salonPins);
  useEffect(() => {
    if (lastDataKeyRef.current === dataKey) return;
    lastDataKeyRef.current = dataKey;
    const controller = controllerRef.current;
    const attachPromise = attachPromiseRef.current;
    if (!controller || !attachPromise) return;
    const nativeBranches = toNativeBranches(branches);
    const nativeSalons = toNativeSalons(salonPins);
    // Queue behind attach so the call lands after show() (the
    // controller drops setData calls made before it is shown).
    void attachPromise.then(() => controller.setData(nativeBranches, nativeSalons));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // ---- Selection sync (card taps fly; pin-tap echoes are idempotent
  // on the native side — it skips the fly-to when already centered) ----
  useEffect(() => {
    if (lastSelectedRef.current === undefined) return;
    if (lastSelectedRef.current === selectedId) return;
    lastSelectedRef.current = selectedId;
    const controller = controllerRef.current;
    const attachPromise = attachPromiseRef.current;
    if (!controller || !attachPromise) return;
    void attachPromise.then(() => controller.setSelected(selectedId, true));
  }, [selectedId]);

  return (
    <div className="relative">
      <div className="modern-map" ref={wrapRef}>
        {/* Sizing surface only — the identical box the web engines use
            (340 / 480 tall). Its content stays hidden: the native
            plugin draws the real map + gold frame over this exact
            rect, and a visible web surface underneath would double
            the frame. */}
        <div
          className="modern-map-mapkit"
          style={{ visibility: 'hidden' }}
          aria-hidden="true"
        />
        {/* Loading shimmer until the native map reports ready — the
            same shimmer the web engines show while they load. */}
        <div
          className={`map-loading${ready ? ' map-loading-done' : ''}`}
          aria-hidden="true"
        />
      </div>
      {/* Locate errors: the web engines render .map-toast inside the
          map, but the native view floats above the WebView and would
          cover it — so here the same toast sits directly under the
          framed map, same message strings, same 4s auto-dismiss. */}
      {locError && (
        <div
          className="map-toast"
          style={{ top: 'calc(100% + 8px)', left: 0, right: 0 }}
          role="status"
        >
          {locError}
        </div>
      )}
    </div>
  );
}
