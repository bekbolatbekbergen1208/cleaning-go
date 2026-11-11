const browserListeners = new Set();
export const SESSION_COOKIE = 'cleaning-go-session';
export function createClient(
  url = 'http://127.0.0.1:54321',
  key = '',
  options = {},
) {
  url = url.replace(/\/$/, '');
  const cookieProxy = url === '/api/local';
  const listeners =
    typeof document !== 'undefined' ? browserListeners : new Set();
  let memory = null;
  let sessionChanged = false;
  const storage = options.auth?.storage;
  async function token() {
    if (cookieProxy) return '';
    if (sessionChanged && options.cookies) return memory?.access_token || '';
    if (options.cookies)
      return (
        options.cookies.getAll().find((c) => c.name === SESSION_COOKIE)
          ?.value || ''
      );
    if (storage) {
      const raw = await storage.getItem(SESSION_COOKIE);
      try {
        return raw ? JSON.parse(raw).access_token : '';
      } catch {
        return '';
      }
    }
    if (typeof document !== 'undefined')
      return (
        document.cookie
          .split('; ')
          .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
          ?.split('=')
          .slice(1)
          .join('=') || ''
      );
    return memory?.access_token || '';
  }
  async function save(session) {
    memory = session;
    sessionChanged = true;
    if (options.cookies)
      options.cookies.setAll([
        {
          name: SESSION_COOKIE,
          value: session?.access_token || '',
          options: {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            maxAge: session ? 604800 : 0,
            secure: url.startsWith('https:'),
          },
        },
      ]);
    else if (storage) {
      if (session)
        await storage.setItem(SESSION_COOKIE, JSON.stringify(session));
      else await storage.removeItem(SESSION_COOKIE);
    } else if (typeof document !== 'undefined' && !cookieProxy)
      document.cookie = `${SESSION_COOKIE}=${session?.access_token || ''}; Path=/; SameSite=Lax; Max-Age=${session ? 604800 : 0}${location.protocol === 'https:' ? '; Secure' : ''}`;
    for (const callback of listeners)
      callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
  }
  async function request(body) {
    try {
      const t = await token();
      const headers = {
        'Content-Type': 'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...(key ? { 'X-Service-Key': key } : {}),
      };
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options.requestTimeoutMs || 15000,
      );
      let response;
      try {
        response = await fetch(`${url}/api`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const result = await response.json();
      return result;
    } catch (error) {
      return {
        data: null,
        error: {
          message:
            error.name === 'AbortError'
              ? 'Сервер не ответил вовремя. Проверьте подключение.'
              : error.message || 'Local server is unavailable',
          status: 0,
        },
      };
    }
  }
  class Query {
    constructor(table) {
      this.plan = { table, filters: [], orders: [] };
    }
    select(columns = '*', options = {}) {
      this.plan.columns = columns;
      this.plan.count = options.count;
      this.plan.head = options.head;
      if (this.plan.operation) this.plan.returning = true;
      return this;
    }
    insert(values) {
      this.plan.operation = 'insert';
      this.plan.values = values;
      return this;
    }
    update(values) {
      this.plan.operation = 'update';
      this.plan.values = values;
      return this;
    }
    delete() {
      this.plan.operation = 'delete';
      return this;
    }
    filter(column, op, value, negate = false) {
      this.plan.filters.push({ column, op, value, negate });
      return this;
    }
    ilike(c, v) {
      return this.filter(c, 'ilike', v);
    }
    like(c, v) {
      return this.filter(c, 'like', v);
    }
    eq(c, v) {
      return this.filter(c, 'eq', v);
    }
    neq(c, v) {
      return this.filter(c, 'neq', v);
    }
    gt(c, v) {
      return this.filter(c, 'gt', v);
    }
    gte(c, v) {
      return this.filter(c, 'gte', v);
    }
    lt(c, v) {
      return this.filter(c, 'lt', v);
    }
    lte(c, v) {
      return this.filter(c, 'lte', v);
    }
    in(c, v) {
      return this.filter(c, 'in', v);
    }
    is(c, v) {
      return this.filter(c, 'is', v);
    }
    not(c, o, v) {
      return this.filter(c, o, v, true);
    }
    or(v) {
      return this.filter(null, 'or', v);
    }
    order(column, options = {}) {
      this.plan.orders.push({ column, ...options });
      return this;
    }
    limit(value) {
      this.plan.limit = value;
      return this;
    }
    single() {
      this.plan.single = 'required';
      return this;
    }
    maybeSingle() {
      this.plan.single = 'optional';
      return this;
    }
    then(resolve, reject) {
      return request({ action: 'query', plan: this.plan }).then(
        resolve,
        reject,
      );
    }
  }
  const auth = {
    async signInWithPassword(credentials) {
      const r = await request({ action: 'signIn', ...credentials });
      if (r.data?.session) await save(r.data.session);
      return r;
    },
    async signOut() {
      const r = await request({ action: 'signOut' });
      await save(null);
      return r;
    },
    async getUser() {
      const r = await request({ action: 'getUser' });
      return { ...r, data: r.data || { user: null } };
    },
    async getSession() {
      const r = await request({ action: 'getSession' });
      return { ...r, data: r.data || { session: null } };
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return {
        data: {
          subscription: { unsubscribe: () => listeners.delete(callback) },
        },
      };
    },
    async resetPasswordForEmail(email, options = {}) {
      return request({
        action: 'recover',
        email,
        redirectTo: options.redirectTo,
      });
    },
    async verifyOtp(args) {
      const r = await request({ action: 'verifyRecovery', ...args });
      if (r.data?.session) await save(r.data.session);
      return r;
    },
    async exchangeCodeForSession(code) {
      return auth.verifyOtp({ token_hash: code });
    },
    async setSession(session) {
      if (cookieProxy) return { data: null, error: { message: 'Use a recovery link to sign in', status: 400 } };
      await save(session);
      return auth.getSession();
    },
    async updateUser(args) {
      const r = await request({ action: 'updateUser', ...args });
      if (r.data?.session) await save(r.data.session);
      return r;
    },
    startAutoRefresh() {},
    stopAutoRefresh() {},
    admin: { createUser: (user) => request({ action: 'createUser', user }) },
  };
  const client = {
    from: (table) => new Query(table),
    rpc: (name, args) => request({ action: 'rpc', name, args }),
    auth,
    storage: {
      from: (bucket) => ({
        async upload(path, file, opts = {}) {
          try {
            const t = await token();
            const response = await fetch(`${url}/upload`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${t}`,
                'X-Bucket': bucket,
                'X-Path': path,
                'X-Upsert': String(!!opts.upsert),
                'Content-Type':
                  opts.contentType || file.type || 'application/octet-stream',
              },
              body: file,
            });
            return await response.json();
          } catch (error) {
            return { data: null, error: { message: error.message } };
          }
        },
        async createSignedUrls(paths, expires) {
          const r = await request({
            action: 'signedUrls',
            bucket,
            paths,
            expires,
          });
          if (r.data)
            r.data = r.data.map((item) => ({
              ...item,
              signedUrl: item.signedUrl
                ? item.signedUrl.startsWith('/')
                  ? cookieProxy ? item.signedUrl : `${url}${item.signedUrl}`
                  : item.signedUrl
                : null,
            }));
          return r;
        },
      }),
    },
    channel() {
      const subscriptions = [];
      let timer = null,
        busy = false,
        active = false;
      const channel = {
        on(_event, filter, callback) {
          subscriptions.push({ filter, callback, previous: null });
          return channel;
        },
        subscribe() {
          if (active) return channel;
          active = true;
          const poll = async () => {
            if (busy || !active) return;
            busy = true;
            try {
              for (const sub of subscriptions) {
                if (!active) return;
                let q = client.from(sub.filter.table).select('*');
                if (sub.filter.filter) {
                  const m = /^(\w+)=eq\.(.+)$/.exec(sub.filter.filter);
                  if (!m) continue;
                  q = q.eq(m[1], m[2]);
                }
                const r = await q;
                if (r.error || !active) continue;
                const rows = r.data || [];
                const current = new Map(
                  rows.map((row) => [row.id ?? JSON.stringify(row), row]),
                );
                if (sub.previous) {
                  const emit = (eventType, row, old) => {
                    if (
                      active &&
                      (sub.filter.event === '*' ||
                        sub.filter.event === eventType)
                    )
                      sub.callback({
                        new: row || {},
                        old: old || {},
                        eventType,
                      });
                  };
                  for (const [id, row] of current) {
                    const old = sub.previous.get(id);
                    if (!old) emit('INSERT', row, null);
                    else if (JSON.stringify(old) !== JSON.stringify(row))
                      emit('UPDATE', row, old);
                  }
                  for (const [id, old] of sub.previous)
                    if (!current.has(id)) emit('DELETE', null, old);
                }
                sub.previous = current;
              }
            } finally {
              busy = false;
            }
          };
          void poll();
          timer = setInterval(poll, options.pollIntervalMs || 3000);
          return channel;
        },
        unsubscribe() {
          active = false;
          if (timer) clearInterval(timer);
          timer = null;
        },
      };
      return channel;
    },
    async removeChannel(channel) {
      channel.unsubscribe();
    },
  };
  return client;
}
export function createServerClient(url, key, options) {
  return createClient(url, key, options);
}
export function createBrowserClient(url, key) {
  return createClient(url, key);
}
export { resolveMobileEndpoints } from './endpoints.js';
