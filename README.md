# Service Network — CSE340

A server-rendered community service directory using Express 5, EJS, and PostgreSQL.

## Run locally

1. Install dependencies with `npm install` (or `npm.cmd install` in PowerShell).
2. Copy `.env.example` to a local, ignored `.env` file and set `DB_URL` to your existing PostgreSQL connection string.
3. Set `SESSION_SECRET` to a privately generated random value (at least 32 characters). For example, generate it locally with Node's `crypto.randomBytes(64).toString('hex')`. Never commit the generated value.
4. Optionally set `PORT` (default `3000`) and `NODE_ENV=development` for local HTTP, request logs, the footer indicator, and error details.
5. Run `npm start` or `npm run dev`.

The existing database connection uses TLS. No schema migration is required for Week 03.
As of Week 05, `src/setup.sql` initializes a **fresh, isolated development database** with the original course data plus roles/users. It does not drop existing tables. An existing table causes the setup transaction to fail instead of resetting data. Do not run it against the Render database used for grading earlier weeks.

## Week 03 structure

- `server.js`: configures EJS, absolute view/static paths, shared environment middleware, routing, and error middleware; starts the server only when executed directly.
- `src/routes.js`: maps URLs to named controllers, following the Week 03 convention.
- `src/controllers/index.js`: `showHomePage`.
- `src/controllers/organizations.js`: `showOrganizationsPage` and `showOrganizationDetailsPage`.
- `src/controllers/projects.js`: `showProjectsPage`, `showProjectDetailsPage`, and `NUMBER_OF_UPCOMING_PROJECTS = 5`.
- `src/controllers/categories.js`: `showCategoriesPage` and `showCategoryDetailsPage`.
- `src/controllers/errors.js`: the course `testErrorPage`, catch-all 404, and centralized four-argument error handler.
- `src/middleware/validate-resource-id.js`: rejects malformed, nonpositive, or out-of-range PostgreSQL INTEGER IDs with HTTP 404 before database access.
- `src/models/organizations.js`: organization list and details queries.
- `src/models/projects.js`: preserves `getAllProjects`; adds `getUpcomingProjects(number_of_projects)`, `getProjectDetails(id)`, `getProjectsByOrganizationId`, and `getProjectsByCategoryId`.
- `src/models/categories.js`: category list, `getCategoryDetails`, and `getCategoriesByProjectId`.

Database queries remain in models. Express 5 forwards rejected async controller promises to the centralized error handler. Existing EJS templates remain in `views/` to preserve the working Week 02 layout.

PostgreSQL `DATE` values are preserved as `YYYY-MM-DD` strings by the pool's date parser in `src/models/db.js`. All project dates use the shared `src/utils/format-project-date.js` helper, exposed to templates through `app.locals.formatProjectDate`. It interprets and formats the calendar day in UTC, avoiding host-timezone shifts. Other PostgreSQL types retain their default parsers. No schema or stored date values are changed.

## Schema and routes

The existing schema is unchanged:

- `organization`: `organization_id`, `name`, `description`, `email`, `logo`.
- `project`: `project_id`, `organization_id`, `title`, `description`, `location`, `date`.
- `category`: `category_id`, `name`.
- `project_category`: `project_id`, `category_id` (composite primary key).

| Route | Behavior |
| --- | --- |
| `/` | Existing home page |
| `/organizations` | All organizations with linked names and existing logos |
| `/organization/:id` | Organization details, contact email, logo, and all linked projects |
| `/projects` | Next five projects with `date >= CURRENT_DATE`, sorted ascending; links to projects and organizations |
| `/project/:id` | Project details, linked organization, and linked category tags |
| `/categories` | All categories with linked names |
| `/category/:id` | Category name and all linked projects |
| `/test-error` | Intentional HTTP 500 for the error-handling learning activity |
| Unmatched URL or invalid/missing resource | Accessible HTTP 404 page |

All dynamic SQL values use placeholders. Views escape database text with `<%= ... %>`; unescaped EJS output is used only for trusted template includes. Error pages use the shared navigation and skip link. Empty directories and relationships have explanatory messages. Development error details are hidden in production.

