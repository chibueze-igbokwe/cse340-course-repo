-- CSE340 Weeks 02–05: Service Network development database setup.
-- Run ONLY against a confirmed isolated, fresh development database.
-- Existing tables cause this transaction to fail rather than resetting data.
-- Never run against the Render database used for earlier-week grading.

BEGIN;

CREATE TABLE organization (
    organization_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    email VARCHAR(255) NOT NULL,
    logo VARCHAR(255) NOT NULL
);

CREATE TABLE project (
    project_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(200) NOT NULL,
    date DATE NOT NULL
);

CREATE TABLE category (
    category_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE project_category (
    project_id INTEGER NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES category(category_id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, category_id)
);

CREATE TABLE roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    role_description TEXT
);

CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role_id INTEGER REFERENCES roles(role_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO roles (role_name, role_description) VALUES
('user', 'Registered Service Network user'),
('admin', 'Service Network administrator');

INSERT INTO organization (name, description, email, logo) VALUES
('Community Care Network', 'Connects volunteers with neighborhood support initiatives.', 'hello@communitycare.example', 'community.svg'),
('Green Future Initiative', 'Organizes environmental stewardship and sustainability projects.', 'contact@greenfuture.example', 'environment.svg'),
('Learning Together Alliance', 'Supports education, literacy, and youth mentorship.', 'team@learningtogether.example', 'education.svg');

INSERT INTO project (organization_id, title, description, location, date) VALUES
(1, 'Neighborhood Food Drive', 'Collect and sort shelf-stable food for local families.', 'Community Center', '2026-11-07'),
(1, 'Senior Home Visits', 'Visit older residents and provide companionship.', 'North District', '2026-11-14'),
(1, 'Winter Clothing Collection', 'Collect and distribute gently used clothing.', 'Central Hall', '2026-11-21'),
(1, 'Community Health Outreach', 'Help organize wellness information and volunteer registration.', 'Civic Square', '2026-12-05'),
(1, 'Holiday Meal Packing', 'Prepare meal parcels for households in need.', 'Community Kitchen', '2026-12-12'),
(2, 'Park Cleanup Day', 'Remove litter and sort recyclable materials.', 'Riverside Park', '2026-11-08'),
(2, 'Tree Planting Morning', 'Plant and water native tree seedlings.', 'Eastside Greenbelt', '2026-11-15'),
(2, 'Recycling Awareness Booth', 'Teach residents how to separate recyclable waste.', 'Town Market', '2026-11-22'),
(2, 'Community Garden Setup', 'Prepare garden beds and install compost bins.', 'Westside Garden', '2026-12-06'),
(2, 'Stream Restoration', 'Remove debris and protect a local stream bank.', 'Willow Creek', '2026-12-13'),
(3, 'Children’s Reading Circle', 'Read stories and practice literacy skills with children.', 'Public Library', '2026-11-09'),
(3, 'After-School Tutoring', 'Support learners with mathematics and reading.', 'Youth Center', '2026-11-16'),
(3, 'School Supply Sorting', 'Prepare donated stationery for distribution.', 'Learning Hub', '2026-11-23'),
(3, 'Digital Skills Workshop', 'Introduce beginners to essential computer skills.', 'Community Lab', '2026-12-07'),
(3, 'Mentor Match Event', 'Connect volunteer mentors with students.', 'Education Center', '2026-12-14');

INSERT INTO category (name) VALUES
('Community Support'),
('Environment'),
('Education'),
('Health and Wellness'),
('Youth Development');

-- Every project gets at least one category. Several have multiple categories.
INSERT INTO project_category (project_id, category_id) VALUES
(1,1),(2,1),(3,1),(4,1),(4,4),(5,1),
(6,2),(7,2),(8,2),(8,3),(9,2),(10,2),
(11,3),(11,5),(12,3),(12,5),(13,3),(14,3),(14,5),(15,3),(15,5);

COMMIT;

-- Verification on a fresh database: 3 organizations, 15 projects, 5 categories,
-- 21 links, 2 roles, and 0 users. No default user accounts/passwords are seeded.
SELECT 'organization' AS table_name, COUNT(*) AS row_count FROM organization
UNION ALL SELECT 'project', COUNT(*) FROM project
UNION ALL SELECT 'category', COUNT(*) FROM category
UNION ALL SELECT 'project_category', COUNT(*) FROM project_category
UNION ALL SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'users', COUNT(*) FROM users;

-- Verification: should return no rows (every project has at least one category).
SELECT p.project_id, p.title
FROM project p
LEFT JOIN project_category pc ON pc.project_id = p.project_id
WHERE pc.project_id IS NULL;
