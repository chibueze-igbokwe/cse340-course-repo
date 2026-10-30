import { getAllCategories, getCategoryDetails } from '../models/categories.js';
import { getProjectsByCategoryId } from '../models/projects.js';
import { notFound } from './errors.js';

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