## Changed views and styling

- `views/organizations.ejs`, `views/categories.ejs`: linked names and empty states.
- `views/projects.ejs`: upcoming-project heading, linked project/organization names, dates, and empty state.
- `views/organization.ejs`, `views/project.ejs`, `views/category.ejs`: new detail pages and reciprocal links.
- `views/partials/project-list.ejs`: shared linked project list with an empty state.
- `views/partials/footer.ejs`: development indicator from middleware-provided `NODE_ENV`.
- `views/errors/404.ejs`, `views/errors/500.ejs`: helpful error messages and navigation; development-only diagnostics on 500.
- `public/css/style.css`: preserves the existing responsive design and adds detail-page/list/tag styling, long-text wrapping, and focus styling for the development error disclosure.

## Verification

| Command | Coverage |
| --- | --- |
| `npm run check` | `scripts/check.js` checks JavaScript syntax and compiles every EJS template |
| `npm test` | `tests/week03.test.js` checks model parameter binding, all routes, reciprocal links, escaping, invalid/missing IDs, empty states, database failures, production error privacy, CSS, and all three static SVG logos; `tests/development.test.js` checks development middleware and escaped diagnostics; `tests/dates.test.js` renders all four project-date pages in UTC, Lagos, Los Angeles, and Kiritimati, including year boundaries, leap day, and daylight-saving transition dates |
| `npm run test:integration` | `tests/integration.test.js` makes read-only queries to the configured database and verifies actual records, exact category relationships against the join table, dates against independent SQL formatting, upcoming-project limits, HTTP routes, database logo filenames and served image bytes, and error responses. A SELECT-only CTE fixture exercises yesterday/today boundaries, ordering, and limits without modifying database records |

No lint tool was configured in the original repository; the `check` command is a syntax/template check, not a lint claim. Tests use Node's built-in test runner without a separate test framework. Week 05 integration checks accept only local `cse340_development`: the authentication suite uses tracked write fixtures and retains the grading admin account, while the legacy read-only suite uses SELECT queries only. Neither suite drops or recreates a database.

## Week 04 foundation and organization forms

This branch adds the organization workflow from the form submission, session/flash, validation, and updating activities, followed by the project, category-assignment, and category create/edit workflows below. Authentication remains outside Week 04's requested scope. The existing database schema and Week 03 features are preserved. No migration, session table, reset, or reseed is needed.

| Route | Behavior |
| --- | --- |
| `GET /new-organization` | Empty form with session-bound CSRF token |
| `POST /new-organization` | Validate and insert an organization, set a success flash message, redirect with HTTP 303 to its detail page |
| `GET /edit-organization/:id` | Form prefilled from the existing organization |
| `POST /edit-organization/:id` | Validate and update only the URL's organization ID, flash success, redirect with HTTP 303 |

Course conventions use the form names `contactEmail` and `logoFilename`; the model functions map these to the existing `email` and `logo` columns. `createOrganization(name, description, contactEmail, logoFilename)` returns the inserted ID. `updateOrganization(id, name, description, contactEmail, logoFilename)` returns the updated ID or `null` when the record no longer exists. Both use SQL placeholders exclusively.

New organizations use the course-provided `public/images/placeholder-logo.png`. Edit forms accept only existing image filenames in `public/images`; URLs, traversal paths, and missing filenames are rejected. There is no file upload workflow.

Validation uses `express-validator` with the course's `organizationValidation` convention: name 3–150 characters, description 1–500, valid contact email up to the schema's 255-character limit. Fields are trimmed; only email domain casing is normalized so mailbox characters are preserved. Arrays from repeated keys and NUL characters are rejected. HTML is escaped on EJS output, preserving the original text in storage without double escaping. Browser validation uses required fields, length limits, email type, and a filename pattern.

