import type { CapacitorConfig } from '@capacitor/cli';

// appId is reverse-DNS style and becomes your Xcode/Android Studio bundle identifier once you
// generate the native projects - change "com.yourcompany" before your first real build.
const config: CapacitorConfig = {
  appId: 'com.yourcompany.workflowengine',
  appName: 'WorkflowEngine',
  webDir: 'www',
  server: {
    // Uncomment during development to live-reload on a physical device straight from
    // `ng serve` instead of the bundled build. Use your machine's LAN IP, not localhost -
    // the device can't reach your computer's localhost.
    // url: 'http://192.168.1.50:4400',
    // cleartext: true
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
