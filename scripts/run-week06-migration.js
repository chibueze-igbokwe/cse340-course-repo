import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runWeek05Migration, safeFailure } from './run-week05-migration.js';

// Reuse the tested execution/connection safeguards, not the Week 05 SQL or flag.
// No dotenv, application import, automatic startup hook, or HTTP endpoint.
export const runWeek06Migration = async (env = process.env, dependencies = {}) => {
  const log = dependencies.log || console.log;
  if (env.RUN_WEEK06_MIGRATION === undefined || env.RUN_WEEK06_MIGRATION === 'false') {
    log('Week 06 migration disabled.');
    return;
  }
  if (env.RUN_WEEK06_MIGRATION !== 'true') {
    throw Object.assign(new Error('Week 06 migration flag must be exactly true or false.'), {
      code: 'W06_FLAG', week05Stage: 'configuration'
    });
  }
  if (!env.WEEK06_EXPECTED_DATABASE) {
    throw Object.assign(new Error('Week 06 expected database name required.'), {
      code: 'W06_EXPECTED_DATABASE', week05Stage: 'configuration'
    });
  }
  return runWeek05Migration({ ...env,
    RUN_WEEK05_MIGRATION: 'true', WEEK05_EXPECTED_DATABASE: env.WEEK06_EXPECTED_DATABASE
  }, {
    ...dependencies,
    // Fixed path cannot be redirected through an environment variable or caller.
    readMigration: () => readFile(new URL('../src/migrations/006-volunteering.sql', import.meta.url), 'utf8'),
    log: message => log(message.replace('Week 05', 'Week 06'))
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWeek06Migration().catch(error => {
    console.error(safeFailure('migration', error, '06'));
    process.exitCode = 1;
  });
}
