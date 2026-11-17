import db from './db.js';

export const addVolunteer = async (userId, projectId) => {
  const result = await db.query(`
    INSERT INTO volunteer (user_id, project_id) VALUES ($1, $2)
    ON CONFLICT (user_id, project_id) DO NOTHING
    RETURNING project_id
  `, [userId, projectId]);
  return result.rows.length > 0;
};

export const removeVolunteer = async (userId, projectId) => {
  const result = await db.query(`
    DELETE FROM volunteer WHERE user_id = $1 AND project_id = $2
    RETURNING project_id
  `, [userId, projectId]);
  return result.rows.length > 0;
};

export const getVolunteerProjects = async (userId) => {
  const result = await db.query(`
    SELECT p.project_id, p.title, p.description, p.location, p.date,
           p.organization_id, o.name AS organization_name
    FROM volunteer v
    JOIN project p ON p.project_id = v.project_id
    JOIN organization o ON o.organization_id = p.organization_id
    WHERE v.user_id = $1
    ORDER BY p.date ASC, p.title ASC, p.project_id ASC
  `, [userId]);
  return result.rows;
};

export const isVolunteering = async (userId, projectId) => {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1 FROM volunteer WHERE user_id = $1 AND project_id = $2
    ) AS volunteering
  `, [userId, projectId]);
  return result.rows[0].volunteering;
};
