import {
  getAllCategories, getCategoryDetails, getCategoriesByProjectId,
  updateCategoryAssignments, createCategory, updateCategory
} from '../models/categories.js';
import { getProjectsByCategoryId, getProjectDetails } from '../models/projects.js';
import { notFound } from './errors.js';
import { formToken } from '../middleware/csrf.js';
import { body, validationResult } from 'express-validator';

// The three-character minimum intentionally exists only on the server.
export const categoryValidation = [
  body('name').isString().withMessage('Enter one category name.').bail()
    .trim().notEmpty().withMessage('Category name is required.').bail()
    .isLength({ min: 3, max: 100 }).withMessage('Category name must be between 3 and 100 characters.').bail()
    .not().contains('\0').withMessage('Category name contains an invalid character.')
];

const renderCategoryForm = (req, res, {
  editing = false, name = '', errors = {}, formError = '', status = 200
} = {}) => res.status(status).render(editing ? 'edit-category' : 'new-category', {
  title: `${editing ? 'Edit' : 'Add New'} Category | Service Network`,
  categoryId: editing ? req.params.id : null,
  name, errors, formError, csrfToken: formToken(req)
});

export const showNewCategoryForm = (req, res) => renderCategoryForm(req, res);

export const showEditCategoryForm = async (req, res, next) => {
  const category = await getCategoryDetails(req.params.id);
  if (!category) return notFound(req, res, next);
  return renderCategoryForm(req, res, { editing: true, name: category.name });
};

const processCategoryForm = async (req, res, next, editing) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  let id;
  try {
    if (editing && !await getCategoryDetails(req.params.id)) return notFound(req, res, next);
    const errors = Object.fromEntries(validationResult(req).array({ onlyFirstError: true })
      .map((error) => [error.path, error.msg]));
    if (Object.keys(errors).length) {
      return renderCategoryForm(req, res, { editing, name, errors, status: 422 });
    }
    id = editing ? await updateCategory(req.params.id, name) : await createCategory(name);
  } catch (error) {
    if (error.status === 404) return next(error);
    if (error.code === '23505') {
      return renderCategoryForm(req, res, { editing, name, status: 409,
        errors: { name: 'A category with this name already exists. Please choose another name.' } });
    }
    console.error('Category save failed:', error);
    return renderCategoryForm(req, res, { editing, name, status: 500,
      formError: 'We could not save the category. Your entry is preserved. Please try again later.' });
  }
  req.flash('success', editing ? 'Category updated successfully!' : 'Category added successfully!');
  req.session.save((error) => error ? next(error) : res.redirect(303, `/category/${id}`));
};

export const processNewCategoryForm = (req, res, next) => processCategoryForm(req, res, next, false);
export const processEditCategoryForm = (req, res, next) => processCategoryForm(req, res, next, true);

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
