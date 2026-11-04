import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcrypt';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../server.js');
const { default: db } = await import('../src/models/db.js');
const { createUser } = await import('../src/models/users.js');
const originalQuery = db.query;
let calls;
let mode;
let server;
let base;
const valid = { name: 'Service Volunteer', email: 'volunteer@example.com', password: 'A careful password 123!' };

before(async () => {
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    assert.match(sql, /INSERT INTO users/, 'Registration must write only through the user model');
    if (mode === 'duplicate') throw Object.assign(new Error('Private users_email_key detail'), { code: '23505' });
    if (mode === 'error') throw new Error('Private database values: ' + values.join(','));
    if (mode === 'missing-role') return { rows: [] };
    return { rows: [{ user_id: 11 }] };
  };
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { calls = []; mode = 'normal'; });
after(async () => {
  db.query = originalQuery;
  await new Promise((resolve) => server.close(resolve));
  await db.end();
});

const client = () => {
  let cookie = '';
  return async (path, data) => {
    const response = await fetch(base + path, {
      method: data ? 'POST' : 'GET', redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: data ? new URLSearchParams(data) : undefined
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, html: await response.text(), headers: response.headers };
  };
};
const openForm = async (request) => {
  const page = await request('/register');
  assert.equal(page.status, 200);
  const token = page.html.match(/name="_csrf" value="([a-f0-9]{64})"/);
  assert.ok(token);
  return { ...page, token: token[1] };
};
const passwordInput = (html) => html.match(/<input\b[^>]*name="password"[^>]*>/)[0];

test('GET /register renders accessible fields, native constraints, CSRF and navigation without querying the database', async () => {
  const page = await openForm(client());
  assert.match(page.html, /action="\/register" method="POST"/);
  for (const field of ['name', 'email', 'password']) assert.ok(page.html.includes(`for="${field}"`));
  assert.match(page.html, /type="email"[^>]*maxlength="100"/);
  assert.match(passwordInput(page.html), /type="password"/);
  assert.match(passwordInput(page.html), /autocomplete="new-password"/);
  assert.doesNotMatch(passwordInput(page.html), /\bvalue=/);
  assert.match(page.html, /href="\/register">Register/);
  assert.match(page.html, /<main id="main-content"/);
  assert.equal(calls.length, 0);
});

test('createUser parameterizes hostile values and assigns only the named default user role', async () => {
  const hostile = "Volunteer'); DROP TABLE users; --";
  assert.equal(await createUser(hostile, 'test@example.com', 'test-only-hash'), 11);
  const query = calls[0];
  assert.deepEqual(query.values, [hostile, 'test@example.com', 'test-only-hash', 'user']);
  assert.match(query.sql, /INSERT INTO users \(name, email, password_hash, role_id\)/);
  assert.match(query.sql, /SELECT \$1, \$2, \$3, role_id FROM roles WHERE role_name = \$4/);
  assert.ok(!query.sql.includes(hostile));
  assert.ok(!query.sql.includes('test@example.com'));
  mode = 'missing-role';
  await assert.rejects(createUser('Name', 'a@example.com', 'test-only-hash'), /default user role/);
});

test('valid registration uses real bcrypt cost 10, preserves password bytes, ignores requested role, redirects and flashes once', async () => {
  const request = client();
  const { token } = await openForm(request);
  const password = '  Keep my spaces 123!  ';
  const result = await request('/register', { ...valid, name: '  Service Volunteer  ', email: ' Volunteer@EXAMPLE.COM ', password, role_id: '2', role_name: 'admin', _csrf: token });
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/');
  assert.equal(calls.length, 1);
  const [name, email, hash, role] = calls[0].values;
  assert.equal(name, valid.name);
  assert.equal(email, valid.email);
  assert.equal(role, 'user');
  assert.notEqual(hash, password);
  assert.equal(bcrypt.getRounds(hash), 10);
  assert.equal(await bcrypt.compare(password, hash), true);
  assert.equal(await bcrypt.compare(password.trim(), hash), false);
  const home = await request('/');
  assert.match(home.html, /Registration successful!/);
  assert.ok(!home.html.includes(password) && !home.html.includes(hash));
  assert.ok(!(await request('/')).html.includes('Registration successful!'));
  assert.ok(!(await client()('/')).html.includes('Registration successful!'));
});

test('invalid registration is rejected before hashing or querying; non-secret input is preserved and escaped', async (t) => {
  const hashSpy = t.mock.method(bcrypt, 'hash', () => { throw new Error('Invalid input must not be hashed'); });
  const request = client();
  const { token } = await openForm(request);
  for (const overrides of [
    { name: '' }, { name: '   ' }, { name: 'n'.repeat(101) }, { name: 'Bad\0Name' },
    { email: '' }, { email: 'not-email' }, { email: 'a'.repeat(90) + '@example.com' },
    { password: '' }, { password: 'short' }, { password: '        ' },
    { password: 'p'.repeat(73) }, { password: '😀'.repeat(19) }, { password: 'A valid\0password' }
  ]) {
    const result = await request('/register', { ...valid, ...overrides, _csrf: token });
    assert.equal(result.status, 422);
    assert.match(result.html, /role="alert"/);
    assert.match(result.html, /aria-invalid="true"/);
    assert.doesNotMatch(passwordInput(result.html), /\bvalue=/);
  }
  for (const field of ['name', 'email', 'password']) {
    const data = new URLSearchParams({ ...valid, _csrf: token });
    data.append(field, valid[field]);
    assert.equal((await request('/register', data)).status, 422);
    const missing = { ...valid, _csrf: token };
    delete missing[field];
    assert.equal((await request('/register', missing)).status, 422);
  }
  const escaped = await request('/register', { ...valid, name: 'A "quoted" <name>', password: 'short', _csrf: token });
  assert.match(escaped.html, /A &#34;quoted&#34; &lt;name&gt;/);
  assert.ok(!escaped.html.includes('A "quoted" <name>'));
  assert.equal(hashSpy.mock.calls.length, 0);
  assert.equal(calls.length, 0);
});

test('registration accepts name/email schema boundaries and 8-character/72-byte password boundaries', async () => {
  const request = client();
  const { token } = await openForm(request);
  const email100 = 'a'.repeat(50) + '@' + 'b'.repeat(45) + '.com';
  assert.equal(email100.length, 100);
  for (const password of ['8letters', 'p'.repeat(72), '😀'.repeat(18)]) {
    const result = await request('/register', { name: 'n'.repeat(100), email: email100, password, _csrf: token });
    assert.equal(result.status, 303);
    const hash = calls.at(-1).values[2];
    assert.equal(await bcrypt.compare(password, hash), true);
    assert.equal(bcrypt.getRounds(hash), 10);
  }
});

test('duplicate email returns helpful feedback without exposing or retaining password/hash', async () => {
  const request = client();
  const { token } = await openForm(request);
  mode = 'duplicate';
  const result = await request('/register', { ...valid, _csrf: token });
  assert.equal(result.status, 409);
  assert.match(result.html, /account with this email already exists/);
  assert.ok(result.html.includes(`value="${valid.email}"`));
  assert.ok(result.html.includes(`value="${valid.name}"`));
  assert.ok(!result.html.includes(valid.password));
  assert.ok(!result.html.includes(calls[0].values[2]));
  assert.ok(!result.html.includes('users_email_key'));
  assert.doesNotMatch(passwordInput(result.html), /\bvalue=/);
});

test('database, missing-role and hashing failures render safe retry feedback and redact logs', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const request = client();
  const { token } = await openForm(request);
  for (const failure of ['error', 'missing-role']) {
    mode = failure;
    const result = await request('/register', { ...valid, _csrf: token });
    assert.equal(result.status, 500);
    assert.match(result.html, /could not create your account/);
    assert.ok(!result.html.includes(valid.password));
    assert.ok(!result.html.includes('Private database values'));
    assert.doesNotMatch(passwordInput(result.html), /\bvalue=/);
  }
  const count = calls.length;
  t.mock.method(bcrypt, 'hash', async () => { throw new Error('Private hash error'); });
  assert.equal((await request('/register', { ...valid, _csrf: token })).status, 500);
  assert.equal(calls.length, count);
  const logText = JSON.stringify(logs.mock.calls.map((call) => call.arguments));
  assert.ok(!logText.includes(valid.password) && !logText.includes(valid.email));
  for (const call of calls) assert.ok(!logText.includes(call.values[2]));
});

test('CSRF rejects missing/incorrect/foreign/repeated tokens before hashing or database access', async (t) => {
  const hashSpy = t.mock.method(bcrypt, 'hash', () => { throw new Error('CSRF failures must not hash'); });
  const request = client();
  const { token } = await openForm(request);
  assert.equal((await request('/register', valid)).status, 403);
  assert.equal((await request('/register', { ...valid, _csrf: '0'.repeat(64) })).status, 403);
  assert.equal((await client()('/register', { ...valid, _csrf: token })).status, 403);
  const repeated = new URLSearchParams({ ...valid, _csrf: token });
  repeated.append('_csrf', token);
  assert.equal((await request('/register', repeated)).status, 403);
  assert.equal(hashSpy.mock.calls.length, 0);
  assert.equal(calls.length, 0);
});

test('Phase 2 endpoints are not implemented and registration does not query them', async () => {
  const request = client();
  for (const route of ['/login', '/logout', '/dashboard', '/admin/users']) assert.equal((await request(route)).status, 404);
  assert.equal(calls.length, 0);
});

test('unit database guard and integration isolation gate refuse unsafe connections before application imports', () => {
  assert.throws(() => db.connect(), /Database connections are disabled/);
  const result = spawnSync(process.execPath, ['--import', './tests/setup-integration-env.js', '--input-type=module', '-'], {
    env: { ...process.env, DEV_DB_URL: '', CONFIRM_ISOLATED_DATABASE: 'false' },
    input: "throw new Error('Application must never run without isolation confirmation');", encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Integration checks require a separate DEV_DB_URL/);
  assert.ok(!result.stderr.includes('Application must never run without isolation confirmation'));
});
