import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWeek05Migration, migrationOptions, isLoopback, safeFailure, renderHostPolicy } from '../scripts/run-week05-migration.js';

const env = { RENDER: 'true', RUN_WEEK05_MIGRATION: 'true',
  DB_URL: 'postgresql://fixture:synthetic@dpg-synthetic-a.oregon-postgres.render.com/course_production?sslmode=disable',
  WEEK05_EXPECTED_DATABASE: 'course_production' };
const fixture = (identity = {}, socket = {}) => {
  const calls = [];
  class Client {
    constructor(options) { calls.push(['options', options]); this.connection = { stream: {
      encrypted: true, authorized: true, remoteAddress: '192.0.2.1', ...socket } }; }
    async connect() { calls.push(['connect']); }
    async query(sql) {
      calls.push(['query', sql]);
      return { rows: [{ database: 'course_production', address: '192.0.2.1', read_only: 'on', ssl: true, ...identity }] };
    }
    async end() { calls.push(['end']); }
  }
  return { calls, deps: { Client, resolve: async () => [{ address: '192.0.2.1' }],
    readMigration: async () => 'UNCHANGED FILE CONTENT', log: () => {} } };
};

test('runner requires explicit flag and Render identity without loading dotenv', async () => {
  const { calls, deps } = fixture();
  await runWeek05Migration({}, deps);
  await runWeek05Migration({ RUN_WEEK05_MIGRATION: 'false' }, deps);
  assert.equal(calls.length, 0);
  for (const overrides of [{ RUN_WEEK05_MIGRATION: 'TRUE' }, { RENDER: 'false' },
    { DB_URL: '' }, { WEEK05_EXPECTED_DATABASE: '' }, { WEEK05_EXPECTED_DATABASE: 'wrong' }]) {
    await assert.rejects(runWeek05Migration({ ...env, ...overrides }, deps));
  }
  assert.equal(calls.length, 0);
});

