import db from './db.js';

export const getAllCategories = async () => {
  const result = await db.query('SELECT category_id, name FROM category ORDER BY name');
  return result.rows;
};
