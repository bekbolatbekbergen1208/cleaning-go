import '@/lib/background-location';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import type { Session } from '@cleaning-go/local-client';
import { backend } from '@/lib/backend';
import { useSessionStore } from '@/store/session';
import { Button, Card, Screen, Title } from '@/components/ui';

const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { session, loading, setSession, setProfile, setLoading } =
    useSessionStore();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (demoMode) {
      setLoading(false);
      return;
    }
    let disposed = false,
      generation = 0;
    async function applySession(next: Session | null) {
      const current = ++generation;
      if (!next) {
        if (!disposed) {
          setSession(null);
          setProfile(null);
          setError('');
          setLoading(false);
        }
        return;
      }
      const result = await backend
        .from('profiles')
        .select('*')
        .eq('id', next.user.id)
        .single();
      if (disposed || current !== generation) return;
      if (result.error) {
        setError(result.error.message);
        setLoading(false);
        return;
      }
      setSession(next);
      setProfile(result.data);
      setError('');
      setLoading(false);
    }
    async function restore() {
      const result = await backend.auth.getSession();
      if (disposed) return;
      if (result.error) {
        setError(
          'Не удалось подключиться к серверу. Проверьте Wi-Fi и запуск сервера.',
        );
        setLoading(false);
        return;
      }
      await applySession(result.data.session);
    }
    setLoading(true);
    void restore();
    const { data } = backend.auth.onAuthStateChange((_event, next) => {
      void applySession(next);
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void restore();
    });
    return () => {
      disposed = true;
      generation++;
      data.subscription.unsubscribe();
      appState.remove();
    };
  }, [attempt, setLoading, setSession, setProfile]);
  useEffect(() => {
    if (loading || error || demoMode) return;
    const inAuth = segments[0] === '(auth)';
    const recovery = segments.join('/') === 'reset-password';
    if (!session && !inAuth && !recovery) router.replace('/(auth)/welcome');
    if (session && inAuth) router.replace('/(tabs)');
  }, [session, loading, error, segments, router]);
  if (loading)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  if (error)
    return (
      <Screen>
        <Title>Нет подключения</Title>
        <Card>
          <Text>{error}</Text>
          <Button
            title="Повторить"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </Card>
      </Screen>
    );
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="order/[id]"
        options={{ headerShown: true, title: 'Заказ' }}
      />
      <Stack.Screen
        name="create-order"
        options={{ headerShown: true, title: 'Новый заказ' }}
      />
      <Stack.Screen
        name="select-company"
        options={{ headerShown: true, title: 'Выбор компании' }}
      />
      <Stack.Screen
        name="reset-password"
        options={{ headerShown: true, title: 'Восстановление доступа' }}
      />
    </Stack>
  );
}
