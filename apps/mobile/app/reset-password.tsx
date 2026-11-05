import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Field, Screen, Title } from '@/components/ui';
import { backend } from '@/lib/backend';
export default function ResetPassword() {
  const { token_hash } = useLocalSearchParams<{ token_hash?: string }>();
  const router = useRouter();
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState('');
  const verified = useRef<string | null>(null);
  useEffect(() => {
    if (!token_hash || verified.current === token_hash) return;
    verified.current = token_hash;
    void backend.auth
      .verifyOtp({ token_hash, type: 'recovery' })
      .then(({ error }) => {
        if (error) setError(error.message);
        else setReady(true);
      });
  }, [token_hash]);
  async function save() {
    if (password.length < 8 || password !== confirm) {
      setError('Введите одинаковые пароли длиной не менее 8 символов.');
      return;
    }
    setBusy(true);
    const { error } = await backend.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else router.replace('/(tabs)');
  }
  return (
    <Screen>
      <Title>Новый пароль</Title>
      <Card>
        {ready ? (
          <>
            <Field
              label="Пароль"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <Field
              label="Повторите пароль"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
            />
            <Button title="Сохранить" busy={busy} onPress={() => void save()} />
          </>
        ) : (
          <Text>
            {token_hash
              ? 'Проверяем ссылку…'
              : 'Откройте ссылку восстановления доступа.'}
          </Text>
        )}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      </Card>
    </Screen>
  );
}
