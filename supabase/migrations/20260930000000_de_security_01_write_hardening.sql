-- DE-SECURITY-01. Apply before DE-18, with business writes paused.
-- This migration is deliberately transactional: unexpected production state
-- aborts before any hardening becomes visible.
BEGIN;

LOCK TABLE public.tenant_members, public.invitations, public.sales,
  public.purchases, public.customer_payments, public.supplier_payments,
  public.super_admins IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  v_table text;
  v_role_constraint text;
  v_definition text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_members WHERE role IS NULL OR role NOT IN ('owner', 'staff')) THEN
    RAISE EXCEPTION 'DE-SECURITY-01: unexpected tenant_members role; inspect before retrying';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invitations WHERE role IS NULL OR role <> 'staff') THEN
    RAISE EXCEPTION 'DE-SECURITY-01: unexpected invitations role; inspect before retrying';
  END IF;
  IF to_regprocedure('public.get_user_tenant_id()') IS NULL
     OR to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'DE-SECURITY-01: expected tenant read helpers are missing';
  END IF;
  FOREACH v_table IN ARRAY ARRAY['customer_payments', 'supplier_payments'] LOOP
    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'INSERT') THEN
      RAISE EXCEPTION 'DE-SECURITY-01: service_role cannot insert into %', v_table;
    END IF;
    IF (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = v_table) <> 1
       OR NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = v_table
           AND cmd = 'ALL' AND roles = ARRAY['authenticated']::name[]
           AND qual LIKE '%tenant_id%'
           AND qual LIKE '%get_user_tenant_id%'
           AND qual LIKE '%is_super_admin%'
       ) THEN
      RAISE EXCEPTION 'DE-SECURITY-01: unexpected payment policy on %', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['tenant_members', 'invitations'] LOOP
    SELECT c.conname, pg_get_constraintdef(c.oid)
      INTO v_role_constraint, v_definition
    FROM pg_constraint AS c
    JOIN pg_attribute AS a
      ON a.attrelid = c.conrelid AND a.attname = 'role'
    WHERE c.conrelid = format('public.%I', v_table)::regclass
      AND c.contype = 'c' AND a.attnum = ANY(c.conkey);

    IF NOT FOUND OR (
      SELECT count(*) FROM pg_constraint AS c
      JOIN pg_attribute AS a
        ON a.attrelid = c.conrelid AND a.attname = 'role'
      WHERE c.conrelid = format('public.%I', v_table)::regclass
        AND c.contype = 'c' AND a.attnum = ANY(c.conkey)
    ) <> 1 THEN
      RAISE EXCEPTION 'DE-SECURITY-01: expected one role constraint on %', v_table;
    END IF;

    IF v_definition NOT ILIKE '%owner%' OR v_definition NOT ILIKE '%staff%'
       OR (v_table = 'tenant_members' AND v_definition NOT ILIKE '%super_admin%') THEN
      RAISE EXCEPTION 'DE-SECURITY-01: unexpected role constraint on %: %', v_table, v_definition;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_table, v_role_constraint);
  END LOOP;
END;
$$;

ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_role_owner_staff_check
  CHECK (role IS NOT NULL AND role IN ('owner', 'staff'));
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_role_staff_only_check
  CHECK (role IS NOT NULL AND role = 'staff');

-- Invalidate all unaccepted tokens. Accepted historical rows are untouched.
UPDATE public.invitations
SET expires_at = LEAST(COALESCE(expires_at, transaction_timestamp()), transaction_timestamp())
WHERE accepted_at IS NULL;

-- TRIGGER allows creating or replacing a table trigger. Ordinary roles do not
-- need it on these server-written tables; REFERENCES is left unchanged.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON TABLE
  public.tenant_members, public.invitations, public.sales,
  public.purchases, public.customer_payments, public.supplier_payments,
  public.super_admins
FROM PUBLIC, anon, authenticated;
-- The audited server workflows only read and create payment rows. No payment
-- FK DDL is performed as service_role, so REFERENCES is unnecessary too.
REVOKE ALL ON TABLE public.customer_payments, public.supplier_payments
  FROM service_role;
