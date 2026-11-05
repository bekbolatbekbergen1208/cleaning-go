import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createClient,
  resolveMobileEndpoints,
  SESSION_COOKIE,
} from '@cleaning-go/local-client';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const endpoints = resolveMobileEndpoints({
  apiUrl: process.env.EXPO_PUBLIC_LOCAL_API_URL,
  registrationUrl: process.env.EXPO_PUBLIC_REGISTRATION_API_URL,
  hostUri: Constants.expoConfig?.hostUri,
  webOrigin:
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : undefined,
  isDevelopment: __DEV__,
});
const serverStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};
const nativeStorage = {
  async getItem(key: string) {
    const secure = await SecureStore.getItemAsync(key);
    if (secure) return secure;
    const legacy = await AsyncStorage.getItem(key);
    if (legacy) {
      await SecureStore.setItemAsync(key, legacy);
      await AsyncStorage.removeItem(key);
    }
    return legacy;
  },
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  async removeItem(key: string) {
    await SecureStore.deleteItemAsync(key);
    await AsyncStorage.removeItem(key);
  },
};
const storage =
  Platform.OS === 'web'
    ? typeof window === 'undefined'
      ? serverStorage
      : AsyncStorage
    : nativeStorage;
export const backend = createClient(endpoints.apiUrl, '', {
  auth: { storage },
});
export async function clearStoredSession() {
  await storage.removeItem(SESSION_COOKIE);
}
