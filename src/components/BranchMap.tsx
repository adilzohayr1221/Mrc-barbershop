'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Branch } from '@/lib/types';

const SAT_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const SAT_ATTR = 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';

// Fit both branches on first mount only.
function FitBounds({ branches }: { branches: Branch[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (branches.length > 1) {
      map.fitBounds(
        L.latLngBounds(branches.map((b) => [b.lat, b.lng] as [number, number])),
        { padding: [52, 52] }
      );
    } else if (branches.length === 1) {
      map.setView([branches[0].lat, branches[0].lng], 14);
    }
  }, [map, branches]);
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

// Small drawn barbershop (storefront + barber pole), drawn bolder so it stays
// crisp at pin size.
const SHOP_GLYPH = `<path d="M4 9 6.5 3h19L28 9Z" fill="#D4AF37"/><path d="M10.5 3.8 10 8.4M14.5 3.8l-.2 4.6M18.5 3.8v4.6M22.5 3.8l.2 4.6" stroke="#1C1A15" stroke-width="1.6" stroke-linecap="round"/><path d="M4 9h24v1q-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0-1.5 2-3 0Z" fill="#1C1A15"/><rect x="6.5" y="12" width="19" height="14.5" rx="1.2" fill="#1C1A15"/><rect x="8.6" y="15" width="4" height="5" rx=".8" fill="#FFFDF6"/><rect x="19.4" y="15" width="4" height="5" rx=".8" fill="#FFFDF6"/><rect x="13.8" y="17" width="4.4" height="9.5" rx=".8" fill="#FFFDF6"/><rect x="26.3" y="13" width="2.7" height="10" rx="1.35" fill="#FFFDF6" stroke="#1C1A15" stroke-width="1"/><path d="M26.3 16l2.7-1.3M26.3 19.2l2.7-1.3M26.3 22.4l2.7-1.3" stroke="#B8912F" stroke-width="1.1"/><rect x="26.3" y="11.6" width="2.7" height="1.8" rx=".9" fill="#D4AF37"/><rect x="26.3" y="23" width="2.7" height="1.8" rx=".9" fill="#D4AF37"/>`;

// Premium teardrop pin: black/gold, drawn shop in a cream medallion, gold
// number badge, tip landing exactly on the shop's coordinates.
function shopPinSvg(n: number) {
  return `<svg viewBox="0 0 34 47" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle class="pin-pulse-ring" cx="17" cy="17" r="14" fill="none" stroke="#D4AF37" stroke-width="2"/><path d="M17 41C12 35 4 28 4 17A13 13 0 1 1 30 17C30 28 22 35 17 41Z" fill="#1C1A15" stroke="#D4AF37" stroke-width="2"/><circle cx="17" cy="17" r="11.5" fill="#FFFDF6"/><g transform="translate(5.8,5.8) scale(0.7)">${SHOP_GLYPH}</g><circle cx="27.5" cy="7" r="6.5" fill="#D4AF37" stroke="#1C1A15" stroke-width="1.5"/><text x="27.5" y="10.2" text-anchor="middle" font-family="Arial, sans-serif" font-size="9.5" font-weight="800" fill="#1C1A15">${n}</text></svg>`;
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

export default function BranchMap({
  branches,
  selectedId,
  onSelect,
}: {
  branches: Branch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
    : [39.28954, -76.5933];

  if (!hasBranches) return null;

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
        {/* Satellite-only tiles (owner request): imagery + free Esri labels overlay.
            Retina tiles disabled: on high-DPI phones they load 4x the tiles and
            feel heavy — standard tiles keep the map fast. */}
        <TileLayer url={SAT_URL} attribution={SAT_ATTR} maxZoom={18} maxNativeZoom={18} eventHandlers={tileEvents} />
        <TileLayer url={LABELS_URL} maxZoom={18} maxNativeZoom={18} opacity={1} />
        <FitBounds branches={branches} />
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
