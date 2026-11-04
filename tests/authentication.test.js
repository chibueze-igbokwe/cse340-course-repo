import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../server.js');
const { default: db } = await import('../src/models/db.js');
const { findUserByEmail, verifyPassword, authenticateUser, getAllUsers } = await import('../src/models/users.js');
const { processLoginForm } = await import('../src/controllers/users.js');
const { verifyDevelopmentDatabase } = await import('./verify-development-database.js');
const originalQuery = db.query;
const password = randomBytes(12).toString('hex');
const hash = await bcrypt.hash(password, 10);
const rows = [
  { user_id: 1, name: '<script>Admin</script>', email: 'admin-fixture@example.com', role_name: 'admin', password_hash: hash },
  { user_id: 2, name: 'Ordinary User', email: 'user-fixture@example.com', role_name: 'user', password_hash: hash }
];
const management = ['/new-organization', '/edit-organization/1', '/new-project', '/edit-project/1', '/new-category', '/edit-category/1', '/assign-categories/1'];
let calls, failure, base, server;
before(async () => {
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (failure) throw new Error('Private authentication database details');
    if (/FROM users/.test(sql)) return { rows: values ? rows.filter((row) => row.email === values[0]) : rows.map(({ password_hash, ...user }) => user) };
    if (/FROM organization/.test(sql)) return { rows: [{ organization_id: 1, name: 'Organization', description: 'Description', email: 'a@example.com', logo: 'community.svg' }] };
    if (/FROM category/.test(sql)) return { rows: [{ category_id: 1, name: 'Category' }] };
    if (/FROM project/.test(sql)) return { rows: [{ project_id: 1, title: 'Project', description: 'Description', location: 'Location', date: '2028-02-29', organization_id: 1, organization_name: 'Organization' }] };
    throw new Error('Unexpected auth query');
  };
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { calls = []; failure = false; });
after(async () => { db.query = originalQuery; await new Promise((resolve) => server.close(resolve)); await db.end(); });

const client = () => {
  let cookie = '';
  const request = async (path, data, overrideCookie) => {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', redirect: 'manual',
      headers: { ...(cookie || overrideCookie ? { cookie: overrideCookie ?? cookie } : {}), ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: data ? new URLSearchParams(data) : undefined });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, html: await response.text(), headers: response.headers };
  };
  request.cookie = () => cookie;
  return request;
};
const token = (html) => html.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
const login = async (request, role = 'user') => {
  const form = await request('/login');
  const result = await request('/login', { email: role + '-fixture@example.com', password, _csrf: token(form.html) });
  assert.equal(result.status, 303); assert.equal(result.headers.get('location'), '/dashboard');
  return result;
};

test('authentication models bind email, compare bcrypt, exclude hash, and list joined roles without selecting hashes', async () => {
  assert.equal((await findUserByEmail(rows[0].email)).user_id, 1);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('incorrect', hash), false);
  const user = await authenticateUser(rows[0].email, password);
  assert.deepEqual(Object.keys(user).sort(), ['email', 'name', 'role_name', 'user_id']);
  assert.equal(await authenticateUser(rows[0].email, 'incorrect'), null);
  assert.equal(await authenticateUser('missing@example.com', password), null);
  const hostile = "' OR 1=1 --";
  await findUserByEmail(hostile);
  assert.deepEqual(calls.at(-1).values, [hostile]); assert.ok(!calls.at(-1).sql.includes(hostile));
  const users = await getAllUsers();
  assert.match(calls.at(-1).sql, /JOIN roles/); assert.doesNotMatch(calls.at(-1).sql, /password_hash|SELECT \*/);
  assert.ok(users.every((row) => !('password_hash' in row)));
});

test('integration safety guard rejects non-local hosts and wrong database names before any query', async () => {
  let queried = false;
  const fake = { options: { host: 'example.invalid', database: 'cse340_development' }, query: async () => { queried = true; } };
  await assert.rejects(verifyDevelopmentDatabase(fake), /host must be loopback/);
  fake.options = { host: 'localhost', database: 'other_database' };
  await assert.rejects(verifyDevelopmentDatabase(fake), /configured database must be/);
  assert.equal(queried, false);
  fake.options = { host: 'localhost', database: 'cse340_development' };
  fake.query = async () => ({ rows: [{ database: 'wrong_database', address: '127.0.0.1' }] });
  await assert.rejects(verifyDevelopmentDatabase(fake), /actual database mismatch/);
  fake.query = async () => ({ rows: [{ database: 'cse340_development', address: '192.0.2.1' }] });
  await assert.rejects(verifyDevelopmentDatabase(fake), /actual database server must be loopback/);
});

test('anonymous GET/POST management routes, dashboard and users are redirected before database work', async () => {
  const request = client();
  for (const path of [...management, '/dashboard', '/users']) {
    const get = await request(path); assert.equal(get.status, 303, path); assert.equal(get.headers.get('location'), '/login');
    if (management.includes(path)) { const post = await request(path, { _csrf: 'invalid' }); assert.equal(post.status, 303); assert.equal(post.headers.get('location'), '/login'); }
  }
  assert.equal(calls.length, 0);
  assert.match((await request('/login')).html, /must be logged in/);
});

