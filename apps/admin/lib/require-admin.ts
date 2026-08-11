import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const ownerEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();

  if (!ownerEmail || user.email?.toLowerCase() !== ownerEmail || data?.role !== 'admin') {
    await supabase.auth.signOut();
    redirect('/?error=forbidden');
  }

  return supabase;
}
