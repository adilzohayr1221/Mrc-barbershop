import type { NextConfig } from "next";

// Audit L1 (2026-10-29): baseline security headers on every response.
// Deliberately minimal — a full Content-Security-Policy risks breaking the
// app (Stripe.js, maps, inline PWA assets), so CSP is limited to
// frame-ancestors, which restricts embedding without touching resources.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
