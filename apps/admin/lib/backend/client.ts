'use client';
import { createBrowserClient } from '@cleaning-go/local-client';
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://127.0.0.1:54321',
    '',
  );
}
