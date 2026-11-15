import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promoteWeek05Admin } from '../scripts/promote-week05-admin.js';

const env = { RENDER: 'true', RUN_WEEK05_ADMIN_PROMOTION: 'true',
  WEEK05_ADMIN_EMAIL: 'synthetic@example.invalid', WEEK05_EXPECTED_DATABASE: 'course_production',
  DB_URL: 'postgresql://fixture:synthetic@dpg-synthetic-a.oregon-postgres.render.com/course_production' };
const fixture = (settings = {}) => {
  const calls = [];
  const logs = [];
  let currentRole = settings.alreadyAdmin ? 9 : 2;
  class Client {
    constructor(options) {
      calls.push({ action: 'options', options });
      this.connection = { stream: { encrypted: true, authorized: !settings.badTLS,
        remoteAddress: settings.internal ? '10.20.0.8' : '192.0.2.1' } };
    }
    async connect() { calls.push({ action: 'connect' }); }
    async end() { calls.push({ action: 'end' }); }
    async query(sql, values) {
      calls.push({ action: 'query', sql, values });
      if (sql.includes('current_database()')) return { rows: [{ database: settings.wrongDatabase ? 'wrong' : 'course_production',
        address: settings.internal ? '10.20.0.8' : '192.0.2.1', read_only: 'on', ssl: true }] };
      if (sql.includes('FOR UPDATE')) return { rows: settings.accounts ?? [{ user_id: 7 }] };
      if (sql.includes('FOR SHARE')) return { rows: settings.roles ?? [{ role_id: 9 }] };
      if (sql.includes('UPDATE public.users')) {
        if (settings.failUpdate) throw new Error('Synthetic private driver details');
        const changed = currentRole !== values[0]; currentRole = values[0];
        return { rows: [], rowCount: changed ? 1 : 0 };
      }
      if (sql.includes('JOIN public.roles')) return { rows: [{ user_id: 7,
        role_name: settings.failVerification ? 'user' : 'admin' }] };
      return { rows: [] };
    }
  }
  return { calls, logs, dependencies: { Client, resolve: async () => [{ address: settings.internal ? '10.20.0.8' : '192.0.2.1' }], log: value => logs.push(value) } };
};
const queries = calls => calls.filter(call => call.action === 'query');

test('promotion is disabled by default and rejects invalid flag or missing/excess email before connection', async () => {
  const { calls, dependencies } = fixture();
  await promoteWeek05Admin({}, dependencies);
  await promoteWeek05Admin({ RUN_WEEK05_ADMIN_PROMOTION: 'false' }, dependencies);
  for (const overrides of [{ RUN_WEEK05_ADMIN_PROMOTION: 'TRUE' }, { WEEK05_ADMIN_EMAIL: '' },
    { WEEK05_ADMIN_EMAIL: ' missing@example.invalid' }, { WEEK05_ADMIN_EMAIL: 'a'.repeat(101) },
    { WEEK05_ADMIN_EMAIL: 'missing' }, { WEEK05_EXPECTED_DATABASE: '' }, { RENDER: 'false' }]) {
    await assert.rejects(promoteWeek05Admin({ ...env, ...overrides }, dependencies));
  }
  assert.equal(calls.length, 0);
});

test('promotion shares local-target, DNS, TLS and production-identity safeguards', async () => {
  for (const settings of [{ badTLS: true }, { wrongDatabase: true }]) {
    const { calls, dependencies } = fixture(settings);
    await assert.rejects(promoteWeek05Admin(env, dependencies));
    assert.ok(!queries(calls).some(({ sql }) => sql === 'BEGIN' || sql.includes('UPDATE public.users')));
    assert.equal(calls.at(-1).action, 'end');
  }
  const { calls, dependencies } = fixture();
  await assert.rejects(promoteWeek05Admin({ ...env, DB_URL: 'postgresql://fixture@localhost/course_production' }, dependencies));
  await assert.rejects(promoteWeek05Admin(env, { ...dependencies, resolve: async () => [{ address: '::1' }] }));
  assert.equal(calls.length, 0);
});

