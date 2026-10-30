import db from './db.js';

export const getAllOrganizations = async () => {
  const result = await db.query('SELECT organization_id, name, description, email, logo FROM organization ORDER BY name');
  return result.rows;
};

export const getOrganizationDetails = async (id) => {
  const result = await db.query(
    'SELECT organization_id, name, description, email, logo FROM organization WHERE organization_id = $1',
    [id]
  );
  return result.rows[0] ?? null;
};

export const createOrganization = async (name, description, contactEmail, logoFilename) => {
  const result = await db.query(`
    INSERT INTO organization (name, description, email, logo)
    VALUES ($1, $2, $3, $4)
    RETURNING organization_id
  `, [name, description, contactEmail, logoFilename]);
  if (!result.rows.length) throw new Error('Failed to create organization');
  return result.rows[0].organization_id;
};

export const updateOrganization = async (id, name, description, contactEmail, logoFilename) => {
  const result = await db.query(`
    UPDATE organization
    SET name = $1, description = $2, email = $3, logo = $4
    WHERE organization_id = $5
    RETURNING organization_id
  `, [name, description, contactEmail, logoFilename, id]);
  return result.rows[0]?.organization_id ?? null;
};
