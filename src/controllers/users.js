import bcrypt from 'bcrypt';
import { body, validationResult } from 'express-validator';
import { createUser } from '../models/users.js';
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
    .custom((value) => value.trim().length > 0 && [...value].length >= 8)
    .withMessage('Use a password with at least 8 characters.').bail()
    .custom((value) => Buffer.byteLength(value, 'utf8') <= 72 && !value.includes('\0'))
    .withMessage('Password must be at most 72 UTF-8 bytes and cannot contain a null character.')
];

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