test('promotion locks exactly selected account and role, binds values, verifies then commits without sensitive logging', async () => {
  const { calls, logs, dependencies } = fixture();
  const hostileEmail = "synthetic'@example.invalid";
  await promoteWeek05Admin({ ...env, WEEK05_ADMIN_EMAIL: hostileEmail }, dependencies);
  const sql = queries(calls);
  assert.equal(calls[0].options.ssl.rejectUnauthorized, true);
  assert.ok(sql.findIndex(call => call.sql.includes('current_database()')) < sql.findIndex(call => call.sql === 'BEGIN'));
  assert.deepEqual(sql.find(call => call.sql.includes('FOR UPDATE')).values, [hostileEmail]);
  assert.deepEqual(sql.find(call => call.sql.includes('FOR SHARE')).values, ['admin']);
  const update = sql.find(call => call.sql.includes('UPDATE public.users'));
  assert.deepEqual(update.values, [9, 7, hostileEmail]);
  assert.match(update.sql, /user_id = \$2 AND email = \$3 AND role_id IS DISTINCT FROM \$1/);
  assert.ok(sql.findIndex(call => call.sql.includes('JOIN public.roles')) < sql.findIndex(call => call.sql === 'COMMIT'));
  assert.ok(!sql.some(call => /INSERT|password|DELETE|SELECT \*/i.test(call.sql)));
  assert.ok(!sql.some(call => call.sql.includes(hostileEmail)));
  assert.ok(!logs.join('').includes(hostileEmail));
  assert.equal(calls.at(-1).action, 'end');
});

test('already-admin account succeeds safely without requiring a changed row', async () => {
  const { calls, dependencies } = fixture({ alreadyAdmin: true });
  await promoteWeek05Admin(env, dependencies);
  assert.ok(queries(calls).some(({ sql }) => sql === 'COMMIT'));
});

test('missing/ambiguous accounts or roles, SQL errors and failed verification roll back and close', async () => {
  for (const settings of [{ accounts: [] }, { accounts: [{ user_id: 7 }, { user_id: 8 }] },
    { roles: [] }, { roles: [{ role_id: 9 }, { role_id: 10 }] }, { failUpdate: true }, { failVerification: true }]) {
    const { calls, logs, dependencies } = fixture(settings);
    await assert.rejects(promoteWeek05Admin(env, dependencies));
    const sql = queries(calls);
    assert.ok(!sql.some(call => call.sql === 'COMMIT'));
    assert.equal(sql.at(-1).sql, 'ROLLBACK');
    assert.equal(calls.at(-1).action, 'end');
    assert.equal(logs.length, 0);
    if (settings.accounts || settings.roles) assert.ok(!sql.some(call => call.sql.includes('UPDATE public.users')));
  }
});

test('CLI failure is nonzero and redacts environment values', () => {
  const result = spawnSync(process.execPath, ['scripts/promote-week05-admin.js'], {
    env: { ...process.env, ...env, RUN_WEEK05_ADMIN_PROMOTION: 'invalid' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refused or failed/);
  assert.ok(!result.stderr.includes(env.DB_URL));
  assert.ok(!result.stderr.includes(env.WEEK05_ADMIN_EMAIL));
});

test('promotion also supports recognized internal encrypted TLS with all account guards retained', async () => {
  const { calls, dependencies } = fixture({ internal: true, badTLS: true });
  await promoteWeek05Admin({ ...env, DB_URL: 'postgresql://fixture:synthetic@dpg-synthetic-a/course_production' }, dependencies);
  assert.equal(calls[0].options.ssl.rejectUnauthorized, false);
  assert.ok(queries(calls).some(({ sql }) => sql.includes('FOR UPDATE')));
  assert.ok(queries(calls).some(({ sql }) => sql === 'COMMIT'));
});
