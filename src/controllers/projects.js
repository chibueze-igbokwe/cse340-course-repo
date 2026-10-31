import { getUpcomingProjects, getProjectDetails, createProject, updateProject } from '../models/projects.js';
import { getCategoriesByProjectId } from '../models/categories.js';
import { notFound } from './errors.js';
import { getAllOrganizations } from '../models/organizations.js';
import { body, validationResult } from 'express-validator';
import { formToken } from '../middleware/csrf.js';
import { isProjectDate } from '../utils/validate-project-date.js';

const NUMBER_OF_UPCOMING_PROJECTS = 5;

export const projectValidation = [
  ...[['title', 3, 200, 'Title'], ['description', 1, 1000, 'Description'], ['location', 1, 200, 'Location']]
    .map(([field, min, max, label]) => body(field).isString().withMessage(`Enter one ${label.toLowerCase()}.`).bail()
      .trim().isLength({ min, max }).withMessage(`${label} must be between ${min} and ${max} characters.`)
      .bail().not().contains('\0').withMessage(`${label} contains an invalid character.`)),
  body('date').custom(isProjectDate).withMessage('Enter a valid calendar date in YYYY-MM-DD format.'),
  body('organizationId').isString().withMessage('Choose one organization.').bail()
    .matches(/^\d+$/).withMessage('Choose a valid organization.').bail()
    .isInt({ min: 1, max: 2147483647 }).withMessage('Choose a valid organization.')
];

const submittedValues = (req) => Object.fromEntries(['title', 'description', 'location', 'date', 'organizationId']
  .map((field) => [field, typeof req.body?.[field] === 'string' ? req.body[field] : '']));

const renderProjectForm = (req, res, organizations, {
  editing = false, status = 200, errors = {}, formError = '',
  values = { title: '', description: '', location: '', date: '', organizationId: '' }
} = {}) => res.status(status).render(editing ? 'edit-project' : 'new-project', {
  title: `${editing ? 'Edit' : 'Add New'} Service Project | Service Network`,
  projectId: editing ? req.params.id : null,
  organizations, values, errors, formError, csrfToken: formToken(req)
});

export const showNewProjectForm = async (req, res) => {
  const organizations = await getAllOrganizations();
  return renderProjectForm(req, res, organizations);
};

export const showEditProjectForm = async (req, res, next) => {
  const project = await getProjectDetails(req.params.id);
  if (!project) return notFound(req, res, next);
  const organizations = await getAllOrganizations();
  return renderProjectForm(req, res, organizations, { editing: true, values: {
    title: project.title, description: project.description, location: project.location,
    date: project.date, organizationId: String(project.organization_id)
  } });
};

const processProjectForm = async (req, res, next, editing) => {
  const values = submittedValues(req);
  if (editing && !await getProjectDetails(req.params.id)) return notFound(req, res, next);
  const organizations = await getAllOrganizations();
  const errors = Object.fromEntries(validationResult(req).array({ onlyFirstError: true }).map((error) => [error.path, error.msg]));
  if (!errors.organizationId && !organizations.some((organization) => organization.organization_id === Number(values.organizationId))) {
    errors.organizationId = 'The selected organization no longer exists. Choose an available organization.';
  }
  if (Object.keys(errors).length) {
    return renderProjectForm(req, res, organizations, { editing, values, errors, status: 422 });
  }
  let id;
  try {
    const args = [values.title, values.description, values.location, values.date, values.organizationId];
    id = editing ? await updateProject(req.params.id, ...args) : await createProject(...args);
  } catch (error) {
    if (error.status === 404) return next(error);
    if (error.code === '23503') {
      const availableOrganizations = await getAllOrganizations();
      return renderProjectForm(req, res, availableOrganizations, { editing, values, status: 422,
        errors: { organizationId: 'The selected organization is no longer available. Choose another organization.' } });
    }
    console.error('Project save failed:', error);
    return renderProjectForm(req, res, organizations, { editing, values, status: 500,
      formError: 'We could not save the project. Your entries are preserved. Please try again later.' });
  }
  req.flash('success', editing ? 'Service project updated successfully!' : 'Service project created successfully!');
  req.session.save((error) => error ? next(error) : res.redirect(303, `/project/${id}`));
};

export const processNewProjectForm = (req, res, next) => processProjectForm(req, res, next, false);
export const processEditProjectForm = (req, res, next) => processProjectForm(req, res, next, true);

export const showProjectsPage = async (req, res) => {
  const projects = await getUpcomingProjects(NUMBER_OF_UPCOMING_PROJECTS);
  res.render('projects', { title: 'Upcoming Service Projects | Service Network', projects });
};

export const showProjectDetailsPage = async (req, res, next) => {
  const project = await getProjectDetails(req.params.id);
  if (!project) return notFound(req, res, next);
  const categories = await getCategoriesByProjectId(req.params.id);
  res.render('project', { title: project.title + ' | Service Network', project, categories });
};
