import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ejs from 'ejs';

const walk = (folder) => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
  const path = `${folder}/${entry.name}`;
  return entry.isDirectory() ? walk(path) : [path];
});

const javascript = ['server.js', ...walk('src'), ...walk('scripts'), ...walk('tests')]
  .filter((file) => file.endsWith('.js'));
for (const file of javascript) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(1);
  }
}
const templates = walk('views').filter((file) => file.endsWith('.ejs'));
for (const file of templates) ejs.compile(readFileSync(file, 'utf8'), { filename: file });
console.log(`Syntax checks passed: ${javascript.length} JavaScript files and ${templates.length} EJS templates.`);
