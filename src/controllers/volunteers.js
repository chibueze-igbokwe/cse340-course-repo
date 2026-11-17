import { addVolunteer, removeVolunteer, getVolunteerProjects } from '../models/volunteers.js';
import { getProjectDetails } from '../models/projects.js';
import { formToken } from '../middleware/csrf.js';
import { notFound } from './errors.js';

export const showMyVolunteering = async (req, res) => {
  const projects = await getVolunteerProjects(req.session.user.user_id);
  res.set('Cache-Control', 'no-store');
  res.render('my-volunteering', {
    title: 'My Volunteering | Service Network', projects, csrfToken: formToken(req)
  });
};

const processVolunteering = async (req, res, next, removing) => {
  const projectId = req.params.id;
  const destination = removing && req.body?.returnTo === 'my-volunteering'
    ? '/my-volunteering' : `/project/${projectId}`;
  try {
    if (!await getProjectDetails(projectId)) return notFound(req, res, next);
    // Ownership always comes from the authenticated session, never the form.
    const changed = await (removing ? removeVolunteer : addVolunteer)(req.session.user.user_id, projectId);
    req.flash('success', removing
      ? (changed ? 'Your volunteering has been removed.' : 'You are not volunteering for this project.')
      : (changed ? 'You are now volunteering for this project!' : 'You are already volunteering for this project.'));
  } catch (error) {
    // A foreign-key race cannot leave an orphaned registration.
    if (error.code === '23503') return notFound(req, res, next);
    console.error('Volunteering save failed:', error.code || error.name);
    req.flash('error', 'We could not update your volunteering. Please try again later.');
  }
  req.session.save((error) => error ? next(error) : res.redirect(303, destination));
};

export const processVolunteer = (req, res, next) => processVolunteering(req, res, next, false);
export const processRemoveVolunteering = (req, res, next) => processVolunteering(req, res, next, true);
