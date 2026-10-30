import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { once } from 'node:events';

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
  try {
    await t.test('every existing model and relationship works with the real schema', async () => {
      const organizations = await organizationsModel.getAllOrganizations();
      const projects = await projectsModel.getAllProjects();
      const categories = await categoriesModel.getAllCategories();
      assert.ok(organizations.length, 'Need existing organizations to verify detail routes');
      assert.ok(projects.length, 'Need existing projects to verify detail routes');
      assert.ok(categories.length, 'Need existing categories to verify detail routes');
      for (const organization of organizations) {
        assert.deepEqual(await organizationsModel.getOrganizationDetails(organization.organization_id), organization);
        const linked = await projectsModel.getProjectsByOrganizationId(organization.organization_id);
        assert.deepEqual(linked.map((p) => p.project_id), projects.filter((p) => p.organization_id === organization.organization_id).map((p) => p.project_id));
        const html = await get(`/organization/${organization.organization_id}`);
        assert.ok(html.includes(`src="/images/${organization.logo}"`));
        assert.ok(existsSync(`public/images/${organization.logo}`), organization.logo);
        await get(`/images/${organization.logo}`);
        for (const project of linked) assert.ok(html.includes(`href="/project/${project.project_id}"`));
      }
      for (const project of projects) {
        assert.deepEqual(await projectsModel.getProjectDetails(project.project_id), project);
        const html = await get(`/project/${project.project_id}`);
        assert.ok(html.includes(`href="/organization/${project.organization_id}"`));
        const linked = await categoriesModel.getCategoriesByProjectId(project.project_id);
        for (const category of linked) {
          assert.ok(html.includes(`href="/category/${category.category_id}"`));
          assert.ok((await projectsModel.getProjectsByCategoryId(category.category_id)).some((p) => p.project_id === project.project_id));
        }
      }
      for (const category of categories) {
        assert.deepEqual(await categoriesModel.getCategoryDetails(category.category_id), category);
        const html = await get(`/category/${category.category_id}`);
        for (const project of await projectsModel.getProjectsByCategoryId(category.category_id)) {
          assert.ok(html.includes(`href="/project/${project.project_id}"`));
        }
      }
      console.log(`Verified ${organizations.length} organizations, ${projects.length} projects, ${categories.length} categories and their detail routes.`);
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
