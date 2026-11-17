import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runWeek06Migration } from '../scripts/run-week06-migration.js';
import { safeFailure } from '../scripts/run-week05-migration.js';

const sql = readFileSync(new URL('../src/migrations/006-volunteering.sql', import.meta.url), 'utf8');
const env = { RENDER: 'true', RUN_WEEK06_MIGRATION: 'true', WEEK06_EXPECTED_DATABASE: 'course_production',
  DB_URL: 'postgresql://fixture:synthetic@dpg-synthetic-a.oregon-postgres.render.com/course_production?sslmode=disable' };
const fixture = (settings = {}) => {
  const calls = [], logs = [];
  const address = settings.internal ? '10.20.0.8' : '192.0.2.1';
  class Client {
    constructor(options) {
      calls.push({ type: 'options', options });
      this.connection = { stream: { encrypted: !settings.plaintext,
        authorized: !settings.internal && !settings.badCertificate, remoteAddress: settings.peer || address } };
    }
    async connect() { calls.push({ type: 'connect' }); }
    async end() { calls.push({ type: 'end' }); }
    async query(query) {
      calls.push({ type: 'query', query });
      if (query === sql && settings.sqlFailure) {
        throw Object.assign(new Error('Private SQL/connection details'), { code: settings.sqlFailure });
      }
      return { rows: [{ database: settings.database || 'course_production',
        address: settings.server || address, read_only: settings.readOnly || 'on', ssl: !settings.serverPlaintext }] };
    }
  }
  return { calls, logs, dependencies: { Client, resolve: async () => [{ address: settings.dns || address }],
    readMigration: () => { throw new Error('Caller cannot select an alternative SQL file'); },
    log: message => logs.push(message) } };
};

test('Week 06 requires its own exact flag and expected database, never falls back to Week 05 settings', async () => {
  const { calls, dependencies } = fixture();
  await runWeek06Migration({ RUN_WEEK05_MIGRATION: 'true' }, dependencies);
  await runWeek06Migration({ RUN_WEEK06_MIGRATION: 'false' }, dependencies);
  for (const overrides of [{ RUN_WEEK06_MIGRATION: 'TRUE' }, { WEEK06_EXPECTED_DATABASE: '' },
    { WEEK06_EXPECTED_DATABASE: undefined, WEEK05_EXPECTED_DATABASE: 'course_production' },
    { WEEK06_EXPECTED_DATABASE: 'wrong' }, { RENDER: 'false' }, { DB_URL: '' }]) {
    await assert.rejects(runWeek06Migration({ ...env, ...overrides }, dependencies));
  }
  assert.equal(calls.length, 0);
});

test('Week 06 submits only the unchanged 006 file after read-only identity verification, with safe compatible reruns', async () => {
  const { calls, logs, dependencies } = fixture();
  const runtime = { ...env, WEEK05_EXPECTED_DATABASE: 'wrong', RUN_WEEK05_MIGRATION: 'false', MIGRATION_FILE: 'src/setup.sql' };
  await runWeek06Migration(runtime, dependencies); await runWeek06Migration(runtime, dependencies);
  assert.equal(calls[0].options.ssl.rejectUnauthorized, true);
  assert.deepEqual(calls.filter(call => call.type === 'query').map(({ query }) =>
    query === sql ? 'migration' : query.includes('SELECT') ? 'identity' : query),
  ['BEGIN READ ONLY', 'identity', 'ROLLBACK', 'migration', 'BEGIN READ ONLY', 'identity', 'ROLLBACK', 'migration']);
  assert.equal(calls.filter(call => call.type === 'end').length, 2);
  assert.ok(logs.some(message => message.includes('Week 06 migration completed')));
});

