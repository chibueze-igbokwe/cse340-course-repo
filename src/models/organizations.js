import db from './db.js';

export const getAllOrganizations = async () => {
  const result = await db.query('SELECT organization_id, name, description, email, logo FROM organization ORDER BY name');
  return result.rows;
};
