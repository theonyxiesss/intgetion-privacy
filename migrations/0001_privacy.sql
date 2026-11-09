-- Privacy: the cookie consent journal (final state of platform migration 0021
-- for this table). Idempotent.

CREATE TABLE IF NOT EXISTS public.consent_records (
    id uuid NOT NULL,
    user_id uuid,
    choice text NOT NULL,
    policy_version text NOT NULL,
    gpc boolean DEFAULT false NOT NULL,
    source text NOT NULL,
    ip_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consent_records_source_check CHECK ((source = ANY (ARRAY['banner'::text, 'settings'::text])))
);

ALTER TABLE ONLY public.consent_records FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_pkey') THEN
    ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS consent_records_created_idx ON public.consent_records USING btree (created_at);

CREATE INDEX IF NOT EXISTS consent_records_user_idx ON public.consent_records USING btree (user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_user_id_fkey') THEN
    ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'consent_records' AND policyname = 'consent_records_anon_deny') THEN
    CREATE POLICY consent_records_anon_deny ON public.consent_records TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'consent_records' AND policyname = 'consent_records_app_rw_all') THEN
    CREATE POLICY consent_records_app_rw_all ON public.consent_records TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'consent_records' AND policyname = 'consent_records_authenticated_deny') THEN
    CREATE POLICY consent_records_authenticated_deny ON public.consent_records TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

-- Table rights for the app role, as on the platform.
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.consent_records TO app_rw;
