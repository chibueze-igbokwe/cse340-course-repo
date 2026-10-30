import { randomBytes } from 'node:crypto';

// Ephemeral test-only signing key, never a stored or deployed credential.
process.env.SESSION_SECRET = randomBytes(64).toString('hex');
