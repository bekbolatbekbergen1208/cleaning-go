import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const orderId = '00000000-0000-4000-8000-000000000010';
const source = ts.transpileModule(readFileSync('apps/admin/lib/tracking.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function accessWith({ role = 'client', status = 'active', userId = 'client', worker = null, company = null, assignment = null, loggedIn = true } = {}) {
  const rows = {
    profiles: { role, status },
    orders: { id: orderId, client_id: 'client', selected_company_id: 'company', status: 'accepted' },
    order_workers: worker,
    order_assignments: assignment,
    company_profiles: company,
  };
  const db = { from(table) {
    const query = { select() { return query; }, eq() { return query; }, in() { return query; }, async maybeSingle() { return { data: rows[table] }; } };
    return query;
  } };
  const exports = {};
  const dependencies = {
    '@supabase/supabase-js': { createClient: () => db },
    './supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: loggedIn ? { id: userId } : null } }) } }) },
    './map-coordinates': { inAstana: () => true },
  };
  new Function('require', 'exports', source)(name => dependencies[name], exports);
  return exports.trackingAccess;
}

test('tracking access permits the client, assigned cleaner and owning company', async () => {
  assert.ok(await accessWith()(orderId));
  assert.equal((await accessWith({ role: 'cleaner', userId: 'worker', worker: { cleaner_id: 'worker' } })(orderId)).isCleaner, true);
  assert.ok(await accessWith({ role: 'company_owner', userId: 'owner', company: { id: 'company' } })(orderId));
  assert.equal((await accessWith({ role: 'cleaner', userId: 'assigned', assignment: { cleaner_id: 'assigned' } })(orderId)).isCleaner, true);
});

test('tracking denies unrelated community members, clients, blocked accounts and anonymous requests', async () => {
  for (const options of [
    { userId: 'other-client' }, { role: 'cleaner', userId: 'community-member' },
    { role: 'company_owner', userId: 'other-company' }, { status: 'blocked' }, { loggedIn: false },
  ]) assert.equal(await accessWith(options)(orderId), null);
  assert.equal(await accessWith()('invalid-order'), null);
});
