# Service Network — CSE340

A server-rendered community service directory using Express 5, EJS, and PostgreSQL.

## Run locally

1. Install dependencies with `npm install` (or `npm.cmd install` in PowerShell).
2. Copy `.env.example` to a local, ignored `.env` file and set `DB_URL` to your existing PostgreSQL connection string.
3. Set `SESSION_SECRET` to a privately generated random value (at least 32 characters). For example, generate it locally with Node's `crypto.randomBytes(64).toString('hex')`. Never commit the generated value.
4. Optionally set `PORT` (default `3000`) and `NODE_ENV=development` for local HTTP, request logs, the footer indicator, and error details.
5. Run `npm start` or `npm run dev`.

The existing database connection uses TLS. No schema migration is required for Week 03.
`src/setup.sql` documents and seeds the Week 02 schema; **running it again drops and recreates the course tables**. Do not run it against an existing database just to install these changes.

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

No lint tool was configured in the original repository; the `check` command is a syntax/template check, not a lint claim. Tests use Node's built-in test runner without a separate test framework. Integration checks require network access to the existing database. No integration test resets or modifies stored data.

## Week 04 foundation: organization forms only

This branch adds the organization workflow from the form submission, session/flash, validation, and updating activities. Project/category write workflows and authentication are outside this change. The existing database schema and Week 03 features are preserved. No migration, session table, reset, or reseed is needed.

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

URL-encoded parsing uses flat fields (`extended: false`), a 16 KB body limit, a 10-parameter limit, and disabled compression. Oversized forms return HTTP 413, malformed forms HTTP 400, and unsupported compression HTTP 415. Missing or foreign-session CSRF tokens return HTTP 403 without a database write.

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

Run `npm run check`, `npm test`, and (with database connectivity) `npm run test:integration`. Automated create/update tests mock the database; a successful live database INSERT/UPDATE is deliberately not claimed. Browser visual/keyboard checks and live write/deployment checks remain separate.

## Hosting verification before submission

Push the checked commit, confirm Render deploys the intended branch and commit, and verify the live home/list/detail routes, reciprocal links, logos, CSS, 404s, and `/test-error` HTTP 500 response. Check mobile layout and keyboard navigation in a browser. Ensure `DB_URL` is configured and `NODE_ENV=production` hides error details. A local HTTP/integration test does not establish successful Render deployment or guarantee a course grade.
