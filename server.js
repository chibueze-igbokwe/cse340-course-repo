import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'node:url';
import router from './src/routes.js';
import { notFound, errorHandler } from './src/controllers/errors.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV?.toLowerCase() || 'production';
app.set('view engine', 'ejs');
app.set('views', fileURLToPath(new URL('./views', import.meta.url)));
app.use((req, res, next) => {
  if (NODE_ENV === 'development') console.log(req.method, req.path);
  res.locals.NODE_ENV = NODE_ENV;
  next();
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
app.use(router);
app.use(notFound);
app.use(errorHandler);

// Importing the app for tests must not start a second listening server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => console.log('Server running at http://localhost:' + port));
}
export default app;
