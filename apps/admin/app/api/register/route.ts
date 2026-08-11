import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const attempts = new Map<string, { count: number; resetAt: number }>();
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

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const key = forwarded || 'local';
  const now = Date.now();
  const rate = attempts.get(key);
  if (rate && rate.resetAt > now && rate.count >= 5) return NextResponse.json({ error: 'Слишком много регистраций. Попробуйте позже.' }, { status: 429, headers });
  attempts.set(key, rate && rate.resetAt > now ? { ...rate, count: rate.count + 1 } : { count: 1, resetAt: now + 60 * 60 * 1000 });

  try {
    const body = await request.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const role = String(body.role ?? '');
    const fullName = String(body.full_name ?? '').trim();
    const rawPhone = String(body.phone ?? '').trim();
    const digits = rawPhone.replace(/\D/g, '');
    const phone = digits.length === 11 && digits.startsWith('8') ? `+7${digits.slice(1)}` : `+${digits}`;
    if (!/^\S+@\S+\.\S+$/.test(email) || !/^\+[1-9]\d{9,14}$/.test(phone) || password.length < 8 || fullName.length < 2 || !roles.has(role)) {
      return NextResponse.json({ error: 'Проверьте имя, email, номер телефона, пароль и роль.' }, { status: 400, headers });
    }
    if (role === 'company_owner' && ['company_name', 'company_registration_number', 'company_city', 'company_address', 'company_phone'].some((field) => !String(body[field] ?? '').trim())) {
      return NextResponse.json({ error: 'Заполните все данные компании.' }, { status: 400, headers });
    }

    const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
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
      const duplicate = error.message.toLowerCase().includes('already') || error.message.toLowerCase().includes('registered');
      return NextResponse.json({ error: duplicate ? 'Этот email уже зарегистрирован.' : error.message }, { status: duplicate ? 409 : 400, headers });
    }
    return NextResponse.json({ userId: data.user.id }, { status: 201, headers });
  } catch {
    return NextResponse.json({ error: 'Не удалось обработать регистрацию.' }, { status: 500, headers });
  }
}
