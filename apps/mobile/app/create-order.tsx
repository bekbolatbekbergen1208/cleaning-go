import { Button, Card, Field, Screen, Title, formatMoney, s } from '@/components/ui';
import { demoServices } from '@/lib/demo';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session';
import type { Order } from '@cleaning-go/types';
import { orderDraftSchema } from '@cleaning-go/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import { z } from 'zod';

type Service = { id: string; name: string; base_price_minor: number };
type Company = { id: string; name: string; rating: number; reviews_count: number; cashback_bps: number };
type Form = z.infer<typeof orderDraftSchema>;
type RoomPhoto = { uri: string; mimeType: string };

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function CreateOrder() {
  const router = useRouter();
  const profile = useSessionStore((state) => state.profile);
  const addDemoOrder = useSessionStore((state) => state.addDemoOrder);
  const demo = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
  const initial = demoServices[0]!;
  const [services, setServices] = useState<Service[]>(demo ? demoServices : []);
  const [service, setService] = useState<Service | undefined>(demo ? initial : undefined);
  const [company, setCompany] = useState<Company | null>(demo ? { id: 'demo-company', name: 'Cleaning Go Demo', rating: 4.9, reviews_count: 128, cashback_bps: 500 } : null);
  const [companyLoading, setCompanyLoading] = useState(!demo);
  const [companyLocked, setCompanyLocked] = useState(false);
  const [companyBonusMinor, setCompanyBonusMinor] = useState(demo ? 200000 : 0);
  const [city, setCity] = useState('Актау');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<RoomPhoto | null>(null);
  const [scheduledDate, setScheduledDate] = useState(() => dateInputValue(new Date(Date.now() + 86400000)));
  const [scheduledTime, setScheduledTime] = useState('10:00');
  const { control, handleSubmit, setValue, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(orderDraftSchema),
    defaultValues: {
      serviceId: demo ? initial.id : '00000000-0000-0000-0000-000000000000',
      addressId: '00000000-0000-0000-0000-000000000000',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      areaSqM: 50,
      roomsCount: 2,
      executorPreference: 'company',
      paymentMethod: 'cash',
      optionIds: [],
    },
  });

  useEffect(() => {
    if (demo || !profile?.id) return;
    void Promise.all([
      supabase.from('cleaning_services').select('id,name,base_price_minor').eq('is_active', true).order('sort_order'),
      supabase.from('client_profiles').select('preferred_company_id,company_locked,company_profiles!preferred_company_id(id,name,rating,reviews_count,cashback_bps)').eq('user_id', profile.id).single(),
    ]).then(([servicesResult, companyResult]) => {
      if (servicesResult.data?.[0]) {
        setServices(servicesResult.data);
        setService(servicesResult.data[0]);
        setValue('serviceId', servicesResult.data[0].id);
      }
      const joined = companyResult.data?.company_profiles;
      const selectedCompany = (Array.isArray(joined) ? joined[0] : joined) as Company | null;
      setCompany(selectedCompany ?? null);
      setCompanyLocked(Boolean(companyResult.data?.company_locked));
      setCompanyLoading(false);
      if (selectedCompany) void supabase.from('company_bonus_balances').select('balance_minor').eq('client_id', profile.id).eq('company_id', selectedCompany.id).maybeSingle().then(({data})=>setCompanyBonusMinor(Number(data?.balance_minor??0)));
    });
  }, [demo, profile?.id, setValue]);

  async function takePhoto() {
    try {
      const ImagePicker = await import('expo-image-picker');
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return Alert.alert('Нужен доступ к камере', 'Разрешите доступ, чтобы сфотографировать помещение для компании.');
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75, allowsEditing: false });
      const asset = result.assets?.[0];
      if (!result.canceled && asset) setPhoto({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
    } catch {
      Alert.alert('Камера недоступна', 'Обновите страницу и разрешите браузеру доступ к камере.');
    }
  }

  async function submit(values: Form) {
    if (!company) return router.push('/select-company');
    if (!photo) return Alert.alert('Добавьте фотографию', 'Сфотографируйте помещение перед отправкой заказа.');
    if (!address.trim()) return Alert.alert('Укажите адрес');
    if (!service) return Alert.alert('Выберите услугу');
    const scheduled = new Date(`${scheduledDate}T${scheduledTime}:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !/^\d{2}:\d{2}$/.test(scheduledTime) || Number.isNaN(scheduled.getTime())) {
      return Alert.alert('Проверьте дату и время', 'Используйте формат даты ГГГГ-ММ-ДД и времени ЧЧ:ММ.');
    }
    if (scheduled <= new Date()) return Alert.alert('Выберите будущее время', 'Дата и время уборки должны быть позже текущего момента.');
    const scheduledAt = scheduled.toISOString();
    setBusy(true);
    if (demo) {
      const now = Date.now();
      const order: Order = {
        id: `demo-order-${now}`,
        order_number: `DEMO-${String(now).slice(-6)}`,
        client_id: profile?.id ?? 'demo-client',
        service_id: service.id,
        city,
        address_text: address,
        scheduled_at: scheduledAt,
        area_sq_m: values.areaSqM,
        rooms_count: values.roomsCount,
        status: 'searching',
        total_minor: 0,
        platform_fee_minor: 0,
        referral_reward_minor: 0,
        executor_amount_minor: 0,
        payment_method: values.paymentMethod,
        payment_status: 'pending',
      };
      addDemoOrder(order);
      setBusy(false);
      Alert.alert('Заказ создан', `Заказ отправлен компании «${company.name}».`);
      router.replace(`/order/${order.id}`);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return Alert.alert('Нужно войти', 'Войдите в аккаунт и повторите заказ.');
    }
    const photoResponse = await fetch(photo.uri);
    const photoBlob = await photoResponse.blob();
    const photoPath = `${user.id}/${Date.now()}.jpg`;
    const { error: photoError } = await supabase.storage.from('order-photos').upload(photoPath, photoBlob, { contentType: photo.mimeType, upsert: false });
    if (photoError) {
      setBusy(false);
      return Alert.alert('Не удалось загрузить фото', photoError.message);
    }
    const { data: savedAddress, error: addressError } = await supabase
      .from('addresses')
      .insert({ user_id: user.id, label: 'Заказ', city, address_line: address })
      .select('id')
      .single();
    if (addressError) {
      setBusy(false);
      return Alert.alert('Ошибка адреса', addressError.message);
    }
    const { data, error } = await supabase.rpc('create_order', {
      payload: {
        address_id: savedAddress.id,
        service_id: service.id,
        selected_company_id: company.id,
        scheduled_at: scheduledAt,
        area_sq_m: values.areaSqM,
        rooms_count: values.roomsCount,
        comment: values.comment,
        executor_preference: 'company',
        payment_method: values.paymentMethod,
        option_ids: values.optionIds,
        photo_urls: [photoPath],
      },
    });
    setBusy(false);
    if (error) Alert.alert('Не удалось создать заказ', error.message);
    else router.replace(`/order/${data.id}`);
  }

  return (
    <Screen>
      <Title subtitle="Цена подтвердится до принятия заказа">Новый заказ</Title>
      {companyLoading ? <Text style={s.muted}>Проверяем выбранную компанию…</Text> : company ? (
        <Card>
          <Text style={s.muted}>Заказ получит компания</Text>
          <Text style={s.cardTitle}>{company.name}</Text>
          <Text>★ {Number(company.rating).toFixed(1)} · {company.reviews_count} отзывов</Text>
          <Text style={s.badge}>Кешбэк за каждый завершённый заказ: {company.cashback_bps / 100}%</Text>
          {companyBonusMinor>0 ? <Text style={s.badge}>Бонус этой компании: {formatMoney(companyBonusMinor)}. Он спишется автоматически.</Text> : null}
          {companyLocked
            ? <Text style={s.muted}>Компания закреплена кодом. Другие компании недоступны.</Text>
            : <Button title="Выбрать другую компанию" variant="secondary" onPress={() => router.push('/select-company')} />}
        </Card>
      ) : (
        <Card>
          <Text style={s.cardTitle}>Сначала выберите компанию</Text>
          <Text style={s.muted}>У вас не было кода компании при регистрации.</Text>
          <Button title="Посмотреть компании и оценки" onPress={() => router.push('/select-company')} />
        </Card>
      )}
      <Text style={s.label}>Вид уборки</Text>
      <View style={{ gap: 8 }}>
        {services.map((item) => (
          <Pressable key={item.id} onPress={() => { setService(item); setValue('serviceId', item.id); }}>
            <Card>
              <Text style={s.cardTitle}>{item.name}</Text>
              <Text style={s.muted}>Цена будет предложена компанией</Text>
              {service?.id === item.id ? <Text style={s.badge}>Выбрано</Text> : null}
            </Card>
          </Pressable>
        ))}
      </View>
      <Field label="Город" value={city} onChangeText={setCity} />
      <Field label="Адрес" value={address} onChangeText={setAddress} />
      <Card>
        <Text style={s.cardTitle}>Когда нужна уборка? *</Text>
        <Field label="Дата (ГГГГ-ММ-ДД)" value={scheduledDate} onChangeText={setScheduledDate} placeholder="2026-08-05" keyboardType="numbers-and-punctuation" />
        <Field label="Время (ЧЧ:ММ)" value={scheduledTime} onChangeText={setScheduledTime} placeholder="10:00" keyboardType="numbers-and-punctuation" />
      </Card>
      <Card>
        <Text style={s.cardTitle}>Фотография помещения *</Text>
        <Text style={s.muted}>Компания оценит объём работы и назначит цену по фотографии.</Text>
        {photo ? <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 220, borderRadius: 14 }} resizeMode="cover" /> : null}
        <Button title={photo ? 'Переснять фотографию' : 'Сделать фотографию'} variant={photo ? 'secondary' : 'primary'} onPress={() => void takePhoto()} />
      </Card>
      <Controller control={control} name="areaSqM" render={({ field }) => <Field label="Площадь, м²" value={String(field.value)} onChangeText={field.onChange} keyboardType="number-pad" error={errors.areaSqM?.message} />} />
      <Controller control={control} name="roomsCount" render={({ field }) => <Field label="Количество комнат" value={String(field.value)} onChangeText={field.onChange} keyboardType="number-pad" error={errors.roomsCount?.message} />} />
      <Controller control={control} name="comment" render={({ field }) => <Field label="Комментарий" value={field.value ?? ''} onChangeText={field.onChange} multiline />} />
      <Text style={s.muted}>Способ оплаты: наличными. Компания подтвердит цену перед выполнением.</Text>
      <Button title={company ? `Заказать у «${company.name}»` : 'Выбрать компанию'} busy={busy} disabled={companyLoading} onPress={company ? handleSubmit(submit) : () => router.push('/select-company')} />
    </Screen>
  );
}
