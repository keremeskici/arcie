-- Browser roles already exist in Supabase. A fresh local Postgres needs them for the same grants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arcie_runtime') THEN
    CREATE ROLE arcie_runtime NOLOGIN;
  ELSIF EXISTS (
    SELECT FROM pg_roles
    WHERE rolname = 'arcie_runtime'
      AND (rolcanlogin OR rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'arcie_runtime has incompatible role attributes';
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA arcie FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA arcie FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA arcie FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT USAGE ON SCHEMA arcie TO arcie_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA arcie TO arcie_runtime;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA arcie TO arcie_runtime;
--> statement-breakpoint
DO $$
DECLARE
  app_table text;
BEGIN
  FOR app_table IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'arcie'
  LOOP
    EXECUTE format('ALTER TABLE arcie.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('CREATE POLICY runtime_access ON arcie.%I FOR ALL TO arcie_runtime USING (true) WITH CHECK (true)', app_table);
  END LOOP;
END
$$;
