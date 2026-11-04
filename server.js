import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'node:url';
import router from './src/routes.js';
import { notFound, errorHandler } from './src/controllers/errors.js';
import { formatProjectDate } from './src/utils/format-project-date.js';
import session from 'express-session';
import { createSessionOptions } from './src/middleware/session.js';
import flash from './src/middleware/flash.js';
import { formToken } from './src/middleware/csrf.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV?.toLowerCase() || 'production';
app.set('view engine', 'ejs');
app.set('views', fileURLToPath(new URL('./views', import.meta.url)));
app.locals.formatProjectDate = formatProjectDate;
app.locals.flash = () => ({});
app.locals.isLoggedIn = false;
app.locals.isAdmin = false;
app.locals.currentUser = null;
app.locals.logoutCsrf = '';
if (NODE_ENV === 'production') app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (NODE_ENV === 'development') console.log(req.method, req.path);
  res.locals.NODE_ENV = NODE_ENV;
  next();
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
const formOptions = { extended: false, limit: '16kb', parameterLimit: 10, inflate: false };
// Checkbox groups can submit many repeated categoryIds keys; keep the other
// forms' existing ten-parameter limit while allowing up to 99 selections.
app.use('/assign-categories', express.urlencoded({ ...formOptions, parameterLimit: 100 }));
app.use(express.urlencoded(formOptions));
app.use(session(createSessionOptions()));
app.use(flash);
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.isLoggedIn = Boolean(req.session.user);
  res.locals.isAdmin = req.session.user?.role_name === 'admin';
  res.locals.logoutCsrf = req.session.user ? formToken(req) : '';
  next();
});
app.use(router);
app.use(notFound);
app.use(errorHandler);

// Importing the app for tests must not start a second listening server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => console.log('Server running at http://localhost:' + port));
}
export default app;
