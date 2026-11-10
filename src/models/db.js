import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DB_URL) {
  throw new Error('DB_URL is missing. Set it in your .env file or Render environment.');
}

const db = new pg.Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false },
  types: {
    getTypeParser(oid, format) {
      // PostgreSQL DATE is a calendar day, not an instant in the server's timezone.
      if (oid === pg.types.builtins.DATE && format !== 'binary') return (value) => value;
      return pg.types.getTypeParser(oid, format);
    }
  }
});

export default db;
