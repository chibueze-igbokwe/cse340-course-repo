import { getAllCategories, getCategoryDetails, getCategoriesByProjectId, updateCategoryAssignments } from '../models/categories.js';
import { getProjectsByCategoryId, getProjectDetails } from '../models/projects.js';
import { notFound } from './errors.js';
import { formToken } from '../middleware/csrf.js';

const renderAssignments = (req, res, project, categories, selectedCategoryIds, { status = 200, error = '' } = {}) => {
  return res.status(status).render('assign-categories', {
    title: 'Assign Categories to Project | Service Network', project, categories,
    selectedCategoryIds, error, csrfToken: formToken(req)
  });
};

export const showAssignCategoriesForm = async (req, res, next) => {
  const project = await getProjectDetails(req.params.projectId);
  if (!project) return notFound(req, res, next);
  const categories = await getAllCategories();
  const assigned = await getCategoriesByProjectId(req.params.projectId);
  return renderAssignments(req, res, project, categories, assigned.map((category) => category.category_id));
};

export const processAssignCategoriesForm = async (req, res, next) => {
  const projectId = req.params.projectId;
  const project = await getProjectDetails(projectId);
  if (!project) return notFound(req, res, next);
  const categories = await getAllCategories();
  const raw = req.body?.categoryIds;
  const ids = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const validId = (id) => typeof id === 'string' && /^\d+$/.test(id) && Number(id) >= 1 && Number(id) <= 2147483647;
  const selected = [...new Set(ids.filter(validId).map(Number))];
  const unknownFields = Object.keys(req.body || {}).some((field) => !['_csrf', 'categoryIds'].includes(field));
  if (unknownFields || !ids.every(validId) || selected.some((id) => !categories.some((category) => category.category_id === id))) {
    return renderAssignments(req, res, project, categories, selected, { status: 422,
      error: 'Choose only categories from the available list. Your valid selections are preserved.' });
  }
  try {
    await updateCategoryAssignments(projectId, selected);
  } catch (error) {
    if (error.status === 404) return next(error);
    if (error.code === '23503') {
      const availableCategories = await getAllCategories();
      return renderAssignments(req, res, project, availableCategories, selected, { status: 422,
        error: 'A selected category is no longer available. Review your selections and try again.' });
    }
    console.error('Category assignment failed:', error);
    return renderAssignments(req, res, project, categories, selected, { status: 500,
      error: 'We could not save the categories. Your selections are preserved. Please try again later.' });
  }
  req.flash('success', 'Categories updated successfully!');
  req.session.save((error) => error ? next(error) : res.redirect(303, `/project/${projectId}`));
};

export const showCategoriesPage = async (req, res) => {
  const categories = await getAllCategories();
  res.render('categories', { title: 'Categories | Service Network', categories });
};

export const showCategoryDetailsPage = async (req, res, next) => {
  const category = await getCategoryDetails(req.params.id);
  if (!category) return notFound(req, res, next);
  const projects = await getProjectsByCategoryId(req.params.id);
  res.render('category', { title: category.name + ' | Service Network', category, projects });
};
