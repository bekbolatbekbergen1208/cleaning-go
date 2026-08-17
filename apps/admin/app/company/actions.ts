'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '../../lib/supabase/server';
export async function saveReferralSettings(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_my_company_referral_settings', { target_welcome_minor: Math.round(Number(formData.get('welcome_bonus')) * 100), target_referral_minor: Math.round(Number(formData.get('referral_bonus')) * 100), target_enabled: formData.get('referral_enabled') === 'on' });
  if (error) throw new Error(error.message); revalidatePath('/company');
}
export async function decideMembership(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('decide_company_membership', { target_membership: String(formData.get('membership_id')), target_accept: formData.get('decision') === 'accept' });
  if (error) throw new Error(error.message); revalidatePath('/company');
}
