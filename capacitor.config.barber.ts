import type { CapacitorConfig } from '@capacitor/cli';

// MRC Barber — the separate barbers' app (owner's decision, 2026-11-08).
// Same codebase and Apple Developer account as the customer app, but its
// own bundle ID (com.mrc.barber), its own name/icon/listing, and it opens
// on the barber side only: the shell loads /barber-app, which runs the
// deep guided tour and the public shop face before any barber login.
// The ios-barber-release Codemagic workflow copies this file over
// capacitor.config.ts before `cap sync`.
const config: CapacitorConfig = {
  appId: 'com.mrc.barber',
  appName: 'MRC Barber',
  webDir: 'public',
  backgroundColor: '#faf6ea',
  server: {
    url: 'https://mrc-barbershop-mrc-0043.vercel.app/barber-app',
    cleartext: false,
  },
  ios: {
    contentInset: 'automatic',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#faf6ea',
    },
    StatusBar: {
      style: 'light',
    },
  },
};

export default config;
