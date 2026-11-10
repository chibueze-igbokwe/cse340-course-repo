import { notFound } from '../controllers/errors.js';

// IDs must fit the existing positive PostgreSQL INTEGER primary keys.
export const validateResourceId = (req, res, next) => {
  const id = Number(req.params.id);
  if (!/^\d+$/.test(req.params.id) || !Number.isInteger(id) || id < 1 || id > 2147483647) {
    return notFound(req, res, next);
  }
  next();
};
