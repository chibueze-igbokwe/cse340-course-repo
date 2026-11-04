import assert from 'node:assert/strict';
import pg from 'pg';

export const verifyDevelopmentDatabase = async (db) => {
  const client = new pg.Client(db.options || { connectionString: process.env.DB_URL });
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(client.connectionParameters.host), 'Abort: database host must be loopback, never Render');
  assert.equal(client.connectionParameters.database, 'cse340_development', 'Abort: configured database must be cse340_development');
  const { rows: [identity] } = await db.query('SELECT current_database() AS database, host(inet_server_addr()) AS address');
  assert.equal(identity.database, 'cse340_development', 'Abort: actual database mismatch');
  assert.ok(['127.0.0.1', '::1'].includes(identity.address), 'Abort: actual database server must be loopback');
  return identity;
};
