import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import session from 'express-session';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.DB_URL ||= 'postgresql://unused:unused@localhost/unused';
const { default: app } = await import('../server.js');
const { default: db } = await import('../src/models/db.js');
const { createOrganization, updateOrganization } = await import('../src/models/organizations.js');
const { createSessionOptions } = await import('../src/middleware/session.js');
const originalQuery = db.query;
const organization = { organization_id: 1, name: 'Existing Organization', description: 'Existing description', email: 'hello@example.com', logo: 'community.svg' };
const valid = { name: 'New Organization', description: 'Helping the community', contactEmail: 'contact@example.com', logoFilename: 'community.svg' };
let calls;
let mode;
let server;
let base;

before(async () => {
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    const writing = /^\s*(INSERT|UPDATE)/.test(sql);
    if (writing && mode === 'duplicate') throw Object.assign(new Error('Private unique constraint details'), { code: '23505' });
    if (writing && mode === 'error') throw new Error('Private database connection details');
    if (mode === 'missing' || (writing && mode === 'deleted')) return { rows: [] };
    if (writing) return { rows: [{ organization_id: 1 }] };
    if (/FROM organization/.test(sql)) return { rows: [organization] };
    return { rows: [] };
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
  return async (path, { data, rawBody, headers = {} } = {}) => {
    const response = await fetch(base + path, {
      method: data || rawBody !== undefined ? 'POST' : 'GET',
      redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(data || rawBody !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...headers },
      body: data ? new URLSearchParams(data) : rawBody
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, html: await response.text(), headers: response.headers };
  };
};
const openForm = async (request, path = '/new-organization') => {
  const page = await request(path);
  assert.equal(page.status, 200);
  const token = page.html.match(/name="_csrf" value="([a-f0-9]{64})"/);
  assert.ok(token, 'Rendered form must contain a session-bound CSRF token');
  return { ...page, token: token[1] };
};
const writes = () => calls.filter(({ sql }) => /^\s*(INSERT|UPDATE)/.test(sql));

test('session secret is required; production cookie options and store are safe', () => {
  const store = new session.MemoryStore();
  assert.throws(() => createSessionOptions({}, store), /SESSION_SECRET/);
  assert.throws(() => createSessionOptions({ SESSION_SECRET: 'short' }, store), /SESSION_SECRET/);
  const options = createSessionOptions({ SESSION_SECRET: process.env.SESSION_SECRET, NODE_ENV: 'production' }, store);
  assert.equal(options.cookie.secure, true);
  assert.equal(options.cookie.httpOnly, true);
  assert.equal(options.cookie.sameSite, 'lax');
  assert.equal(options.saveUninitialized, false);
  assert.equal(options.resave, false);
  assert.equal(options.cookie.maxAge, 3600000);
});

test('production sets a Secure cookie behind the trusted HTTPS proxy, never over plain HTTP', async () => {
  const productionApp = express();
  productionApp.set('trust proxy', 1);
  productionApp.use(session(createSessionOptions({ SESSION_SECRET: process.env.SESSION_SECRET, NODE_ENV: 'production' }, new session.MemoryStore())));
  productionApp.get('/', (req, res) => { req.session.probe = true; res.send('Session test'); });
  const productionServer = productionApp.listen(0, '127.0.0.1');
  await once(productionServer, 'listening');
  const url = `http://127.0.0.1:${productionServer.address().port}/`;
  try {
    assert.equal((await fetch(url)).headers.get('set-cookie'), null);
    const response = await fetch(url, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(response.headers.get('set-cookie'), /Secure/);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  } finally { await new Promise((resolve) => productionServer.close(resolve)); }
});

test('create/update SQL bind every value including hostile text and IDs', async () => {
  const hostile = "Robert'); DROP TABLE organization; --";
  assert.equal(await createOrganization(hostile, hostile, 'a@example.com', 'community.svg'), 1);
  assert.equal(await updateOrganization('1 OR 1=1', hostile, hostile, 'a@example.com', 'community.svg'), 1);
  const [insert, update] = writes();
  assert.match(insert.sql, /INSERT INTO organization \(name, description, email, logo\)/);
  assert.match(insert.sql, /VALUES \(\$1, \$2, \$3, \$4\)/);
  assert.deepEqual(insert.values, [hostile, hostile, 'a@example.com', 'community.svg']);
  assert.match(update.sql, /SET name = \$1, description = \$2, email = \$3, logo = \$4/);
  assert.match(update.sql, /WHERE organization_id = \$5/);
  assert.deepEqual(update.values, [hostile, hostile, 'a@example.com', 'community.svg', '1 OR 1=1']);
  for (const call of writes()) {
    assert.ok(!call.sql.includes(hostile));
    assert.ok(!call.sql.includes('1 OR 1=1'));
  }
  mode = 'missing';
  assert.equal(await updateOrganization(1, ...Object.values(valid)), null);
  await assert.rejects(createOrganization('Name', 'Description', 'a@example.com', 'community.svg'), /Failed to create/);
});

test('GET forms provide accessible fields, native validation, existing values, and navigation links', async () => {
  const request = client();
  const page = await openForm(request);
  assert.match(page.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(page.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.match(page.html, /action="\/new-organization" method="POST"/);
  assert.match(page.html, /minlength="3" maxlength="150" required/);
  assert.match(page.html, /maxlength="500" required/);
  assert.match(page.html, /type="email"/);
  for (const field of ['name', 'description', 'contactEmail']) assert.ok(page.html.includes(`for="${field}"`));
  const edit = await openForm(request, '/edit-organization/1');
  assert.match(edit.html, /action="\/edit-organization\/1" method="POST"/);
  assert.match(edit.html, /value="Existing Organization"/);
  assert.match(edit.html, />Existing description<\/textarea>/);
  assert.match(edit.html, /value="hello@example.com"/);
  assert.match(edit.html, /value="community.svg"/);
  assert.match((await request('/organizations')).html, /href="\/new-organization"/);
  assert.match((await request('/organization/1')).html, /href="\/edit-organization\/1"/);
  assert.equal(writes().length, 0);
});

test('valid create trims input, uses server-selected placeholder, redirects, and flashes once per session', async () => {
  const request = client();
  const { token } = await openForm(request);
  const response = await request('/new-organization', { data: { ...valid, name: '  New Organization  ', contactEmail: ' contact@EXAMPLE.COM ', logoFilename: '../../evil.svg', _csrf: token } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/organization/1');
  assert.deepEqual(writes()[0].values, ['New Organization', valid.description, 'contact@example.com', 'placeholder-logo.png']);
  const otherSession = await client()('/organization/1');
  assert.ok(!otherSession.html.includes('Organization added successfully!'));
  // Static assets must not consume the flash message.
  assert.equal((await request('/css/style.css')).status, 200);
  assert.match((await request('/organization/1')).html, /Organization added successfully!/);
  assert.ok(!(await request('/organization/1')).html.includes('Organization added successfully!'));
});

test('valid edit updates only the URL ID and redirects with a success message', async () => {
  const request = client();
  const { token } = await openForm(request, '/edit-organization/1');
  const response = await request('/edit-organization/1', { data: { ...valid, organization_id: '999', _csrf: token } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/organization/1');
  assert.deepEqual(writes()[0].values, [valid.name, valid.description, valid.contactEmail, valid.logoFilename, '1']);
  assert.match((await request('/organization/1')).html, /Organization updated successfully!/);
});

test('server rejects missing, whitespace, short/long fields, malformed emails, and repeated keys without writes', async () => {
  const request = client();
  const { token } = await openForm(request);
  for (const overrides of [
    { name: '' }, { name: '   ' }, { name: 'ab' }, { name: 'n'.repeat(151) },
    { description: '' }, { description: '   ' }, { description: 'd'.repeat(501) },
    { contactEmail: '' }, { contactEmail: 'not-email' }, { contactEmail: 'a'.repeat(256) }, { name: 'Bad\0Name' }
  ]) {
    const response = await request('/new-organization', { data: { ...valid, ...overrides, _csrf: token } });
    assert.equal(response.status, 422, JSON.stringify(overrides));
    assert.match(response.html, /role="alert"/);
    assert.match(response.html, /aria-invalid="true"/);
  }
  const repeated = new URLSearchParams({ ...valid, _csrf: token });
  repeated.append('name', 'Second name');
  assert.equal((await request('/new-organization', { rawBody: repeated.toString() })).status, 422);
  assert.equal(writes().length, 0);
});

test('validation and database errors preserve escaped form input for both workflows', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const path of ['/new-organization', '/edit-organization/1']) {
    const request = client();
    const { token } = await openForm(request, path);
    const data = { ...valid, name: 'A "quoted" <name>', description: '</textarea><script>alert(1)</script>', _csrf: token };
    const invalid = await request(path, { data: { ...data, contactEmail: 'not-email' } });
    assert.equal(invalid.status, 422);
    assert.match(invalid.html, /A &#34;quoted&#34; &lt;name&gt;/);
    assert.ok(!invalid.html.includes('<script>alert(1)</script>'));
    mode = 'duplicate';
    const duplicate = await request(path, { data });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.html, /already exists/);
    assert.ok(!duplicate.html.includes('Private unique constraint details'));
    mode = 'error';
    const failed = await request(path, { data });
    assert.equal(failed.status, 500);
    assert.match(failed.html, /Your entries are preserved/);
    assert.match(failed.html, /A &#34;quoted&#34; &lt;name&gt;/);
    assert.ok(!failed.html.includes('Private database connection details'));
    mode = 'normal';
  }
});

test('edit validates logo against existing assets and rejects URLs and path traversal', async () => {
  const request = client();
  const { token } = await openForm(request, '/edit-organization/1');
  for (const logoFilename of ['', '../community.svg', 'https://example.com/logo.svg', 'missing.png']) {
    const response = await request('/edit-organization/1', { data: { ...valid, logoFilename, _csrf: token } });
    assert.equal(response.status, 422);
    assert.match(response.html, /Choose a logo filename/);
  }
  assert.equal(writes().length, 0);
  assert.equal((await request('/images/placeholder-logo.png')).status, 200);
});

test('invalid/missing edit IDs and concurrent deletion return 404 without an unintended write', async () => {
  const request = client();
  const { token } = await openForm(request);
  calls = [];
  for (const id of ['abc', '0', '-1', '1.5', '2147483648', '1%20OR%201=1']) {
    assert.equal((await request('/edit-organization/' + id)).status, 404);
    assert.equal((await request('/edit-organization/' + id, { data: { ...valid, _csrf: token } })).status, 404);
  }
  assert.equal(calls.length, 0);
  mode = 'missing';
  assert.equal((await request('/edit-organization/1')).status, 404);
  assert.equal((await request('/edit-organization/1', { data: { ...valid, _csrf: token } })).status, 404);
  assert.equal(writes().length, 0);
  mode = 'deleted';
  assert.equal((await request('/edit-organization/1', { data: { ...valid, _csrf: token } })).status, 404);
});

test('CSRF tokens are required and bound to their session', async () => {
  const request = client();
  const { token } = await openForm(request);
  for (const path of ['/new-organization', '/edit-organization/1']) {
    assert.equal((await request(path, { data: valid })).status, 403);
    assert.equal((await request(path, { data: { ...valid, _csrf: '0'.repeat(64) } })).status, 403);
    assert.equal((await client()(path, { data: { ...valid, _csrf: token } })).status, 403);
  }
  assert.equal(writes().length, 0);
});

test('parser limits size, parameter count, and compression without executing writes', async () => {
  const request = client();
  assert.equal((await request('/new-organization', { rawBody: 'name=' + 'a'.repeat(17000) })).status, 413);
  assert.equal((await request('/new-organization', { rawBody: Array.from({ length: 11 }, (_, i) => `field${i}=x`).join('&') })).status, 413);
  assert.equal((await request('/new-organization', { rawBody: 'name=test', headers: { 'Content-Encoding': 'gzip' } })).status, 415);
  assert.equal(writes().length, 0);
});
