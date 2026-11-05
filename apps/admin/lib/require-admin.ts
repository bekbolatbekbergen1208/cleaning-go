import { redirect } from 'next/navigation';
import { createClient } from './backend/server';

export async function requireAdmin() {
  const backend = await createClient();
  const { data: { user } } = await backend.auth.getUser();

  if (!user) redirect('/admin/login');

  const ownerEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const { data } = await backend.from('profiles').select('role').eq('id', user.id).single();

  if (!ownerEmail || user.email?.toLowerCase() !== ownerEmail || data?.role !== 'admin') {
    await backend.auth.signOut();
    redirect('/?error=forbidden');
  }

  return backend;
}
