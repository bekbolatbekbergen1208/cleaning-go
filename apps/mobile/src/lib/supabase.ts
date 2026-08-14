import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Заполните EXPO_PUBLIC_SUPABASE_URL и EXPO_PUBLIC_SUPABASE_ANON_KEY');

const serverStorage = {
  getItem: async (_key: string) => null,
  setItem: async (_key: string, _value: string) => undefined,
  removeItem: async (_key: string) => undefined,
};
const authStorage = Platform.OS === 'web' && typeof window === 'undefined' ? serverStorage : AsyncStorage;

export const supabase = createClient(url, key, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
if (Platform.OS !== 'web') AppState.addEventListener('change', (state) => state === 'active' ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh());
