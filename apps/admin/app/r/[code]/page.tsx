import { notFound, redirect } from 'next/navigation';

export default async function ReferralLink({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,64}$/.test(normalized)) notFound();
  redirect(`/register?code=${encodeURIComponent(normalized)}`);
}
