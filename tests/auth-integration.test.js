import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { verifyDevelopmentDatabase } from './verify-development-database.js';

process.env.NODE_ENV = 'test';
const { default: db } = await import('../src/models/db.js');
const { default: app } = await import('../server.js');
const { findUserByEmail } = await import('../src/models/users.js');
const adminEmail = 'admin@example.com';
const adminPassword = process.env.GRADING_ADMIN_PASSWORD;
const marker = 'auth-check-' + randomUUID();
const normalEmail = marker + '@example.com';
const normalPassword = randomBytes(16).toString('hex');
const created = { users: [], projects: [], organizations: [], categories: [] };
const paths = ['/new-organization', '/edit-organization/1', '/new-project', '/edit-project/1', '/new-category', '/edit-category/1', '/assign-categories/1'];
let base, server;
const csrf = (html) => html.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
const safeQuery = async (sql, values) => { await verifyDevelopmentDatabase(db); return db.query(sql, values); };
const client = () => {
  let cookie = '';
  const request = async (path, data, overrideCookie) => {
    // Check physical database and resolved configured host before EVERY POST,
    // even when that POST only logs in or is expected to fail authorization.
    if (data) await verifyDevelopmentDatabase(db);
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', redirect: 'manual',
      headers: { ...(cookie || overrideCookie ? { cookie: overrideCookie ?? cookie } : {}), ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: data ? new URLSearchParams(data) : undefined });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, html: await response.text(), headers: response.headers };
  };
  request.cookie = () => cookie;
  return request;
};
const login = async (request, email, password) => {
  const form = await request('/login');
  const result = await request('/login', { email, password, _csrf: csrf(form.html) });
  assert.equal(result.status, 303); assert.equal(result.headers.get('location'), '/dashboard');
};

before(async () => {
  await verifyDevelopmentDatabase(db);
  assert.ok(adminPassword, 'Provide the course grading password through GRADING_ADMIN_PASSWORD; never store it in source or SQL');
  const { rows: roles } = await db.query('SELECT role_name FROM roles ORDER BY role_name');
  assert.deepEqual(roles.map((role) => role.role_name), ['admin', 'user']);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  const existing = await findUserByEmail(adminEmail);
  if (!existing) {
    const request = client(); const form = await request('/register');
    const registration = await request('/register', { name: 'admin', email: adminEmail, password: adminPassword, _csrf: csrf(form.html) });
    assert.equal(registration.status, 303, 'Grading account must be created through registration');
    assert.equal((await findUserByEmail(adminEmail)).role_name, 'user');
    console.log('Grading account created through POST /register with normal user role.');
  }
  const stored = await findUserByEmail(adminEmail);
  assert.equal(await bcrypt.compare(adminPassword, stored.password_hash), true, 'Existing grading account password does not match; no password reset is performed');
  assert.equal(bcrypt.getRounds(stored.password_hash), 10);
  await safeQuery('UPDATE users SET role_id = (SELECT role_id FROM roles WHERE role_name = $1) WHERE email = $2', ['admin', adminEmail]);
  assert.equal((await findUserByEmail(adminEmail)).role_name, 'admin');
  console.log('Verified grading account: admin@example.com, admin role, bcrypt cost 10, supplied password matches.');
});
beforeEach(async () => { await verifyDevelopmentDatabase(db); });
after(async () => {
  try {
    // Delete only IDs created by these tests. The grading account is retained.
    for (const id of created.projects) await safeQuery('DELETE FROM project WHERE project_id = $1', [id]);
    for (const id of created.categories) await safeQuery('DELETE FROM category WHERE category_id = $1', [id]);
    for (const id of created.organizations) await safeQuery('DELETE FROM organization WHERE organization_id = $1', [id]);
    for (const id of created.users) await safeQuery('DELETE FROM users WHERE user_id = $1 AND email = $2', [id, normalEmail]);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
  }
});

test('local registration stores bcrypt, defaults to user, and rejects duplicate email', async () => {
  const request = client(); const form = await request('/register'); const token = csrf(form.html);
  const result = await request('/register', { name: marker, email: normalEmail, password: normalPassword, role_name: 'admin', _csrf: token });
  assert.equal(result.status, 303);
  const user = await findUserByEmail(normalEmail); created.users.push(user.user_id);
  assert.equal(user.role_name, 'user'); assert.equal(await bcrypt.compare(normalPassword, user.password_hash), true); assert.equal(bcrypt.getRounds(user.password_hash), 10);
  assert.equal((await request('/register', { name: marker, email: normalEmail, password: normalPassword, _csrf: token })).status, 409);
  const short = await request('/register', { name: marker, email: marker + '-short@example.com', password: 'short', _csrf: token });
  assert.equal(short.status, 422);
});

