import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.abstechnologies.cloud',
  appName: 'ABS Cloud',
  webDir: 'build',
  server: {
    // Load from live website — app auto-updates on every cPanel deploy
    url: 'https://cloud.abstechnologies.co.in',
    androidScheme: 'https',
    cleartext: true,
  }
};

export default config;
