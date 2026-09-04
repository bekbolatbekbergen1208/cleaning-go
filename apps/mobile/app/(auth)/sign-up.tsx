import { Button, Card, Field, Screen, Title, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import { registrationSchema } from '@cleaning-go/validation';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

type Role = 'client' | 'cleaner' | 'company_owner';
type Feedback = { kind: 'success' | 'error'; title: string; body: string };

function registrationError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('email rate limit')) return 'Supabase временно ограничил отправку писем. Подождите около часа и попробуйте снова либо подключите SMTP в настройках Supabase.';
  if (normalized.includes('already registered')) return 'Этот email уже зарегистрирован. Перейдите на страницу входа.';
  if (normalized.includes('invalid') && normalized.includes('email')) return 'Введите настоящий действующий email.';
  if (normalized.includes('database error')) return 'Ошибка создания профиля в базе. Попробуйте снова или обратитесь к администратору.';
  return message;
}

export default function SignUp() {
  const router = useRouter();
  const setProfile = useSessionStore((state) => state.setProfile);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hasCode, setHasCode] = useState<boolean | null>(null);
  const [referralCode, setReferralCode] = useState('');
  const [role, setRole] = useState<Role>('client');
  const [companyName, setCompanyName] = useState('');
  const [companyBin, setCompanyBin] = useState('');
  const [companyCity, setCompanyCity] = useState('Актау');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const cleanerCodeRequired = false;
  const isCompany = role === 'company_owner';

  function showFeedback(kind: Feedback['kind'], title: string, body: string) {
    setFeedback({ kind, title, body });
    if (kind === 'error') Alert.alert(title, body);
  }

  function chooseRole(value: Role) {
    setRole(value);
    setFeedback(null);
    if (value === 'cleaner') {
      setHasCode(false);
      setReferralCode('');
    }
    if (value === 'company_owner') {
      setHasCode(false);
      setReferralCode('');
    }
  }

  async function submit() {
    setFeedback(null);

    if (cleanerCodeRequired && !referralCode.trim()) {
      showFeedback('error', 'Код обязателен для клинера', 'Введите специальный код, полученный от компании или Cleaning Go.');
      return;
    }
    if (!isCompany && !cleanerCodeRequired && hasCode && !referralCode.trim()) {
      showFeedback('error', 'Введите код', 'Укажите код компании или пригласившего пользователя.');
      return;
    }
    if (isCompany && (!companyName.trim() || !companyBin.trim() || !companyCity.trim() || !companyAddress.trim() || !companyPhone.trim())) {
      showFeedback('error', 'Заполните данные компании', 'Название, БИН, город, адрес и телефон обязательны.');
      return;
    }

    const useCode = !isCompany && (cleanerCodeRequired || hasCode === true);
    const parsed = registrationSchema.safeParse({
      email: email.trim(),
      password,
      fullName: name.trim(),
      role,
      referralCode: useCode ? referralCode.trim().toUpperCase() : undefined,
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    if (!parsed.success) {
      showFeedback('error', 'Проверьте данные', parsed.error.issues[0]?.message ?? 'Проверьте заполненные поля.');
      return;
    }

    setBusy(true);
    try {
      if (process.env.EXPO_PUBLIC_DEMO_MODE === 'true') {
        setProfile({
          id: 'demo-client',
          role,
          full_name: name.trim(),
          phone: companyPhone || null,
          email: email.trim(),
          avatar_url: null,
          city: companyCity || 'Актау',
          referral_code: 'CLG-DEMO25',
        });
        router.replace('/(tabs)');
        return;
      }

      const registrationApi = process.env.EXPO_PUBLIC_REGISTRATION_API_URL ?? 'http://127.0.0.1:3000/api/register';
      const response = await fetch(registrationApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          full_name: name.trim(),
          role,
          referral_code: useCode ? referralCode.trim().toUpperCase() : undefined,
          company_name: companyName.trim() || undefined,
          company_registration_number: companyBin.trim() || undefined,
          company_city: companyCity.trim() || undefined,
          company_address: companyAddress.trim() || undefined,
          company_phone: companyPhone.trim() || undefined,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          const { data: existingLogin, error: existingLoginError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
          if (!existingLoginError && existingLogin.session) {
            showFeedback('success', isCompany ? 'Компания уже создана' : 'Аккаунт уже создан', 'Открываем ваш кабинет…');
            router.replace('/(tabs)');
            return;
          }
        }
        showFeedback('error', isCompany ? 'Не удалось создать компанию' : 'Не удалось создать аккаунт', registrationError(result.error ?? 'Ошибка регистрации.'));
        return;
      }
      const { data: login, error: loginFailure } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (loginFailure || !login.session) {
        showFeedback('error', 'Аккаунт создан', 'Автоматический вход не выполнен. Обновите страницу и попробуйте войти.');
        return;
      }
      showFeedback('success', isCompany ? 'Компания создана' : 'Аккаунт создан', 'Открываем ваш кабинет…');
      router.replace('/(tabs)');
    } catch (error) {
      showFeedback(
        'error',
        'Нет соединения с сервером',
        error instanceof Error ? error.message : 'Попробуйте ещё раз через несколько секунд.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={x.header}>
        <View style={x.step}><Text style={x.stepText}>ШАГ 1 ИЗ 2</Text></View>
        <Title subtitle="Создайте профиль — это займёт меньше минуты">Добро пожаловать в Cleaning Go</Title>
      </View>

      <Card>
        <Field label="Ваше имя" value={name} onChangeText={setName} placeholder="Например, Айдана" />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="name@example.com" autoCapitalize="none" keyboardType="email-address" />
        <Field label="Пароль" value={password} onChangeText={setPassword} placeholder="Минимум 8 символов" secureTextEntry />
        <Text style={s.label}>Кто вы?</Text>
        <View style={x.roles}>
          {([
            ['client', 'Клиент', 'Заказать уборку'],
            ['cleaner', 'Клинер', 'Брать заказы в сообществе'],
            ['company_owner', 'Компания', 'Вести клиентов и заказы'],
          ] as const).map(([value, label, description]) => (
            <Pressable key={value} onPress={() => chooseRole(value)} style={[x.role, role === value && x.roleActive]}>
              <Text style={[x.roleTitle, role === value && x.roleTitleActive]}>{label}</Text>
              <Text style={x.roleDesc}>{description}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {isCompany ? (
        <Card>
          <View>
            <Text style={x.codeTitle}>Создайте свою компанию</Text>
            <Text style={s.muted}>Компания и её уникальный промокод создаются сразу. Бонус клиентам по умолчанию — 5%.</Text>
          </View>
          <Field label="Название компании *" value={companyName} onChangeText={setCompanyName} placeholder="Например, Aqtau Clean" />
          <Field label="БИН или регистрационный номер *" value={companyBin} onChangeText={setCompanyBin} placeholder="12 цифр" keyboardType="number-pad" />
          <Field label="Город обслуживания *" value={companyCity} onChangeText={setCompanyCity} placeholder="Актау" />
          <Field label="Адрес компании *" value={companyAddress} onChangeText={setCompanyAddress} placeholder="Микрорайон, дом, офис" />
          <Field label="Контактный телефон *" value={companyPhone} onChangeText={setCompanyPhone} placeholder="+7 700 000 00 00" keyboardType="phone-pad" />
          <View style={x.pending}><Text style={x.pendingText}>Компания создаётся сразу. До проверки будет ограничен только приём заказов.</Text></View>
        </Card>
      ) : null}

      {!isCompany && role === 'client' ? <Card>
        <View>
          <Text style={x.codeTitle}>{cleanerCodeRequired ? 'Введите специальный код' : 'У вас есть специальный код?'}</Text>
          <Text style={s.muted}>
            {cleanerCodeRequired
              ? 'Для регистрации клинера код обязателен. Получите его у компании или администратора Cleaning Go.'
              : 'Для клиента код необязательный. Промокод компании даёт её бонус после завершённого заказа.'}
          </Text>
        </View>
        {!cleanerCodeRequired ? (
          <View style={x.answerRow}>
            <Pressable onPress={() => setHasCode(true)} style={[x.answer, hasCode === true && x.answerActive]}>
              <Text style={[x.answerText, hasCode === true && x.answerTextActive]}>Да, есть код</Text>
            </Pressable>
            <Pressable onPress={() => { setHasCode(false); setReferralCode(''); }} style={[x.answer, hasCode === false && x.answerActive]}>
              <Text style={[x.answerText, hasCode === false && x.answerTextActive]}>Нет кода</Text>
            </Pressable>
          </View>
        ) : null}
        {cleanerCodeRequired || hasCode ? (
          <View style={x.codeBox}>
            <Field label={cleanerCodeRequired ? 'Код клинера *' : 'Специальный код'} value={referralCode} onChangeText={setReferralCode} placeholder="Например, CGC-COMPANY25" autoCapitalize="characters" />
            <Text style={x.hint}>{cleanerCodeRequired ? 'Без действующего кода регистрация клинера невозможна.' : 'Код можно получить у клининговой компании или пригласившего пользователя.'}</Text>
          </View>
        ) : null}
      </Card> : null}

      {feedback ? (
        <View style={[x.feedback, feedback.kind === 'success' ? x.feedbackSuccess : x.feedbackError]}>
          <Text style={x.feedbackTitle}>{feedback.title}</Text>
          <Text style={x.feedbackBody}>{feedback.body}</Text>
          {feedback.kind === 'success' ? <Button title="Перейти ко входу" variant="secondary" onPress={() => router.replace('/(auth)/sign-in')} /> : null}
        </View>
      ) : null}

      <Text style={s.muted}>Продолжая, вы принимаете пользовательское соглашение и политику конфиденциальности.</Text>
      <Button title={isCompany ? 'Создать компанию' : 'Создать аккаунт'} busy={busy} onPress={() => void submit()} />
      <Pressable onPress={() => router.push('/(auth)/sign-in')}>
        <Text style={x.login}>Уже зарегистрированы? <Text style={x.loginStrong}>Войти</Text></Text>
      </Pressable>
    </Screen>
  );
}

const x = StyleSheet.create({
  header: { gap: 8 },
  step: { alignSelf: 'flex-start', backgroundColor: '#DFF6F0', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  stepText: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#087562' },
  roles: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  role: { flexGrow: 1, minWidth: 105, borderWidth: 1.5, borderColor: '#DCEAE6', borderRadius: 15, padding: 12, gap: 3, backgroundColor: '#FAFCFB' },
  roleActive: { borderColor: '#0B967C', backgroundColor: '#E9F8F4' },
  roleTitle: { fontWeight: '800', color: '#36554E' },
  roleTitleActive: { color: '#087562' },
  roleDesc: { fontSize: 11, color: '#7A8E89' },
  codeTitle: { fontSize: 19, fontWeight: '900', color: '#173F37', marginBottom: 4 },
  answerRow: { flexDirection: 'row', gap: 9 },
  answer: { flex: 1, minHeight: 46, borderRadius: 13, borderWidth: 1.5, borderColor: '#D7E7E2', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFCFB' },
  answerActive: { backgroundColor: '#0B967C', borderColor: '#0B967C' },
  answerText: { fontWeight: '800', color: '#506B64' },
  answerTextActive: { color: 'white' },
  codeBox: { gap: 8, backgroundColor: '#F4FAF8', padding: 14, borderRadius: 15 },
  hint: { fontSize: 11, lineHeight: 16, color: '#71857F' },
  pending: { backgroundColor: '#FFF8DF', borderRadius: 13, padding: 12, borderWidth: 1, borderColor: '#F2DE93' },
  pendingText: { fontSize: 12, fontWeight: '700', color: '#715D16' },
  feedback: { gap: 7, borderRadius: 16, padding: 16, borderWidth: 1 },
  feedbackSuccess: { backgroundColor: '#E9F8F4', borderColor: '#91D3C4' },
  feedbackError: { backgroundColor: '#FDEEEE', borderColor: '#F1BBBB' },
  feedbackTitle: { fontSize: 17, fontWeight: '900', color: '#173F37' },
  feedbackBody: { color: '#506B64', lineHeight: 20 },
  login: { textAlign: 'center', color: '#6D827C', padding: 8 },
  loginStrong: { fontWeight: '900', color: '#087562' },
});