test('runner rejects loopback names, addresses, DNS answers and development database', async () => {
  for (const host of ['localhost', 'other.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '[::ffff:127.0.0.1]']) {
    assert.throws(() => migrationOptions({ ...env, DB_URL: `postgresql://fixture@${host}/course_production` }));
  }
  assert.equal(isLoopback('::ffff:7f00:1'), true);
  assert.throws(() => migrationOptions({ ...env, DB_URL: 'postgresql://fixture@dpg-synthetic-a.oregon-postgres.render.com/cse340_development', WEEK05_EXPECTED_DATABASE: 'cse340_development' }));
  const { calls, deps } = fixture();
  await assert.rejects(runWeek05Migration(env, { ...deps, resolve: async () => [{ address: '::1' }] }));
  assert.equal(calls.length, 0);
});

test('runner enforces TLS and read-only identity before submitting unchanged migration', async () => {
  const { calls, deps } = fixture();
  await runWeek05Migration(env, deps);
  assert.equal(calls[0][1].ssl.rejectUnauthorized, true);
  assert.deepEqual(calls.filter(([kind]) => kind === 'query').map(([, sql]) => sql === 'UNCHANGED FILE CONTENT' ? 'migration' : sql.includes('SELECT') ? 'identity' : sql),
    ['BEGIN READ ONLY', 'identity', 'ROLLBACK', 'migration']);
  assert.equal(calls.at(-1)[0], 'end');
});

test('TLS or identity mismatch prevents all migration writes and closes connection', async () => {
  for (const [identity, socket] of [[{}, { authorized: false }], [{}, { encrypted: false }],
    [{}, { remoteAddress: '127.0.0.1' }], [{ database: 'wrong' }, {}],
    [{ address: '::1' }, {}], [{ read_only: 'off' }, {}], [{ ssl: false }, {}]]) {
    const { calls, deps } = fixture(identity, socket);
    await assert.rejects(runWeek05Migration(env, deps));
    assert.ok(!calls.some(([, sql]) => sql === 'UNCHANGED FILE CONTENT'));
    assert.equal(calls.at(-1)[0], 'end');
  }
});

test('migration failure propagates and closes the connection', async () => {
  const { calls, deps } = fixture();
  const original = deps.Client.prototype.query;
  deps.Client.prototype.query = async function(sql) {
    if (sql === 'UNCHANGED FILE CONTENT') throw new Error('Synthetic migration failure');
    return original.call(this, sql);
  };
  await assert.rejects(runWeek05Migration(env, deps), /Synthetic migration failure/);
  assert.equal(calls.at(-1)[0], 'end');
});

test('safe diagnostics distinguish missing configuration and identity refusal without exposing values', async () => {
  for (const [overrides, code] of [[{ DB_URL: '' }, 'W05_DB_URL'],
    [{ WEEK05_EXPECTED_DATABASE: '' }, 'W05_EXPECTED_DATABASE'],
    [{ WEEK05_EXPECTED_DATABASE: 'wrong' }, 'W05_TARGET']]) {
    const { deps } = fixture();
    await assert.rejects(runWeek05Migration({ ...env, ...overrides }, deps), error => {
      assert.match(safeFailure('migration', error), new RegExp(`stage=configuration code=${code}`));
      return true;
    });
  }
  const { deps } = fixture({ database: 'wrong' });
  await assert.rejects(runWeek05Migration(env, deps), error => {
    assert.match(safeFailure('migration', error), /stage=identity code=W05_IDENTITY/);
    return true;
  });
});

test('certificate failure is classified, closes connection and never submits any SQL', async () => {
  const { calls, deps } = fixture();
  deps.Client.prototype.connect = async () => {
    throw Object.assign(new Error('Synthetic private URL and certificate details'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  };
  await assert.rejects(runWeek05Migration(env, deps), error => {
    const output = safeFailure('migration', error);
    assert.match(output, /stage=connection code=DEPTH_ZERO_SELF_SIGNED_CERT/);
    assert.ok(!output.includes(error.message));
    return true;
  });
  assert.ok(!calls.some(([kind]) => kind === 'query'));
  assert.equal(calls.at(-1)[0], 'end');
});

test('SQL failures expose only stage and SQLSTATE, never SQL, detail, credentials or arbitrary error codes', async () => {
  const { deps } = fixture();
  const original = deps.Client.prototype.query;
  deps.Client.prototype.query = async function(sql) {
    if (sql === 'UNCHANGED FILE CONTENT') throw Object.assign(new Error('Private driver message'), {
      code: '42501', detail: env.DB_URL, query: sql
    });
    return original.call(this, sql);
  };
  await assert.rejects(runWeek05Migration(env, deps), error => {
    const output = safeFailure('migration', error);
    assert.match(output, /stage=migration-sql code=42501/);
    assert.ok(!output.includes(error.message) && !output.includes(env.DB_URL) && !output.includes(error.query));
    return true;
  });
  assert.match(safeFailure('migration', { code: env.DB_URL, week05Stage: env.DB_URL }), /stage=operation code=UNCLASSIFIED/);
});

const internalEnv = { ...env, DB_URL: 'postgresql://fixture:synthetic@dpg-synthetic-a/course_production?sslmode=disable' };
const internalFixture = (identity = {}, socket = {}) => {
  const result = fixture({ address: '10.20.0.8', ...identity }, {
    remoteAddress: '10.20.0.8', authorized: false, ...socket
  });
  result.deps.resolve = async () => [{ address: '10.20.0.8' }];
  return result;
};

test('only recognized Render hosts select internal or verified external TLS', () => {
  assert.equal(renderHostPolicy('dpg-synthetic-a'), 'internal');
  for (const region of ['oregon', 'ohio', 'virginia', 'frankfurt', 'singapore']) {
    const host = `dpg-synthetic-a.${region}-postgres.render.com`;
    assert.equal(renderHostPolicy(host), 'external');
    assert.equal(migrationOptions({ ...env, DB_URL: `postgresql://fixture@${host}/course_production?sslmode=disable` }).ssl.rejectUnauthorized, true);
  }
  for (const host of ['db.example.invalid', 'render.com', 'dpg-synthetic-a.evil.invalid',
    'dpg-synthetic-a.oregon-postgres.render.com.evil.invalid', 'evil-render.com',
    'dpg--a', 'dpg-synthetic-a.', 'dpg-synthetic-a.internal', '10.20.0.8']) {
    assert.throws(() => migrationOptions({ ...env, DB_URL: `postgresql://fixture@${host}/course_production` }));
  }
});

test('internal Render connection requires encryption and private addresses but accepts self-signed TLS', async () => {
  const { calls, deps } = internalFixture();
  await runWeek05Migration(internalEnv, deps);
  assert.deepEqual(calls[0][1].ssl, { rejectUnauthorized: false, servername: 'dpg-synthetic-a' });
  assert.ok(calls.some(([, sql]) => sql === 'UNCHANGED FILE CONTENT'));
});

test('internal policy rejects plaintext, public addresses and wrong identity without submitting migration', async () => {
  for (const [identity, socket] of [[{}, { encrypted: false }], [{ ssl: false }, {}],
    [{ database: 'wrong' }, {}], [{ read_only: 'off' }, {}],
    [{ address: '192.0.2.1' }, {}], [{}, { remoteAddress: '192.0.2.1' }],
    [{}, { remoteAddress: '127.0.0.1' }]]) {
    const { calls, deps } = internalFixture(identity, socket);
    await assert.rejects(runWeek05Migration(internalEnv, deps));
    assert.ok(!calls.some(([, sql]) => sql === 'UNCHANGED FILE CONTENT'));
    assert.equal(calls.at(-1)[0], 'end');
  }
  for (const addresses of [[{ address: '192.0.2.1' }], [{ address: '10.20.0.8' }, { address: '127.0.0.1' }]]) {
    const { calls, deps } = internalFixture();
    await assert.rejects(runWeek05Migration(internalEnv, { ...deps, resolve: async () => addresses }));
    assert.equal(calls.length, 0);
  }
});
