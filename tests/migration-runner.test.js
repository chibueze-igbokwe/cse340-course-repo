import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWeek05Migration, migrationOptions, isLoopback } from '../scripts/run-week05-migration.js';

const env = { RENDER: 'true', RUN_WEEK05_MIGRATION: 'true',
  DB_URL: 'postgresql://fixture:synthetic@db.example.invalid/course_production?sslmode=disable',
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
  assert.throws(() => migrationOptions({ ...env, DB_URL: 'postgresql://fixture@db.example.invalid/cse340_development', WEEK05_EXPECTED_DATABASE: 'cse340_development' }));
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
