import db from './db.js';

export const getAllProjects = async () => {
  const result = await db.query(`
    SELECT p.project_id, p.organization_id, p.title, p.description, p.location, p.date,
           o.name AS organization_name
    FROM project p
    JOIN organization o ON p.organization_id = o.organization_id
    ORDER BY p.date, p.title
  `);
  return result.rows;
};

export const getUpcomingProjects = async (number_of_projects) => {
  const result = await db.query(`
    SELECT p.project_id, p.organization_id, p.title, p.description, p.location, p.date,
           o.name AS organization_name
    FROM project p
    JOIN organization o ON p.organization_id = o.organization_id
    WHERE p.date >= CURRENT_DATE
    ORDER BY p.date ASC, p.title ASC, p.project_id ASC
    LIMIT $1
  `, [number_of_projects]);
  return result.rows;
};

export const getProjectDetails = async (id) => {
  const result = await db.query(`
    SELECT p.project_id, p.organization_id, p.title, p.description, p.location, p.date,
           o.name AS organization_name
    FROM project p
    JOIN organization o ON p.organization_id = o.organization_id
    WHERE p.project_id = $1
  `, [id]);
  return result.rows[0] ?? null;
};

export const getProjectsByOrganizationId = async (organizationId) => {
  const result = await db.query(`
    SELECT project_id, organization_id, title, description, location, date
    FROM project
    WHERE organization_id = $1
    ORDER BY date ASC, title ASC, project_id ASC
  `, [organizationId]);
  return result.rows;
};

export const getProjectsByCategoryId = async (categoryId) => {
  const result = await db.query(`
    SELECT p.project_id, p.organization_id, p.title, p.description, p.location, p.date,
           o.name AS organization_name
    FROM project p
    JOIN project_category pc ON p.project_id = pc.project_id
    JOIN organization o ON p.organization_id = o.organization_id
    WHERE pc.category_id = $1
    ORDER BY p.date ASC, p.title ASC, p.project_id ASC
  `, [categoryId]);
  return result.rows;
};
