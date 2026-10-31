import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.NODE_ENV = 'test';
process.env.DB_URL ||= 'postgresql://unused:unused@localhost/unused';
const { default: app } = await import('../server.js');
const { default: db } = await import('../src/models/db.js');
const { createProject, updateProject } = await import('../src/models/projects.js');
const { updateCategoryAssignments } = await import('../src/models/categories.js');
const { isProjectDate } = await import('../src/utils/validate-project-date.js');
const originalQuery = db.query;
const originalConnect = db.connect;
const organizations = [{ organization_id: 1, name: 'First Organization' }, { organization_id: 2, name: 'Second Organization' }];
const categories = [{ category_id: 1, name: 'Community' }, { category_id: 2, name: 'Education' }, { category_id: 3, name: 'Environment' }];
const originalProject = { project_id: 7, title: 'Existing Project', description: 'Original description', location: 'Original location', date: '2028-02-29', organization_id: 1, organization_name: 'First Organization' };
const valid = { title: 'New Project', description: 'Support our community', location: 'Community Center', date: '2026-11-07', organizationId: '2' };
let project;
let assignments;
let pendingAssignments;
let calls;
let mode;
let releases;
let server;
let base;

const execute = async (sql, values, transactional = false) => {
  calls.push({ sql, values, transactional });
  if (sql === 'BEGIN') { pendingAssignments = [...assignments]; return { rows: [] }; }
  if (sql === 'COMMIT') { assignments = pendingAssignments; return { rows: [] }; }
  if (sql === 'ROLLBACK') { pendingAssignments = [...assignments]; return { rows: [] }; }
  const writing = /^\s*(INSERT|UPDATE|DELETE)/.test(sql);
  if (writing && mode === 'error') throw new Error('Private database failure');
  if (writing && mode === 'foreign-key') throw Object.assign(new Error('Private foreign key detail'), { code: '23503' });
  if (/FOR UPDATE/.test(sql)) return { rows: mode === 'deleted' ? [] : [{ project_id: 7 }] };
  if (/DELETE FROM project_category/.test(sql)) { pendingAssignments = []; return { rows: [] }; }
  if (/INSERT INTO project_category/.test(sql)) {
    if (mode === 'second-category-error' && values[1] === 3) throw new Error('Relationship insertion failed');
    if (!pendingAssignments.includes(Number(values[1]))) pendingAssignments.push(Number(values[1]));
    return { rows: [] };
  }
  if (/INSERT INTO project|UPDATE project\s/.test(sql)) {
    if (mode === 'deleted') return { rows: [] };
    project = { project_id: 7, title: values[0], description: values[1], location: values[2], date: values[3], organization_id: Number(values[4]), organization_name: organizations.find((org) => org.organization_id === Number(values[4]))?.name };
    return { rows: [{ project_id: 7 }] };
  }
  if (/FROM organization/.test(sql)) {
    if (mode === 'lookup-error') throw new Error('Private organization lookup failure');
    return { rows: mode === 'no-organizations' ? [] : organizations };
  }
  if (/FROM category/.test(sql)) {
    return { rows: /JOIN project_category/.test(sql) ? categories.filter((category) => assignments.includes(category.category_id)) : categories };
  }
  if (/FROM project p/.test(sql)) return { rows: mode === 'missing' ? [] : [project] };
  throw new Error('Unexpected query in project tests: ' + sql);
};

