'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Branch } from '@/lib/types';
import { shopPinSvg, salonPinSvg } from './mapPins';

// The Leaflet implementation of the customer map (Esri World Topo basemap).
// Since the MapKit switch (2026-10-30) this is the FALLBACK engine: it
// renders whenever Apple MapKit JS can't load, can't authorize, or doesn't
// render in time, so customers never see a blank map. Behavior here is the
// reference contract the MapKit engine mirrors.

// Modern light basemap (owner refresh, 2026-10-30): Esri World Topo Map —
// a clean, muted light base (white/grey roads, soft blue water, pale green
// parks, uncluttered labels) that serves anonymously with attribution.
// CARTO's Voyager/Positron rasters were the first choice for this look but
// now return "API key required" placeholder tiles to anonymous callers
// (verified 2026-10-30), and this app uses no paid/keyed map services.
const TOPO_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';

const TOPO_ATTR =
  'Esri, USGS, NOAA &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS User Community';

// Fit all pins (branches + salon pins) on first mount only.
function FitBounds({ branches, salonPins }: { branches: Branch[]; salonPins: SalonPin[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const pts: [number, number][] = [
      ...branches.map((b) => [b.lat, b.lng] as [number, number]),
      ...salonPins.map((s) => [s.lat, s.lng] as [number, number]),
    ];
    if (pts.length > 1) {
      // Center the pins as one group with generous breathing room
      // (owner fix, 2026-11-01 — a tight bounding fit left "the pins
      // at the edges"): fit bounds built from the midpoint with spans
      // 2.6× the pins' own spread, mirroring the native/MapKit fit.
      let minLat = Infinity,
        maxLat = -Infinity,
        minLng = Infinity,
        maxLng = -Infinity;
      for (const [lat, lng] of pts) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
      const cLat = (minLat + maxLat) / 2;
      const cLng = (minLng + maxLng) / 2;
      const sLat = Math.max((maxLat - minLat) * 2.6, 0.014) / 2;
      const sLng = Math.max((maxLng - minLng) * 2.6, 0.014) / 2;
      map.fitBounds(
        L.latLngBounds([
          [cLat - sLat, cLng - sLng],
          [cLat + sLat, cLng + sLng],
        ])
      );
    } else if (pts.length === 1) {
      map.setView(pts[0], 14);
    }
  }, [map, branches, salonPins]);
  return null;
}

// Smooth fly-to when the user picks a different branch (skips the initial
// mount, and skips entirely when the map is already centered there —
// re-flying to the same spot makes the map visibly shake).
function FlyToSelected({
  branches,
  selectedId,
}: {
  branches: Branch[];
  selectedId: string | null;
}) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const b = branches.find((x) => x.id === selectedId);
    if (!b) return;
    const target = L.latLng(b.lat, b.lng);
    const alreadyThere = map.getCenter().distanceTo(target) < 30 && map.getZoom() >= 15;
    if (alreadyThere) return;
    map.flyTo(target, 15, { duration: 1.1 });
  }, [map, branches, selectedId]);
  return null;
}

function ZoomButtons() {
  const map = useMap();
  return (
    <div className="map-zoom-stack">
      <button type="button" aria-label="Zoom in" onClick={() => map.zoomIn()}>
        +
      </button>
      <button type="button" aria-label="Zoom out" onClick={() => map.zoomOut()}>
        &minus;
      </button>
    </div>
  );
}

function shopIcon(n: number) {
  return L.divIcon({
    className: '',
    // NOTE: the `selected` class is toggled on the existing icon element
    // (see the effect below) — the icon object itself never changes, so
    // Leaflet never destroys/recreates the marker DOM (no blink on tap).
    html: `<div class="shop-pin">${shopPinSvg(n)}</div>`,
    iconSize: [34, 47],
    // Anchor at the pin tip so it points at the building.
    iconAnchor: [17, 41],
  });
}

function userDotIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="user-dot"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

interface UserPos {
  lat: number;
  lng: number;
  acc: number;
}

// A platform salon shown as a discovery pin (distinct from MRC branch pins).
export interface SalonPin {
  id: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
}

function salonIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="shop-pin salon-pin">${salonPinSvg()}</div>`,
    iconSize: [34, 47],
    iconAnchor: [17, 41],
  });
}

export default function BranchMapLeaflet({
  branches,
  selectedId,
  onSelect,
  salonPins = [],
  onSalonSelect,
}: {
  branches: Branch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  salonPins?: SalonPin[];
  onSalonSelect?: (slug: string) => void;
}) {
  const [tilesReady, setTilesReady] = useState(false);
  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Record<string, L.Marker | null>>({});
  const loadedOnce = useRef(false);
  const hasBranches = branches.length > 0;

  // One stable icon per branch — never recreated, so tapping never blinks.
  const branchIcons = useMemo(
    () => branches.map((_, i) => shopIcon(i + 1)),
    [branches]
  );

  // Toggle the selected look on the existing marker DOM (no icon swap).
  useEffect(() => {
    branches.forEach((b) => {
      const pin = markerRefs.current[b.id]?.getElement()?.querySelector('.shop-pin');
      pin?.classList.toggle('selected', selectedId === b.id);
    });
  }, [branches, selectedId]);

  const tileEvents = {
    // Only show the loading shimmer on the very first tile load — showing it
    // again on every pan/zoom makes the whole map flash.
    loading: () => {
      if (!loadedOnce.current) setTilesReady(false);
    },
    load: () => {
      loadedOnce.current = true;
      setTilesReady(true);
    },
  };

  const locateMe = () => {
    const map = mapRef.current;
    if (!navigator.geolocation) {
      setLocError('Location is not supported on this device.');
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const ll: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPos({ lat: ll[0], lng: ll[1], acc: pos.coords.accuracy || 40 });
        map?.flyTo(ll, 15, { duration: 1.3 });
      },
      () => {
        setLocating(false);
        setLocError('Could not get your location. Check permission and try again.');
        window.setTimeout(() => setLocError(null), 4000);
      },
      { timeout: 12000, maximumAge: 60000 }
    );
  };

  const center: [number, number] = hasBranches
    ? [branches[0].lat, branches[0].lng]
    : salonPins.length
      ? [salonPins[0].lat, salonPins[0].lng]
      : [39.28954, -76.5933];

  // One stable icon for all salon pins (before the early return: hooks rule).
  const salonPinIcon = useMemo(() => salonIcon(), []);

  if (!hasBranches && salonPins.length === 0) return null;

  return (
    <div className="modern-map">
      <MapContainer
        center={center}
        zoom={12}
        maxZoom={18}
        className="modern-map-leaflet"
        scrollWheelZoom={false}
        zoomControl={false}
        ref={mapRef}
      >
        {/* Light modern basemap (labels are part of the tile set, so a
            single layer keeps the map clean and fast). */}
        <TileLayer url={TOPO_URL} attribution={TOPO_ATTR} maxZoom={18} maxNativeZoom={18} eventHandlers={tileEvents} />
        <FitBounds branches={branches} salonPins={salonPins} />
        <FlyToSelected branches={branches} selectedId={selectedId} />
        <ZoomButtons />
        {branches.map((b, i) => {
          const isSelected = selectedId === b.id;
          return (
            <Marker
              key={b.id}
              ref={(m) => {
                markerRefs.current[b.id] = m;
              }}
              position={[b.lat, b.lng]}
              icon={branchIcons[i]}
              eventHandlers={{ click: () => onSelect(b.id) }}
              opacity={selectedId && !isSelected ? 0.55 : 1}
              zIndexOffset={isSelected ? 1000 : 0}
            />
          );
        })}
        {salonPins.map((s) => (
          <Marker
            key={`salon-${s.id}`}
            position={[s.lat, s.lng]}
            icon={salonPinIcon}
            eventHandlers={{ click: () => onSalonSelect?.(s.slug) }}
          />
        ))}
        {userPos && (
          <>
            <Circle
              center={[userPos.lat, userPos.lng]}
              radius={Math.max(userPos.acc, 25)}
              pathOptions={{ color: '#1a73e8', weight: 1.5, fillColor: '#1a73e8', fillOpacity: 0.12 }}
            />
            <Marker position={[userPos.lat, userPos.lng]} icon={userDotIcon()} interactive={false} />
          </>
        )}
      </MapContainer>

      {/* Tile loading shimmer */}
      <div className={`map-loading${tilesReady ? ' map-loading-done' : ''}`} aria-hidden="true" />

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
