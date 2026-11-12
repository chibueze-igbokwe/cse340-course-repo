import { notFound } from '../controllers/errors.js';

// IDs must fit the existing positive PostgreSQL INTEGER primary keys.
export const validateResourceId = (req, res, next) => {
  const value = req.params.id ?? req.params.projectId;
  const id = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(id) || id < 1 || id > 2147483647) {
    return notFound(req, res, next);
  }
  next();
};
