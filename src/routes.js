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
  showCategoriesPage, showCategoryDetailsPage, showAssignCategoriesForm, processAssignCategoriesForm,
  showNewCategoryForm, processNewCategoryForm, showEditCategoryForm, processEditCategoryForm, categoryValidation
} from './controllers/categories.js';
import { testErrorPage } from './controllers/errors.js';
import { validateResourceId } from './middleware/validate-resource-id.js';
import { requireFormToken } from './middleware/csrf.js';
import {
  showUserRegistrationForm, processUserRegistrationForm, userRegistrationValidation,
  showLoginForm, processLoginForm, loginValidation, showLogoutForm, processLogout,
  requireLogin, requireRole, showDashboard, showUsersPage
} from './controllers/users.js';

const router = express.Router();
const adminOnly = [requireLogin, requireRole('admin')];
router.get('/', showHomePage);
router.get('/register', showUserRegistrationForm);
router.post('/register', requireFormToken, userRegistrationValidation, processUserRegistrationForm);
router.get('/login', showLoginForm);
router.post('/login', requireFormToken, loginValidation, processLoginForm);
router.get('/logout', requireLogin, showLogoutForm);
router.post('/logout', requireLogin, requireFormToken, processLogout);
router.get('/dashboard', requireLogin, showDashboard);
router.get('/users', ...adminOnly, showUsersPage);
router.get('/organizations', showOrganizationsPage);
router.get('/organization/:id', validateResourceId, showOrganizationDetailsPage);
router.get('/new-organization', ...adminOnly, showNewOrganizationForm);
router.post('/new-organization', ...adminOnly, requireFormToken, organizationValidation, processNewOrganizationForm);
router.get('/edit-organization/:id', ...adminOnly, validateResourceId, showEditOrganizationForm);
router.post('/edit-organization/:id', ...adminOnly, validateResourceId, requireFormToken,
  organizationValidation, organizationLogoValidation, processEditOrganizationForm);
router.get('/projects', showProjectsPage);
router.get('/project/:id', validateResourceId, showProjectDetailsPage);
router.get('/new-project', ...adminOnly, showNewProjectForm);
router.post('/new-project', ...adminOnly, requireFormToken, projectValidation, processNewProjectForm);
router.get('/edit-project/:id', ...adminOnly, validateResourceId, showEditProjectForm);
router.post('/edit-project/:id', ...adminOnly, validateResourceId, requireFormToken, projectValidation, processEditProjectForm);
router.get('/assign-categories/:projectId', ...adminOnly, validateResourceId, showAssignCategoriesForm);
router.post('/assign-categories/:projectId', ...adminOnly, validateResourceId, requireFormToken, processAssignCategoriesForm);
router.get('/categories', showCategoriesPage);
router.get('/category/:id', validateResourceId, showCategoryDetailsPage);
router.get('/new-category', ...adminOnly, showNewCategoryForm);
router.post('/new-category', ...adminOnly, requireFormToken, categoryValidation, processNewCategoryForm);
router.get('/edit-category/:id', ...adminOnly, validateResourceId, showEditCategoryForm);
router.post('/edit-category/:id', ...adminOnly, validateResourceId, requireFormToken, categoryValidation, processEditCategoryForm);
router.get('/test-error', testErrorPage);

// Express 5 forwards rejected async controller promises to the error handler.
export default router;
