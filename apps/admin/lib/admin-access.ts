type AdminUser = { email?: string | null };
type AdminProfile = { role?: string | null; status?: string | null };

export function isAllowedAdmin(user: AdminUser, profile: AdminProfile | null | undefined) {
  if (profile?.role !== 'admin' || profile.status !== 'active') return false;

  const email = user.email?.trim().toLowerCase();
  if (!email) return false;

  const allowed = [
    process.env.SEED_ADMIN_EMAIL,
    ...(process.env.ADDITIONAL_ADMIN_EMAILS || '').split(','),
  ].map((value) => value?.trim().toLowerCase()).filter(Boolean);

  return allowed.includes(email);
}
