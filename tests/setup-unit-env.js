import './setup-env.js';
import pg from 'pg';

// Override inherited configuration before app imports. Unit tests must never
// use .env's grading database, even when a query mock is accidentally omitted.
process.env.DB_URL = 'offline-tests-only';
const refuseDatabaseConnection = () => {
  throw new Error('Database connections are disabled in unit tests; use a mock.');
};
pg.Pool.prototype.connect = refuseDatabaseConnection;
pg.Client.prototype.connect = refuseDatabaseConnection;
