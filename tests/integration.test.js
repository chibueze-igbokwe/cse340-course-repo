import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { extname } from 'node:path';
import ejs from 'ejs';

process.env.NODE_ENV = 'production';
const { default: db } = await import('../src/models/db.js');
const { default: app } = await import('../server.js');
const organizationsModel = await import('../src/models/organizations.js');
const projectsModel = await import('../src/models/projects.js');
const categoriesModel = await import('../src/models/categories.js');

test('read-only verification against the configured PostgreSQL database and local HTTP server', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, expectedStatus = 200) => {
    const response = await fetch(base + path);
    const html = await response.text();
    assert.equal(response.status, expectedStatus, path);
    return html;
  };
  const projectLinks = (html) => [...html.matchAll(/href="\/project\/(\d+)"/g)].map((match) => Number(match[1]));
  const sorted = (ids) => [...ids].sort((a, b) => a - b);
  try {
    await t.test('every existing model and relationship works with the real schema', async () => {
      const organizations = await organizationsModel.getAllOrganizations();
      const projects = await projectsModel.getAllProjects();
      const categories = await categoriesModel.getAllCategories();
      // Independent SQL expectations prevent two incorrect model functions
      // from making the relationship checks pass by agreeing with each other.
      const { rows: relationships } = await db.query('SELECT project_id, category_id FROM project_category');
      const { rows: calendarDates } = await db.query("SELECT project_id, to_char(date, 'YYYY-MM-DD') AS calendar_date, to_char(date, 'Mon FMDD, YYYY') AS display_date FROM project");
      const dates = new Map(calendarDates.map((row) => [row.project_id, row]));
      const organizationsHtml = await get('/organizations');
      const categoriesHtml = await get('/categories');
      assert.ok(organizations.length, 'Need existing organizations to verify detail routes');
      assert.ok(projects.length, 'Need existing projects to verify detail routes');
      assert.ok(categories.length, 'Need existing categories to verify detail routes');
      for (const organization of organizations) {
        assert.deepEqual(await organizationsModel.getOrganizationDetails(organization.organization_id), organization);
        const linked = await projectsModel.getProjectsByOrganizationId(organization.organization_id);
        assert.deepEqual(linked.map((p) => p.project_id), projects.filter((p) => p.organization_id === organization.organization_id).map((p) => p.project_id));
        const html = await get(`/organization/${organization.organization_id}`);
        assert.ok(organizationsHtml.includes(`href="/organization/${organization.organization_id}"`));
        assert.ok(organizationsHtml.includes(`src="/images/${organization.logo}"`));
        assert.ok(html.includes(`src="/images/${organization.logo}"`));
        const logoResponse = await fetch(`${base}/images/${organization.logo}`);
        assert.equal(logoResponse.status, 200);
        const imageTypes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
        assert.ok(logoResponse.headers.get('content-type').startsWith(imageTypes[extname(organization.logo).toLowerCase()]));
        assert.deepEqual(Buffer.from(await logoResponse.arrayBuffer()), readFileSync(`public/images/${organization.logo}`));
        assert.deepEqual(sorted(projectLinks(html)), sorted(linked.map((p) => p.project_id)));
        for (const project of linked) {
          assert.equal(project.date, dates.get(project.project_id).calendar_date);
          assert.ok(html.includes(dates.get(project.project_id).display_date));
        }
        console.log(`Verified database logo: ${organization.name} -> ${organization.logo}`);
      }
      for (const project of projects) {
        assert.deepEqual(await projectsModel.getProjectDetails(project.project_id), project);
        const html = await get(`/project/${project.project_id}`);
        assert.equal(project.date, dates.get(project.project_id).calendar_date);
        assert.ok(html.includes(dates.get(project.project_id).display_date));
        assert.ok(html.includes(`href="/organization/${project.organization_id}"`));
        const linked = await categoriesModel.getCategoriesByProjectId(project.project_id);
        const expectedCategoryIds = sorted(relationships.filter((row) => row.project_id === project.project_id).map((row) => row.category_id));
        assert.deepEqual(sorted(linked.map((row) => row.category_id)), expectedCategoryIds);
        const tagIds = [...html.matchAll(/class="tag" href="\/category\/(\d+)"/g)].map((match) => Number(match[1]));
        assert.deepEqual(sorted(tagIds), expectedCategoryIds);
        for (const category of linked) {
          assert.ok(html.includes(`href="/category/${category.category_id}"`));
          assert.ok((await projectsModel.getProjectsByCategoryId(category.category_id)).some((p) => p.project_id === project.project_id));
        }
      }
      for (const category of categories) {
        assert.deepEqual(await categoriesModel.getCategoryDetails(category.category_id), category);
        const html = await get(`/category/${category.category_id}`);
        assert.ok(categoriesHtml.includes(`href="/category/${category.category_id}"`));
        const linked = await projectsModel.getProjectsByCategoryId(category.category_id);
        const expectedProjectIds = sorted(relationships.filter((row) => row.category_id === category.category_id).map((row) => row.project_id));
        assert.deepEqual(sorted(linked.map((row) => row.project_id)), expectedProjectIds);
        assert.deepEqual(sorted(projectLinks(html)), expectedProjectIds);
        for (const project of linked) {
          assert.equal(project.date, dates.get(project.project_id).calendar_date);
          assert.ok(html.includes(dates.get(project.project_id).display_date));
        }
      }
      console.log(`Verified ${organizations.length} organizations, ${projects.length} projects, ${categories.length} categories and their detail routes.`);
    });

    await t.test('Week 04 GET forms use real organization fields and production sessions without writing database records', async () => {
      const response = await fetch(base + '/new-organization', { headers: { 'X-Forwarded-Proto': 'https' } });
      assert.equal(response.status, 200);
      const cookie = response.headers.get('set-cookie');
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /Secure/);
      assert.match(cookie, /SameSite=Lax/);
      const html = await response.text();
      const token = html.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
      assert.match(html, /action="\/new-organization" method="POST"/);
      for (const organization of await organizationsModel.getAllOrganizations()) {
        const edit = await fetch(`${base}/edit-organization/${organization.organization_id}`, {
          headers: { 'X-Forwarded-Proto': 'https', Cookie: cookie.split(';')[0] }
        });
        assert.equal(edit.status, 200);
        const editHtml = await edit.text();
        assert.ok(editHtml.includes(`value="${ejs.escapeXML(organization.name)}"`));
        assert.ok(editHtml.includes(`value="${ejs.escapeXML(organization.email)}"`));
        assert.ok(editHtml.includes(`value="${ejs.escapeXML(organization.logo)}"`));
        assert.ok(editHtml.includes(`${ejs.escapeXML(organization.description)}</textarea>`));
        assert.ok(editHtml.includes(`value="${token}"`), 'File-backed session must retain the form token across requests');
      }
      for (const id of ['abc', '0', '2147483648', '2147483647']) await get('/edit-organization/' + id, 404);
      const placeholder = await fetch(base + '/images/placeholder-logo.png');
      assert.equal(placeholder.status, 200);
      assert.match(placeholder.headers.get('content-type'), /image\/png/);
      assert.deepEqual(Buffer.from(await placeholder.arrayBuffer()), readFileSync('public/images/placeholder-logo.png'));
      // Intentionally no valid POST requests to the real database.
    });

    await t.test('project create/edit and assignment GET forms match real dates, organizations and category links', async () => {
      const response = await fetch(base + '/new-project', { headers: { 'X-Forwarded-Proto': 'https' } });
      assert.equal(response.status, 200);
      const cookie = response.headers.get('set-cookie').split(';')[0];
      const newHtml = await response.text();
      assert.match(newHtml, /action="\/new-project" method="POST"/);
      const organizations = await organizationsModel.getAllOrganizations();
      const categories = await categoriesModel.getAllCategories();
      const { rows: links } = await db.query('SELECT project_id, category_id FROM project_category');
      for (const organization of organizations) {
        assert.ok(newHtml.includes(`value="${organization.organization_id}">${ejs.escapeXML(organization.name)}</option>`));
      }
      const formGet = async (path) => {
        const page = await fetch(base + path, { headers: { 'X-Forwarded-Proto': 'https', Cookie: cookie } });
        assert.equal(page.status, 200, path);
        return page.text();
      };
      for (const project of await projectsModel.getAllProjects()) {
        const editHtml = await formGet(`/edit-project/${project.project_id}`);
        assert.ok(editHtml.includes(`value="${project.date}"`));
        assert.ok(editHtml.includes(`value="${ejs.escapeXML(project.title)}"`));
        assert.ok(editHtml.includes(`value="${project.organization_id}" selected>`));
        const assignmentsHtml = await formGet(`/assign-categories/${project.project_id}`);
        const checked = [...assignmentsHtml.matchAll(/name="categoryIds" value="(\d+)" checked/g)].map((match) => Number(match[1]));
        const expected = links.filter((link) => link.project_id === project.project_id).map((link) => link.category_id);
        assert.deepEqual(sorted(checked), sorted(expected));
        for (const category of categories) {
          assert.ok(assignmentsHtml.includes(`for="category-${category.category_id}">${ejs.escapeXML(category.name)}</label>`));
        }
      }
      for (const route of ['/edit-project/', '/assign-categories/']) {
        for (const id of ['abc', '0', '-1', '2147483648', '2147483647']) await get(route + id, 404);
      }
      assert.match(await get('/projects'), /href="\/new-project"/);
      // No POST requests: shared project and relationship records are untouched.
    });

    await t.test('actual upcoming SQL includes today, excludes yesterday, sorts and limits read-only fixtures', async () => {
      // CTEs shadow table names for this SELECT only. No records or tables are
      // created, changed, or reset, even when the real data has no past dates.
      const query = db.query;
      db.query = (sql, values) => query.call(db, `
        WITH project AS (
          SELECT project_id, 1 AS organization_id,
                 'Fixture ' || project_id AS title, ''::text AS description,
                 ''::text AS location, CURRENT_DATE + day_offset AS date
          FROM (VALUES (901, -1), (902, 3), (903, 0), (904, 1),
                       (905, 6), (906, 2), (907, 5), (908, 4)) AS fixture(project_id, day_offset)
        ), organization AS (
          SELECT 1 AS organization_id, 'Fixture Organization'::text AS name
        )
        ${sql}
      `, values);
      try {
        assert.deepEqual((await projectsModel.getUpcomingProjects(5)).map((row) => row.project_id), [903, 904, 906, 902, 908]);
        assert.deepEqual((await projectsModel.getUpcomingProjects(100)).map((row) => row.project_id), [903, 904, 906, 902, 908, 907, 905]);
        assert.deepEqual(await projectsModel.getUpcomingProjects(0), []);
      } finally { db.query = query; }
    });

    await t.test('upcoming projects filter by database CURRENT_DATE and respect arbitrary limits', async () => {
      const { rows: [{ today }] } = await db.query('SELECT CURRENT_DATE AS today');
      const all = await projectsModel.getAllProjects();
      const expected = all.filter((project) => project.date >= today);
      for (const limit of [0, 1, 5, 100]) {
        assert.deepEqual(await projectsModel.getUpcomingProjects(limit), expected.slice(0, limit));
      }
      const html = await get('/projects');
      assert.equal((html.match(/href="\/project\/\d+"/g) || []).length, Math.min(5, expected.length));
      for (const project of expected.slice(0, 5)) {
        assert.ok(html.includes(`href="/project/${project.project_id}"`));
        assert.ok(html.includes(`href="/organization/${project.organization_id}"`));
      }
    });

    await t.test('existing pages, invalid IDs, genuinely missing IDs and 500 handling', async (subtest) => {
      for (const path of ['/', '/organizations', '/projects', '/categories', '/css/style.css']) await get(path);
      for (const resource of ['organization', 'project', 'category']) {
        for (const id of ['abc', '-1', '0', '1.5', '2147483648', '2147483647']) {
          await get(`/${resource}/${id}`, 404);
        }
      }
      assert.equal(await organizationsModel.getOrganizationDetails(2147483647), null);
      assert.equal(await projectsModel.getProjectDetails(2147483647), null);
      assert.equal(await categoriesModel.getCategoryDetails(2147483647), null);
      await get('/not-a-route', 404);
      subtest.mock.method(console, 'error', () => {});
      const html = await get('/test-error', 500);
      assert.match(html, /Something Went Wrong/);
      assert.ok(!html.includes('This is a test error'));
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.end();
  }
});
