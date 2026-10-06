'use client';

import { useEffect, useState } from 'react';
import { NavigationIcon } from '@/components/Icons';

function isAppleDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ in desktop mode reports as MacIntel — touch points give it away.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * Directions link that opens the device's own map app:
 * Apple Maps on iPhone/iPad, Google Maps on Android (Samsung, …)
 * and on everything else. Free — no map API keys needed.
 */
export function directionsUrl(lat: number, lng: number): string {
  if (isAppleDevice()) return `https://maps.apple.com/?daddr=${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export default function DirectionsButton({
  lat,
  lng,
  className,
  iconSize = 16,
}: {
  lat: number;
  lng: number;
  className?: string;
  iconSize?: number;
}) {
  // Compute after mount so SSR and the first client render match (no hydration mismatch).
  const [url, setUrl] = useState(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
  useEffect(() => {
    setUrl(directionsUrl(lat, lng));
  }, [lat, lng]);
  return (
    <a className={className} href={url} target="_blank" rel="noreferrer">
      <NavigationIcon size={iconSize} /> Directions
    </a>
  );
}