test('login session contains exactly public user identity and role after regeneration', async () => {
  let regenerated = false;
  const req = { body: { email: rows[0].email, password }, flash: () => {}, session: {
    oldData: true,
    regenerate(callback) { regenerated = true; req.session = { save: (done) => done() }; callback(); }
  } };
  const res = { redirect: (status, path) => { assert.equal(status, 303); assert.equal(path, '/dashboard'); } };
  await processLoginForm(req, res, (error) => { throw error; });
  assert.equal(regenerated, true); assert.equal(req.session.oldData, undefined);
  assert.deepEqual(Object.keys(req.session.user).sort(), ['email', 'name', 'role_name', 'user_id']);
  assert.ok(!JSON.stringify(req.session).includes(hash));
});

test('regular users are denied every management GET/POST and users list with dashboard flash', async () => {
  const request = client(); await login(request); calls = [];
  for (const path of [...management, '/users']) {
    const get = await request(path); assert.equal(get.status, 303, path); assert.equal(get.headers.get('location'), '/dashboard');
    if (management.includes(path)) { const post = await request(path, { _csrf: 'invalid' }); assert.equal(post.status, 303); assert.equal(post.headers.get('location'), '/dashboard'); }
  }
  assert.equal(calls.length, 0);
  const dashboard = await request('/dashboard'); assert.match(dashboard.html, /do not have permission/);
  assert.doesNotMatch(dashboard.html, /href="\/users"/);
});

test('admins can access every management form and registered users; output is escaped and hash-free', async () => {
  const request = client(); await login(request, 'admin');
  for (const path of management) assert.equal((await request(path)).status, 200, path);
  const dashboard = await request('/dashboard'); assert.match(dashboard.html, /href="\/users"/);
  assert.match(dashboard.html, /&lt;script&gt;Admin&lt;\/script&gt;/);
  const users = await request('/users'); assert.equal(users.status, 200);
  assert.ok(users.html.includes(rows[1].email)); assert.ok(!users.html.includes(hash)); assert.doesNotMatch(users.html, /<script>Admin/);
  assert.equal(users.headers.get('cache-control'), 'no-store');
});

test('login rotates session ID and CSRF token; logout destroys old authentication and clears navigation', async () => {
  const request = client();
  const form = await request('/login'); const preCookie = request.cookie(); const preToken = token(form.html);
  const loggedIn = await request('/login', { email: rows[1].email, password, _csrf: preToken });
  assert.equal(loggedIn.status, 303); const authCookie = request.cookie(); assert.notEqual(authCookie, preCookie);
  const dashboard = await request('/dashboard'); assert.equal(dashboard.status, 200);
  assert.match(dashboard.html, /Ordinary User/); assert.match(dashboard.html, /user-fixture@example.com/);
  assert.doesNotMatch(dashboard.html, /href="\/(?:login|register)"/);
  assert.match(dashboard.html, /action="\/logout"/); assert.notEqual(token(dashboard.html), preToken);
  assert.equal((await client()('/dashboard', undefined, preCookie)).status, 303);
  assert.equal((await request('/logout')).status, 200); assert.equal((await request('/dashboard')).status, 200, 'GET logout does not mutate auth');
  assert.equal((await request('/logout', { _csrf: preToken })).status, 403);
  const logout = await request('/logout', { _csrf: token(dashboard.html) }); assert.equal(logout.status, 303); assert.equal(logout.headers.get('location'), '/login');
  assert.notEqual(request.cookie(), authCookie);
  assert.equal((await client()('/dashboard', undefined, authCookie)).status, 303);
  const page = await request('/login'); assert.match(page.html, /Logout successful/); assert.match(page.html, /href="\/register"/);
  assert.equal((await request('/dashboard')).status, 303);
});

test('incorrect/unknown credentials show the same feedback; invalid/CSRF input does not query; database failures are safe', async (t) => {
  const request = client(); const form = await request('/login'); const csrf = token(form.html);
  for (const email of [rows[1].email, 'missing@example.com']) {
    const result = await request('/login', { email, password: 'incorrect', _csrf: csrf });
    assert.equal(result.status, 401); assert.match(result.html, /Invalid email or password/);
    assert.doesNotMatch(result.html, /value="incorrect"/);
  }
  calls = [];
  assert.equal((await request('/login', { email: 'bad', password, _csrf: csrf })).status, 422);
  assert.equal((await request('/login', { email: rows[1].email, password })).status, 403);
  assert.equal(calls.length, 0);
  t.mock.method(console, 'error', () => {}); failure = true;
  const result = await request('/login', { email: rows[1].email, password, _csrf: csrf });
  assert.equal(result.status, 500); assert.doesNotMatch(result.html, /Private authentication/);
});

test('management links appear only to admins while public detail links remain visible', async () => {
  for (const role of ['anonymous', 'user', 'admin']) {
    const request = client(); if (role !== 'anonymous') await login(request, role);
    for (const path of ['/organizations', '/organization/1', '/projects', '/project/1', '/categories', '/category/1']) {
      const result = await request(path); assert.equal(result.status, 200);
      assert.equal(/href="\/(?:new-|edit-|assign-categories)/.test(result.html), role === 'admin', role + path);
    }
    const error = await request('/register', { name: 'Missing token' });
    assert.equal(error.status, 403);
    assert.equal(/href="\/new-organization"/.test(error.html), role === 'admin');
  }
});