DO $$
DECLARE
  v_table text;
  v_column text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['customer_payments', 'supplier_payments'] LOOP
    FOR v_column IN
      SELECT attname FROM pg_attribute
      WHERE attrelid = format('public.%I', v_table)::regclass
        AND attnum > 0 AND NOT attisdropped AND attacl IS NOT NULL
    LOOP
      -- PostgreSQL has no column-level DELETE privilege.
      EXECUTE format(
        'REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE public.%I FROM service_role',
        v_column, v_column, v_column, v_table
      );
    END LOOP;
  END LOOP;
END;
$$;
GRANT SELECT, INSERT ON TABLE public.customer_payments, public.supplier_payments
  TO service_role;

-- Column grants can survive table-level REVOKE. Close any such ordinary write
-- grants on every protected table, even if the reviewed preflight found none.
DO $$
DECLARE
  v_table text;
  v_column text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'tenant_members', 'invitations', 'sales', 'purchases',
    'customer_payments', 'supplier_payments', 'super_admins'
  ] LOOP
    FOR v_column IN
      SELECT attname FROM pg_attribute
      WHERE attrelid = format('public.%I', v_table)::regclass
        AND attnum > 0 AND NOT attisdropped AND attacl IS NOT NULL
    LOOP
      EXECUTE format(
        'REVOKE INSERT (%I), UPDATE (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_column, v_column, v_table
      );
    END LOOP;
  END LOOP;
END;
$$;

-- The live policies are self-read for memberships, owner-read for invites,
-- and tenant/super-admin read for financial headers and payments. Remove every old policy
-- (including FOR ALL) before installing read-only replacements.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('tenant_members', 'invitations', 'sales', 'purchases',
                        'customer_payments', 'supplier_payments')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I',
      v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  END LOOP;
END;
$$;

ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_members_self_select_de_security_01
  ON public.tenant_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY invitations_owner_select_de_security_01
  ON public.invitations FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT m.tenant_id FROM public.tenant_members AS m
    WHERE m.user_id = auth.uid() AND m.role = 'owner'
  ));
CREATE POLICY sales_tenant_select_de_security_01
  ON public.sales FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY purchases_tenant_select_de_security_01
  ON public.purchases FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY customer_payments_tenant_select_de_security_01
  ON public.customer_payments FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY supplier_payments_tenant_select_de_security_01
  ON public.supplier_payments FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Auth creation is outside PostgreSQL, but all database effects of accepting
-- an invitation share this function's one transaction. Only the server's
-- service-role client may execute it.
CREATE FUNCTION public.consume_staff_invitation_de_security_01(
  p_invitation_id text, p_token text, p_tenant_id uuid,
  p_user_id uuid, p_full_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invited_by public.invitations.invited_by%TYPE;
  v_consumed_count bigint;
  v_now timestamptz;
BEGIN
  IF NULLIF(btrim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Full name is required' USING ERRCODE = '22023';
  END IF;

  -- Sample database time after waiting for any concurrent consumption.
  PERFORM 1 FROM public.invitations AS i
  WHERE i.id::text = p_invitation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_now := clock_timestamp();

  UPDATE public.invitations AS i
  SET accepted_at = v_now
  WHERE i.id::text = p_invitation_id
    AND i.token::text = p_token
    AND i.tenant_id = p_tenant_id
    AND i.role = 'staff'
    AND i.accepted_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > v_now)
    AND EXISTS (
      SELECT 1 FROM auth.users AS u
      WHERE u.id = p_user_id
        AND lower(btrim(u.email)) = lower(btrim(i.email))
    )
  RETURNING i.invited_by INTO v_invited_by;

  GET DIAGNOSTICS v_consumed_count = ROW_COUNT;
  IF v_consumed_count = 0 THEN
    RETURN false;
  END IF;
  IF v_consumed_count <> 1 THEN
    RAISE EXCEPTION 'Invitation consumption matched multiple rows';
  END IF;

  INSERT INTO public.profiles (id, full_name, role, tenant_id)
  VALUES (p_user_id, btrim(p_full_name), 'staff', p_tenant_id);
  INSERT INTO public.tenant_members (tenant_id, user_id, role, invited_by)
  VALUES (p_tenant_id, p_user_id, 'staff', v_invited_by);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)
  TO service_role;

