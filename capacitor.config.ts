import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mrc.barbershop',
  appName: 'MRC Barbershop',
  webDir: 'public',
  server: {
    url: 'https://mrc-barbershop-mrc-0043.vercel.app/customer',
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
