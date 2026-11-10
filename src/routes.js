import express from 'express';
import { showHomePage } from './controllers/index.js';
import { showOrganizationsPage, showOrganizationDetailsPage } from './controllers/organizations.js';
import { showProjectsPage, showProjectDetailsPage } from './controllers/projects.js';
import { showCategoriesPage, showCategoryDetailsPage } from './controllers/categories.js';
import { testErrorPage } from './controllers/errors.js';
import { validateResourceId } from './middleware/validate-resource-id.js';

const router = express.Router();
router.get('/', showHomePage);
router.get('/organizations', showOrganizationsPage);
router.get('/organization/:id', validateResourceId, showOrganizationDetailsPage);
router.get('/projects', showProjectsPage);
router.get('/project/:id', validateResourceId, showProjectDetailsPage);
router.get('/categories', showCategoriesPage);
router.get('/category/:id', validateResourceId, showCategoryDetailsPage);
router.get('/test-error', testErrorPage);

// Express 5 forwards rejected async controller promises to the error handler.
export default router;
