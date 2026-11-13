import db from './db.js';
import bcrypt from 'bcrypt';

export const findUserByEmail = async (email) => {
  const result = await db.query(`
    SELECT u.user_id, u.name, u.email, u.password_hash, r.role_name
    FROM users u JOIN roles r ON u.role_id = r.role_id
    WHERE u.email = $1
  `, [email]);
  return result.rows[0] ?? null;
};

export const verifyPassword = (password, passwordHash) => bcrypt.compare(password, passwordHash);

export const authenticateUser = async (email, password) => {
  const user = await findUserByEmail(email);
  if (!user || !await verifyPassword(password, user.password_hash)) return null;
  return { user_id: user.user_id, name: user.name, email: user.email, role_name: user.role_name };
};

export const getAllUsers = async () => {
  const result = await db.query(`
    SELECT u.user_id, u.name, u.email, r.role_name
    FROM users u JOIN roles r ON u.role_id = r.role_id
    ORDER BY u.name, u.user_id
  `);
  return result.rows;
};

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
