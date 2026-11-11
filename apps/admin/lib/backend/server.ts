import {
  createServerClient,
  type CookieOptions,
} from '@cleaning-go/local-client';
import { sessionCookieOptions } from '../request-security';
import { cookies } from 'next/headers';
type CookieToSet = { name: string; value: string; options: CookieOptions };
export async function createClient() {
  const store = await cookies();
  return createServerClient(
    process.env.LOCAL_API_URL || 'http://127.0.0.1:54321',
    '',
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll(items: CookieToSet[]) {
          try {
            items.forEach(({ name, value, options }) =>
              store.set(name, value, { ...options, ...sessionCookieOptions(), maxAge: options.maxAge }),
            );
          } catch {}
        },
      },
    },
  );
}
