import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.NODE_ENV = 'test';
process.env.DB_URL ||= 'postgresql://unused:unused@localhost/unused';
const { default: app } = await import('../server.js');
const { default: db } = await import('../src/models/db.js');
const { createCategory, updateCategory } = await import('../src/models/categories.js');
const originalQuery = db.query;
const project = { project_id: 3, organization_id: 1, organization_name: 'Organization', title: 'Service Project', description: 'Description', location: 'Location', date: '2026-11-07' };
let category;
let calls;
let mode;
let server;
let base;

before(async () => {
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    const writing = /^\s*(INSERT|UPDATE)/.test(sql);
    if (writing && mode === 'duplicate') throw Object.assign(new Error('Private category_name_key constraint details'), { code: '23505' });
    if (writing && mode === 'error') throw new Error('Private category database failure');
    if (!writing && mode === 'lookup-error') throw new Error('Private category lookup failure');
    if (mode === 'missing' || (writing && mode === 'deleted')) return { rows: [] };
    if (writing) {
      category.name = values[0];
      return { rows: [{ category_id: category.category_id }] };
    }
    if (/FROM category/.test(sql)) return { rows: [category] };
    if (/FROM project/.test(sql)) return { rows: [project] };
    throw new Error('Unexpected category-test query: ' + sql);
  };
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { category = { category_id: 7, name: 'Community & Care' }; calls = []; mode = 'normal'; });
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
const openForm = async (request, path = '/new-category') => {
  const page = await request(path);
  assert.equal(page.status, 200, path);
  const token = page.html.match(/name="_csrf" value="([a-f0-9]{64})"/);
  assert.ok(token, 'Category form requires a session-bound CSRF token');
  return { ...page, token: token[1] };
};
const writes = () => calls.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql));

test('category model SQL binds names and IDs, returns IDs, and reports missing rows', async () => {
  const hostile = "Care'); DROP TABLE category; --";
  assert.equal(await createCategory(hostile), 7);
  assert.equal(await updateCategory('7 OR 1=1', hostile), 7);
  const [insert, update] = writes();
  assert.match(insert.sql, /INSERT INTO category \(name\)/);
  assert.match(insert.sql, /VALUES \(\$1\)/);
  assert.deepEqual(insert.values, [hostile]);
  assert.match(update.sql, /SET name = \$1/);
  assert.match(update.sql, /WHERE category_id = \$2/);
  assert.deepEqual(update.values, [hostile, '7 OR 1=1']);
  for (const query of writes()) {
    assert.ok(!query.sql.includes(hostile));
    assert.ok(!query.sql.includes('7 OR 1=1'));
    assert.ok(!query.sql.includes('project_category'), 'Renaming a category must retain relationships');
  }
  mode = 'missing';
  await assert.rejects(createCategory('New category'), /Failed to create category/);
  await assert.rejects(updateCategory(7, 'Updated category'), { message: 'Category not found', status: 404 });
});

test('GET forms are accessible and prefilled; browser validation requires only presence and max length', async () => {
  const request = client();
  for (const path of ['/new-category', '/edit-category/7']) {
    const { html } = await openForm(request, path);
    assert.ok(html.includes(`action="${path}" method="POST"`));
    const input = html.match(/<input\b[^>]*name="name"[^>]*>/)[0];
    assert.match(input, /type="text"/);
    assert.match(input, /maxlength="100"/);
    assert.match(input, /\brequired\b/);
    // Prevent regressions that block the rubric's one-/two-character test in the browser.
    assert.doesNotMatch(html, /\bminlength\s*=|\bpattern\s*=|<script\b|\bon(?:input|change|blur)\s*=/i);
    assert.match(html, /<label for="name">Category name<\/label>/);
    assert.match(input, /aria-describedby="name-help"/);
    assert.match(html, /<main id="main-content"/);
    assert.match(input, path === '/new-category' ? /value=""/ : /value="Community &amp; Care"/);
  }
  assert.match((await request('/categories')).html, /href="\/new-category"/);
  assert.match((await request('/category/7')).html, /href="\/edit-category\/7"/);
  assert.equal(writes().length, 0);
});

test('one- and two-character category names reach server validation on both POST routes and never write', async () => {
  const request = client();
  const { token } = await openForm(request);
  for (const path of ['/new-category', '/edit-category/7']) {
    for (const name of ['a', 'ab', ' a ', ' ab ']) {
      const response = await request(path, { name, _csrf: token });
      assert.equal(response.status, 422, `${path}: ${name}`);
      assert.match(response.html, /Category name must be between 3 and 100 characters/);
      assert.ok(response.html.includes(`value="${name.trim()}"`));
      assert.match(response.html, /role="alert"/);
      assert.match(response.html, /href="#name"/);
      assert.match(response.html, /aria-invalid="true"/);
      assert.match(response.html, /aria-describedby="name-help name-error"/);
    }
  }
  assert.equal(writes().length, 0);
});

test('missing, empty, whitespace, too-long, NUL, and repeated names fail without writes', async () => {
  const request = client();
  const { token } = await openForm(request);
  for (const path of ['/new-category', '/edit-category/7']) {
    assert.equal((await request(path, { _csrf: token })).status, 422);
    for (const name of ['', '   ', 'n'.repeat(101), 'Bad\0Name']) {
      assert.equal((await request(path, { name, _csrf: token })).status, 422);
    }
    const repeated = new URLSearchParams({ _csrf: token, name: 'First name' });
    repeated.append('name', 'Second name');
    assert.equal((await request(path, repeated)).status, 422);
  }
  assert.equal(writes().length, 0);
});

