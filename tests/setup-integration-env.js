import './setup-env.js';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
const target = process.env.DEV_DB_URL || process.env.DB_URL;
let url;
try { url = new URL(target); } catch { /* fail closed below */ }
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/cse340_development') {
  throw new Error('Integration checks require a localhost cse340_development database. Remote and grading databases are refused.');
}
process.env.DB_URL = target;