Validation failures re-render HTTP 422 with submitted values, a linked error summary, field errors, and `aria-invalid`/`aria-describedby`. A duplicate name returns HTTP 409 with an actionable field error. Database failures return HTTP 500 while preserving entries and hiding internal details. Invalid/missing IDs return HTTP 404, including deletion between the lookup and update.

URL-encoded parsing uses flat fields (`extended: false`), a 16 KB body limit, a 10-parameter limit, and disabled compression. The category-assignment route alone allows 100 parameters (a CSRF token plus up to 99 checkbox selections). Oversized forms return HTTP 413, malformed forms HTTP 400, and unsupported compression HTTP 415. Missing or foreign-session CSRF tokens return HTTP 403 without a database write.

Sessions use `express-session` and `session-file-store`; course-style flash middleware lives in `src/middleware/flash.js`. Cookies are HTTP-only, SameSite=Lax, and Secure in production, with a one-hour lifetime. Unmodified anonymous sessions are not saved. Production assumes one trusted reverse proxy (such as Render's HTTPS proxy); local HTTP requires `NODE_ENV=development`. The signing key comes only from `SESSION_SECRET`; startup rejects a missing/short key. The application saves success messages before redirecting, consumes them when a template renders, and leaves them intact for static asset requests.

Session files default to ignored `.sessions/`. For production, set `SESSION_DIR` to a private, writable persistent directory; without persistent storage, a restart or redeploy loses sessions. File storage is appropriate for a single app instance; multiple instances need a shared session store. Session storage never writes to the course database. Hosting environment configuration is required before deployment; this work does not deploy or merge any branch.

New and changed Week 04 files:

- `.env.example`, `.gitignore`: public configuration template and ignored session files.
- `package.json`, `package-lock.json`: session/store/validation dependencies and expanded test commands.
- `server.js`: bounded form parser, sessions, flash middleware, and production proxy support.
- `src/middleware/session.js`, `flash.js`, `csrf.js`: session configuration, one-time messages, and form request protection.
- `src/controllers/organizations.js`, `src/models/organizations.js`, `src/routes.js`: organization create/edit MVC workflow and validation.
- `src/controllers/errors.js`, `views/errors/request.ejs`: safe request error statuses and accessible feedback.
- `src/utils/organization-logos.js`, `public/images/placeholder-logo.png`: available image filenames and the course placeholder.
- `views/new-organization.ejs`, `views/edit-organization.ejs`, `views/partials/organization-form.ejs`: accessible, reusable forms that preserve input.
- `views/organizations.ejs`, `views/organization.ejs`, `views/partials/header.ejs`, `public/css/style.css`: create/edit navigation, shared flash output, and responsive form styles.
- `tests/setup-env.js`, `tests/week04.test.js`: ephemeral test-only signing keys; mocked database writes test validation, SQL injection resistance, duplicate names, failures, session isolation, flash consumption, CSRF, parser limits, and production cookie behavior.
- `tests/integration.test.js`: existing read-only checks plus GET-only Week 04 forms, real database field values, placeholder image, and file-backed production sessions. No real INSERT/UPDATE is attempted.
- `tests/dates.test.js`: keeps its organization fixture consistent with the existing schema.

Run `npm run check`, `npm test`, and (only with a confirmed isolated development database) `npm run test:integration`. Automated create/update tests mock the database; a successful live database INSERT/UPDATE is deliberately not claimed. Browser visual/keyboard checks and live write/deployment checks remain separate.

## Week 04 service projects and category assignments

| Route | Behavior |
| --- | --- |
| `GET /new-project` | Project form with organization dropdown |
| `POST /new-project` | Validate fields and selected organization; insert and redirect HTTP 303 to the new project's details |
| `GET /edit-project/:id` | Prefilled form, exact PostgreSQL `YYYY-MM-DD` date, current organization selected |
| `POST /edit-project/:id` | Update project fields, including `organization_id`; redirect HTTP 303 with one-time success flash |
| `GET /assign-categories/:projectId` | Checkboxes for all categories, with existing assignments selected |
| `POST /assign-categories/:projectId` | Replace assignments atomically; redirect HTTP 303 with success flash |

The project list links to creation; project details link to editing and category assignment. All three POST routes enforce the existing session-bound CSRF protection and use parameterized model queries. Create/edit checks that the submitted organization actually exists. Foreign-key races return helpful form errors. Validation failures return HTTP 422 and retain submitted text, date, and organization selection; database write failures return a helpful HTTP 500 form. Invalid/missing project IDs and a project deleted between lookup and save return HTTP 404.

`createProject(title, description, location, date, organizationId)` returns the inserted ID. `updateProject(id, title, description, location, date, organizationId)` can change the organization and throws an Error with status 404 when no row is returned, as required by the team activity. The organization table itself is not changed when moving a project.

Validation requires title 3–200 characters, description 1–1,000, location 1–200, a real four-digit-year Gregorian calendar date, and one positive PostgreSQL INTEGER organization ID. Text is trimmed; repeated scalar fields, NUL characters, invalid dates, and unknown organizations are rejected. Date validation rejects rollover dates, timestamps, and year zero; past dates remain valid for editing historical projects. Browser constraints match the server's field limits. EJS escapes database and submitted text. An empty organization directory explains the prerequisite and disables submission.

Category assignment follows the separate course learning activity. `updateCategoryAssignments(projectId, categoryIds)` checks out one client, begins a transaction, locks and verifies the project, deletes its old assignments, inserts the unique desired IDs using the internal `assignCategoryToProject` helper, and commits. Any failure rolls back and always releases the client. The row lock serializes concurrent replacements for the same project. `ON CONFLICT` and deduplication prevent duplicate links. Selecting no categories removes all assignments. Unknown category IDs and malformed field names return HTTP 422; valid selections are retained on errors. A category removed during saving causes a rollback and an actionable error rather than partial changes.

Course inconsistencies resolved:

- The insertion activity's early HTML limits differ from its later validation examples. Both browser and server use the later limits (200/1,000/200), respecting the existing schema. The SQL table is the existing singular `project`.
- The insertion prose mentions redirecting to the list, while its sample redirects to project details. The implementation uses details, consistent with the organization workflow and team activity.
- The team activity briefly mentions `update-project.ejs` but otherwise names `edit-project.ejs`; this implementation uses `edit-project.ejs` in the existing root `views/` directory.
- The category activity alternates between route/field names. This implementation follows its actual form and route examples: `/assign-categories/:projectId` and repeated `categoryIds` fields, plus the repository's existing `getCategoriesByProjectId` function.

Changed files for this continuation:

- `src/models/projects.js`: parameterized create/update functions and missing-row Error.
- `src/models/categories.js`: transactional category replacement and private parameterized assignment helper.
- `src/controllers/projects.js`: course-named project form controllers, validation, organization existence checks, errors, and redirects.
- `src/controllers/categories.js`: course-named assignment form controllers, category validation, and preserved selections.
- `src/routes.js`: six GET/POST route registrations.
- `src/middleware/validate-resource-id.js`: validates either `id` or course-style `projectId` parameters.
- `src/utils/validate-project-date.js`: timezone-independent calendar validation.
- `server.js`: bounded category checkbox parser while preserving other form limits.
- `views/new-project.ejs`, `views/edit-project.ejs`, `views/partials/project-form.ejs`: accessible project forms with shared styling and error feedback.
- `views/assign-categories.ejs`: accessible assignment form with checked selections and empty/error states.
- `views/projects.ejs`, `views/project.ejs`: create/edit/assignment navigation links.
- `public/css/style.css`: project form, select, fieldset, checkbox, disabled button, and keyboard-focus styles.
- `tests/project-forms.test.js`, `package.json`: mocked write/transaction tests and inclusion in the test command.
- `tests/dates.test.js`: checks edit-form dates and selected organizations in four runtime timezones.
- `tests/integration.test.js`: GET-only verification of real project edit fields and category checkbox selections against independent relationship data.
- `README.md`: requirements mapping, ambiguity decisions, and verification limits.

No database records are created or updated by automated live integration checks. Mocked write tests cover SQL parameter binding, organization changes, invalid submissions, duplicate category IDs, rollback/release, missing/deleted records, CSRF, date boundaries, retained values, and success flashes. The read-only integration suite checks all existing real projects' edit and assignment forms. No branch is merged or deployed by these commands.

## Week 04 assignment: creating and editing categories

| Route | Behavior |
| --- | --- |
| `GET /new-category` | Blank category-name form with CSRF token |
| `POST /new-category` | Validate, insert, flash success, redirect HTTP 303 to category details |
| `GET /edit-category/:id` | Existing category name prepopulated in the edit form |
| `POST /edit-category/:id` | Validate and update the URL's category ID, flash success, redirect HTTP 303 |

The client intentionally validates **only required input and maximum length 100**. There is no category `minlength`, minimum-length pattern, or JavaScript minimum-length check. This lets one- and two-character names reach the server as required by the assignment. `categoryValidation` trims strings and enforces presence and length 3–100 on the server. Short names return HTTP 422 with a preserved value and accessible field error, without an INSERT or UPDATE. Repeated name parameters and NUL characters are rejected.

`createCategory(name)` and `updateCategory(id, name)` use SQL placeholders and return the saved ID. `updateCategory` throws an Error with status 404 if no row is returned. Duplicate names return HTTP 409 with helpful feedback, other database failures preserve the entered name in an HTTP 500 form, and invalid/missing IDs return HTTP 404. Both POST routes require the existing session-bound CSRF token. EJS escapes all names. Updating a name keeps the original category ID and does not rewrite project-category relationships.

Category links use the existing directory/detail pattern: `/categories` links to creation and each category detail page links to editing. New forms reuse the shared form styles, focus indicators, labels, linked error summary, and `aria-describedby`/`aria-invalid` feedback.

Changed files for the category assignment:

- `src/models/categories.js`: parameterized `createCategory` and `updateCategory` functions.
- `src/controllers/categories.js`: `categoryValidation`, `showNewCategoryForm`, `processNewCategoryForm`, `showEditCategoryForm`, `processEditCategoryForm`, form feedback, duplicate handling, and success redirects.
- `src/routes.js`: four category GET/POST route registrations, ID checks, CSRF, and server validation.
- `views/new-category.ejs`, `views/edit-category.ejs`, `views/partials/category-form.ejs`: accessible create/edit forms with intentionally server-only minimum-length validation.
- `views/categories.ejs`, `views/category.ejs`: create/edit navigation.
- `public/css/style.css`: category form width uses the existing form styling.
- `tests/category-forms.test.js`, `package.json`: category route/model tests added to the existing suite, including rendered browser attributes, one-/two-character POST rejection with zero writes, 3/100/101-character boundaries, whitespace, CSRF, SQL parameter binding, duplicates, missing/deleted records, escaped/preserved names, success flashes, and retained project links/tags.
- `tests/integration.test.js`: GET-only checks against actual category names and production sessions, plus invalid/missing edit IDs.
- `tests/dates.test.js`: existing category fixture now includes its schema-defined ID for the edit link.
- `README.md`: implementation summary and full Week 04 review.

## Full Week 04 requirements review

Reviewed against the [official Week 04 assignment](https://byui-cse.github.io/cse340-ww-course-v2/week04/assignment.html) and the preceding learning/team activities.

| Area | Implementation and verification | Remaining verification |
| --- | --- | --- |
| Organizations | Create/edit routes, course-named controllers, parameterized writes, browser/server validation, error feedback and flash messages; mocked write tests and real-record GET integration checks | Controlled live write test and browser interaction |
| Service projects | Create/edit, change organization, exact date prepopulation, organization existence checks, calendar validation, parameterized SQL and missing-row errors; mocked writes plus real-record form checks | Controlled live write test and browser interaction |
| Categories | Required/max-100 browser constraints, server-only min-3, create/edit models/controllers/forms, escaped/preserved values, duplicate handling, CSRF, redirects and navigation | Controlled live write test and browser interaction |
| Category assignments | Existing-category checkboxes, add/remove/clear selections, transactional replacement, rollback/release, locking and deduplication; mocked transactions and real relationship GET checks | Controlled live write test and browser interaction |
| MVC and security | SQL exclusively in models; named controllers; application routes in `src/routes.js`; root EJS views; parameterized values, bounded form parsing, sessions and CSRF; existing regression tests retained | No missing implementation identified in the requested scope |
| Professional style and accessibility | Existing responsive CSS, semantic forms, labels, keyboard focus styling, readable errors and success feedback; rendered HTML checked automatically | Manual mobile/desktop visual and keyboard/screen-reader review |
| Deployment and submission | Changes remain on `week04-inserting-updating`; no deployment or merge is performed | Course rubric requires a functional hosted deployment and GitHub/Render submission links; hosting has not been verified for this branch |

Write tests use mocks; live integration tests issue read-only queries and GET requests. Passing these tests does not claim successful live INSERT/UPDATE operations, Render deployment, or a guaranteed grade. No reset, reseed, schema migration, or modification to stored records is performed. `main` and `week03-mvc` remain protected from this work.

## Week 05: authentication and authorization

Phase 1 added the roles/users schema and registration. The local PostgreSQL development database is now initialized independently; no setup, reset, or reseed is run by the tests. The existing course data is preserved. This branch completes the course login, protected routes, admin role, and registered-users activities. No deployment or merge is performed.

### Routes and behavior

| Route | Access and behavior |
| --- | --- |
| GET/POST /register | Public; parameterized normal-user registration with bcrypt cost 10, CSRF, validation, duplicate feedback and success flash |
| GET/POST /login | Public; validated email/password, bcrypt comparison, generic invalid-credentials message, regenerated session, success redirect to dashboard |
| GET /logout | Logged-in confirmation page; does not change authentication |
| POST /logout | Logged-in and CSRF-protected; destroys the old session through regeneration, creates a fresh anonymous session for the flash, redirects to login |
| GET /dashboard | Requires login; displays escaped user name and email |
| GET /users | Requires login and admin role; displays joined user name, email and role only |
| All organization/project/category create/edit GET/POST routes | Admin only, before validation or database work; POST routes also require CSRF |
| GET/POST /assign-categories/:projectId | Admin only; existing parameterized transaction and CSRF remain in place |

The user model implements findUserByEmail, verifyPassword and authenticateUser using bcrypt.compare. Successful authentication returns only user_id, name, email and role_name; that explicit public object is placed in req.session.user. Password hashes are selected only for password verification, never stored in sessions or selected by getAllUsers. The users-list query joins users and roles and explicitly selects the public columns.

requireLogin and requireRole(role) follow the course controller naming pattern in src/controllers/users.js. Anonymous requests redirect to login with a flash message. Non-admin requests redirect to the dashboard with an access-denied message. Management links and the Users dashboard link appear only for admins, including on request-error pages. Public directory/detail links remain available. The navigation shows Login/Register to guests and Dashboard/Logout to authenticated users. Dashboard and users responses use Cache-Control: no-store.

The course login sample and prose differ about logout behavior and navigation. This implementation uses a POST logout with CSRF (GET shows confirmation), clears the entire old session, and follows the requested dashboard redirect. The registration minimum is now seven characters for everyone so the required grading account can use the standard registration/hash/compare workflow. There is no email-specific password exception or authentication bypass. Passwords remain limited to 72 UTF-8 bytes, are never trimmed, and always use bcrypt.hash(password, 10) on registration. Forms do not retain passwords. Errors preserve escaped name/email, and sensitive database details are not logged.

### Local database and grading account

The configured local target was verified as localhost / cse340_development with server address ::1. Both user and admin roles exist. Local loopback PostgreSQL connections disable TLS; hosted connections retain the existing TLS configuration. Render settings, database, and deployment were not accessed or changed.

The grading account admin@example.com was created through POST /register, initially with the normal user role. A parameterized UPDATE then assigned the admin role. Verification confirmed that the supplied grading password matches a bcrypt cost-10 hash and that a real login has admin access. No plaintext grading password is stored in source, SQL, or this document. No default password or authentication bypass is seeded. The account is retained only in the local development database. A new login is required after changing roles because roles are stored in the session.

### Verification and database safety

- npm run check compiles all EJS templates and checks JavaScript syntax.
- npm test runs offline with real pg connections disabled. Authentication tests cover bcrypt, SQL parameters, the safe session object, login/logout session and CSRF rotation, old-cookie replay, guest/user/admin permission matrices, hidden management links, safe errors, and the local database guard. Week 04 form tests now authenticate fixture admins through the real login route instead of bypassing permissions.
- npm run test:integration runs the live auth suite first and then the existing read-only suite. Supply GRADING_ADMIN_PASSWORD privately in the command environment; do not commit it. DB_URL (or an optional DEV_DB_URL override) must resolve to localhost and database cse340_development. The preloader rejects any other target before application imports. Before every writing test, every POST, promotion, or cleanup query, verifyDevelopmentDatabase checks resolved connection settings, current_database(), and the actual loopback server address. Any mismatch aborts. Unit tests verify the guard rejects remote/wrong targets before a query.
- Integration tests exercise real registration and stored hashes, duplicates, login success/failure, session rotation, logout invalidation, dashboard protection, every admin-only GET/POST, users-list access and hash exclusion, navigation, and successful organization/project/category/assignment writes. Only generated fixtures are cleaned up by captured IDs. The required grading account is retained. No database is dropped or recreated and no existing course record is edited/reset.
- Read-only integration checks still verify the existing three organizations, fifteen projects, five categories, twenty-one relationships, dates, image files, forms, invalid IDs and errors, now using a real admin login and production-style cookies.

No manual database initialization is needed for the already initialized local database. Use a private SESSION_SECRET and NODE_ENV=development for local HTTP. The optional DEV_DB_URL is a local override, not permission to target a hosted database. Tests never fall back to Render. The GRADING_ADMIN_PASSWORD environment value is required to rerun the live suite. If a grading account already exists with a different password, tests stop instead of silently resetting it.

Changed areas for this continuation:

- src/models/users.js: authentication functions, safe public user object and joined users list.
- src/controllers/users.js: login/logout, dashboard/users controllers, requireLogin/requireRole, seven-character registration minimum.
- src/routes.js: login/logout/dashboard/users routes and admin checks on all management routes.
- server.js: shared login/role locals and logout CSRF token after session middleware.
- src/models/db.js: local-loopback TLS compatibility while retaining hosted TLS.
- views/login.ejs, views/logout.ejs, views/dashboard.ejs, views/users.ejs: accessible styled authentication and users pages.
- views/partials/header.ejs, views/home.ejs, organization/project/category directory/detail views and views/errors/request.ejs: conditional navigation and management links.
- views/register.ejs, public/css/style.css: registration minimum, logout button and responsive user table styling.
- tests/authentication.test.js, tests/auth-integration.test.js, tests/verify-development-database.js: authentication/security and guarded local write tests.
- tests/admin-client.js, existing Week 04 tests, tests/registration.test.js and tests/integration.test.js: authenticated regression fixtures and updated expectations.
- tests/setup-integration-env.js, package.json, .env.example: guarded local integration runner and private credential inputs.
- README.md: implementation, test coverage and verification limits.

The application was not deployed or merged. Deployment and the grading account on any future hosted target still require separate authorization and verification. Manual browser/mobile/keyboard checks remain separate from automated HTTP/HTML verification.

## Hosting verification before submission (future work; not Phase 1)

Push the checked commit, confirm Render deploys the intended branch and commit, and verify the live home/list/detail routes, reciprocal links, logos, CSS, 404s, and `/test-error` HTTP 500 response. Check mobile layout and keyboard navigation in a browser. Ensure `DB_URL` is configured and `NODE_ENV=production` hides error details. A local HTTP/integration test does not establish successful Render deployment or guarantee a course grade.