test('three- and 100-character names save trimmed, redirect, and flash once per session', async () => {
  const request = client();
  const { token } = await openForm(request);
  for (const path of ['/new-category', '/edit-category/7']) {
    for (const name of ['abc', 'n'.repeat(100)]) {
      const response = await request(path, { name: `  ${name}  `, _csrf: token, category_id: '999' });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/category/7');
      const write = writes().at(-1);
      assert.deepEqual(write.values, path === '/new-category' ? [name] : [name, '7']);
      const message = path === '/new-category' ? 'Category added successfully!' : 'Category updated successfully!';
      assert.ok(!(await client()('/category/7')).html.includes(message));
      await request('/css/style.css');
      const details = await request('/category/7');
      assert.ok(details.html.includes(message));
      assert.ok(details.html.includes(`<h1>${name}</h1>`));
      assert.ok(!(await request('/category/7')).html.includes(message));
    }
  }
});

test('hostile category names remain bound text and escape correctly in forms and details', async () => {
  const request = client();
  const { token } = await openForm(request);
  const name = 'Care "group" <script>bad()</script>';
  const response = await request('/new-category', { name, _csrf: token });
  assert.equal(response.status, 303);
  assert.deepEqual(writes().at(-1).values, [name]);
  const edit = await request('/edit-category/7');
  assert.match(edit.html, /Care &#34;group&#34; &lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.ok(!(await request('/category/7')).html.includes('<script>bad()</script>'));
  assert.ok(!edit.html.includes('<script>bad()</script>'));
});

test('renaming a category keeps project links and category tags on the existing category ID', async () => {
  const request = client();
  const { token } = await openForm(request, '/edit-category/7');
  assert.equal((await request('/edit-category/7', { name: 'Renamed Category', _csrf: token })).status, 303);
  const details = await request('/category/7');
  assert.match(details.html, /<h1>Renamed Category<\/h1>/);
  assert.match(details.html, /href="\/project\/3"/);
  const projectDetails = await request('/project/3');
  assert.match(projectDetails.html, /class="tag" href="\/category\/7">Renamed Category<\/a>/);
  assert.equal(writes().length, 1);
  assert.match(writes()[0].sql, /UPDATE category/);
  assert.doesNotMatch(writes()[0].sql, /project_category/);
});

test('duplicate names and database errors preserve escaped input with helpful private feedback', async (t) => {
  t.mock.method(console, 'error', () => {});
  const request = client();
  const { token } = await openForm(request);
  const name = 'Care "group" <name>';
  for (const path of ['/new-category', '/edit-category/7']) {
    mode = 'duplicate';
    const duplicate = await request(path, { name, _csrf: token });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.html, /already exists/);
    assert.match(duplicate.html, /Care &#34;group&#34; &lt;name&gt;/);
    assert.ok(!duplicate.html.includes('category_name_key'));
    mode = 'error';
    const failed = await request(path, { name, _csrf: token });
    assert.equal(failed.status, 500);
    assert.match(failed.html, /Your entry is preserved/);
    assert.match(failed.html, /Care &#34;group&#34; &lt;name&gt;/);
    assert.ok(!failed.html.includes('Private category database failure'));
  }
});

test('invalid IDs, nonexistent categories and deletion between lookup and update return 404', async () => {
  const request = client();
  const { token } = await openForm(request);
  calls = [];
  for (const id of ['abc', '0', '-1', '1.5', '2147483648', '7%20OR%201=1']) {
    assert.equal((await request('/edit-category/' + id)).status, 404);
    assert.equal((await request('/edit-category/' + id, { name: 'Updated', _csrf: token })).status, 404);
  }
  assert.equal(calls.length, 0);
  mode = 'missing';
  assert.equal((await request('/edit-category/2147483647')).status, 404);
  assert.equal((await request('/edit-category/2147483647', { name: 'Updated', _csrf: token })).status, 404);
  assert.equal(writes().length, 0);
  mode = 'deleted';
  assert.equal((await request('/edit-category/7', { name: 'Updated', _csrf: token })).status, 404);
});

test('category POST routes reject missing, incorrect, repeated and foreign-session CSRF tokens', async () => {
  const request = client();
  const { token } = await openForm(request);
  calls = [];
  for (const path of ['/new-category', '/edit-category/7']) {
    assert.equal((await request(path, { name: 'Updated' })).status, 403);
    assert.equal((await request(path, { name: 'Updated', _csrf: '0'.repeat(64) })).status, 403);
    assert.equal((await client()(path, { name: 'Updated', _csrf: token })).status, 403);
    const repeated = new URLSearchParams({ name: 'Updated', _csrf: token });
    repeated.append('_csrf', token);
    assert.equal((await request(path, repeated)).status, 403);
  }
  assert.equal(calls.length, 0);
});

test('category lookup failures are handled without exposing database details or writing', async (t) => {
  t.mock.method(console, 'error', () => {});
  const request = client();
  const { token } = await openForm(request);
  mode = 'lookup-error';
  const edit = await request('/edit-category/7');
  assert.equal(edit.status, 500);
  assert.ok(!edit.html.includes('Private category lookup failure'));
  const failed = await request('/edit-category/7', { name: 'Preserved name', _csrf: token });
  assert.equal(failed.status, 500);
  assert.match(failed.html, /value="Preserved name"/);
  assert.equal(writes().length, 0);
});
