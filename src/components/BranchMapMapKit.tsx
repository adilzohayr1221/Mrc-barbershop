'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Branch } from '@/lib/types';
import type { SalonPin } from './BranchMapLeaflet';
import { shopPinSvg, salonPinSvg } from './mapPins';

// Apple MapKit JS implementation of the customer map — same props, same
// framed shell, same original shop pins and behaviors as the Leaflet
// fallback (BranchMapLeaflet), which the dispatcher swaps in ONLY on a
// hard failure: script load error, token fetch/authorization error, a
// MapKit error event, a total hang (nothing painted 15s after the map
// object exists), or a failed reachability probe (Apple's CDN
// unreachable from this network at the 8s decision moment, painted
// or not — see probeAppleReachable below). Slow loading is NOT a
// failure — on a phone network the ~650KB bundle + token + first
// tiles can take well
// over 6s (the old deadline fired on the owner's iPhone and the
// fallback then stuck for the whole session, since the dispatcher never
// retries). While waiting, the loading shimmer below covers the framed
// container. A customer must never see a blank map.
//
// MapKit JS 5 anchors a custom annotation element at (width/2, height)
// of the element (bottom-center). The shop pins' tip sits at (17, 41) in
// their 34×47 box, so an anchorOffset of (0, -6) reproduces the Leaflet
// iconAnchor [17, 41] exactly.

// MapKit has no published TS types in this repo; the surface used here is
// small and verified against the 5.x bundle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MK = any;

const MAPKIT_SRC = 'https://cdn.apple-mapkit.com/mk/5.69/mapkit.js';
// Hang backstop ONLY: how long the map may exist without painting a
// single frame before we conclude Apple's services are unreachable from
// this device (blocked hosts, captive portal, …) and fall back. It is
// deliberately far beyond any honest load time — slow is not a failure.
const RENDER_TIMEOUT_MS = 15000;

// ---- Apple-reachability probe ----------------------------------------
// The one failure mode the hang backstop can't see: Apple's bundle and
// map initialize (pins, controls, "Legal" all render) but the street
// tiles never paint, because the device's network can't reach Apple's
// map infrastructure while other hosts (e.g. the fallback's Esri tiles)
// work fine. Symptom on the phone: an empty beige grid forever. A timed
// no-cors fetch to the MapKit CDN separates that case from mere
// slowness: reachable → never fall back for slowness alone (the 15s
// hang backstop remains); unreachable at the decision moment below →
// engage the fallback for THIS session early instead of stranding the
// customer on an empty grid — even if a paint signal already fired,
// since it can fire over that same tile-less grid.
const PROBE_TIMEOUT_MS = 5000;
const UNREACHABLE_DECISION_MS = 8000;

// Session-scoped: the probe runs once per page session, however often
// the map remounts, and its verdict is remembered in this module only
// (never in storage — a new visit re-checks the network it is on).
let probePromise: Promise<boolean> | null = null;

function probeAppleReachable(): Promise<boolean> {
  if (probePromise) return probePromise;
  probePromise = new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    // no-cors: the response is opaque — resolution alone proves the
    // host answered; a network error or the timeout means unreachable.
    const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
    fetch(MAPKIT_SRC, { mode: 'no-cors', cache: 'no-store' })
      .then(() => {
        clearTimeout(timer);
        done(true);
      })
      .catch(() => {
        clearTimeout(timer);
        done(false);
      });
  });
  return probePromise;
}

let scriptPromise: Promise<MK> | null = null;
let initPromise: Promise<MK> | null = null;
// mapkit.init is a process-wide singleton, so the authorization callback
// captured at first init reports token failures through this mutable
// handler, (re)assigned by whichever map component is currently mounted.
let tokenFailureHandler: (() => void) | null = null;

