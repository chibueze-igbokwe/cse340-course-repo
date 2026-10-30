import { getUpcomingProjects, getProjectDetails } from '../models/projects.js';
import { getCategoriesByProjectId } from '../models/categories.js';
import { notFound } from './errors.js';

const NUMBER_OF_UPCOMING_PROJECTS = 5;

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
