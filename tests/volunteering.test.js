import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../server.js');
const { default: db } = await import('../src/models/db.js');
const models = await import('../src/models/volunteers.js');
const originalQuery = db.query;
const password = randomBytes(16).toString('hex');
const passwordHash = await bcrypt.hash(password, 4);
const project = { project_id: 1, title: 'Food <Drive>', description: 'Synthetic project',
  organization_id: 1, organization_name: 'Community & Care', location: 'Town Hall', date: '2028-02-29' };
let calls, registrations, failure, server, base;
before(async () => {
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/FROM users/.test(sql)) {
      const userId = { 'first@example.invalid': 1, 'second@example.invalid': 2, 'admin@example.invalid': 3 }[values[0]];
      return { rows: userId ? [{ user_id: userId, name: 'Synthetic User', email: values[0],
        role_name: userId === 3 ? 'admin' : 'user', password_hash: passwordHash }] : [] };
    }
    if (/FROM project/.test(sql)) {
      if (failure === 'lookup') throw new Error('Private database details');
      return { rows: Number(values?.[0]) === 999 ? [] : [project] };
    }
    if (/FROM category/.test(sql)) return { rows: [] };
    const writing = /^\s*(INSERT|DELETE)/.test(sql);
    if (writing && failure === 'write') throw new Error('Private database details');
    if (writing && failure === 'fk') throw Object.assign(new Error('Private foreign key'), { code: '23503' });
    const key = `${values?.[0]}:${values?.[1]}`;
    if (/INSERT INTO volunteer/.test(sql)) {
      if (registrations.has(key)) return { rows: [] };
      registrations.add(key); return { rows: [{ project_id: values[1] }] };
    }
    if (/DELETE FROM volunteer/.test(sql)) return { rows: registrations.delete(key) ? [{ project_id: values[1] }] : [] };
    if (/FROM volunteer/.test(sql)) {
      if (failure === 'volunteer') throw new Error('Private volunteer details');
      if (/SELECT EXISTS/.test(sql)) return { rows: [{ volunteering: registrations.has(key) }] };
      return { rows: registrations.has(`${values[0]}:1`) ? [project] : [] };
    }
    throw new Error('Unexpected mocked query');
  };
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { calls = []; registrations = new Set(); failure = ''; });
after(async () => { db.query = originalQuery; await new Promise(resolve => server.close(resolve)); await db.end(); });
const client = () => {
  let cookie = '';
  return async (path, data) => {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: data ? new URLSearchParams(data) : undefined });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, html: await response.text(), headers: response.headers };
  };
};
const token = html => html.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
const login = async (request, email = 'first@example.invalid') => {
  const form = await request('/login');
  assert.equal((await request('/login', { email, password, _csrf: token(form.html) })).status, 303);
};
const writes = () => calls.filter(({ sql }) => /^\s*(INSERT|DELETE)/.test(sql));

test('all volunteer models parameterize IDs, return correct values and handle duplicates/removal safely', async () => {
  assert.equal(await models.isVolunteering(1, 1), false);
  assert.equal(await models.addVolunteer(1, 1), true);
  assert.equal(await models.addVolunteer(1, 1), false);
  assert.equal(await models.isVolunteering(1, 1), true);
  assert.deepEqual(await models.getVolunteerProjects(1), [project]);
  assert.deepEqual(await models.getVolunteerProjects(2), []);
  assert.equal(await models.removeVolunteer(1, 1), true);
  assert.equal(await models.removeVolunteer(1, 1), false);
  for (const fn of [models.addVolunteer, models.removeVolunteer, models.isVolunteering]) {
    await fn("1' OR 1=1 --", '2');
    assert.deepEqual(calls.at(-1).values, ["1' OR 1=1 --", '2']);
    assert.ok(!calls.at(-1).sql.includes("1' OR 1=1 --"));
  }
  await models.getVolunteerProjects('1 OR 1=1');
  assert.deepEqual(calls.at(-1).values, ['1 OR 1=1']);
  assert.match(calls.find(({ sql }) => /ON CONFLICT/.test(sql)).sql, /ON CONFLICT \(user_id, project_id\) DO NOTHING/);
  const list = calls.find(({ sql }) => /FROM volunteer v/.test(sql)).sql;
  assert.match(list, /WHERE v.user_id = \$1/); assert.match(list, /JOIN project/); assert.match(list, /JOIN organization/);
  assert.doesNotMatch(list, /CURRENT_DATE/);
});

