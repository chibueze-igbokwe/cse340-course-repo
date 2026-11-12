import db from './db.js';

export const createCategory = async (name) => {
  const result = await db.query(`
    INSERT INTO category (name)
    VALUES ($1)
    RETURNING category_id
  `, [name]);
  if (!result.rows.length) throw new Error('Failed to create category');
  return result.rows[0].category_id;
};

export const updateCategory = async (id, name) => {
  const result = await db.query(`
    UPDATE category
    SET name = $1
    WHERE category_id = $2
    RETURNING category_id
  `, [name, id]);
  if (!result.rows.length) {
    const error = new Error('Category not found');
    error.status = 404;
    throw error;
  }
  return result.rows[0].category_id;
};

const assignCategoryToProject = async (client, projectId, categoryId) => {
  await client.query(`
    INSERT INTO project_category (project_id, category_id)
    VALUES ($1, $2)
    ON CONFLICT (project_id, category_id) DO NOTHING
  `, [projectId, categoryId]);
};

export const updateCategoryAssignments = async (projectId, categoryIds) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Serialize concurrent replacements for this project and detect deletion.
    const project = await client.query('SELECT project_id FROM project WHERE project_id = $1 FOR UPDATE', [projectId]);
    if (!project.rows.length) {
      const error = new Error('Project not found');
      error.status = 404;
      throw error;
    }
    await client.query('DELETE FROM project_category WHERE project_id = $1', [projectId]);
    for (const categoryId of new Set(categoryIds.map(Number))) {
      await assignCategoryToProject(client, projectId, categoryId);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

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
