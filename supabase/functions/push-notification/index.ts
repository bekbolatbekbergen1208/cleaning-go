import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (request) => {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return new Response('Unauthorized', { status: 401 });
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  // MVP keeps the durable in-app notification in PostgreSQL. Expo delivery is
  // intentionally enabled only after credentials and consent are configured.
  return Response.json({ accepted: true, delivery: 'in_app' });
});
