import Constants from 'expo-constants';

// While developing, Expo knows the computer's LAN address (the machine running `expo start`),
// and the backend runs on that same machine, port 4000. Override with EXPO_PUBLIC_API_URL if needed.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0];

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || (devHost ? `http://${devHost}:4000` : 'http://localhost:4000');
