import { redirect } from 'next/navigation';
import { createClient } from './backend/server';
import { isAllowedAdmin } from './admin-access';

export async function requireAdmin() {
  const backend = await createClient();
  const { data: { user } } = await backend.auth.getUser();

  if (!user) redirect('/admin/login');

  const { data } = await backend.from('profiles').select('role,status').eq('id', user.id).single();

  if (!isAllowedAdmin(user, data)) {
    await backend.auth.signOut();
    redirect('/?error=forbidden');
  }

  return backend;
}
