import db from './db.js';

export const getAllCategories = async () => {
  const result = await db.query('SELECT category_id, name FROM category ORDER BY name');
  return result.rows;
};

export const getCategoryDetails = async (id) => {
  const result = await db.query('SELECT category_id, name FROM category WHERE category_id = $1', [id]);
  return result.rows[0] ?? null;
};

export const getCategoriesByProjectId = async (projectId) => {
  const result = await db.query(`
    SELECT c.category_id, c.name
    FROM category c
    JOIN project_category pc ON c.category_id = pc.category_id
    WHERE pc.project_id = $1
    ORDER BY c.name
  `, [projectId]);
  return result.rows;
};
