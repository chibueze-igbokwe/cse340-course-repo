import bcrypt from 'bcrypt';
import { body, validationResult } from 'express-validator';
import { createUser, authenticateUser, getAllUsers } from '../models/users.js';
import { formToken } from '../middleware/csrf.js';

export const userRegistrationValidation = [
  body('name').isString().withMessage('Enter one name.').bail()
    .trim().notEmpty().withMessage('Name is required.').bail()
    .isLength({ max: 100 }).withMessage('Name must be 100 characters or fewer.').bail()
    .not().contains('\0').withMessage('Name contains an invalid character.'),
  body('email').isString().withMessage('Enter one email address.').bail()
    .trim().isLength({ max: 100 }).withMessage('Email must be 100 characters or fewer.').bail()
    .isEmail({ allow_utf8_local_part: false }).withMessage('Enter a valid email address.')
    .customSanitizer((value) => value.toLowerCase()),
  body('password').isString().withMessage('Enter one password.').bail()
    .custom((value) => value.trim().length > 0 && [...value].length >= 7)
    .withMessage('Use a password with at least 7 characters.').bail()
    .custom((value) => Buffer.byteLength(value, 'utf8') <= 72 && !value.includes('\0'))
    .withMessage('Password must be at most 72 UTF-8 bytes and cannot contain a null character.')
];

export const loginValidation = [
  body('email').isString().withMessage('Enter one email address.').bail().trim()
    .isLength({ max: 100 }).withMessage('Email must be 100 characters or fewer.').bail()
    .isEmail({ allow_utf8_local_part: false }).withMessage('Enter a valid email address.')
    .customSanitizer((value) => value.toLowerCase()),
  body('password').isString().withMessage('Enter one password.').bail()
    .custom((value) => value.length > 0 && Buffer.byteLength(value, 'utf8') <= 72 && !value.includes('\0'))
    .withMessage('Enter a valid password (up to 72 UTF-8 bytes).')
];

const renderLogin = (req, res, { email = '', errors = {}, formError = '', status = 200 } = {}) =>
  res.status(status).render('login', { title: 'Login | Service Network', email, errors, formError, csrfToken: formToken(req) });

export const showLoginForm = (req, res) => renderLogin(req, res);

export const processLoginForm = async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const errors = Object.fromEntries(validationResult(req).array({ onlyFirstError: true }).map((error) => [error.path, error.msg]));
  if (Object.keys(errors).length) return renderLogin(req, res, { email, errors, status: 422 });
  let user;
  try { user = await authenticateUser(email, req.body.password); }
  catch (error) {
    console.error('Login failed:', error.code || error.name);
    return renderLogin(req, res, { email, status: 500, formError: 'We could not log you in. Please try again later.' });
  }
  if (!user) {
    req.flash('error', 'Invalid email or password.');
    return renderLogin(req, res, { email, status: 401 });
  }
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = user;
    req.flash('success', 'Login successful!');
    req.session.save((saveError) => saveError ? next(saveError) : res.redirect(303, '/dashboard'));
  });
};

export const showLogoutForm = (req, res) => res.render('logout', { title: 'Logout | Service Network', csrfToken: formToken(req) });

export const processLogout = (req, res, next) => {
  // regenerate destroys the authenticated session and creates a fresh anonymous
  // session for the one-time confirmation, invalidating the old session ID.
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.flash('success', 'Logout successful!');
    req.session.save((saveError) => saveError ? next(saveError) : res.redirect(303, '/login'));
  });
};

const denyAccess = (req, res, next, path, message) => {
  req.flash('error', message);
  req.session.save((error) => error ? next(error) : res.redirect(303, path));
};

export const requireLogin = (req, res, next) => {
  if (!req.session?.user) return denyAccess(req, res, next, '/login', 'You must be logged in to access that page.');
  next();
};

export const requireRole = (role) => (req, res, next) => {
  if (!req.session?.user) return requireLogin(req, res, next);
  if (req.session.user.role_name !== role) return denyAccess(req, res, next, '/dashboard', 'You do not have permission to access that page.');
  next();
};

export const showDashboard = (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.render('dashboard', { title: 'Dashboard | Service Network', name: req.session.user.name, email: req.session.user.email });
};

export const showUsersPage = async (req, res) => {
  const users = await getAllUsers();
  res.set('Cache-Control', 'no-store');
  res.render('users', { title: 'Registered Users | Service Network', users });
};

const renderRegistrationForm = (req, res, {
  name = '', email = '', errors = {}, formError = '', status = 200
} = {}) => res.status(status).render('register', {
  title: 'Register | Service Network', name, email, errors, formError, csrfToken: formToken(req)
});

export const showUserRegistrationForm = (req, res) => renderRegistrationForm(req, res);

export const processUserRegistrationForm = async (req, res, next) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const errors = Object.fromEntries(validationResult(req).array({ onlyFirstError: true })
    .map((error) => [error.path, error.msg]));
  if (Object.keys(errors).length) return renderRegistrationForm(req, res, { name, email, errors, status: 422 });
  try {
    // Do not trim, escape, store in the session, log, or re-render passwords.
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    await createUser(name, email, passwordHash);
  } catch (error) {
    if (error.code === '23505') {
      return renderRegistrationForm(req, res, { name, email, status: 409,
        errors: { email: 'An account with this email already exists. Please use another email address.' } });
    }
    // Database error details can include values: log only the error code/type.
    console.error('Registration failed:', error.code || error.name);
    return renderRegistrationForm(req, res, { name, email, status: 500,
      formError: 'We could not create your account. Please try again later. Re-enter your password to retry.' });
  }
  req.flash('success', 'Registration successful! Your account has been created.');
  req.session.save((error) => error ? next(error) : res.redirect(303, '/'));
};