-- A lost HTTP response does not prove rollback. Wait behind consumption's
-- invitation lock before taking this trusted snapshot. Plain independent
-- SELECT requests could otherwise see pending state while consumption is
-- still in flight. This RPC performs no acceptance/profile/membership writes.
CREATE FUNCTION public.read_staff_invitation_acceptance_de_security_01(
  p_invitation_id text, p_token text, p_tenant_id uuid, p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invitations jsonb;
  v_memberships jsonb;
  v_profiles jsonb;
  v_auth_user jsonb;
BEGIN
  PERFORM 1 FROM public.invitations AS i
  WHERE i.id::text = p_invitation_id
  FOR UPDATE;

  SELECT COALESCE(jsonb_agg(to_jsonb(snapshot_row)), '[]'::jsonb) INTO v_invitations
  FROM (
    SELECT i.id::text AS id, i.token::text = p_token AS token_matches,
           i.tenant_id, i.email, i.role, i.invited_by, i.accepted_at
    FROM public.invitations AS i WHERE i.id::text = p_invitation_id
    LIMIT 2
  ) AS snapshot_row;
  SELECT COALESCE(jsonb_agg(to_jsonb(snapshot_row)), '[]'::jsonb) INTO v_memberships
  FROM (
    SELECT m.tenant_id, m.user_id, m.role, m.invited_by
    FROM public.tenant_members AS m
    WHERE m.tenant_id = p_tenant_id AND m.user_id = p_user_id
    LIMIT 2
  ) AS snapshot_row;
  SELECT COALESCE(jsonb_agg(to_jsonb(snapshot_row)), '[]'::jsonb) INTO v_profiles
  FROM (
    SELECT p.id, p.tenant_id, p.role, p.full_name
    FROM public.profiles AS p WHERE p.id = p_user_id
    LIMIT 2
  ) AS snapshot_row;
  SELECT jsonb_build_object('id', u.id, 'email', u.email) INTO v_auth_user
  FROM auth.users AS u WHERE u.id = p_user_id;

  RETURN jsonb_build_object(
    'invitations', v_invitations, 'memberships', v_memberships,
    'profiles', v_profiles, 'auth_user', v_auth_user
  );
END;
$$;
REVOKE ALL ON FUNCTION public.read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)
  TO service_role;

CREATE FUNCTION public.prevent_invoice_identity_update_de_security_01()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Invoice number and tenant cannot be changed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_invoice_identity_update_de_security_01()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sales_invoice_identity_immutable_de_security_01
BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_identity_update_de_security_01();
CREATE TRIGGER purchases_invoice_identity_immutable_de_security_01
BEFORE UPDATE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_identity_update_de_security_01();

-- Capture the definitions created in this transaction. DE-18 compares the
-- deployed definitions with this protected attestation, so a changed role
-- check or a no-op replacement of the guard cannot pass by keeping its name.
CREATE TABLE public.de_security_01_attestation (
  version text PRIMARY KEY,
  member_role_check text NOT NULL,
  invitation_role_check text NOT NULL,
  guard_function_source text NOT NULL,
  invite_consume_source text NOT NULL,
  invite_read_source text NOT NULL,
  customer_payment_read_qual text NOT NULL,
  supplier_payment_read_qual text NOT NULL
);
REVOKE ALL ON TABLE public.de_security_01_attestation
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.de_security_01_attestation TO service_role;

INSERT INTO public.de_security_01_attestation
  (version, member_role_check, invitation_role_check,
   guard_function_source, invite_consume_source, invite_read_source,
   customer_payment_read_qual, supplier_payment_read_qual)
