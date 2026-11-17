# Week 06: Additional Feature — Volunteering

The feature reuses Express MVC, session authentication, CSRF, flash messages,
resource-ID validation, existing styles and the shared date formatter. No new
dependencies. Both ordinary users and admins can volunteer; existing admin-only
management routes retain their permissions. Guests can still browse projects.

## Database

`volunteer` has two required integer foreign keys, `user_id` to `users` and
`project_id` to `project`, with a composite primary key `(user_id, project_id)`.
This prevents duplicates even under concurrent requests. Both foreign keys use
ON DELETE CASCADE: deleting a parent removes only its registrations, never the
other parent. No accounts or volunteering records are seeded.

Fresh isolated databases use updated `src/setup.sql`. Existing databases use
`src/migrations/006-volunteering.sql`: one additive transaction, compatible
reruns retain all records, and incompatible columns/constraints abort instead
of silently accepting the table. Requires users/project and the public schema.
It does not alter existing Week 04/05 tables or reset/reseed records. Do not run
setup.sql against an existing database. Backup, target inspection, permissions,
and separate production execution approval are still required before deployment.
Week 05 startup runners do not apply this new migration automatically.

## Model and routes

`src/models/volunteers.js`: `addVolunteer`, `removeVolunteer`,
`getVolunteerProjects`, `isVolunteering`. All dynamic SQL uses placeholders;
add uses ON CONFLICT DO NOTHING and remove is scoped to both user and project.
Lists include past and future projects, sorted by date/title/ID.

- GET `/project/:id`: public, with current-user status and POST controls only
  when logged in. Personalized responses use Cache-Control: no-store.
- POST `/project/:id/volunteer`: requireLogin, ID validation, CSRF, existence
  check, session-owned insert, flash and 303 redirect back to project details.
- POST `/project/:id/remove-volunteering`: same guards and ownership, idempotent
  removal. Only the fixed `returnTo=my-volunteering` value can select the list
  destination; arbitrary URLs cannot redirect users offsite.
- GET `/my-volunteering`: requireLogin, session-owned list with project and
  organization links, removal actions and helpful empty state. Linked from the
  dashboard, with no change to the login/dashboard authorization behavior.

Neither form submits a user ID. Forged user/account fields cannot alter the
session-derived owner. Missing projects and foreign-key races return 404;
write failures show generic retry feedback without claiming success. All data
and labels are EJS-escaped, with visible keyboard focus and descriptive buttons.

## Verification

Run `npm run check`, `npm test`, and `git diff --check`. New unit/HTTP tests
mock the database under the existing connection-blocking test preloader and
cover models, duplicate/removal behavior, sessions, authorization, CSRF, rendered
status/list changes, invalid IDs, missing records and database failures.
Any optional real-database flow must target only the confirmed localhost
disposable database; never use the repository's writing integration suite on
Render. Production migration/deployment remain separate manual review steps.

`npm run test:week06:integration` uses already configured local credentials but
connects ONLY to the existing `cse340_week05_migration_test` on 127.0.0.1:5432.
It refuses remote configuration, checks the actual target before writes, never
creates a database, and never executes setup.sql. It tests the migration body
inside an outer transaction (omitting only its BEGIN/COMMIT wrapper), reruns,
incompatible-schema rejection, real login and volunteer/unvolunteer HTTP flow,
ownership, duplicates and cascade behavior. All fixtures/DDL are rolled back;
parent records use explicit test IDs to avoid advancing identity sequences.
It requires the existing disposable Week 04/05 schema and running PostgreSQL.
The initial attempt on this machine failed before writes with ECONNREFUSED;
no running PostgreSQL service was available. Unit/HTTP tests remain independent
of that optional integration check; this is not a claim of real SQL success.

Local PostgreSQL has since been uninstalled by the owner. Do not reinstall it
for this assignment. The final review uses database-isolated tests and static
SQL review; no real-database migration/rerun success is claimed for Week 06.

## Final review against the six criteria

| Criterion | Implementation and verification |
| --- | --- |
| Database | Two required FKs, composite key, registration-only cascades, matching fresh schema and additive repeatable migration; incompatible definitions are rejected |
| Models | Four parameterized functions; duplicate adds and repeated removals are safe; user-scoped list includes all dates |
| Project details | Session-specific status and POST actions; guests have no controls; redirected pages reflect saved state |
| Dashboard | My Volunteering link, private list, project/organization links, per-project removal and empty state |
| Access control | requireLogin, CSRF and ID validation before actions; session-derived owner; project existence checks; admin permissions unchanged |
| Code quality | Existing MVC/EJS/styles/date helper reused; escaped output, accessible controls and focus; regression and failure tests; no new dependencies |

The review found no functional gaps in these criteria. Migration validation was
strengthened to reject existing rewrite rules and table inheritance as well as
unexpected triggers/RLS/columns/constraints. These checks do not modify existing
records and are deliberately conservative. Deployment still requires production
schema/permissions verification and a backup/recovery decision.

## Controlled Render migration (instructions only; not execution approval)

`scripts/run-week06-migration.js` reuses the tested Week 05 production executor
and connection helper but reads ONLY the fixed 006-volunteering.sql path. It
requires its own settings; Week 05 settings cannot authorize it or substitute
for the Week 06 expected database name. It never loads dotenv or the app.

For a separately approved deployment, retain Render's existing DB_URL and set:

```text
RUN_WEEK06_MIGRATION=true
WEEK06_EXPECTED_DATABASE=<exact existing production database name>
```

Temporary Start Command:

```sh
node scripts/run-week06-migration.js && npm start
```

This is not part of normal npm start and has no HTTP endpoint. It preserves
Render runtime checks, recognized hostname rules, expected and actual database
identity checks, and mandatory encrypted TLS. Only recognized internal Render
hosts may use self-signed TLS, with private DNS/peer/server addresses. External
Render hosts retain certificate verification. Local/development and unknown
hosts are refused. Preflight SQL is read-only; migration SQL starts only after
the checks pass. The migration supplies its own transaction and closes/rolls
back on failure. CLI failure returns nonzero, so && prevents app startup.

Diagnostics show Week 06, stage and allowlisted error code only. Shared
connection failures retain W05_* codes; missing Week 06 expected database and
invalid Week 06 flag use W06_EXPECTED_DATABASE and W06_FLAG respectively.
SQLSTATE P0001 may indicate a compatibility refusal; 42501 indicates insufficient
privileges. Do not print connection details to troubleshoot failures.

After confirmed migration success and a healthy application, remove the Week 06
flag/expected-name setting, restore Start Command to `npm start`, and redeploy.
Compatible reruns retain registrations if a restart occurs before cleanup; this
is not an exactly-once scheduler. Do not change Week 05 runners or run setup.sql
as a substitute. No administrator promotion is needed for volunteering.

Before submission, perform an approved hosted smoke test: guest controls hidden,
user login, volunteer once/twice, project status and My Volunteering list update,
remove from both entry points, private user isolation, CSRF rejection, and
unchanged admin/project/category functionality. Use marked synthetic accounts
and records. The repository is prepared for review/merge, not automatically
authorized for production migration, writes or deployment.
