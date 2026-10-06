import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 24, ...props }: P, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ScissorsIcon(p: P) {
  return base(p, <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </>);
}

export function PoleIcon(p: P) {
  return base(p, <>
    <rect x="9" y="2" width="6" height="20" rx="3" />
    <line x1="9" y1="7" x2="15" y2="4.5" />
    <line x1="9" y1="12" x2="15" y2="9.5" />
    <line x1="9" y1="17" x2="15" y2="14.5" />
  </>);
}

export function KeyIcon(p: P) {
  return base(p, <>
    <circle cx="8" cy="15" r="4.5" />
    <line x1="11.5" y1="11.5" x2="20" y2="3" />
    <line x1="16" y1="7" x2="18.5" y2="9.5" />
  </>);
}

export function MapPinIcon(p: P) {
  return base(p, <>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </>);
}

export function ArrowRightIcon(p: P) {
  return base(p, <>
    <line x1="4" y1="12" x2="20" y2="12" />
    <polyline points="13 5 20 12 13 19" />
  </>);
}

export function ArrowLeftIcon(p: P) {
  return base(p, <>
    <line x1="20" y1="12" x2="4" y2="12" />
    <polyline points="11 5 4 12 11 19" />
  </>);
}

export function CalendarIcon(p: P) {
  return base(p, <>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </>);
}

export function ClockIcon(p: P) {
  return base(p, <>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 13.5" />
  </>);
}

export function PhoneIcon(p: P) {
  return base(p, <>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z" />
  </>);
}

export function UserIcon(p: P) {
  return base(p, <>
    <path d="M20 21a8 8 0 0 0-16 0" />
    <circle cx="12" cy="8" r="4" />
  </>);
}

export function CheckIcon(p: P) {
  return base(p, <polyline points="20 6 9 17 4 12" />);
}

export function CheckSealIcon(p: P) {
  return (
    <svg width={p.size ?? 24} height={p.size ?? 24} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <circle cx="12" cy="12" r="10" fill="url(#sealGold)" />
      <path d="m8 12.5 2.7 2.7L16 9.5" stroke="#0b0b0d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <defs>
        <linearGradient id="sealGold" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="#f6e27a" />
          <stop offset="0.55" stopColor="#d4af37" />
          <stop offset="1" stopColor="#9c7c1e" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function NavigationIcon(p: P) {
  return base(p, <polygon points="3 11 22 2 13 21 11 13 3 11" />);
}

export function PlusIcon(p: P) {
  return base(p, <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>);
}

export function PencilIcon(p: P) {
  return base(p, <>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </>);
}

export function TrashIcon(p: P) {
  return base(p, <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>);
}

export function LogOutIcon(p: P) {
  return base(p, <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>);
}

export function LockIcon(p: P) {
  return base(p, <>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>);
}

export function GearIcon(p: P) {
  return base(p, <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>);
}

export function QrIcon(p: P) {
  return base(p, <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M14 14h3v3h-3z" />
    <path d="M21 14v7" />
    <path d="M14 21h4" />
  </>);
}

export function ScanIcon(p: P) {
  return base(p, <>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </>);
}

export function StarIcon({ size = 16, filled = true, ...props }: P & { filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...props}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function CameraIcon(p: P) {
  return base(p, <>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </>);
}

export function ShareIcon(p: P) {
  return base(p, <>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </>);
}

export function PrintIcon(p: P) {
  return base(p, <>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </>);
}

export function ReceiptIcon(p: P) {
  return base(p, <>
    <path d="M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5z" />
    <line x1="8" y1="7" x2="16" y2="7" />
    <line x1="8" y1="11" x2="16" y2="11" />
    <line x1="8" y1="15" x2="13" y2="15" />
  </>);
}
