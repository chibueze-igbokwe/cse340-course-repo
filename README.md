# Service Network — CSE340

A server-rendered community service directory using Express 5, EJS, and PostgreSQL.

## Run locally

1. Install dependencies with `npm install` (or `npm.cmd install` in PowerShell).
2. Set `DB_URL` in a local, ignored `.env` file to your existing PostgreSQL connection string.
3. Optionally set `PORT` (default `3000`) and `NODE_ENV=development` for request logs, the footer indicator, and error details.
4. Run `npm start` or `npm run dev`.

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
| `npm test` | `tests/week03.test.js` checks model parameter binding, all routes, reciprocal links, escaping, invalid/missing IDs, empty states, database failures, production error privacy, CSS, and all three static SVG logos; `tests/development.test.js` checks development middleware and diagnostics |
| `npm run test:integration` | `tests/integration.test.js` makes read-only queries to the configured database and verifies actual records, relationships, upcoming-project limits, HTTP routes, logo filenames/assets, and error responses |

No lint tool was configured in the original repository; the `check` command is a syntax/template check, not a lint claim. The tests use Node's built-in test runner and require no new dependencies. Integration checks require network access to the existing database. No integration test resets or modifies stored data.

## Hosting verification before submission

Push the checked commit, confirm Render deploys the intended branch and commit, and verify the live home/list/detail routes, reciprocal links, logos, CSS, 404s, and `/test-error` HTTP 500 response. Check mobile layout and keyboard navigation in a browser. Ensure `DB_URL` is configured and `NODE_ENV=production` hides error details. A local HTTP/integration test does not establish successful Render deployment or guarantee a course grade.
