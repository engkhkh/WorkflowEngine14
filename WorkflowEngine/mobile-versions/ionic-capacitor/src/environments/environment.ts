export const environment = {
  production: false,
  // Android emulator can't reach the host machine via "localhost" - it maps to the emulator
  // itself. Use 10.0.2.2 (Android emulator's alias for the host) or your machine's real LAN
  // IP for a physical device. iOS Simulator can use localhost fine.
  apiBaseUrl: 'http://localhost:5000/api'
};
