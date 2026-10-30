import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'node:url';
import router from './src/routes.js';
import { notFound, errorHandler } from './src/controllers/errors.js';
import { formatProjectDate } from './src/utils/format-project-date.js';
import session from 'express-session';
import { createSessionOptions } from './src/middleware/session.js';
import flash from './src/middleware/flash.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV?.toLowerCase() || 'production';
app.set('view engine', 'ejs');
app.set('views', fileURLToPath(new URL('./views', import.meta.url)));
app.locals.formatProjectDate = formatProjectDate;
app.locals.flash = () => ({});
if (NODE_ENV === 'production') app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (NODE_ENV === 'development') console.log(req.method, req.path);
  res.locals.NODE_ENV = NODE_ENV;
  next();
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
app.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 10, inflate: false }));
app.use(session(createSessionOptions()));
app.use(flash);
app.use(router);
app.use(notFound);
app.use(errorHandler);

// Importing the app for tests must not start a second listening server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => console.log('Server running at http://localhost:' + port));
}
export default app;
