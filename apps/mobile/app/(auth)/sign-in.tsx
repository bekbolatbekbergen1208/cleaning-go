import { Button, Card, Field, Screen, Title, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

type Feedback = { kind: 'success' | 'error'; title: string; body: string };

function loginError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'Неверный email или пароль.';
  if (normalized.includes('email not confirmed')) return 'Сначала подтвердите email по ссылке из письма.';
  if (normalized.includes('rate limit')) return 'Слишком много попыток. Подождите немного и попробуйте снова.';
  return message;
}

const LOGIN_TIMEOUT_MS = 15_000;

async function signInWithTimeout(email: string, password: string) {
  return Promise.race([
    supabase.auth.signInWithPassword({ email, password }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Сервер не ответил вовремя. Проверьте интернет и попробуйте снова.')), LOGIN_TIMEOUT_MS),
    ),
  ]);
}

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function submit() {
    setFeedback(null);
    if (!email.trim() || !password) {
      setFeedback({ kind: 'error', title: 'Заполните данные', body: 'Введите email и пароль.' });
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await signInWithTimeout(email.trim().toLowerCase(), password);
      if (error) {
        const next = { kind: 'error' as const, title: 'Не удалось войти', body: loginError(error.message) };
        setFeedback(next);
        Alert.alert(next.title, next.body);
        return;
      }
      if (!data.session) {
        const next = { kind: 'error' as const, title: 'Не удалось войти', body: 'Сессия не создана. Попробуйте ещё раз.' };
        setFeedback(next);
        Alert.alert(next.title, next.body);
        return;
      }
      setFeedback({ kind: 'success', title: 'Вход выполнен', body: 'Открываем ваш кабинет…' });
      router.replace('/(tabs)');
    } catch (error) {
      const next = {
        kind: 'error',
        title: 'Нет соединения с сервером',
        body: error instanceof Error ? error.message : 'Попробуйте ещё раз через несколько секунд.',
      } as const;
      setFeedback(next);
      Alert.alert(next.title, next.body);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setFeedback({ kind: 'error', title: 'Введите email', body: 'Укажите email, на который отправить ссылку восстановления.' });
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    const next = error
      ? { kind: 'error' as const, title: 'Ошибка', body: error.message }
      : { kind: 'success' as const, title: 'Письмо отправлено', body: 'Проверьте почту и перейдите по ссылке восстановления.' };
    setFeedback(next);
    if (error) Alert.alert(next.title, next.body);
  }

  return (
    <Screen>
      <Title subtitle="Введите email и пароль">Вход</Title>
      <Card>
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="name@example.com" />
        <Field label="Пароль" value={password} onChangeText={setPassword} secureTextEntry placeholder="Ваш пароль" />
        <Button title="Войти" busy={busy} onPress={() => void submit()} />
      </Card>
      {feedback ? (
        <View style={[x.feedback, feedback.kind === 'success' ? x.success : x.error]}>
          <Text style={x.feedbackTitle}>{feedback.title}</Text>
          <Text style={s.muted}>{feedback.body}</Text>
        </View>
      ) : null}
      <Button title="Восстановить доступ" variant="secondary" onPress={() => void resetPassword()} />
    </Screen>
  );
}

const x = StyleSheet.create({
  feedback: { padding: 16, borderRadius: 15, borderWidth: 1, gap: 5 },
  success: { backgroundColor: '#E9F8F4', borderColor: '#91D3C4' },
  error: { backgroundColor: '#FDEEEE', borderColor: '#F1BBBB' },
  feedbackTitle: { color: '#173F37', fontSize: 17, fontWeight: '900' },
});