function loadMapKitScript(): Promise<MK> {
  const w = window as unknown as { mapkit?: MK };
  if (w.mapkit) return Promise.resolve(w.mapkit);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<MK>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MAPKIT_SRC;
    s.async = true;
    s.onload = () => {
      const mk = (window as unknown as { mapkit?: MK }).mapkit;
      if (mk) resolve(mk);
      else {
        scriptPromise = null;
        reject(new Error('MapKit script loaded without the mapkit global.'));
      }
    };
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('MapKit script failed to load.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function initMapKit(): Promise<MK> {
  if (initPromise) return initPromise;
  initPromise = loadMapKitScript().then(
    (mk: MK) =>
      new Promise<MK>((resolve) => {
        mk.init({
          authorizationCallback: (done: (token: string) => void) => {
            const fetchToken = () =>
              fetch('/api/mapkit/token').then((r) => {
                if (!r.ok) throw new Error(`Map token route returned ${r.status}`);
                return r.text();
              });
            fetchToken()
              // One retry: a single dropped request on a phone network is
              // a transient blip, not an authorization failure. Only when
              // the retry also fails is this a hard failure → fallback.
              .catch(() => fetchToken())
              .then((token) => done(token))
              .catch(() => {
                // 503/500/network on both attempts — per contract the
                // client uses the fallback.
                tokenFailureHandler?.();
                done('');
              });
          },
        });
        resolve(mk);
      })
  );
  // Don't let one transient failure poison the singleton for the session.
  initPromise.catch(() => {
    initPromise = null;
  });
  return initPromise;
}

interface Pt {
  lat: number;
  lng: number;
}

const clampSpan = (d: number) => Math.min(Math.max(d, 0.0008), 90);

// Visible span for a Leaflet-style zoom level in a w×h viewport (Web
// Mercator math, same approximation Leaflet itself uses).
function spanForZoom(mk: MK, zoom: number, w: number, h: number, lat: number) {
  const worldPx = 256 * Math.pow(2, zoom);
  const lngDelta = (360 * w) / worldPx;
  const latDelta = (360 * Math.cos((lat * Math.PI) / 180) * h) / worldPx;
  return new mk.CoordinateSpan(clampSpan(latDelta), clampSpan(lngDelta));
}

// Center the whole pin set as one group in the middle of the map with
// generous breathing room (owner fix, 2026-11-01 — a tight bounding fit
// left "the pins at the edges"): midpoint center, spans 2.6× the pins'
// own spread, so each pin sits ~38% of the way from center to its edge.
// Mirrors the native plugin's fitAllPins exactly. A single pin centers
// at zoom ~14.
function fittedRegion(mk: MK, pts: Pt[], w: number, h: number) {
  if (pts.length === 1) {
    return new mk.CoordinateRegion(
      new mk.Coordinate(pts[0].lat, pts[0].lng),
      spanForZoom(mk, 14, w, h, pts[0].lat)
    );
  }
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return new mk.CoordinateRegion(
    new mk.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2),
    new mk.CoordinateSpan(
      clampSpan(Math.max((maxLat - minLat) * 2.6, 0.014)),
      clampSpan(Math.max((maxLng - minLng) * 2.6, 0.014))
    )
  );
}

function haversineMeters(a: Pt, b: Pt): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// The pin element: the exact same .shop-pin markup the Leaflet engine
// renders inside its divIcon, so all existing pin CSS (selected scale +
// gold glow, hover, pulse ring) applies unchanged.
function pinElement(svg: string, salon: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.className = salon ? 'shop-pin salon-pin' : 'shop-pin';
  // Explicit size so MapKit's anchor measurement is exact from the start.
  el.style.width = '34px';
  el.style.height = '47px';
  el.style.cursor = 'pointer';
  el.innerHTML = svg.replace('<svg ', '<svg width="34" height="47" ');
  return el;
}

interface UserPos {
  lat: number;
  lng: number;
  acc: number;
}

export interface BranchMapMapKitProps {
  branches: Branch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  salonPins?: SalonPin[];
  onSalonSelect?: (slug: string) => void;
  onFallback: () => void;
}

