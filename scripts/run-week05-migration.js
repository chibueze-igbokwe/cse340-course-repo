import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const refusal = (code, message) => Object.assign(new Error(message), { code });
// Never log driver messages, detail, SQL, URLs, certificate subjects or stacks.
export const safeFailure = (operation, error, week = '05') => {
  const stages = ['configuration', 'dns', 'connection', 'tls', 'identity', 'migration-file', 'migration-sql'];
  const stage = stages.includes(error?.week05Stage) ? error.week05Stage : 'operation';
  const code = typeof error?.code === 'string' && (
    /^[0-9A-Z]{5}$/.test(error.code)
    || ['W05_RENDER', 'W05_DB_URL', 'W05_EXPECTED_DATABASE', 'W05_TARGET', 'W05_HOST', 'W05_TLS', 'W05_IDENTITY',
      'W06_EXPECTED_DATABASE', 'W06_FLAG',
      'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOENT',
      'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED'].includes(error.code)
  ) ? error.code : 'UNCLASSIFIED';
  return `Week ${week === '06' ? '06' : '05'} ${operation} refused or failed [stage=${stage} code=${code}]. Application startup stopped.`;
};

// No dotenv or application imports: only Render's runtime environment is used.
export const isLoopback = (value) => {
  const address = String(value).toLowerCase().replace(/^\[|\]$/g, '');
  return address === 'localhost' || address.endsWith('.localhost')
    || address === '::1' || /^127\./.test(address)
    || /^::ffff:127\./.test(address) || /^::ffff:7f[0-9a-f]{2}:/.test(address);
};

// Intentionally narrow: Render PostgreSQL instance labels, not arbitrary hosts
// containing "render" or arbitrary subdomains of render.com.
export const renderHostPolicy = (host) => {
  if (/^dpg-[a-z0-9]+-[a-z]$/.test(host)) return 'internal';
  if (/^dpg-[a-z0-9]+-[a-z]\.(oregon|ohio|virginia|frankfurt|singapore)-postgres\.render\.com$/.test(host)) return 'external';
  throw refusal('W05_HOST', 'Unrecognized Render PostgreSQL hostname.');
};

export const isPrivateAddress = (value) => {
  const address = String(value).toLowerCase().replace(/^::ffff:/, '');
  if (isIP(address) === 4) {
    const [first, second] = address.split('.').map(Number);
    return first === 10 || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }
  return isIP(address) === 6 && /^(fc|fd)/.test(address);
};

export const migrationOptions = (env) => {
  if (env.RENDER !== 'true') throw refusal('W05_RENDER', 'Render runtime required.');
  if (!env.DB_URL) throw refusal('W05_DB_URL', 'Runtime DB_URL required.');
  if (!env.WEEK05_EXPECTED_DATABASE) throw refusal('W05_EXPECTED_DATABASE', 'Expected database name required.');
  const url = new URL(env.DB_URL);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !host || isLoopback(host)
      || host.endsWith('.') || database === 'cse340_development'
      || database !== env.WEEK05_EXPECTED_DATABASE) throw refusal('W05_TARGET', 'Database target refused.');
  const policy = renderHostPolicy(host);
  // TLS is mandatory in both policies. Only recognized private-network hosts
  // use Render's self-signed internal certificate policy. URL SSL flags cannot
  // override these explicit per-client settings.
  return {
    host, port: Number(url.port || 5432), database,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: policy === 'external', servername: host },
    connectionTimeoutMillis: 10000, application_name: 'cse340-week05-migration'
  };
};

export const connectProductionDatabase = async (env, {
  Client = pg.Client, resolve = lookup
} = {}) => {
  let stage = 'configuration';
  let client;
  try {
    const options = migrationOptions(env);
    const internal = renderHostPolicy(options.host) === 'internal';
    stage = 'dns';
    const addresses = await resolve(options.host, { all: true });
    if (!addresses.length || addresses.some(({ address }) => !isIP(address) || isLoopback(address)
        || (internal && !isPrivateAddress(address)))) throw refusal('W05_TARGET', 'Resolved database address refused.');
    client = new Client(options);
    stage = 'connection';
    await client.connect();
    stage = 'tls';
    const socket = client.connection?.stream;
    if (!socket?.encrypted || (!internal && socket.authorized !== true) || !socket.remoteAddress
        || isLoopback(socket.remoteAddress) || (internal && !isPrivateAddress(socket.remoteAddress))) {
      throw refusal('W05_TLS', 'Required remote TLS policy not satisfied.');
    }
    // Inspect identity in a read-only transaction before submitting migration SQL.
    stage = 'identity';
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`
      SELECT current_database() AS database, host(inet_server_addr()) AS address,
             current_setting('transaction_read_only') AS read_only,
             (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl
    `);
    const identity = rows[0];
    if (!identity || identity.database !== options.database || identity.database === 'cse340_development'
        || !identity.address || isLoopback(identity.address) || (internal && !isPrivateAddress(identity.address))
        || identity.read_only !== 'on' || identity.ssl !== true) throw refusal('W05_IDENTITY', 'Database identity verification failed.');
    await client.query('ROLLBACK');
    return client;
  } catch (error) {
    error.week05Stage = stage;
    if (client) await client.end().catch(() => {});
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
  let stage = 'migration-file';
  try {
    const sql = await readMigration();
    log('Production database identity and required encrypted TLS policy confirmed.');
    stage = 'migration-sql';
    await client.query(sql); // Validated file supplies its own BEGIN/COMMIT.
    log('Week 05 migration completed. Remove the flag and temporary start command.');
  } catch (error) {
    error.week05Stage = stage;
    throw error;
  } finally {
    // Also rolls back an uncommitted migration after any failure.
    await client.end();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWeek05Migration().catch((error) => {
    // Driver errors can contain connection details. Never print them here.
    console.error(safeFailure('migration', error));
    process.exitCode = 1;
  });
}
