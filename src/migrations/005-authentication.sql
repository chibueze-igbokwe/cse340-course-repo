-- Additive Week 05 migration. Review docs/week05-production-migration.md first.
-- Execute only after target confirmation, backup verification, and approval.
-- public is intentional: confirm the application's search_path resolves here.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE IF NOT EXISTS public.roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    role_description TEXT
);

CREATE TABLE IF NOT EXISTS public.users (
    user_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role_id INTEGER REFERENCES public.roles(role_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- IF NOT EXISTS alone is insufficient: reject incompatible existing tables.
-- Locks prevent concurrent writes/DDL while validating and seeding these tables.
LOCK TABLE public.roles, public.users IN SHARE ROW EXCLUSIVE MODE;
DO $validation$
DECLARE
    table_name TEXT;
    id_column TEXT;
    sequence_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['roles', 'users'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_class
            WHERE oid = to_regclass('public.' || table_name)
              AND relkind = 'r' AND NOT relispartition
              AND NOT relrowsecurity AND NOT relforcerowsecurity
        ) THEN
            RAISE EXCEPTION 'public.% must be an ordinary, nonpartitioned table without RLS', table_name;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = to_regclass('public.' || table_name) AND NOT tgisinternal
        ) OR EXISTS (
            SELECT 1 FROM pg_rewrite WHERE ev_class = to_regclass('public.' || table_name)
        ) OR EXISTS (
            SELECT 1 FROM pg_inherits
            WHERE inhrelid = to_regclass('public.' || table_name)
               OR inhparent = to_regclass('public.' || table_name)
        ) THEN
            RAISE EXCEPTION 'Unexpected triggers, rules, or inheritance on public.%: manual review required', table_name;
        END IF;
        id_column := CASE table_name WHEN 'roles' THEN 'role_id' ELSE 'user_id' END;
        sequence_name := pg_get_serial_sequence('public.' || table_name, id_column);
        IF sequence_name IS DISTINCT FROM 'public.' || table_name || '_' || id_column || '_seq' THEN
            RAISE EXCEPTION 'Unexpected SERIAL sequence/ownership on public.%', table_name;
        END IF;
    END LOOP;

    IF EXISTS (
        WITH expected(table_name, position, column_name, data_type, required, default_value) AS (
            VALUES
            ('roles', 1, 'role_id', 'integer', true, 'nextval(''roles_role_id_seq''::regclass)'),
            ('roles', 2, 'role_name', 'character varying(50)', true, NULL),
            ('roles', 3, 'role_description', 'text', false, NULL),
            ('users', 1, 'user_id', 'integer', true, 'nextval(''users_user_id_seq''::regclass)'),
            ('users', 2, 'name', 'character varying(100)', true, NULL),
            ('users', 3, 'email', 'character varying(100)', true, NULL),
            ('users', 4, 'password_hash', 'character varying(255)', true, NULL),
            ('users', 5, 'role_id', 'integer', false, NULL),
            ('users', 6, 'created_at', 'timestamp without time zone', false, 'CURRENT_TIMESTAMP')
        ), actual AS (
            SELECT c.relname::text AS table_name, a.attnum::integer AS position,
                   a.attname::text AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type,
                   a.attnotnull AS required, pg_get_expr(d.adbin, d.adrelid) AS default_value,
                   a.attidentity, a.attgenerated,
                   a.attcollation = t.typcollation AS default_collation
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_type t ON t.oid = a.atttypid
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid IN ('public.roles'::regclass, 'public.users'::regclass)
              AND a.attnum > 0 AND NOT a.attisdropped
        )
        SELECT 1 FROM expected e FULL JOIN actual a USING (table_name, position)
        WHERE e.column_name IS DISTINCT FROM a.column_name
           OR e.data_type IS DISTINCT FROM a.data_type
           OR e.required IS DISTINCT FROM a.required
           OR e.default_value IS DISTINCT FROM a.default_value
           OR a.attidentity <> '' OR a.attgenerated <> '' OR NOT a.default_collation
    ) THEN
        RAISE EXCEPTION 'Authentication columns/defaults differ from src/setup.sql; no automatic repair attempted';
    END IF;

    IF EXISTS (
        WITH expected(table_name, constraint_name, definition) AS (
            VALUES
            ('roles', 'roles_pkey', 'PRIMARY KEY (role_id)'),
            ('roles', 'roles_role_name_key', 'UNIQUE (role_name)'),
            ('users', 'users_pkey', 'PRIMARY KEY (user_id)'),
            ('users', 'users_email_key', 'UNIQUE (email)'),
            ('users', 'users_role_id_fkey', 'FOREIGN KEY (role_id) REFERENCES roles(role_id)')
        ), actual AS (
            SELECT c.relname::text AS table_name, con.conname::text AS constraint_name,
                   pg_get_constraintdef(con.oid) AS definition
            FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
            WHERE con.conrelid IN ('public.roles'::regclass, 'public.users'::regclass)
              -- PostgreSQL 18 exposes NOT NULL constraints here as well.
              AND con.contype <> 'n'
        )
        SELECT 1 FROM expected e FULL JOIN actual a USING (table_name, constraint_name)
        WHERE e.definition IS DISTINCT FROM a.definition
    ) THEN
        RAISE EXCEPTION 'Authentication constraints differ from src/setup.sql; manual review required';
    END IF;
END
$validation$;

-- Retain existing roles and descriptions; add only missing required role names.
INSERT INTO public.roles (role_name, role_description)
SELECT seed.role_name, seed.role_description
FROM (VALUES
    ('user', 'Registered Service Network user'),
    ('admin', 'Service Network administrator')
) AS seed(role_name, role_description)
WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.role_name = seed.role_name)
ON CONFLICT (role_name) DO NOTHING;

COMMIT;