SELECT 'v1',
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'public.tenant_members'::regclass
     AND conname = 'tenant_members_role_owner_staff_check'),
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'public.invitations'::regclass
     AND conname = 'invitations_role_staff_only_check'),
  (SELECT prosrc FROM pg_proc
   WHERE oid = 'public.prevent_invoice_identity_update_de_security_01()'::regprocedure),
  (SELECT prosrc FROM pg_proc
   WHERE oid = 'public.consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)'::regprocedure),
  (SELECT prosrc FROM pg_proc
   WHERE oid = 'public.read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)'::regprocedure),
  (SELECT qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'customer_payments'
     AND policyname = 'customer_payments_tenant_select_de_security_01'),
  (SELECT qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'supplier_payments'
     AND policyname = 'supplier_payments_tenant_select_de_security_01');

DO $$
DECLARE
  v_role text;
  v_table text;
  v_privilege text;
  v_column text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'tenant_members', 'invitations', 'sales', 'purchases',
      'customer_payments', 'supplier_payments', 'super_admins',
      'de_security_01_attestation'
    ] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER'] LOOP
        IF has_table_privilege(v_role, format('public.%I', v_table), v_privilege) THEN
          RAISE EXCEPTION 'DE-SECURITY-01: % retains % on %', v_role, v_privilege, v_table;
        END IF;
      END LOOP;
      FOR v_column IN
        SELECT attname FROM pg_attribute
        WHERE attrelid = format('public.%I', v_table)::regclass
          AND attnum > 0 AND NOT attisdropped
      LOOP
        IF has_column_privilege(v_role, format('public.%I', v_table), v_column, 'INSERT')
           OR has_column_privilege(v_role, format('public.%I', v_table), v_column, 'UPDATE') THEN
          RAISE EXCEPTION 'DE-SECURITY-01: % retains column writes on %.%',
            v_role, v_table, v_column;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH v_privilege IN ARRAY ARRAY[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'
  ] LOOP
    IF has_table_privilege('service_role', 'public.de_security_01_attestation', v_privilege) THEN
      RAISE EXCEPTION 'DE-SECURITY-01: service_role retains % on attestation', v_privilege;
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY['customer_payments', 'supplier_payments'] LOOP
    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'INSERT')
       OR NOT has_table_privilege('service_role', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'DE-SECURITY-01: service_role lost payment INSERT/SELECT on %', v_table;
    END IF;
    FOREACH v_privilege IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'] LOOP
      IF has_table_privilege('service_role', format('public.%I', v_table), v_privilege) THEN
        RAISE EXCEPTION 'DE-SECURITY-01: service_role retains effective % on %; stop and review inherited grants',
          v_privilege, v_table;
      END IF;
    END LOOP;
    FOR v_column IN
      SELECT attname FROM pg_attribute
      WHERE attrelid = format('public.%I', v_table)::regclass
        AND attnum > 0 AND NOT attisdropped
    LOOP
      IF has_column_privilege('service_role', format('public.%I', v_table), v_column, 'UPDATE')
         OR has_column_privilege('service_role', format('public.%I', v_table), v_column, 'REFERENCES') THEN
        RAISE EXCEPTION 'DE-SECURITY-01: service_role retains effective column privileges on %.%',
          v_table, v_column;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_attribute AS a
      CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
      WHERE a.attrelid = format('public.%I', v_table)::regclass
        AND a.attnum > 0 AND NOT a.attisdropped
        AND acl.grantee = 'service_role'::regrole::oid
        AND acl.privilege_type IN ('INSERT', 'UPDATE', 'REFERENCES')
    ) THEN
      RAISE EXCEPTION 'DE-SECURITY-01: explicit service_role payment column grants remain on %', v_table;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.de_security_01_attestation', 'SELECT')
     OR has_function_privilege('anon',
       'public.consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DE-SECURITY-01: attestation or invite RPC privileges are unexpected';
  END IF;
END;
$$;

COMMIT;
