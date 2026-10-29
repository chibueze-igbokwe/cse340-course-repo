import express from 'express';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => res.render('home', { title: 'Home | Service Network' }));
app.get('/organizations', (req, res) => res.render('organizations', { title: 'Organizations | Service Network' }));
app.get('/projects', (req, res) => res.render('projects', { title: 'Projects | Service Network' }));
app.get('/categories', (req, res) => res.render('categories', { title: 'Categories | Service Network' }));

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