test('guests see no volunteering controls and cannot add, remove or view private registrations', async () => {
  const request = client();
  assert.doesNotMatch((await request('/project/1')).html, /project-volunteering|action="\/project\/1\//);
  calls = [];
  for (const path of ['/my-volunteering', '/project/1/volunteer', '/project/1/remove-volunteering']) {
    const response = await request(path, path === '/my-volunteering' ? undefined : { user_id: '2' });
    assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/login');
  }
  assert.equal(calls.length, 0);
});

test('complete local HTTP flow updates status, dashboard list, flash feedback and removal empty state', async () => {
  const request = client(); await login(request);
  assert.match((await request('/dashboard')).html, /href="\/my-volunteering"/);
  assert.match((await request('/my-volunteering')).html, /not volunteered for any projects/);
  let detail = await request('/project/1');
  assert.match(detail.html, /Volunteer for this project/);
  const add = await request('/project/1/volunteer', { _csrf: token(detail.html) });
  assert.equal(add.status, 303); assert.equal(add.headers.get('location'), '/project/1');
  detail = await request('/project/1');
  assert.match(detail.html, /You are volunteering/); assert.match(detail.html, /Remove volunteering/);
  assert.equal(detail.headers.get('cache-control'), 'no-store');
  const list = await request('/my-volunteering');
  assert.equal(list.status, 200); assert.match(list.html, /Food &lt;Drive&gt;/);
  assert.doesNotMatch(list.html, /Food <Drive>/); assert.match(list.html, /Feb 29, 2028/);
  assert.match(list.html, /href="\/project\/1"/); assert.match(list.html, /href="\/organization\/1"/);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  const remove = await request('/project/1/remove-volunteering', { _csrf: token(list.html), returnTo: 'my-volunteering' });
  assert.equal(remove.status, 303); assert.equal(remove.headers.get('location'), '/my-volunteering');
  const empty = await request('/my-volunteering'); assert.match(empty.html, /not volunteered for any projects/);
  assert.match(empty.html, /Your volunteering has been removed/);
  assert.match((await request('/project/1')).html, /Volunteer for this project/);
});

test('duplicate posts and repeated removals are idempotent with truthful feedback', async () => {
  const request = client(); await login(request);
  const csrf = token((await request('/project/1')).html);
  for (let i = 0; i < 2; i++) assert.equal((await request('/project/1/volunteer', { _csrf: csrf })).status, 303);
  assert.equal(registrations.size, 1);
  assert.match((await request('/project/1')).html, /already volunteering/);
  for (let i = 0; i < 2; i++) assert.equal((await request('/project/1/remove-volunteering', { _csrf: csrf })).status, 303);
  assert.equal(registrations.size, 0);
  assert.match((await request('/project/1')).html, /not volunteering for this project/);
});

test('ownership uses session only; forged user IDs cannot add or remove another user registration', async () => {
  const first = client(), second = client(); await login(first); await login(second, 'second@example.invalid');
  const firstToken = token((await first('/project/1')).html), secondToken = token((await second('/project/1')).html);
  await first('/project/1/volunteer', { _csrf: firstToken, user_id: '2', userId: '2' });
  assert.deepEqual([...registrations], ['1:1']);
  await second('/project/1/remove-volunteering', { _csrf: secondToken, user_id: '1' });
  assert.deepEqual([...registrations], ['1:1']);
  assert.match((await second('/my-volunteering')).html, /not volunteered/);
  assert.match((await first('/my-volunteering')).html, /Food &lt;Drive&gt;/);
  assert.deepEqual(writes().map(({ values }) => values[0]), [1, 2]);
});

test('CSRF is required and bound to the same session before any write', async () => {
  const first = client(), second = client(); await login(first); await login(second, 'second@example.invalid');
  const otherToken = token((await second('/project/1')).html);
  for (const suffix of ['volunteer', 'remove-volunteering']) {
    for (const data of [{}, { _csrf: 'incorrect' }, { _csrf: otherToken }, new URLSearchParams([['_csrf', otherToken], ['_csrf', otherToken]])]) {
      assert.equal((await first('/project/1/' + suffix, data)).status, 403);
    }
  }
  assert.equal(writes().length, 0);
});

test('invalid and nonexistent projects return 404; GET cannot change volunteering; redirects are allowlisted', async () => {
  const request = client(); await login(request); const csrf = token((await request('/project/1')).html);
  for (const suffix of ['volunteer', 'remove-volunteering']) {
    for (const id of ['abc', '0', '-1', '2147483648', '1%20OR%201=1', '999']) {
      assert.equal((await request(`/project/${id}/${suffix}`, { _csrf: csrf })).status, 404);
    }
    assert.equal((await request(`/project/1/${suffix}`)).status, 404);
  }
  assert.equal(writes().length, 0);
  const result = await request('/project/1/remove-volunteering', { _csrf: csrf, returnTo: 'https://example.invalid' });
  assert.equal(result.headers.get('location'), '/project/1');
});

test('write failures preserve existing registrations; read failures are private 500s; FK races are 404', async t => {
  t.mock.method(console, 'error', () => {});
  const request = client(); await login(request); const csrf = token((await request('/project/1')).html);
  registrations.add('1:1'); failure = 'write';
  assert.equal((await request('/project/1/remove-volunteering', { _csrf: csrf })).status, 303);
  failure = ''; const detail = await request('/project/1');
  assert.match(detail.html, /could not update/); assert.match(detail.html, /You are volunteering/);
  assert.doesNotMatch(detail.html, /Private database/);
  failure = 'fk'; assert.equal((await request('/project/1/volunteer', { _csrf: csrf })).status, 404);
  failure = 'volunteer';
  for (const path of ['/my-volunteering', '/project/1']) {
    const response = await request(path); assert.equal(response.status, 500); assert.doesNotMatch(response.html, /Private volunteer/);
  }
});

test('admins can volunteer while ordinary users remain denied administrative workflows', async () => {
  const admin = client(); await login(admin, 'admin@example.invalid');
  const csrf = token((await admin('/project/1')).html);
  assert.equal((await admin('/project/1/volunteer', { _csrf: csrf })).status, 303);
  assert.ok(registrations.has('3:1'));
  assert.equal((await admin('/new-category')).status, 200);
  const regular = client(); await login(regular);
  const denied = await regular('/new-category'); assert.equal(denied.status, 303);
  assert.equal(denied.headers.get('location'), '/dashboard');
});
