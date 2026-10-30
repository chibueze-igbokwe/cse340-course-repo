import { getAllOrganizations, getOrganizationDetails, createOrganization, updateOrganization } from '../models/organizations.js';
import { getProjectsByOrganizationId } from '../models/projects.js';
import { notFound } from './errors.js';
import { body, validationResult } from 'express-validator';
import { formToken } from '../middleware/csrf.js';
import { organizationLogos } from '../utils/organization-logos.js';

// Check types before sanitizing: repeated URL-encoded keys are arrays.
export const organizationValidation = [
  body('name').isString().withMessage('Enter one organization name.').bail()
    .trim().isLength({ min: 3, max: 150 }).withMessage('Organization name must be between 3 and 150 characters.')
    .bail().not().contains('\0').withMessage('Organization name contains an invalid character.'),
  body('description').isString().withMessage('Enter one description.').bail()
    .trim().isLength({ min: 1, max: 500 }).withMessage('Description is required and must be 500 characters or fewer.')
    .bail().not().contains('\0').withMessage('Description contains an invalid character.'),
  body('contactEmail').isString().withMessage('Enter one contact email.').bail()
    .trim().isLength({ max: 255 }).withMessage('Contact email must be 255 characters or fewer.')
    .bail().isEmail({ allow_utf8_local_part: false }).withMessage('Enter a valid contact email address.')
    // Preserve mailbox characters; normalize only the case-insensitive domain.
    .customSanitizer((value) => value.replace(/@(.+)$/, (_, domain) => '@' + domain.toLowerCase()))
];

export const organizationLogoValidation = body('logoFilename').isString()
  .withMessage('Choose one logo filename.').bail().trim()
  .isIn(organizationLogos).withMessage('Choose a logo filename from the available images.');

const submittedValues = (req) => Object.fromEntries(
  ['name', 'description', 'contactEmail', 'logoFilename'].map((key) => [key,
    typeof req.body?.[key] === 'string' ? req.body[key] : ''])
);

const renderForm = (req, res, { editing = false, values, errors = {}, formError = '', status = 200 } = {}) => {
  const id = editing ? req.params.id : null;
  return res.status(status).render(editing ? 'edit-organization' : 'new-organization', {
    title: `${editing ? 'Edit' : 'Add New'} Organization | Service Network`,
    organizationId: id,
    values: values || { name: '', description: '', contactEmail: '', logoFilename: 'placeholder-logo.png' },
    errors, formError, csrfToken: formToken(req), organizationLogos
  });
};

const formErrors = (req) => Object.fromEntries(validationResult(req).array({ onlyFirstError: true })
  .map((error) => [error.path, error.msg]));

const saveFailure = (error, req, res, editing, values) => {
  if (error.code === '23505') {
    return renderForm(req, res, { editing, values, status: 409,
      errors: { name: 'An organization with this name already exists. Please choose another name.' } });
  }
  console.error('Organization save failed:', error);
  return renderForm(req, res, { editing, values, status: 500,
    formError: 'We could not save the organization. Your entries are preserved. Please try again later.' });
};

const redirectToOrganization = (req, res, next, id, message) => {
  req.flash('success', message);
  // Save before redirecting so the next request sees the flash message.
  req.session.save((error) => error ? next(error) : res.redirect(303, `/organization/${id}`));
};

export const showNewOrganizationForm = (req, res) => renderForm(req, res);

export const processNewOrganizationForm = async (req, res, next) => {
  const values = submittedValues(req);
  const errors = formErrors(req);
  if (Object.keys(errors).length) return renderForm(req, res, { values, errors, status: 422 });
  let id;
  try {
    id = await createOrganization(values.name, values.description, values.contactEmail, 'placeholder-logo.png');
  } catch (error) { return saveFailure(error, req, res, false, values); }
  redirectToOrganization(req, res, next, id, 'Organization added successfully!');
};

export const showEditOrganizationForm = async (req, res, next) => {
  const organization = await getOrganizationDetails(req.params.id);
  if (!organization) return notFound(req, res, next);
  return renderForm(req, res, { editing: true, values: {
    name: organization.name, description: organization.description,
    contactEmail: organization.email, logoFilename: organization.logo
  } });
};

export const processEditOrganizationForm = async (req, res, next) => {
  const values = submittedValues(req);
  let id;
  try {
    if (!await getOrganizationDetails(req.params.id)) return notFound(req, res, next);
    const errors = formErrors(req);
    if (Object.keys(errors).length) return renderForm(req, res, { editing: true, values, errors, status: 422 });
    id = await updateOrganization(req.params.id, values.name, values.description, values.contactEmail, values.logoFilename);
    if (!id) return notFound(req, res, next);
  } catch (error) { return saveFailure(error, req, res, true, values); }
  redirectToOrganization(req, res, next, id, 'Organization updated successfully!');
};

export const showOrganizationsPage = async (req, res) => {
  const organizations = await getAllOrganizations();
  res.render('organizations', { title: 'Organizations | Service Network', organizations });
};

export const showOrganizationDetailsPage = async (req, res, next) => {
  const organizationDetails = await getOrganizationDetails(req.params.id);
  if (!organizationDetails) return notFound(req, res, next);
  const projects = await getProjectsByOrganizationId(req.params.id);
  res.render('organization', {
    title: organizationDetails.name + ' | Service Network', organizationDetails, projects
  });
};
