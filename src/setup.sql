-- CSE340 Week 02: Service Network database setup
-- Run in pgAdmin Query Tool against your CSE340 database.
-- WARNING: Re-running this script resets these four course tables and their data.

BEGIN;

DROP TABLE IF EXISTS project_category;
DROP TABLE IF EXISTS category;
DROP TABLE IF EXISTS project;
DROP TABLE IF EXISTS organization;

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

INSERT INTO organization (name, description, email, logo) VALUES
('Community Care Network', 'Connects volunteers with neighborhood support initiatives.', 'hello@communitycare.example', 'community-care.svg'),
('Green Future Initiative', 'Organizes environmental stewardship and sustainability projects.', 'contact@greenfuture.example', 'green-future.svg'),
('Learning Together Alliance', 'Supports education, literacy, and youth mentorship.', 'team@learningtogether.example', 'learning-together.svg');

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

-- Verification: expect 3 organizations, 15 projects, 5 categories, 21 links.
SELECT 'organization' AS table_name, COUNT(*) AS row_count FROM organization
UNION ALL SELECT 'project', COUNT(*) FROM project
UNION ALL SELECT 'category', COUNT(*) FROM category
UNION ALL SELECT 'project_category', COUNT(*) FROM project_category;

-- Verification: should return no rows (every project has at least one category).
SELECT p.project_id, p.title
FROM project p
LEFT JOIN project_category pc ON pc.project_id = p.project_id
WHERE pc.project_id IS NULL;
