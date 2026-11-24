-- One-time bridge from the workspace migrations that ran before they were
-- consolidated. Only the exact legacy Drizzle history needs this repair.
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RETURN;
  END IF;

  LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE;
  IF (
    SELECT array_agg(created_at::text || ':' || hash ORDER BY created_at)
    FROM drizzle.__drizzle_migrations
    WHERE created_at > 1794917746150
  ) IS DISTINCT FROM ARRAY[
    '1795334019778:180f58f74f315f87e53e39276347264764123867f25035e9549093ebc4c6a891',
    '1795341315924:ea1f4eaf0de9936eab806886fd0aa8cca5957bc7c4dba169e2db3c8d02080532',
    '1795348683518:bf3c888a2c4f8b13497d471a8701af8a9c7baae75ef3c8a4182ab6463ebde6c8'
  ] THEN
    RETURN;
  END IF;

  ALTER TABLE public.orgs ADD COLUMN created_by text;
  -- The old schema used a NULL added_by for the workspace's creator.
  LOCK TABLE public.org_members IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (
    SELECT org.id
    FROM public.orgs AS org
    LEFT JOIN public.org_members AS member
      ON member.org_id = org.id AND member.added_by IS NULL
    GROUP BY org.id
    HAVING count(member.user_id) <> 1
  ) THEN
    RAISE EXCEPTION 'Workspace repair requires exactly one recorded creator per workspace';
  END IF;

  UPDATE public.orgs AS org SET created_by = member.user_id
  FROM public.org_members AS member
  WHERE member.org_id = org.id AND member.added_by IS NULL;
  ALTER TABLE public.orgs ALTER COLUMN created_by SET NOT NULL;
  UPDATE public.org_members SET added_by = user_id WHERE added_by IS NULL;
  ALTER TABLE public.org_members ALTER COLUMN added_by SET NOT NULL;

  ALTER TABLE public.mcp_oauth_sign_ins ADD COLUMN sharing public.connection_sharing DEFAULT 'personal' NOT NULL;
  ALTER TABLE public.data_connections DROP CONSTRAINT data_connections_secret_or_demo;
  CREATE TABLE public.connection_sign_ins (
    id uuid PRIMARY KEY NOT NULL,
    connection_id uuid NOT NULL,
    user_id text NOT NULL,
    secret jsonb NOT NULL,
    status public.connection_status NOT NULL,
    last_checked_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connection_sign_ins_connection_id_data_connections_id_fk
      FOREIGN KEY (connection_id) REFERENCES public.data_connections (id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX connection_sign_ins_connection_user_idx ON public.connection_sign_ins (connection_id, user_id);
  CREATE INDEX connection_sign_ins_user_id_idx ON public.connection_sign_ins (user_id);

  INSERT INTO public.connection_sign_ins (id, connection_id, user_id, secret, status, last_checked_at, created_at, updated_at)
  SELECT gen_random_uuid(), id, user_id, secret, status, last_checked_at, created_at, updated_at
  FROM public.data_connections
  WHERE config -> 'oauth' IS NOT NULL AND secret IS NOT NULL;
  UPDATE public.data_connections SET secret = NULL WHERE config -> 'oauth' IS NOT NULL;
  ALTER TABLE public.data_connections ADD CONSTRAINT data_connections_secret_or_demo CHECK (
    CASE
      WHEN demo_dataset IS NOT NULL THEN secret IS NULL
      WHEN config -> 'oauth' IS NULL THEN secret IS NOT NULL
      ELSE true
    END
  );

  -- Schema and the canonical migration marker are committed together.
  INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
  VALUES ('7c3e23bf39988e4ab540f13d2dd3d047bf133d34e0951269d8aab8d103ffea33', 1795502215686);
END
$$;
