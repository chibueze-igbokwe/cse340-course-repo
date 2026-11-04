import './setup-env.js';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
if (!process.env.DEV_DB_URL || process.env.CONFIRM_ISOLATED_DATABASE !== 'true') {
  throw new Error('Integration checks require a separate DEV_DB_URL and CONFIRM_ISOLATED_DATABASE=true. The grading DB_URL is never used.');
}
process.env.DB_URL = process.env.DEV_DB_URL;
