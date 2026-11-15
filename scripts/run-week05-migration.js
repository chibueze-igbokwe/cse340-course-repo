import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

// No dotenv or application imports: only Render's runtime environment is used.
export const isLoopback = (value) => {
  const address = String(value).toLowerCase().replace(/^\[|\]$/g, '');
  return address === 'localhost' || address.endsWith('.localhost')
    || address === '::1' || /^127\./.test(address)
    || /^::ffff:127\./.test(address) || /^::ffff:7f[0-9a-f]{2}:/.test(address);
};

export const migrationOptions = (env) => {
  if (env.RENDER !== 'true') throw new Error('Render runtime required.');
  if (!env.DB_URL || !env.WEEK05_EXPECTED_DATABASE) throw new Error('Database configuration and expected database name required.');
  const url = new URL(env.DB_URL);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !host || isLoopback(host)
      || host.endsWith('.') || database === 'cse340_development'
      || database !== env.WEEK05_EXPECTED_DATABASE) throw new Error('Database target refused.');
  // Explicit options prevent URL sslmode parameters overriding TLS verification.
  return {
    host, port: Number(url.port || 5432), database,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true, ...(isIP(host) ? {} : { servername: host }) },
    connectionTimeoutMillis: 10000, application_name: 'cse340-week05-migration'
  };
};

export const connectProductionDatabase = async (env, {
  Client = pg.Client, resolve = lookup
} = {}) => {
  const options = migrationOptions(env);
  const addresses = await resolve(options.host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isLoopback(address))) throw new Error('Resolved database address refused.');
  const client = new Client(options);
  try {
    await client.connect();
    const socket = client.connection?.stream;
    if (!socket?.encrypted || socket.authorized !== true || !socket.remoteAddress
        || isLoopback(socket.remoteAddress)) throw new Error('Verified remote TLS connection required.');
    // Inspect identity in a read-only transaction before submitting migration SQL.
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`
      SELECT current_database() AS database, host(inet_server_addr()) AS address,
             current_setting('transaction_read_only') AS read_only,
             (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl
    `);
    const identity = rows[0];
    if (!identity || identity.database !== options.database || identity.database === 'cse340_development'
        || !identity.address || isLoopback(identity.address)
        || identity.read_only !== 'on' || identity.ssl !== true) throw new Error('Database identity verification failed.');
    await client.query('ROLLBACK');
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
};

export const runWeek05Migration = async (env = process.env, {
  Client = pg.Client, resolve = lookup,
  readMigration = () => readFile(new URL('../src/migrations/005-authentication.sql', import.meta.url), 'utf8'),
  log = console.log
} = {}) => {
  if (env.RUN_WEEK05_MIGRATION === undefined || env.RUN_WEEK05_MIGRATION === 'false') {
    log('Week 05 migration disabled.');
    return;
  }
  if (env.RUN_WEEK05_MIGRATION !== 'true') throw new Error('Migration flag must be exactly true or false.');
  const client = await connectProductionDatabase(env, { Client, resolve });
  try {
    const sql = await readMigration();
    log('Production database identity and verified TLS confirmed.');
    await client.query(sql); // Validated file supplies its own BEGIN/COMMIT.
    log('Week 05 migration completed. Remove the flag and temporary start command.');
  } finally {
    // Also rolls back an uncommitted migration after any failure.
    await client.end();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWeek05Migration().catch(() => {
    // Driver errors can contain connection details. Never print them here.
    console.error('Week 05 migration refused or failed. Application startup stopped; review target, TLS, permissions and schema privately.');
    process.exitCode = 1;
  });
}
