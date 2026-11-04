import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

// Legacy Week 04 form tests now run as authenticated admins through real login.
// This wraps only the mocked login lookup, never production code or real data.
const password = randomBytes(16).toString('hex');
const passwordHash = await bcrypt.hash(password, 4);
export const mockAdminLookup = (query) => (sql, values) => {
  if (/FROM users u JOIN roles/.test(sql) && values?.[0] === 'fixture-admin@example.com') {
    return Promise.resolve({ rows: [{ user_id: 900, name: 'Fixture Admin', email: values[0], role_name: 'admin', password_hash: passwordHash }] });
  }
  return query(sql, values);
};

export const authenticatedAdminClient = (base) => {
  let cookie = '';
  let authenticated = false;
  const send = async (path, options = {}) => {
    const response = await fetch(base + path, { ...options, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...options.headers } });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, html: await response.text(), headers: response.headers };
  };
  return async (path, options) => {
    if (!authenticated) {
      const form = await send('/login');
      const token = form.html.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
      const login = await send('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'fixture-admin@example.com', password, _csrf: token }) });
      if (login.status !== 303) throw new Error('Fixture admin login failed: ' + login.status);
      authenticated = true;
    }
    return send(path, options);
  };
};
