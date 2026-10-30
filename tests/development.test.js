import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.DB_URL ||= 'postgresql://unused:unused@localhost/unused';
process.env.NODE_ENV = 'development';
const { default: app } = await import('../server.js');
const { default: db } = await import('../src/models/db.js');

test('development middleware logs requests and exposes escaped error details only in development', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /\(Development mode\)/);
    assert.ok(log.mock.calls.some(({ arguments: args }) => args[0] === 'GET' && args[1] === '/'));
    const error = await fetch(base + '/test-error');
    assert.equal(error.status, 500);
    const html = await error.text();
    assert.match(html, /Error details \(development only\)/);
    assert.match(html, /This is a test error/);
    t.mock.method(db, 'query', async () => { throw new Error('<script>private failure</script>'); });
    const databaseError = await fetch(base + '/organizations');
    assert.equal(databaseError.status, 500);
    const databaseHtml = await databaseError.text();
    assert.match(databaseHtml, /&lt;script&gt;private failure&lt;\/script&gt;/);
    assert.ok(!databaseHtml.includes('<script>private failure</script>'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
  }
});