before(async () => {
  db.query = (sql, values) => execute(sql, values);
  db.connect = async () => {
    if (mode === 'connect-error') throw new Error('Private pool acquisition failure');
    return { query: (sql, values) => execute(sql, values, true), release: () => { releases += 1; } };
  };
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { project = { ...originalProject }; assignments = [1, 2]; calls = []; mode = 'normal'; releases = 0; });
after(async () => {
  db.query = originalQuery;
  db.connect = originalConnect;
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
const openForm = async (request, path = '/new-project') => {
  const page = await request(path);
  assert.equal(page.status, 200, path);
  const token = page.html.match(/name="_csrf" value="([a-f0-9]{64})"/);
  assert.ok(token);
  return { ...page, token: token[1] };
};
const writes = () => calls.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql));

test('project SQL binds every field and permits changing organization_id; missing update throws 404', async () => {
  const hostile = "Project'); DROP TABLE project; --";
  assert.equal(await createProject(hostile, hostile, hostile, '2028-02-29', '2'), 7);
  assert.equal(await updateProject('7 OR 1=1', hostile, hostile, hostile, '2028-02-29', '2'), 7);
  const [insert, update] = writes();
  assert.match(insert.sql, /VALUES \(\$1, \$2, \$3, \$4, \$5\)/);
  assert.deepEqual(insert.values, [hostile, hostile, hostile, '2028-02-29', '2']);
  assert.match(update.sql, /organization_id = \$5/);
  assert.match(update.sql, /WHERE project_id = \$6/);
  assert.deepEqual(update.values, [hostile, hostile, hostile, '2028-02-29', '2', '7 OR 1=1']);
  for (const query of writes()) assert.ok(!query.sql.includes(hostile) && !query.sql.includes('7 OR 1=1'));
  mode = 'deleted';
  await assert.rejects(updateProject(7, ...Object.values(valid)), { message: 'Project not found', status: 404 });
  await assert.rejects(createProject(...Object.values(valid)), /Failed to create project/);
});

test('calendar validation rejects rollover and timestamps and accepts Gregorian leap/year boundaries', () => {
  for (const date of ['0001-01-01', '2026-12-31', '2027-01-01', '2000-02-29', '2028-02-29', '9999-12-31', '2026-03-08', '2026-11-01']) assert.equal(isProjectDate(date), true, date);
  for (const date of ['', '0000-01-01', '10000-01-01', '1900-02-29', '2026-02-29', '2026-02-30', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', ['2026-01-01']]) assert.equal(isProjectDate(date), false, String(date));
});

test('project forms include labels, native constraints, organization options, exact date and selected organization', async () => {
  const request = client();
  const page = await openForm(request);
  assert.match(page.html, /action="\/new-project" method="POST"/);
  assert.match(page.html, /minlength="3" maxlength="200" required/);
  assert.match(page.html, /maxlength="1000" required/);
  for (const field of ['title', 'description', 'location', 'date', 'organizationId']) assert.ok(page.html.includes(`for="${field}"`));
  const edit = await openForm(request, '/edit-project/7');
  assert.match(edit.html, /value="2028-02-29"/);
  assert.match(edit.html, /value="1" selected>First Organization/);
  assert.match(edit.html, /value="2">Second Organization/);
  assert.match(edit.html, />Original description<\/textarea>/);
  assert.match((await request('/projects')).html, /href="\/new-project"/);
  const details = await request('/project/7');
  assert.match(details.html, /href="\/edit-project\/7"/);
  assert.match(details.html, /href="\/assign-categories\/7"/);
  assert.equal(writes().length, 0);
});

test('valid project creation and edits preserve calendar date, change organization, redirect and flash once', async () => {
  const request = client();
  const { token } = await openForm(request);
  const created = await request('/new-project', { ...valid, title: '  New Project  ', _csrf: token });
  assert.equal(created.status, 303);
  assert.equal(created.headers.get('location'), '/project/7');
  assert.deepEqual(writes()[0].values, Object.values(valid));
  assert.match((await request('/project/7')).html, /Service project created successfully!/);
  assert.ok(!(await request('/project/7')).html.includes('Service project created successfully!'));
  const edited = await request('/edit-project/7', { ...valid, organizationId: '1', date: '2000-02-29', _csrf: token });
  assert.equal(edited.status, 303);
  assert.deepEqual(writes().at(-1).values, [valid.title, valid.description, valid.location, '2000-02-29', '1', '7']);
  const details = await request('/project/7');
  assert.match(details.html, /Service project updated successfully!/);
  assert.match(details.html, /href="\/organization\/1"/);
  assert.match((await request('/edit-project/7')).html, /value="2000-02-29"/);
  assert.match((await request('/edit-project/7')).html, /value="1" selected/);
});

test('invalid projects, unknown organizations, duplicate scalar fields and invalid dates never write', async () => {
  const request = client();
  const { token } = await openForm(request);
  for (const path of ['/new-project', '/edit-project/7']) {
    for (const overrides of [
      { title: '' }, { title: 'ab' }, { title: 't'.repeat(201) }, { description: ' ' },
      { description: 'd'.repeat(1001) }, { location: '' }, { location: 'l'.repeat(201) },
      { title: 'Bad\0Title' }, { date: '2026-02-30' }, { date: '1900-02-29' }, { date: '0000-01-01' },
      { date: '2026-10-31T12:00:00Z' }, { organizationId: '999' }, { organizationId: '1 OR 1=1' },
      { organizationId: '-1' }, { organizationId: '2147483648' }
    ]) {
      const failed = await request(path, { ...valid, ...overrides, _csrf: token });
      assert.equal(failed.status, 422, path + JSON.stringify(overrides));
      assert.match(failed.html, /role="alert"/);
      assert.match(failed.html, /aria-invalid="true"/);
    }
    for (const field of Object.keys(valid)) {
      const repeated = new URLSearchParams({ ...valid, _csrf: token });
      repeated.append(field, valid[field]);
      assert.equal((await request(path, repeated)).status, 422);
    }
  }
  assert.equal(writes().length, 0);
});

test('project validation retains escaped text, date, organization choice, and boundary-length values', async () => {
  const request = client();
  const { token } = await openForm(request);
  const failed = await request('/new-project', { ...valid, title: 'A "quoted" <project>', description: '</textarea><script>bad()</script>', location: '', date: '2028-02-29', _csrf: token });
  assert.equal(failed.status, 422);
  assert.match(failed.html, /A &#34;quoted&#34; &lt;project&gt;/);
  assert.ok(!failed.html.includes('<script>bad()</script>'));
  assert.match(failed.html, /value="2028-02-29"/);
  assert.match(failed.html, /value="2" selected/);
  const accepted = await request('/new-project', { ...valid, title: 't'.repeat(200), description: 'd'.repeat(1000), location: 'l'.repeat(200), date: '9999-12-31', _csrf: token });
  assert.equal(accepted.status, 303);
});

test('project database failures preserve input; foreign key races are actionable; lookups fail safely', async (t) => {
  t.mock.method(console, 'error', () => {});
  const request = client();
  const { token } = await openForm(request);
  for (const path of ['/new-project', '/edit-project/7']) {
    mode = 'error';
    const failed = await request(path, { ...valid, _csrf: token });
    assert.equal(failed.status, 500);
    assert.match(failed.html, /Your entries are preserved/);
    assert.match(failed.html, /value="2026-11-07"/);
    assert.ok(!failed.html.includes('Private database failure'));
    mode = 'foreign-key';
    assert.equal((await request(path, { ...valid, _csrf: token })).status, 422);
  }
  mode = 'lookup-error';
  assert.equal((await request('/new-project')).status, 500);
  mode = 'no-organizations';
  assert.match((await request('/new-project')).html, /Add an organization before saving/);
  assert.equal((await request('/new-project', { ...valid, _csrf: token })).status, 422);
});

test('project and category form routes reject invalid/missing IDs and deletion races', async () => {
  const request = client();
  const { token } = await openForm(request);
  calls = [];
  for (const route of ['/edit-project/', '/assign-categories/']) {
    for (const id of ['abc', '0', '-1', '1.5', '2147483648', '7%20OR%201=1']) {
      assert.equal((await request(route + id)).status, 404);
      assert.equal((await request(route + id, { ...valid, _csrf: token })).status, 404);
    }
  }
  assert.equal(calls.length, 0);
  mode = 'missing';
  for (const route of ['/edit-project/7', '/assign-categories/7']) {
    assert.equal((await request(route)).status, 404);
    assert.equal((await request(route, { ...valid, _csrf: token })).status, 404);
  }
  mode = 'deleted';
  assert.equal((await request('/edit-project/7', { ...valid, _csrf: token })).status, 404);
  assert.equal((await request('/assign-categories/7', { categoryIds: '1', _csrf: token })).status, 404);
  assert.equal(releases, 1);
});

test('category replacement uses one locked transaction, parameterized SQL, deduplication and release', async () => {
  await updateCategoryAssignments('7', ['2', '02', '3', '3']);
  assert.deepEqual(assignments, [2, 3]);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /FOR UPDATE/);
  assert.deepEqual(calls[1].values, ['7']);
  assert.match(calls[2].sql, /DELETE FROM project_category WHERE project_id = \$1/);
  assert.deepEqual(calls[2].values, ['7']);
  const inserts = calls.filter(({ sql }) => /INSERT INTO project_category/.test(sql));
  assert.deepEqual(inserts.map(({ values }) => values), [['7', 2], ['7', 3]]);
  for (const insert of inserts) {
    assert.match(insert.sql, /VALUES \(\$1, \$2\)/);
    assert.match(insert.sql, /ON CONFLICT \(project_id, category_id\) DO NOTHING/);
  }
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.ok(calls.every(({ transactional }) => transactional));
  assert.equal(releases, 1);
  await updateCategoryAssignments('7', []);
  assert.deepEqual(assignments, []);
  calls = [];
  await updateCategoryAssignments('7 OR 1=1', [1]);
  for (const query of calls) assert.ok(!query.sql.includes('7 OR 1=1'));
  assert.deepEqual(calls.find(({ sql }) => /DELETE FROM/.test(sql)).values, ['7 OR 1=1']);
  assert.deepEqual(calls.find(({ sql }) => /INSERT INTO/.test(sql)).values, ['7 OR 1=1', 1]);
});

test('failed relationship insert rolls back earlier changes and releases; pool failures propagate', async () => {
  mode = 'second-category-error';
  await assert.rejects(updateCategoryAssignments('7', [2, 3]), /Relationship insertion failed/);
  assert.deepEqual(assignments, [1, 2]);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!calls.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(releases, 1);
  mode = 'connect-error';
  await assert.rejects(updateCategoryAssignments('7', [2]), /pool acquisition/);
});

test('category form prechecks existing links; single/multiple/duplicate/empty selections update and flash', async () => {
  const request = client();
  const { token, html } = await openForm(request, '/assign-categories/7');
  assert.match(html, /name="categoryIds" value="1" checked/);
  assert.match(html, /name="categoryIds" value="2" checked/);
  assert.match(html, /name="categoryIds" value="3">/);
  for (const selected of [['2'], ['2', '3', '2'], []]) {
    const data = new URLSearchParams({ _csrf: token });
    for (const id of selected) data.append('categoryIds', id);
    const response = await request('/assign-categories/7', data);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/project/7');
    assert.deepEqual(assignments, [...new Set(selected.map(Number))]);
    assert.match((await request('/project/7')).html, /Categories updated successfully!/);
  }
});

test('category form rejects unknown/hostile IDs, keeps valid choices, and preserves assignments on errors', async (t) => {
  t.mock.method(console, 'error', () => {});
  const request = client();
  const { token } = await openForm(request, '/assign-categories/7');
  for (const invalid of ['999', '1 OR 1=1', '-1', '0', '2147483648', '1.2', '']) {
    const data = new URLSearchParams({ _csrf: token, categoryIds: '2' });
    data.append('categoryIds', invalid);
    const response = await request('/assign-categories/7', data);
    assert.equal(response.status, 422);
    assert.match(response.html, /value="2" checked/);
    assert.deepEqual(assignments, [1, 2]);
  }
  assert.equal(writes().length, 0);
  assert.equal((await request('/assign-categories/7', { _csrf: token, 'categoryIds[]': '3' })).status, 422);
  assert.deepEqual(assignments, [1, 2]);
  mode = 'error';
  const failed = await request('/assign-categories/7', { _csrf: token, categoryIds: '3' });
  assert.equal(failed.status, 500);
  assert.match(failed.html, /Your selections are preserved/);
  assert.match(failed.html, /value="3" checked/);
  assert.ok(!failed.html.includes('Private database failure'));
  assert.deepEqual(assignments, [1, 2]);
  mode = 'foreign-key';
  assert.equal((await request('/assign-categories/7', { _csrf: token, categoryIds: '3' })).status, 422);
  assert.deepEqual(assignments, [1, 2]);
});

test('all project write routes require a token from the same session', async () => {
  const request = client();
  const { token } = await openForm(request);
  calls = [];
  for (const path of ['/new-project', '/edit-project/7', '/assign-categories/7']) {
    assert.equal((await request(path, valid)).status, 403);
    assert.equal((await request(path, { ...valid, _csrf: 'f'.repeat(64) })).status, 403);
    assert.equal((await client()(path, { ...valid, _csrf: token })).status, 403);
  }
  assert.equal(calls.length, 0);
});

test('category checkbox parser accepts more than ten selections and deduplicates them', async () => {
  const request = client();
  const { token } = await openForm(request, '/assign-categories/7');
  const data = new URLSearchParams({ _csrf: token });
  for (let i = 0; i < 12; i++) data.append('categoryIds', '1');
  assert.equal((await request('/assign-categories/7', data)).status, 303);
  assert.deepEqual(assignments, [1]);
  for (let i = 0; i < 100; i++) data.append('categoryIds', '1');
  assert.equal((await request('/assign-categories/7', data)).status, 413);
});
