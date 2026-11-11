export interface User {
  id: string;
  email?: string;
  phone?: string;
  user_metadata: Record<string, any>;
}
export interface Session {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number;
  user: User;
}
export interface CookieOptions {
  path?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
}
export interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}
export interface ClientOptions {
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  cookies?: {
    getAll: () => { name: string; value: string }[];
    setAll: (items: CookieToSet[]) => void;
  };
  auth?: {
    storage?: {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
      removeItem: (key: string) => Promise<void>;
    };
    persistSession?: boolean;
    autoRefreshToken?: boolean;
    detectSessionInUrl?: boolean;
  };
}
export interface Result<T = any> {
  data: T;
  error: { message: string; code?: string; status?: number } | null;
  count?: number | null;
}
export interface Query<T = any[]> extends PromiseLike<Result<T>> {
  select(
    columns?: string,
    options?: { count?: string; head?: boolean },
  ): Query<T>;
  insert(values: any): Query<T>;
  update(values: any): Query<T>;
  delete(): Query<T>;
  ilike(c: string, v: any): Query<T>;
  like(c: string, v: any): Query<T>;
  eq(c: string, v: any): Query<T>;
  neq(c: string, v: any): Query<T>;
  gt(c: string, v: any): Query<T>;
  gte(c: string, v: any): Query<T>;
  lt(c: string, v: any): Query<T>;
  lte(c: string, v: any): Query<T>;
  in(c: string, v: any[]): Query<T>;
  is(c: string, v: any): Query<T>;
  not(c: string, o: string, v: any): Query<T>;
  or(v: string): Query<T>;
  order(c: string, o?: { ascending?: boolean }): Query<T>;
  limit(n: number): Query<T>;
  single(): Query<any>;
  maybeSingle(): Query<any>;
}
export interface Channel {
  on(
    event: string,
    filter: { event: string; schema: string; table: string; filter?: string },
    callback: (payload: {
      new: Record<string, any>;
      old?: Record<string, any>;
      eventType: string;
    }) => void,
  ): Channel;
  subscribe(): Channel;
  unsubscribe(): void;
}
export interface Client {
  from(table: string): Query;
  rpc(name: string, args?: Record<string, any>): Promise<Result>;
  auth: {
    signInWithPassword(args: {
      email: string;
      password: string;
    }): Promise<Result<{ user: User | null; session: Session | null }>>;
    signOut(options?: { scope?: string }): Promise<Result>;
    getUser(): Promise<Result<{ user: User | null }>>;
    getSession(): Promise<Result<{ session: Session | null }>>;
    onAuthStateChange(cb: (event: string, session: Session | null) => void): {
      data: { subscription: { unsubscribe: () => void } };
    };
    resetPasswordForEmail(
      email: string,
      options?: { redirectTo?: string },
    ): Promise<Result>;
    verifyOtp(args: { token_hash: string; type?: string }): Promise<Result>;
    exchangeCodeForSession(code: string): Promise<Result>;
    setSession(session: {
      access_token: string;
      refresh_token: string;
    }): Promise<Result>;
    updateUser(args: { password: string; currentPassword?: string }): Promise<Result>;
    startAutoRefresh(): void;
    stopAutoRefresh(): void;
    admin: { createUser(user: any): Promise<Result<{ user: User }>> };
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: any,
        options?: { contentType?: string; upsert?: boolean },
      ): Promise<Result>;
      createSignedUrls(
        paths: string[],
        expires: number,
      ): Promise<
        Result<{ path: string; signedUrl: string | null; error?: string }[]>
      >;
    };
  };
  channel(name: string): Channel;
  removeChannel(channel: Channel): Promise<void>;
}
export const SESSION_COOKIE: string;
export function createClient(
  url?: string,
  key?: string,
  options?: ClientOptions,
): Client;
export function createServerClient(
  url: string,
  key: string,
  options: ClientOptions,
): Client;
export function createBrowserClient(url: string, key: string): Client;
export function resolveMobileEndpoints(options?: {
  apiUrl?: string;
  registrationUrl?: string;
  hostUri?: string;
  webOrigin?: string;
  isDevelopment?: boolean;
}): { apiUrl: string; registrationUrl: string; webUrl: string };
