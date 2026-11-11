'use client';
import { createBrowserClient } from '@cleaning-go/local-client';
export function createClient() {
  return createBrowserClient('/api/local', '');
}
