import { pathToFileURL } from 'node:url';
import { connectProductionDatabase } from './run-week05-migration.js';

// Explicit CLI operation only. Never imported by server.js; never loads dotenv.
export const promoteWeek05Admin = async (env = process.env, dependencies = {}) => {
  const log = dependencies.log || console.log;
  if (env.RUN_WEEK05_ADMIN_PROMOTION === undefined || env.RUN_WEEK05_ADMIN_PROMOTION === 'false') {
    log('Week 05 administrator promotion disabled.');
    return;
  }
  if (env.RUN_WEEK05_ADMIN_PROMOTION !== 'true') throw new Error('Promotion flag must be exactly true or false.');
  const email = env.WEEK05_ADMIN_EMAIL;
  // Match exactly: do not normalize or broaden the supplied account selector.
  if (typeof email !== 'string' || !email || email.length > 100 || email !== email.trim()
      || !/^[^\s@]+@[^\s@]+$/.test(email) || email.includes('\0')) throw new Error('Exact registered account email required.');
  const client = await connectProductionDatabase(env, dependencies);
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const accounts = await client.query('SELECT user_id FROM public.users WHERE email = $1 FOR UPDATE', [email]);
    if (accounts.rows.length !== 1) throw new Error('Exactly one existing account required.');
    const roles = await client.query('SELECT role_id FROM public.roles WHERE role_name = $1 FOR SHARE', ['admin']);
    if (roles.rows.length !== 1) throw new Error('Exactly one existing administrator role required.');
    const userId = accounts.rows[0].user_id;
    const roleId = roles.rows[0].role_id;
    // Skip an already-correct role, allowing deployment restarts to rerun safely.
    await client.query(`
      UPDATE public.users SET role_id = $1
      WHERE user_id = $2 AND email = $3 AND role_id IS DISTINCT FROM $1
    `, [roleId, userId, email]);
    const verified = await client.query(`
      SELECT u.user_id, r.role_name FROM public.users u
      JOIN public.roles r ON r.role_id = u.role_id
      WHERE u.user_id = $1 AND u.email = $2
    `, [userId, email]);
    if (verified.rows.length !== 1 || verified.rows[0].user_id !== userId
        || verified.rows[0].role_name !== 'admin') throw new Error('Administrator role verification failed.');
    await client.query('COMMIT');
    log('Week 05 administrator role verified. Remove the promotion flag and temporary start command; log in again.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  promoteWeek05Admin().catch(() => {
    // Never emit driver errors, account identifiers, connection details or hashes.
    console.error('Week 05 administrator promotion refused or failed. Application startup stopped; review configuration and account privately.');
    process.exitCode = 1;
  });
}
