import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mrc.barbershop',
  appName: 'MRC Barbershop',
  webDir: 'public',
  backgroundColor: '#faf6ea',
  server: {
    url: 'https://mrc-barbershop-mrc-0043.vercel.app/customer',
    cleartext: false,
    // Refresh-in-place (owner, 2026-11-09): see capacitor.config.barber.ts —
    // allow both production hosts so no same-host navigation or reload is
    // ever handed to Safari by Capacitor's navigation policy.
    allowNavigation: ['mrc-barbershop-mrc-0043.vercel.app', 'mrc-barbershop.vercel.app'],
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
