'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '../../lib/supabase/server';
export async function saveReferralSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const welcomeMinor = Math.round(Number(formData.get('welcome_bonus')) * 100);
  const referralMinor = Math.round(Number(formData.get('referral_bonus')) * 100);
  if (!Number.isFinite(welcomeMinor) || !Number.isFinite(referralMinor) || welcomeMinor < 0 || referralMinor < 0 || welcomeMinor > 1_000_000 || referralMinor > 1_000_000) {
    redirect('/company?referral_error=invalid');
  }
  const admin = createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin.from('profiles').select('role,status').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'company_owner' || profile.status !== 'active') redirect('/login?error=company_account');
  const { error } = await admin.from('company_profiles').update({ welcome_bonus_minor: welcomeMinor, referral_bonus_minor: referralMinor, referral_enabled: formData.get('referral_enabled') === 'on' }).eq('owner_id', user.id);
  if (error) redirect(`/company?referral_error=${encodeURIComponent(error.code || 'save')}`);
  revalidatePath('/company');
  redirect('/company?referral_saved=1');
}
export async function decideMembership(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('decide_company_membership', { target_membership: String(formData.get('membership_id')), target_accept: formData.get('decision') === 'accept' });
  if (error) throw new Error(error.message); revalidatePath('/company');
}
export async function joinCommunity(formData: FormData) {
  const code=String(formData.get('community_code')??'').trim().toUpperCase(); if(!code) throw new Error('Введите код сообщества');
  const supabase=await createClient(); const {error}=await supabase.rpc('join_company_community',{community_code:code}); if(error) throw new Error(error.message); revalidatePath('/company');
}
