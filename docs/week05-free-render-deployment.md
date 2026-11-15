# Controlled Week 05 deployment on Render Free

Preparation only. Production execution has NOT been approved. No recoverable
production backup has been verified. Do not enable the migration flag until
the backup is restored successfully into a separately approved disposable
database, or the owner explicitly approves proceeding with the documented
data-loss/recovery risk. Prefer verifying the backup first.

## Files and behavior

`scripts/run-week05-migration.js` imports neither dotenv nor the application.
It uses only runtime environment values, requires Render's `RENDER=true`, and
executes the existing `src/migrations/005-authentication.sql` without rewriting
it. It is a command-line script, not an HTTP endpoint. Disabled/missing flag
skips it; a malformed flag or an enabled migration failure stops startup.

The runner checks the configured database name, DNS results, TLS certificate
verification, actual socket address, and server-reported database/address/TLS
inside a read-only transaction before submitting the migration. Internal remote
Render network addresses are allowed; loopback targets are not. The expected
database name must be copied privately from the database dashboard, not guessed
or derived automatically from DB_URL. It is a confirmation value, not a secret.

TLS verification is mandatory even if DB_URL contains weaker SSL options. If
the configured endpoint/certificate cannot be verified, stop and resolve its
hostname/trust configuration. Do not switch to rejectUnauthorized=false. A
trusted CA may be provided through NODE_EXTRA_CA_CERTS when necessary; never
disable TLS verification. Connection errors are deliberately logged generically
to avoid leaking connection details.

## Manual deployment steps (after separate approvals)

1. Follow `week05-production-migration.md` for read-only production inspection,
   backup using local pg_dump, and successful restoration verification. Do not
   run the repository integration suite against production.
2. Review and separately authorize committing/pushing the prepared files. Avoid
   an unintended auto-deploy while arranging the one-time startup command;
   coordinate the dashboard's deployment settings before the push. Do not put
   credentials in Git. Confirm the intended main commit is the deploy target.
3. Retain Render's existing DB_URL and SESSION_SECRET. Confirm NODE_ENV=production,
   a private writable session directory, and a single instance. Do not edit the
   local .env. Build command remains `npm ci`.
4. Only after explicit execution approval, add these Render environment values:

   ```text
   WEEK05_EXPECTED_DATABASE=<exact existing production database name>
   RUN_WEEK05_MIGRATION=true
   ```

   Render supplies RENDER=true automatically. Do not manually set it locally to
   try the production runner. No password or grading credentials are required
   by the migration.
5. Set the temporary **Start Command** exactly to:

   ```sh
   node scripts/run-week05-migration.js && npm start
   ```

   Deploy the reviewed main commit. This uses the Free service's normal start
   process, requiring no shell, paid job, or public migration endpoint. The
   application starts only after migration success. An interrupted deployment
   or restart can rerun the script: this is not an exactly-once scheduler. The
   validated migration supports compatible reruns; serialize deployment attempts.
6. Require the log `Week 05 migration completed.` and a healthy application.
   If refused/failed, stop; do not weaken safeguards, run setup.sql, or reset
   tables. Investigate connection/TLS/permissions/schema privately. Verify the
   Week 04 baseline still matches through approved read-only inspection.
7. Remove RUN_WEEK05_MIGRATION (or set false), remove the optional expected-name
   setting, and restore the Start Command to `npm start`. Save/redeploy to ensure
   future restarts do not run migrations. Keep the script and migration in Git.

## Separate, narrowly scoped administrator promotion

No promotion occurs in normal npm start. After the migrated application is
live, register the grading account through the normal HTTPS form, using
credentials supplied privately by the owner/course. Never store its password
in scripts, SQL, logs, environment variables, or Git.

After separate promotion/deployment approval, in Render's Environment settings:

```text
RUN_WEEK05_ADMIN_PROMOTION=true
WEEK05_ADMIN_EMAIL=<exact email of the registered account>
WEEK05_EXPECTED_DATABASE=<exact production database name>
```

Keep RUN_WEEK05_MIGRATION removed/false. Temporarily set Start Command to:

```sh
node scripts/promote-week05-admin.js && npm start
```

Deploy the reviewed code. The promotion runner reuses the migration runner's
verified TLS, remote-target and read-only database-identity checks. It locks
exactly one account selected by parameterized exact email, locks the existing
admin role, changes only that account's role_id, verifies the joined admin role,
and commits. Missing/ambiguous accounts or roles and failed verification abort;
SQL failures roll back and stop startup. Already-admin accounts pass safely
without changing their role again. No account is created, no password/hash is
selected or changed, and no account identifier is logged.

Require the log `Week 05 administrator role verified.` and a healthy
application. Remove RUN_WEEK05_ADMIN_PROMOTION and WEEK05_ADMIN_EMAIL and restore
Start Command to `npm start`; save/redeploy. Until removed, a restart may
repeat the guarded operation. Log out and log in again to refresh the role in
the session, then verify /users and management access. Do not weaken TLS or
identity checks to work around a refusal. This procedure requires no external
PostgreSQL connection, public endpoint, paid shell or new dependency.

## Minimum submission checks

- Confirm deployed commit, healthy startup, verified role seeds and original
  Week 04 record/relationship baseline.
- Register a synthetic ordinary user; test duplicate registration and correct/
  incorrect login, dashboard, POST logout and denial after logout.
- Verify guests are redirected to login; ordinary users are denied /users and
  all create/edit/assignment routes; admins can access them.
- Confirm conditional navigation and hash-free /users output.
- As admin, use clearly marked synthetic records for organization/project/
  category create/edit and category assignment. Refresh to verify persistence.
  Never edit graded records for smoke testing. Cleanup needs separate approval.
- Verify existing public lists/details, reciprocal links, dates, images, CSS,
  invalid IDs and 404/500 behavior. Submit course links and grading credentials
  only through the designated private course channel.

Local mocked runner tests prove safeguard behavior, not Render connectivity,
TLS certificate availability, production permissions or backup recoverability.
