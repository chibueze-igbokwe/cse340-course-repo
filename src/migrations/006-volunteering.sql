-- Additive Week 06 migration. Requires the existing Week 04/05 schema.
-- Never run setup.sql on an existing database. No volunteer data is seeded.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE IF NOT EXISTS public.volunteer (
    user_id INTEGER NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, project_id)
);

LOCK TABLE public.volunteer IN SHARE ROW EXCLUSIVE MODE;
DO $validation$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE oid = 'public.volunteer'::regclass
          AND relkind = 'r' AND NOT relispartition
          AND NOT relrowsecurity AND NOT relforcerowsecurity
    ) OR EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.volunteer'::regclass AND NOT tgisinternal
    ) OR EXISTS (
        SELECT 1 FROM pg_rewrite WHERE ev_class = 'public.volunteer'::regclass
    ) OR EXISTS (
        SELECT 1 FROM pg_inherits
        WHERE inhrelid = 'public.volunteer'::regclass OR inhparent = 'public.volunteer'::regclass
    ) THEN
        RAISE EXCEPTION 'Unexpected volunteer structure, triggers, rules or inheritance; review before migrating';
    END IF;

    IF EXISTS (
        WITH expected(position, column_name) AS (VALUES (1, 'user_id'), (2, 'project_id')),
        actual AS (
            SELECT attnum::integer AS position, attname::text AS column_name,
                   atttypid, attnotnull, atthasdef, attidentity, attgenerated
            FROM pg_attribute WHERE attrelid = 'public.volunteer'::regclass
              AND attnum > 0 AND NOT attisdropped
        )
        SELECT 1 FROM expected e FULL JOIN actual a USING (position)
        WHERE e.column_name IS DISTINCT FROM a.column_name
           OR a.atttypid <> 'integer'::regtype OR NOT a.attnotnull OR a.atthasdef
           OR a.attidentity <> '' OR a.attgenerated <> ''
    ) THEN
        RAISE EXCEPTION 'Volunteer columns differ from setup.sql; no automatic repair attempted';
    END IF;

    IF EXISTS (
        WITH expected(constraint_name, definition) AS (
            VALUES
            ('volunteer_pkey', 'PRIMARY KEY (user_id, project_id)'),
            ('volunteer_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE'),
            ('volunteer_project_id_fkey', 'FOREIGN KEY (project_id) REFERENCES project(project_id) ON DELETE CASCADE')
        ), actual AS (
            SELECT conname::text AS constraint_name, pg_get_constraintdef(oid) AS definition
            FROM pg_constraint WHERE conrelid = 'public.volunteer'::regclass AND contype <> 'n'
        )
        SELECT 1 FROM expected e FULL JOIN actual a USING (constraint_name)
        WHERE e.definition IS DISTINCT FROM a.definition
    ) THEN
        RAISE EXCEPTION 'Volunteer constraints differ from setup.sql; review existing schema';
    END IF;
END
$validation$;

COMMIT;
