import express from 'express';
import { showHomePage } from './controllers/index.js';
import {
  showOrganizationsPage, showOrganizationDetailsPage,
  showNewOrganizationForm, processNewOrganizationForm,
  showEditOrganizationForm, processEditOrganizationForm,
  organizationValidation, organizationLogoValidation
} from './controllers/organizations.js';
import {
  showProjectsPage, showProjectDetailsPage, showNewProjectForm, processNewProjectForm,
  showEditProjectForm, processEditProjectForm, projectValidation
} from './controllers/projects.js';
import {
  showCategoriesPage, showCategoryDetailsPage, showAssignCategoriesForm, processAssignCategoriesForm
} from './controllers/categories.js';
import { testErrorPage } from './controllers/errors.js';
import { validateResourceId } from './middleware/validate-resource-id.js';
import { requireFormToken } from './middleware/csrf.js';

const router = express.Router();
router.get('/', showHomePage);
router.get('/organizations', showOrganizationsPage);
router.get('/organization/:id', validateResourceId, showOrganizationDetailsPage);
router.get('/new-organization', showNewOrganizationForm);
router.post('/new-organization', requireFormToken, organizationValidation, processNewOrganizationForm);
router.get('/edit-organization/:id', validateResourceId, showEditOrganizationForm);
router.post('/edit-organization/:id', validateResourceId, requireFormToken,
  organizationValidation, organizationLogoValidation, processEditOrganizationForm);
router.get('/projects', showProjectsPage);
router.get('/project/:id', validateResourceId, showProjectDetailsPage);
router.get('/new-project', showNewProjectForm);
router.post('/new-project', requireFormToken, projectValidation, processNewProjectForm);
router.get('/edit-project/:id', validateResourceId, showEditProjectForm);
router.post('/edit-project/:id', validateResourceId, requireFormToken, projectValidation, processEditProjectForm);
router.get('/assign-categories/:projectId', validateResourceId, showAssignCategoriesForm);
router.post('/assign-categories/:projectId', validateResourceId, requireFormToken, processAssignCategoriesForm);
router.get('/categories', showCategoriesPage);
router.get('/category/:id', validateResourceId, showCategoryDetailsPage);
router.get('/test-error', testErrorPage);

// Express 5 forwards rejected async controller promises to the error handler.
export default router;
