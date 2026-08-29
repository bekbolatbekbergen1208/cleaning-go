import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { bodyIsTooLarge, hasJsonContentType } from '../../../lib/request-security';

const roles = new Set(['client', 'cleaner', 'company_owner']);

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowed = !origin || /^https?:\/\/(localhost|127\.0\.0\.1):8081$/.test(origin) || origin === process.env.PUBLIC_APP_URL;
  return allowed ? { 'Access-Control-Allow-Origin': origin ?? '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' } : null;
}

export async function OPTIONS(request: NextRequest) {
  const headers = corsHeaders(request);
  return headers ? new NextResponse(null, { status: 204, headers }) : NextResponse.json({ error: 'Origin is not allowed' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request);
  if (!headers) return NextResponse.json({ error: 'Origin is not allowed' }, { status: 403 });
  if (!hasJsonContentType(request) || bodyIsTooLarge(request)) return NextResponse.json({ error: 'Некорректный запрос.' }, { status: 400, headers });

  try {
    const body = await request.json();
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 254);
    const password = String(body.password ?? '');
    const role = String(body.role ?? '');
    const fullName = String(body.full_name ?? '').trim();
    const rawPhone = String(body.phone ?? '').trim();
    const digits = rawPhone.replace(/\D/g, '');
    const phone = digits.length === 11 && digits.startsWith('8') ? `+7${digits.slice(1)}` : `+${digits}`;
    if (!/^\S+@\S+\.\S+$/.test(email) || !/^\+[1-9]\d{9,14}$/.test(phone) || password.length < 8 || password.length > 256 || fullName.length < 2 || fullName.length > 120 || !roles.has(role)) {
      return NextResponse.json({ error: 'Проверьте имя, email, номер телефона, пароль и роль.' }, { status: 400, headers });
    }
    if (role === 'company_owner' && ['company_name', 'company_registration_number', 'company_city', 'company_address', 'company_phone'].some((field) => !String(body[field] ?? '').trim())) {
      return NextResponse.json({ error: 'Заполните все данные компании.' }, { status: 400, headers });
    }

    const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: existingProfiles, error: profileLookupError } = await admin
      .from('profiles')
      .select('email,phone')
      .or(`email.ilike.${email},phone.eq.${phone}`)
      .limit(1);
    if (profileLookupError) return NextResponse.json({ error: 'Не удалось проверить регистрационные данные.' }, { status: 503, headers });
    if (existingProfiles?.some((item) => item.email?.toLowerCase() === email || item.phone === phone)) {
      return NextResponse.json({ error: 'Аккаунт с такими данными уже существует.' }, { status: 409, headers });
    }
    if (role === 'company_owner') {
      const registrationNumber = String(body.company_registration_number).trim();
      const { data: existingCompany, error: companyLookupError } = await admin.from('company_profiles').select('id').eq('registration_number', registrationNumber).maybeSingle();
      if (companyLookupError) return NextResponse.json({ error: 'Не удалось проверить БИН компании.' }, { status: 503, headers });
      if (existingCompany) return NextResponse.json({ error: 'Компания с таким БИН уже зарегистрирована.' }, { status: 409, headers });
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      phone,
      password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: {
        full_name: fullName,
        phone,
        role,
        referral_code: body.referral_code || undefined,
        company_name: body.company_name || undefined,
        company_registration_number: body.company_registration_number || undefined,
        company_city: body.company_city || undefined,
        company_address: body.company_address || undefined,
        company_phone: body.company_phone || undefined,
      },
    });
    if (error) {
      console.error('Registration failed:', { code: error.code, status: error.status, message: error.message });
      return NextResponse.json({ error: error.status === 422 ? 'Пользователь с такими данными уже существует.' : 'Не удалось создать аккаунт.' }, { status: error.status === 422 ? 409 : 400, headers });
    }
    if (role === 'client' && body.referral_code) {
      const code = String(body.referral_code).trim().toUpperCase();
      const { data: company } = await admin.from('company_profiles').select('id,owner_id').eq('company_code', code).maybeSingle();
      if (company) {
        await admin.from('notifications').insert({
          user_id: company.owner_id,
          type: 'company_client',
          title: 'Новый клиент в отделе продаж',
          body: `${fullName} зарегистрировался по коду вашей компании`,
          data: { company_id: company.id, client_id: data.user.id },
        });
      }
    }
    return NextResponse.json({ userId: data.user.id }, { status: 201, headers });
  } catch {
    return NextResponse.json({ error: 'Не удалось обработать регистрацию.' }, { status: 500, headers });
  }
}
