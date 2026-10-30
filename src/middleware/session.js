import session from 'express-session';
import fileStore from 'session-file-store';
import { fileURLToPath } from 'node:url';

const FileStore = fileStore(session);

export const createSessionOptions = (env = process.env, store) => {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error('Set SESSION_SECRET to a private random value of at least 32 characters.');
  }
  const production = (env.NODE_ENV?.toLowerCase() || 'production') === 'production';
  return {
    name: 'service-network.sid',
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: store ?? (env.NODE_ENV === 'test' ? new session.MemoryStore() : new FileStore({
      path: env.SESSION_DIR || fileURLToPath(new URL('../../.sessions', import.meta.url)),
      ttl: 3600,
      retries: 0,
      reapInterval: 600
    })),
    cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 60 * 60 * 1000 }
  };
};
