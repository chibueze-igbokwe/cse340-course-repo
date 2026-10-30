import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Separate processes exercise actual runtime timezones, the configured pg
// parser, Express view locals, and every page that displays a project date.
for (const [timezone, offset] of [['UTC', 0], ['Africa/Lagos', -60], ['America/Los_Angeles', 480], ['Pacific/Kiritimati', -840]]) {
  test(`PostgreSQL calendar dates render unchanged in ${timezone}`, () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
      env: { ...process.env, TZ: timezone, NODE_ENV: 'production', DB_URL: 'postgresql://unused:unused@localhost/unused' },
      encoding: 'utf8',
      timeout: 15000,
      input: `
        import assert from 'node:assert/strict';
        import pg from 'pg';
        import app from './server.js';
        import db from './src/models/db.js';
        assert.equal(new Date('2026-11-07T12:00:00Z').getTimezoneOffset(), ${offset}, 'Child process must actually use the requested timezone');
        const parseDate = db.options.types.getTypeParser(pg.types.builtins.DATE, 'text');
        assert.equal(db.options.types.getTypeParser(pg.types.builtins.INT4, 'text')('42'), 42);
        const render = (view, locals) => new Promise((resolve, reject) => {
          app.render(view, locals, (error, html) => error ? reject(error) : resolve(html));
        });
        const cases = [
          ['2026-11-07', 'Nov 7, 2026'],
          ['2026-01-01', 'Jan 1, 2026'],
          ['2026-12-31', 'Dec 31, 2026'],
          ['2028-02-29', 'Feb 29, 2028'],
          ['2026-03-08', 'Mar 8, 2026'],
          ['2026-11-01', 'Nov 1, 2026']
        ];
        for (const [date, expected] of cases) {
          const parsed = parseDate(date);
          assert.equal(parsed, date, 'DATE parser must preserve the original calendar day');
          const project = { project_id: 1, organization_id: 1, organization_name: 'Organization', title: 'Project', description: 'Description', location: 'Location', date: parsed };
          const locals = {
            title: 'Date test', NODE_ENV: 'production', project, projects: [project],
            categories: [], category: { name: 'Category' },
            organizationDetails: { organization_id: 1, name: 'Organization', description: 'Description', logo: 'community.svg', email: 'hello@example.com' }
          };
          for (const view of ['projects', 'project', 'organization', 'category']) {
            assert.ok((await render(view, locals)).includes(expected), view + ': ' + date + ' must display ' + expected);
          }
        }
        await db.end();
      `
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
