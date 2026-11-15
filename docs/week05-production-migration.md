# Week 05 production migration review and execution

Status: prepared for review; not executed or verified against a live database.
Migration: `src/migrations/005-authentication.sql`.

## Scope and compatibility

The migration matches the `roles` and `users` declarations in `src/setup.sql`.
It adds two SERIAL sequences, primary-key indexes, unique indexes for role name
and email, and the users-to-roles foreign key. `users.role_id` and `created_at`
remain nullable, exactly as setup.sql defines them. The application always
selects the default `user` role by name; it never assumes numeric role IDs.
Registration inserts bcrypt hashes, login joins users to roles, authorization
reads the joined role name from the session, and the users list excludes hashes.
No accounts or passwords are seeded.

No Week 04 object is changed or reseeded. No ALTER, DROP, TRUNCATE, DELETE,
sequence reset, credential change, or administrator promotion is performed.
Do not execute `src/setup.sql` on production.

The explicit target schema is `public`. Confirm the application's search_path
uses these tables, with no shadowing tables in another schema. Stop for review
if the existing application uses another schema.

## Approval gates

Preparing these files does not authorize connecting to Render. Obtain approval
before inspection/backup access, before running the migration, and separately
before push/deployment or administrator registration/promotion. Do not run
integration tests against production: this repository's live test command
includes writes and accepts only the isolated localhost development database.

## 1. Inspect the target (approved operator only)

Use an appropriate PostgreSQL `psql` client and a private libpq service entry
named `cse340_render`. Configure its host/database/user/TLS options privately;
use a protected password file or interactive password prompt. Never put URLs
or passwords in source, shell history, screenshots, or reports. Use the database
owner/migration role, and confirm the target in the provider dashboard too.

The following commands are instructions only; none were executed for this task:

```text
psql "service=cse340_render" -X -v ON_ERROR_STOP=1
\conninfo
SELECT current_database(), current_user, current_schema();
SHOW search_path;
SHOW server_version;
\dt public.*
\d+ public.organization
\d+ public.project
\d+ public.category
\d+ public.project_category
```

Inspect `public.roles` and `public.users` if present with `\d+`; inspect their
sequences, indexes, owners, permissions, triggers, rules, RLS and foreign keys.
Confirm exact column order/types/nullability/defaults and constraint names
against setup.sql and the migration. Identity columns are intentionally not
accepted in place of SERIAL. Extra columns/constraints are rejected. Additional
indexes, grants, sequence options and external dependencies still require human
review: the automated checks are not a complete schema/security comparison.
PostgreSQL catalog rendering differences can cause a conservative rejection;
stop and review rather than weakening the checks on production.

Capture row counts for all four Week 04 tables and an inventory of their IDs,
schema and relationships. Counts alone cannot prove unchanged record contents.
Keep exports and inspection output private. If users already exist, do not
export their password hashes into review logs.

## 2. Create and verify a recoverable backup

Arrange a quiet window: pause public writes and avoid concurrent deployments
through the migration and before/after verification. This makes comparisons
meaningful and protects against unrelated concurrent record changes.

Use pg_dump/pg_restore compatible with the server (prefer the same major
version; pg_dump must not be older than the server). Store the full custom-format
backup outside this repository in encrypted/private storage with restricted
access. Replace the paths below with approved private absolute paths.

```text
pg_dump --dbname="service=cse340_render" --format=custom --file="<private-path>/before-week05.dump"
pg_restore --list "<private-path>/before-week05.dump"
```

Require successful exit codes, a nonempty archive, and a saved SHA-256 checksum.
An archive listing/checksum is not proof of recoverability: with separate
approval, restore into an EMPTY disposable database, never the Render database:

```text
pg_restore --dbname="service=cse340_restore_check" --no-owner --no-privileges --exit-on-error "<private-path>/before-week05.dump"
```

Check restored tables, record counts, relationships and representative contents.
Review production owners/grants/extensions separately; the portable restore
above deliberately omits original ownership/grants. Record the recovery plan,
backup location, timestamp and successful restore verification before proceeding.

## 3. Apply only after migration approval

Confirm public.users/public.roles are absent or reviewed as compatible. Existing
incompatible objects cause the transaction to abort, not automatic repair.
Ensure the operator can create objects/sequences and that the runtime app role
will have schema USAGE, required table permissions, and sequence USAGE. If a
different owner creates these objects, review explicit grants separately; this
migration does not guess role names or grant broad permissions.

From the repository root, with the migration reviewed and backup verified:

```text
psql "service=cse340_render" -X -v ON_ERROR_STOP=1 -f src/migrations/005-authentication.sql
```

Require exit code zero and COMMIT. The script supplies its own transaction.
If a lock timeout or any error occurs, stop. A closed psql connection rolls back
the uncommitted transaction; an interactive failed transaction needs ROLLBACK.
Do not retry blindly or reset sequences. Only roles/users are explicitly locked;
no application SQL in the migration writes the four Week 04 tables.

## 4. Verify after application (approved operator only)

```text
\d+ public.roles
\d+ public.users
SELECT role_id, role_name, role_description FROM public.roles ORDER BY role_name;
SELECT count(*) AS user_count FROM public.users;
SELECT count(*) FROM public.organization;
SELECT count(*) FROM public.project;
SELECT count(*) FROM public.category;
SELECT count(*) FROM public.project_category;
```

Expect required `user` and `admin` roles exactly once. A newly created users
table must be empty; on a rerun, existing accounts must remain unchanged. Never
SELECT password hashes for routine reporting. Compare the Week 04 counts, IDs,
schema, full row exports and relationships to the quiet-window baseline, not
the original seed counts (legitimate Week 04 additions must remain).
Confirm the runtime role can access the new objects and resolve the public
tables. A future approved registration smoke test is needed to establish real
INSERT/sequence permissions; this preparation does not claim that success.

## Reruns and failure behavior

Compatible tables are retained and validated; only missing roles are inserted.
Existing role IDs, descriptions, users and Week 04 records are not updated.
Incompatible columns, SERIAL ownership/defaults, constraints, RLS, inheritance,
rules or user triggers abort the whole transaction. A partial existing schema
may be completed only if both resulting tables pass validation. Extra unrelated
tables are not inspected or changed. Concurrent migration execution is not
supported: serialize operators and retry only after reviewing the failure.

PostgreSQL sequence allocations are not transactional: a failed seed insertion
can consume role sequence numbers on an existing table. Gaps are harmless; no
sequence is reset and models do not require role IDs 1/2. Existing out-of-sync
sequences can cause a safe failure and require separate approved investigation.

There is no automatic down migration. If verification fails, hold deployment
and investigate without dropping authentication tables or restoring over live
records. Any recovery or corrective changes need separate review/approval.
Administrator registration, role promotion and deployment are separate tasks.