test('local correct/incorrect login, session rotation, dashboard, logout and old-cookie invalidation', async () => {
  const request = client(); const form = await request('/login'); const token = csrf(form.html); const oldCookie = request.cookie();
  assert.equal((await request('/login', { email: normalEmail, password: 'wrong', _csrf: token })).status, 401);
  await login(request, normalEmail, normalPassword); const authCookie = request.cookie(); assert.notEqual(authCookie, oldCookie);
  const dashboard = await request('/dashboard'); assert.equal(dashboard.status, 200); assert.ok(dashboard.html.includes(normalEmail));
  assert.doesNotMatch(dashboard.html, /href="\/users"|href="\/register"/);
  assert.match(dashboard.html, /action="\/logout"/);
  assert.equal((await client()('/dashboard', undefined, oldCookie)).headers.get('location'), '/login');
  assert.equal((await request('/logout', { _csrf: 'bad' })).status, 403);
  assert.equal((await request('/logout', { _csrf: csrf(dashboard.html) })).status, 303);
  assert.equal((await client()('/dashboard', undefined, authCookie)).headers.get('location'), '/login');
  assert.equal((await request('/dashboard')).headers.get('location'), '/login');
});

test('anonymous and normal users cannot access any management GET/POST or the users page', async () => {
  for (const role of ['anonymous', 'user']) {
    const request = client(); if (role === 'user') await login(request, normalEmail, normalPassword);
    const redirect = role === 'user' ? '/dashboard' : '/login';
    const form = await request(role === 'user' ? '/dashboard' : '/login'); const token = csrf(form.html);
    for (const path of [...paths, '/users']) {
      assert.equal((await request(path)).headers.get('location'), redirect, role + path);
      if (paths.includes(path)) assert.equal((await request(path, { _csrf: token, name: marker })).headers.get('location'), redirect, role + ' POST ' + path);
    }
    for (const path of ['/organizations', '/organization/1', '/projects', '/project/1', '/categories', '/category/1']) {
      assert.doesNotMatch((await request(path)).html, /href="\/(?:new-|edit-|assign-categories)/);
    }
  }
});

test('grading admin can view all joined users without any hash disclosure and sees management links', async () => {
  const request = client(); await login(request, adminEmail, adminPassword);
  assert.match((await request('/dashboard')).html, /href="\/users"/);
  const users = await request('/users'); assert.equal(users.status, 200); assert.ok(users.html.includes(adminEmail)); assert.ok(users.html.includes(normalEmail));
  for (const row of (await db.query('SELECT password_hash FROM users')).rows) assert.ok(!users.html.includes(row.password_hash));
  for (const path of paths) assert.equal((await request(path)).status, 200, path);
  for (const path of ['/organizations', '/projects', '/categories']) assert.match((await request(path)).html, /href="\/new-/);
});

test('admin Week 04 create/edit and association workflows work on tracked local fixtures only', async () => {
  const request = client(); await login(request, adminEmail, adminPassword);
  const submit = async (path, values) => { const form = await request(path); const result = await request(path, { ...values, _csrf: csrf(form.html) }); assert.equal(result.status, 303, path); return result.headers.get('location'); };
  for (let i = 0; i < 2; i++) {
    const path = await submit('/new-organization', { name: marker + '-org' + i, description: 'Local integration fixture', contactEmail: 'test@example.com' });
    created.organizations.push(Number(path.split('/').at(-1)));
  }
  await submit('/edit-organization/' + created.organizations[0], { name: marker + '-updated', description: 'Updated fixture', contactEmail: 'changed@example.com', logoFilename: 'community.svg' });
  for (let i = 0; i < 2; i++) {
    const path = await submit('/new-category', { name: marker + '-cat' + i }); created.categories.push(Number(path.split('/').at(-1)));
  }
  await submit('/edit-category/' + created.categories[0], { name: marker + '-renamed' });
  const projectData = { title: marker, description: 'Fixture project', location: 'Local test location', date: '2028-02-29', organizationId: String(created.organizations[0]) };
  const projectPath = await submit('/new-project', projectData); const id = Number(projectPath.split('/').at(-1)); created.projects.push(id);
  const editPath = '/edit-project/' + id;
  assert.ok((await request(editPath)).html.includes('value="2028-02-29"'));
  await submit(editPath, { ...projectData, organizationId: String(created.organizations[1]), date: '2030-01-01' });
  const updated = (await db.query('SELECT organization_id, date FROM project WHERE project_id = $1', [id])).rows[0];
  assert.equal(updated.organization_id, created.organizations[1]); assert.equal(updated.date, '2030-01-01');
  const assignPath = '/assign-categories/' + id; const assignForm = await request(assignPath);
  const data = new URLSearchParams({ _csrf: csrf(assignForm.html) });
  for (const categoryId of [...created.categories, created.categories[0]]) data.append('categoryIds', String(categoryId));
  assert.equal((await request(assignPath, data)).status, 303);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM project_category WHERE project_id = $1', [id])).rows[0].count, 2);
  const clearForm = await request(assignPath); assert.equal((await request(assignPath, { _csrf: csrf(clearForm.html) })).status, 303);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM project_category WHERE project_id = $1', [id])).rows[0].count, 0);
});
