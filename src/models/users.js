import db from './db.js';

export const createUser = async (name, email, passwordHash) => {
  // Resolve the role by name rather than assuming an ID or trusting form data.
  // INSERT ... SELECT also prevents a role-less account if the seed is missing.
  const result = await db.query(`
    INSERT INTO users (name, email, password_hash, role_id)
    SELECT $1, $2, $3, role_id FROM roles WHERE role_name = $4
    RETURNING user_id
  `, [name, email, passwordHash, 'user']);
  if (!result.rows.length) throw new Error('Unable to create user; verify the default user role is configured.');
  return result.rows[0].user_id;
};
