import { getAllOrganizations, getOrganizationDetails } from '../models/organizations.js';
import { getProjectsByOrganizationId } from '../models/projects.js';
import { notFound } from './errors.js';

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
