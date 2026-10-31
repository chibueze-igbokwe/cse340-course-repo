import express from 'express';
import dotenv from 'dotenv';
import { getAllOrganizations } from './src/models/organizations.js';
import { getAllProjects } from './src/models/projects.js';
import { getAllCategories } from './src/models/categories.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => res.render('home', { title: 'Home | Service Network' }));

app.get('/organizations', async (req, res, next) => {
  try {
    const organizations = await getAllOrganizations();
    res.render('organizations', { title: 'Organizations | Service Network', pageHeading: 'Organizations', organizations });
  } catch (error) { next(error); }
});

app.get('/projects', async (req, res, next) => {
  try {
    const projects = await getAllProjects();
    res.render('projects', { title: 'Projects | Service Network', pageHeading: 'Service Projects', projects });
  } catch (error) { next(error); }
});

app.get('/categories', async (req, res, next) => {
  try {
    const categories = await getAllCategories();
    res.render('categories', { title: 'Categories | Service Network', pageHeading: 'Service Project Categories', categories });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error('Request failed:', error);
  res.status(500).send('Sorry, something went wrong. Please try again later.');
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