export default function BranchMapMapKit({
  branches,
  selectedId,
  onSelect,
  salonPins = [],
  onSalonSelect,
  onFallback,
}: BranchMapMapKitProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MK>(null);
  const mkRef = useRef<MK>(null);
  const branchAnnsRef = useRef<Record<string, { ann: MK; el: HTMLDivElement }>>({});
  const salonAnnsRef = useRef<Record<string, { ann: MK; el: HTMLDivElement }>>({});
  const userAnnRef = useRef<{ ann: MK; circle: MK } | null>(null);
  const renderedRef = useRef(false);
  const fallbackCalledRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const onSelectRef = useRef(onSelect);
  const onSalonSelectRef = useRef(onSalonSelect);
  const onFallbackRef = useRef(onFallback);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onSalonSelectRef.current = onSalonSelect;
    onFallbackRef.current = onFallback;
  });

  const triggerFallback = useCallback((opts?: { force?: boolean }) => {
    if (fallbackCalledRef.current) return;
    // A painted map normally proves this engine works, so fallback is
    // refused once anything rendered. The one exception is the probe
    // path (force): an "unreachable" verdict at the 8s decision moment
    // means the paint signal may have fired over a tile-less grid —
    // bootstrap reached, street tiles blocked — which the signal
    // itself cannot tell apart from a real render, so the fallback
    // engages anyway.
    if (renderedRef.current && !opts?.force) return;
    fallbackCalledRef.current = true;
    onFallbackRef.current();
  }, []);

  // ---- Mount: load MapKit, init, build the map in the framed surface ----
  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let canvasSeenAt = 0;

    const myTokenFailure = () => triggerFallback();
    tokenFailureHandler = myTokenFailure;

    // Reachability decision, in parallel with the normal load: if the
    // probe has settled "unreachable" by the decision moment, fall
    // back now rather than at the 15s hang backstop. The fallback is
    // FORCED (see triggerFallback): with an unreachable verdict, even
    // a fired paint signal is suspect — it may have fired over a
    // tile-less grid whose street tiles are blocked, which is exactly
    // the owner's failure mode. With a "reachable" verdict nothing
    // changes at all: Apple stays however long it honestly takes.
    let probeReachable: boolean | null = null;
    probeAppleReachable().then((ok) => {
      probeReachable = ok;
    });
    const probeTimer = setTimeout(() => {
      if (!cancelled && probeReachable === false) triggerFallback({ force: true });
    }, UNREACHABLE_DECISION_MS);

    const markRendered = () => {
      if (renderedRef.current || cancelled) return;
      renderedRef.current = true;
      setRendered(true);
      if (poll) clearInterval(poll);
    };

    initMapKit()
      .then((mk: MK) => {
        if (cancelled) return;
        mkRef.current = mk;
        const el = surfaceRef.current;
        if (!el) {
          triggerFallback();
          return;
        }
        // Authorization/token errors surface as mapkit "error" events;
        // before first render they mean this engine can't work here.
        try {
          mk.addEventListener('error', () => {
            if (!renderedRef.current) triggerFallback();
          });
        } catch {
          /* older builds may not expose it — the render deadline covers us */
        }

        const pts: Pt[] = [
          ...branches.map((b) => ({ lat: b.lat, lng: b.lng })),
          ...salonPins.map((s) => ({ lat: s.lat, lng: s.lng })),
        ];
        let map: MK;
        try {
          map = new mk.Map(el, {
            region: fittedRegion(mk, pts, el.clientWidth || 366, el.clientHeight || 340),
            mapType: mk.Map.MapTypes.MutedStandard ?? mk.Map.MapTypes.Standard,
            colorScheme: mk.Map.ColorSchemes.Light,
            showsZoomControl: false,
            showsMapTypeControl: false,
            showsUserLocationControl: false,
            isRotationEnabled: false,
            // Normal interactive map (owner's restored spec,
            // 2026-11-01 — "when it was normal it moved easily and
            // stayed in its place"): drag pans, pinch zooms, inside
            // the framed card. The +/− buttons, selection fly-to and
            // locate-me work alongside the gestures.
            isScrollEnabled: true,
            isZoomEnabled: true,
          });
        } catch {
          triggerFallback();
          return;
        }
        mapRef.current = map;
        setMapReady(true);

        // Strongest success signal MapKit JS 5 exposes: the map fires
        // "region-change-end" once it has laid out and painted the
        // visible region. With a canvas in the DOM that is a rendered
        // map — cancel the hang deadline permanently.
        try {
          map.addEventListener('region-change-end', () => {
            if (el.querySelector('canvas')) markRendered();
          });
        } catch {
          /* the poll below still detects the render on its own */
        }

        // Render detection (backstop): a live MapKit map paints a WebGL
        // canvas. Ask twice ~500ms apart (a stray canvas with dead tiles
        // signs the error path instead), and treat any pre-render error
        // or the 15s hang deadline as a fallback trigger.
        const deadline = Date.now() + RENDER_TIMEOUT_MS;
        poll = setInterval(() => {
          if (cancelled) return;
          if (el.querySelector('canvas')) {
            if (!canvasSeenAt) canvasSeenAt = Date.now();
            else if (Date.now() - canvasSeenAt > 450) markRendered();
          } else {
            canvasSeenAt = 0;
          }
          if (!renderedRef.current && Date.now() > deadline) {
            if (poll) clearInterval(poll);
            triggerFallback();
          }
        }, 200);
      })
      .catch(() => triggerFallback());

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      clearTimeout(probeTimer);
      if (tokenFailureHandler === myTokenFailure) tokenFailureHandler = null;
      const map = mapRef.current;
      mapRef.current = null;
      try {
        if (map && typeof map.destroy === 'function') map.destroy();
      } catch {
        /* best-effort cleanup; removing the DOM node is the real teardown */
      }
    };
    // Mount-once: initial branches/salonPins are read for the first fit,
    // later prop changes are synced by the annotation effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Keep annotations in sync with props ----
  useEffect(() => {
    const mk = mkRef.current;
    const map = mapRef.current;
    if (!mapReady || !mk || !map) return;

    // Rebuild (lists here are tiny — a couple of branches, a few salons).
    for (const rec of Object.values(branchAnnsRef.current)) map.removeAnnotation(rec.ann);
    for (const rec of Object.values(salonAnnsRef.current)) map.removeAnnotation(rec.ann);
    branchAnnsRef.current = {};
    salonAnnsRef.current = {};

    branches.forEach((b, i) => {
      const el = pinElement(shopPinSvg(i + 1), false);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectRef.current(b.id);
      });
      let cached: HTMLDivElement | null = null;
      const ann = new mk.Annotation(new mk.Coordinate(b.lat, b.lng), () => (cached ??= el), {
        anchorOffset: new DOMPoint(0, -6),
        accessibilityLabel: b.name,
      });
      branchAnnsRef.current[b.id] = { ann, el };
      map.addAnnotation(ann);
    });

    salonPins.forEach((s) => {
      const el = pinElement(salonPinSvg(), true);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSalonSelectRef.current?.(s.slug);
      });
      let cached: HTMLDivElement | null = null;
      const ann = new mk.Annotation(new mk.Coordinate(s.lat, s.lng), () => (cached ??= el), {
        anchorOffset: new DOMPoint(0, -6),
        accessibilityLabel: s.name,
      });
      salonAnnsRef.current[s.id] = { ann, el };
      map.addAnnotation(ann);
    });
  }, [mapReady, branches, salonPins]);

  // ---- Selection: restyle pins + fly to the newly selected branch ----
  const flySkippedFirst = useRef(false);
  useEffect(() => {
    const mk = mkRef.current;
    const map = mapRef.current;
    if (!mapReady || !mk || !map) return;

    branches.forEach((b) => {
      const rec = branchAnnsRef.current[b.id];
      if (!rec) return;
      const isSelected = selectedId === b.id;
      rec.el.classList.toggle('selected', isSelected);
      rec.el.style.opacity = selectedId && !isSelected ? '0.55' : '1';
      rec.el.style.zIndex = isSelected ? '1000' : '';
    });

    // Fly-to parity with the Leaflet engine: skip the first run (the
    // initial fit already framed everything), skip when already there.
    if (!flySkippedFirst.current) {
      flySkippedFirst.current = true;
      return;
    }
    const b = branches.find((x) => x.id === selectedId);
    if (!b) return;
    const el = surfaceRef.current;
    const w = el?.clientWidth || 366;
    const h = el?.clientHeight || 340;
    const center = map.center as { latitude: number; longitude: number };
    const span = map.region?.span as { longitudeDelta: number } | undefined;
    const zoom = span ? Math.log2((360 * w) / (span.longitudeDelta * 256)) : 0;
    const dist = haversineMeters(
      { lat: center.latitude, lng: center.longitude },
      { lat: b.lat, lng: b.lng }
    );
    if (dist < 30 && zoom >= 15) return;
    map.setRegionAnimated(
      new mk.CoordinateRegion(new mk.Coordinate(b.lat, b.lng), spanForZoom(mk, 15, w, h, b.lat)),
      true
    );
  }, [mapReady, branches, selectedId]);

  // ---- User position: blue dot + accuracy circle (Leaflet parity) ----
  useEffect(() => {
    const mk = mkRef.current;
    const map = mapRef.current;
    if (!mapReady || !mk || !map) return;
    if (userAnnRef.current) {
      map.removeAnnotation(userAnnRef.current.ann);
      map.removeOverlay(userAnnRef.current.circle);
      userAnnRef.current = null;
    }
    if (!userPos) return;
    const coord = new mk.Coordinate(userPos.lat, userPos.lng);
    const dot = document.createElement('div');
    dot.className = 'user-dot';
    let cached: HTMLDivElement | null = null;
    const ann = new mk.Annotation(coord, () => (cached ??= dot), {
      anchorOffset: new DOMPoint(0, -11),
      enabled: false,
    });
    const circle = new mk.CircleOverlay(coord, Math.max(userPos.acc, 25), {
      style: new mk.Style({
        strokeColor: '#1a73e8',
        lineWidth: 1.5,
        fillColor: '#1a73e8',
        fillOpacity: 0.12,
      }),
    });
    map.addOverlay(circle);
    map.addAnnotation(ann);
    userAnnRef.current = { ann, circle };
  }, [mapReady, userPos]);

  // ---- Wheel parity: Leaflet runs with scrollWheelZoom off, so a wheel
  // over the map scrolls the page instead of zooming the map. MapKit has
  // no per-gesture switch; stop the event at the framed wrapper (capture
  // phase) without preventDefault, so page scroll still happens.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => e.stopPropagation();
    wrap.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => wrap.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  const zoomBy = (factor: number) => {
    const mk = mkRef.current;
    const map = mapRef.current;
    if (!mk || !map) return;
    const region = map.region;
    map.setRegionAnimated(
      new mk.CoordinateRegion(
        region.center,
        new mk.CoordinateSpan(
          clampSpan(region.span.latitudeDelta * factor),
          clampSpan(region.span.longitudeDelta * factor)
        )
      ),
      true
    );
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      setLocError('Location is not supported on this device.');
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserPos({ lat, lng, acc: pos.coords.accuracy || 40 });
        const mk = mkRef.current;
        const map = mapRef.current;
        const el = surfaceRef.current;
        if (mk && map && el) {
          map.setRegionAnimated(
            new mk.CoordinateRegion(
              new mk.Coordinate(lat, lng),
              spanForZoom(mk, 15, el.clientWidth || 366, el.clientHeight || 340, lat)
            ),
            true
          );
        }
      },
      () => {
        setLocating(false);
        setLocError('Could not get your location. Check permission and try again.');
        window.setTimeout(() => setLocError(null), 4000);
      },
      { timeout: 12000, maximumAge: 60000 }
    );
  };

  return (
    <div className="modern-map" ref={wrapRef}>
      <div ref={surfaceRef} className="modern-map-mapkit" />

      {/* Loading shimmer until the Apple map has actually painted */}
      <div className={`map-loading${rendered ? ' map-loading-done' : ''}`} aria-hidden="true" />

      {/* Zoom controls — same glass stack as the Leaflet engine */}
      <div className="map-zoom-stack">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(0.5)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(2)}>
          &minus;
        </button>
      </div>

      {/* Locate me */}
      <button
        type="button"
        className={`map-fab${locating ? ' locating' : ''}`}
        onClick={locateMe}
        aria-label="Locate me"
        title="Locate me"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      </button>
      {locError && <div className="map-toast">{locError}</div>}
    </div>
  );
}
