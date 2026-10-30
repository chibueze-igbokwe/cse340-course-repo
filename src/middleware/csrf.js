import { randomBytes, timingSafeEqual } from 'node:crypto';

export const formToken = (req) => {
  req.session.csrfToken ||= randomBytes(32).toString('hex');
  return req.session.csrfToken;
};

export const requireFormToken = (req, res, next) => {
  const supplied = req.body?._csrf;
  const expected = req.session.csrfToken;
  if (typeof supplied !== 'string' || !expected || !/^[a-f0-9]{64}$/.test(supplied)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    const error = new Error('Your form session has expired. Reload the form and try again.');
    error.status = 403;
    return next(error);
  }
  next();
};
