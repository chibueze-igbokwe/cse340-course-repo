import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';

// Explicit optional suite, never part of npm test. Reuse only the pre-existing
// disposable Week 05 database; no database creation, setup.sql, or production.
test('Week 06 real PostgreSQL migration and HTTP flow, rolled back in localhost disposable database', async t => {
  dotenv.config({ quiet: true });
  const source = process.env.DEV_DB_URL || process.env.DB_URL;
  assert.ok(source, 'Local credentials must already be configured.');
  const url = new URL(source);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Refusing non-local configuration.');
  assert.ok(!url.port || url.port === '5432', 'Unexpected local PostgreSQL port.');
  url.hostname = '127.0.0.1'; url.port = '5432';
  url.pathname = '/cse340_week05_migration_test'; url.search = '';
  const connection = new pg.Client({ connectionString: url.toString(), ssl: false,
    options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 5000,
    types: { getTypeParser: (oid, format) => oid === pg.types.builtins.DATE
      ? value => value : pg.types.getTypeParser(oid, format) } });
  let server, db, originalQuery;
  const guard = async () => {
    const row = (await connection.query('SELECT current_database() AS name, host(inet_server_addr()) AS address, inet_server_port() AS port')).rows[0];
    assert.equal(row.name, 'cse340_week05_migration_test');
    assert.equal(row.address, '127.0.0.1'); assert.equal(row.port, 5432);
  };
  const write = async (sql, values) => { await guard(); return connection.query(sql, values); };
  const snapshots = async () => {
    const result = {};
    // Fixed identifiers only. Entire existing records stay private, in memory.
    for (const table of ['organization', 'project', 'category', 'project_category', 'roles', 'users']) {
      result[table] = (await connection.query(`SELECT * FROM public.${table} ORDER BY 1, 2`)).rows;
    }
    return result;
  };
  let baseline;
  try {
    await connection.connect(); await guard(); baseline = await snapshots();
    process.env.DB_URL = url.toString(); process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = randomBytes(64).toString('hex');
    db = (await import('../src/models/db.js')).default;
    originalQuery = db.query;
    // Real SQL over one transaction; no mocked result sets or production pool.
    db.query = (sql, values) => write(sql, values);
    const { default: app } = await import('../server.js');
    const models = await import('../src/models/volunteers.js');
    const file = readFileSync('src/migrations/006-volunteering.sql', 'utf8');
    const body = file.replace(/\bBEGIN;\s*/, '').replace(/\bCOMMIT;\s*$/, '');
    await guard(); await connection.query('SET default_transaction_read_only=off');
    await write('BEGIN');
    await t.test('additive migration creates compatible table and rejects incompatible rerun atomically', async () => {
      await write(body); await write(body);
      const constraints = (await connection.query("SELECT contype FROM pg_constraint WHERE conrelid='public.volunteer'::regclass AND contype IN ('p','f')")).rows;
      assert.equal(constraints.filter(row => row.contype === 'p').length, 1);
      assert.equal(constraints.filter(row => row.contype === 'f').length, 2);
      await write('SAVEPOINT incompatible');
      await write('ALTER TABLE volunteer ADD COLUMN incompatible integer');
      await assert.rejects(write(body), /Volunteer columns differ/);
      await connection.query('ROLLBACK TO SAVEPOINT incompatible');
    });
    const id = 1000000000 + randomInt(1, 100000000);
    const password = randomBytes(16).toString('hex'), hash = await bcrypt.hash(password, 10);
    await write('INSERT INTO organization (organization_id,name,description,email,logo) OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5)',
      [id, `W06 isolated ${id}`, 'Synthetic rollback fixture', 'fixture@example.invalid', 'community.svg']);
    await write('INSERT INTO project (project_id,organization_id,title,description,location,date) OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6)',
      [id, id, 'W06 <Synthetic> Project', 'Rollback fixture', 'Test Hall', '2028-02-29']);
    for (const offset of [1, 2]) {
      await write('INSERT INTO users (user_id,name,email,password_hash,role_id) SELECT $1,$2,$3,$4,role_id FROM roles WHERE role_name=$5',
        [id + offset, 'W06 Synthetic User', `w06-${id + offset}@example.invalid`, hash, 'user']);
    }
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const client = () => {
      let cookie = '';
      return async (path, data) => {
        const response = await fetch(base + path, { redirect: 'manual', method: data ? 'POST' : 'GET',
          headers: { ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
          body: data ? new URLSearchParams(data) : undefined });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        return { status: response.status, html: await response.text(), headers: response.headers };
      };
    };
    const token = html => html.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
    await t.test('real guest denial, login, duplicate volunteer, ownership, list and removal flow', async () => {
      const request = client();
      assert.doesNotMatch((await request(`/project/${id}`)).html, /project-volunteering/);
      assert.equal((await request(`/project/${id}/volunteer`, {})).headers.get('location'), '/login');
      assert.equal((await request('/my-volunteering')).status, 303);
      const form = await request('/login');
      assert.equal((await request('/login', { email: `w06-${id + 1}@example.invalid`, password, _csrf: token(form.html) })).status, 303);
      assert.match((await request('/dashboard')).html, /My Volunteering/);
      const csrf = token((await request(`/project/${id}`)).html);
      assert.equal((await request(`/project/${id}/volunteer`, { _csrf: 'bad' })).status, 403);
      for (let i = 0; i < 2; i++) assert.equal((await request(`/project/${id}/volunteer`, { _csrf: csrf, user_id: id + 2 })).status, 303);
      assert.equal(await models.isVolunteering(id + 1, id), true);
      assert.equal(await models.isVolunteering(id + 2, id), false);
      assert.equal((await connection.query('SELECT count(*)::integer AS count FROM volunteer WHERE user_id=$1 AND project_id=$2', [id + 1, id])).rows[0].count, 1);
      assert.match((await request(`/project/${id}`)).html, /You are volunteering/);
      const list = await request('/my-volunteering');
      assert.match(list.html, /W06 &lt;Synthetic&gt; Project/); assert.match(list.html, /Feb 29, 2028/);
      await write(body); // Rerun with an existing registration in the same transaction.
      assert.equal(await models.isVolunteering(id + 1, id), true);
      assert.equal(await models.removeVolunteer(id + 2, id), false);
      const remove = await request(`/project/${id}/remove-volunteering`, { _csrf: csrf, returnTo: 'my-volunteering' });
      assert.equal(remove.headers.get('location'), '/my-volunteering');
      assert.match((await request('/my-volunteering')).html, /not volunteered/);
      assert.match((await request(`/project/${id}`)).html, /Volunteer for this project/);
    });
    await t.test('foreign keys cascade only registrations when a fixture parent is removed', async () => {
      await write('SAVEPOINT cascade_test');
      await models.addVolunteer(id + 1, id); await models.addVolunteer(id + 2, id);
      await write('DELETE FROM users WHERE user_id=$1', [id + 1]);
      assert.equal(await models.isVolunteering(id + 1, id), false);
      assert.equal(await models.isVolunteering(id + 2, id), true);
      await write('DELETE FROM project WHERE project_id=$1', [id]);
      assert.equal(await models.isVolunteering(id + 2, id), false);
      await write('ROLLBACK TO SAVEPOINT cascade_test');
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) { db.query = originalQuery; await db.end(); }
    await connection.query('ROLLBACK').catch(() => {});
    try {
      if (baseline) assert.deepEqual(await snapshots(), baseline, 'Existing database rows must be unchanged after rollback.');
    } finally { await connection.end(); }
  }
});