test('Week 06 inherits internal encrypted TLS and private-network policy', async () => {
  const { calls, dependencies } = fixture({ internal: true });
  await runWeek06Migration({ ...env, DB_URL: 'postgresql://fixture:synthetic@dpg-synthetic-a/course_production' }, dependencies);
  assert.deepEqual(calls[0].options.ssl, { rejectUnauthorized: false, servername: 'dpg-synthetic-a' });
  assert.ok(calls.some(call => call.query === sql));
});

test('Week 06 refuses local, unknown, plaintext, untrusted external and mismatched identity targets before migration', async () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'db.example.invalid', 'dpg-synthetic-a.evil.invalid']) {
    const { calls, dependencies } = fixture();
    await assert.rejects(runWeek06Migration({ ...env, DB_URL: `postgresql://fixture@${host}/course_production` }, dependencies));
    assert.equal(calls.length, 0);
  }
  for (const settings of [{ dns: '127.0.0.1' }, { peer: '127.0.0.1' }, { plaintext: true }, { badCertificate: true },
    { database: 'wrong' }, { database: 'cse340_development' }, { server: '::1' }, { readOnly: 'off' }, { serverPlaintext: true },
    { internal: true, dns: '192.0.2.1' }, { internal: true, peer: '192.0.2.1' }, { internal: true, server: '192.0.2.1' }]) {
    const { calls, dependencies } = fixture(settings);
    const runtime = settings.internal ? { ...env, DB_URL: 'postgresql://fixture@dpg-synthetic-a/course_production' } : env;
    await assert.rejects(runWeek06Migration(runtime, dependencies));
    assert.ok(!calls.some(call => call.query === sql));
    if (calls.some(call => call.type === 'connect')) assert.equal(calls.at(-1).type, 'end');
  }
});

test('Week 06 schema/permission failures propagate, close the connection and retain redacted diagnostic codes', async () => {
  for (const code of ['P0001', '42501']) {
    const { calls, dependencies } = fixture({ sqlFailure: code });
    await assert.rejects(runWeek06Migration(env, dependencies), error => {
      const message = safeFailure('migration', error, '06');
      assert.match(message, new RegExp(`Week 06.*stage=migration-sql code=${code}`));
      assert.ok(!message.includes(error.message) && !message.includes(env.DB_URL));
      return true;
    });
    assert.equal(calls.at(-1).type, 'end');
  }
});

test('Week 06 CLI fails nonzero and prints no private values on configuration error', () => {
  const result = spawnSync(process.execPath, ['scripts/run-week06-migration.js'], {
    env: { ...process.env, ...env, WEEK06_EXPECTED_DATABASE: '' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /Week 06.*W06_EXPECTED_DATABASE/);
  assert.ok(!result.stderr.includes(env.DB_URL));
});

test('migration declares the same junction schema as setup and includes transactional compatibility guards without destructive statements', () => {
  const setup = readFileSync(new URL('../src/setup.sql', import.meta.url), 'utf8');
  const normalize = value => value.replaceAll('public.', '').replace(/\s+/g, ' ').trim();
  assert.equal(normalize(setup.match(/CREATE TABLE volunteer \(([\s\S]*?)\n\);/)[1]),
    normalize(sql.match(/CREATE TABLE IF NOT EXISTS public.volunteer \(([\s\S]*?)\n\);/)[1]));
  const statements = sql.replace(/--[^\n]*/g, '');
  assert.match(statements, /^\s*BEGIN;/); assert.match(statements, /COMMIT;\s*$/);
  assert.doesNotMatch(statements, /^\s*(?:DROP|TRUNCATE|DELETE FROM|UPDATE\s|ALTER\s|INSERT\s)/im);
  assert.match(statements, /FULL JOIN actual/); assert.match(statements, /RAISE EXCEPTION/);
  for (const catalog of ['pg_attribute', 'pg_constraint', 'pg_trigger', 'pg_rewrite', 'pg_inherits']) assert.ok(statements.includes(catalog));
  assert.equal((statements.match(/ON DELETE CASCADE/g) || []).length, 4);
});
