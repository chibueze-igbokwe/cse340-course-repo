import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Isolated tests never connect to the database, even without a local .env file.
process.env.DB_URL ||= 'postgresql://unused:unused@localhost/unused';
process.env.NODE_ENV = 'production';
const { default: db } = await import('../src/models/db.js');
const { default: app } = await import('../server.js');
const organizations = await import('../src/models/organizations.js');
const projects = await import('../src/models/projects.js');
const categories = await import('../src/models/categories.js');
const originalQuery = db.query;
let server;
let base;
let calls;
let mode;
const organization = { organization_id: 1, name: 'Community & Care', description: '<script>alert(1)</script>', email: 'hello@example.com', logo: 'community.svg' };
const project = { project_id: 1, organization_id: 1, organization_name: organization.name, title: 'Food <Drive>', description: organization.description, location: 'Town & Hall', date: '2026-11-07' };
const category = { category_id: 1, name: 'Community <Support>' };

before(async () => {
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (mode === 'error') throw new Error('Private database failure');
    if (mode === 'empty' || values?.[0] === '2147483647') return { rows: [] };
    if (/FROM organization/.test(sql)) return { rows: [organization] };
    if (/FROM category/.test(sql)) return { rows: [category] };
    return { rows: [project] };
  };
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { calls = []; mode = 'normal'; });
after(async () => {
  db.query = originalQuery;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.end();
});

const get = async (path) => {
  const response = await fetch(base + path);
  return { status: response.status, html: await response.text(), headers: response.headers };
};

test('all model functions return rows and bind dynamic values separately', async () => {
  const cases = [
    [organizations.getAllOrganizations, [], [organization]],
    [organizations.getOrganizationDetails, [1], organization],
    [projects.getAllProjects, [], [project]],
    [projects.getUpcomingProjects, [5], [project]],
    [projects.getProjectDetails, [1], project],
    [projects.getProjectsByOrganizationId, [1], [project]],
    [projects.getProjectsByCategoryId, [1], [project]],
    [categories.getAllCategories, [], [category]],
    [categories.getCategoryDetails, [1], category],
    [categories.getCategoriesByProjectId, [1], [category]]
  ];
  for (const [fn, args, expected] of cases) {
    assert.deepEqual(await fn(...args), expected, fn.name);
    const call = calls.at(-1);
    if (args.length) {
      assert.match(call.sql, /\$1/);
      assert.deepEqual(call.values, args);
    }
  }
  const upcoming = calls.find(({ sql }) => /LIMIT/.test(sql));
  assert.match(upcoming.sql, /date >= CURRENT_DATE/);
  assert.match(upcoming.sql, /ORDER BY p.date ASC/);
  assert.match(upcoming.sql, /LIMIT \$1/);
  const hostileId = '1 OR 1=1';
  await projects.getProjectDetails(hostileId);
  assert.deepEqual(calls.at(-1).values, [hostileId]);
  assert.ok(!calls.at(-1).sql.includes(hostileId));
});

test('detail models return null when records are missing', async () => {
  mode = 'empty';
  for (const fn of [organizations.getOrganizationDetails, projects.getProjectDetails, categories.getCategoryDetails]) {
    assert.equal(await fn(1), null);
  }
});

test('home and all list/detail routes render with semantic main content', async () => {
  for (const path of ['/', '/organizations', '/organization/1', '/projects', '/project/1', '/categories', '/category/1']) {
    const { status, html } = await get(path);
    assert.equal(status, 200, path);
    assert.match(html, /<main id="main-content"/);
    assert.match(html, /href="#main-content"/);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, path);
  }
});

test('list and detail pages contain the required reciprocal links and escape database text', async () => {
  const expectations = [
    ['/organizations', ['/organization/1']],
    ['/organization/1', ['/project/1', '/images/community.svg']],
    ['/projects', ['/project/1', '/organization/1']],
    ['/project/1', ['/organization/1', '/category/1']],
    ['/categories', ['/category/1']],
    ['/category/1', ['/project/1']]
  ];
  for (const [path, links] of expectations) {
    const { html } = await get(path);
    for (const link of links) assert.ok(html.includes(`"${link}"`), `${path}: ${link}`);
    assert.ok(!html.includes('<script>'), path);
    assert.ok(!html.includes('Food <Drive>'), path);
    assert.ok(!html.includes('Community <Support>'), path);
  }
  assert.match((await get('/project/1')).html, /Food &lt;Drive&gt;/);
  assert.match((await get('/project/1')).html, /Community &lt;Support&gt;/);
  await get('/projects');
  assert.deepEqual(calls.at(-1).values, [5]);
});

test('invalid IDs return 404 without querying PostgreSQL; missing records also return 404', async () => {
  for (const resource of ['organization', 'project', 'category']) {
    for (const id of ['abc', '0', '-1', '1.2', '1abc', '2147483648', '999999999999999999999', '1%20OR%201=1']) {
      const { status, html } = await get(`/${resource}/${id}`);
      assert.equal(status, 404, `${resource}/${id}`);
      assert.match(html, /Page Not Found/);
    }
  }
  assert.equal(calls.length, 0);
  for (const resource of ['organization', 'project', 'category']) {
    assert.equal((await get(`/${resource}/2147483647`)).status, 404);
  }
  assert.equal((await get('/missing-page')).status, 404);
});

test('empty directories and empty project/category relationships have helpful messages', async () => {
  mode = 'empty';
  for (const path of ['/organizations', '/projects', '/categories']) {
    const { status, html } = await get(path);
    assert.equal(status, 200);
    assert.match(html, /No (organizations|upcoming projects|categories)/);
  }
  const query = db.query;
  db.query = async (sql, values) => {
    if (/FROM project\s*WHERE organization_id =|WHERE pc.category_id =|WHERE pc.project_id =/.test(sql)) return { rows: [] };
    mode = 'normal';
    return query(sql, values);
  };
  try {
    for (const path of ['/organization/1', '/category/1']) {
      const { status, html } = await get(path);
      assert.equal(status, 200);
      assert.match(html, /No service projects/);
    }
    assert.match((await get('/project/1')).html, /No categories have been assigned/);
  } finally { db.query = query; }
});

test('database errors and the course test-error route render 500 without leaking production details', async (t) => {
  t.mock.method(console, 'error', () => {});
  mode = 'error';
  for (const path of ['/organizations', '/organization/1', '/projects', '/project/1', '/categories', '/category/1', '/test-error']) {
    const { status, html } = await get(path);
    assert.equal(status, 500, path);
    assert.match(html, /Something Went Wrong/);
    assert.ok(!html.includes('Private database failure'));
    assert.ok(!html.includes('This is a test error'));
    assert.match(html, /href="\/"/);
  }
  assert.equal((await get('/')).status, 200);
});

test('all existing logos and stylesheet are served with correct content types', async () => {
  for (const logo of ['community.svg', 'education.svg', 'environment.svg']) {
    const result = await get(`/images/${logo}`);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(result.html, /<svg/);
  }
  const css = await get('/css/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(css.html, /focus-visible/);
  assert.match(css.html, /@media \(max-width: 750px\)/);
});
