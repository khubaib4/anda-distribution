-- DE-18. Apply after DE-SECURITY-01 while all protected writes remain paused.
-- The compatible application build must already be deployed and quiescent.
BEGIN;

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
      'customer_payments', 'supplier_payments', 'super_admins'
    ] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER'] LOOP
        IF has_table_privilege(v_role, format('public.%I', v_table), v_privilege) THEN
          RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: % retains % on %',
            v_role, v_privilege, v_table;
        END IF;
      END LOOP;
      FOR v_column IN
        SELECT attname FROM pg_attribute
        WHERE attrelid = format('public.%I', v_table)::regclass
          AND attnum > 0 AND NOT attisdropped
      LOOP
        IF has_column_privilege(v_role, format('public.%I', v_table), v_column, 'INSERT')
           OR has_column_privilege(v_role, format('public.%I', v_table), v_column, 'UPDATE') THEN
          RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: % retains column writes on %.%',
            v_role, v_table, v_column;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['customer_payments', 'supplier_payments'] LOOP
    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'INSERT')
       OR NOT has_table_privilege('service_role', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: service_role payment INSERT/SELECT on %',
        v_table;
    END IF;
    FOREACH v_privilege IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'] LOOP
      IF has_table_privilege('service_role', format('public.%I', v_table), v_privilege) THEN
        RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: service_role retains effective % on %',
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
        RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: service_role payment column privileges on %.%',
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
      RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: service_role payment column grants on %', v_table;
    END IF;
  END LOOP;

  IF to_regclass('public.de_security_01_attestation') IS NULL THEN
    RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: attestation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.de_security_01_attestation AS att
    JOIN pg_constraint AS member_check
      ON member_check.conrelid = 'public.tenant_members'::regclass
      AND member_check.conname = 'tenant_members_role_owner_staff_check'
      AND member_check.contype = 'c' AND member_check.convalidated
      AND pg_get_constraintdef(member_check.oid) = att.member_role_check
    JOIN pg_constraint AS invitation_check
      ON invitation_check.conrelid = 'public.invitations'::regclass
      AND invitation_check.conname = 'invitations_role_staff_only_check'
      AND invitation_check.contype = 'c' AND invitation_check.convalidated
      AND pg_get_constraintdef(invitation_check.oid) = att.invitation_role_check
    WHERE att.version = 'v1'
      AND (SELECT count(*) FROM public.de_security_01_attestation) = 1
      AND (SELECT count(*) FROM pg_constraint AS c
           JOIN pg_attribute AS a ON a.attrelid = c.conrelid AND a.attname = 'role'
           WHERE c.conrelid = 'public.tenant_members'::regclass
             AND c.contype = 'c' AND a.attnum = ANY(c.conkey)) = 1
      AND (SELECT count(*) FROM pg_constraint AS c
           JOIN pg_attribute AS a ON a.attrelid = c.conrelid AND a.attname = 'role'
           WHERE c.conrelid = 'public.invitations'::regclass
             AND c.contype = 'c' AND a.attnum = ANY(c.conkey)) = 1
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('anon'), ('authenticated')) AS actors(actor)
        CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('TRIGGER')) AS privileges(privilege)
        WHERE has_table_privilege(actors.actor, 'public.de_security_01_attestation', privileges.privilege)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('anon'), ('authenticated')) AS actors(actor)
        CROSS JOIN pg_attribute AS a
        WHERE a.attrelid = 'public.de_security_01_attestation'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND (has_column_privilege(actors.actor, a.attrelid, a.attnum, 'INSERT')
               OR has_column_privilege(actors.actor, a.attrelid, a.attnum, 'UPDATE'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')
        )
          AS privileges(privilege)
        WHERE has_table_privilege('service_role',
          'public.de_security_01_attestation', privileges.privilege)
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute AS a
        WHERE a.attrelid = 'public.de_security_01_attestation'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND (has_column_privilege('service_role', a.attrelid, a.attnum, 'INSERT')
               OR has_column_privilege('service_role', a.attrelid, a.attnum, 'UPDATE'))
      )
      AND has_table_privilege('service_role', 'public.de_security_01_attestation', 'SELECT')
  ) THEN
    RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: exact role constraints';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger AS t
    WHERE t.tgrelid = 'public.sales'::regclass
      AND t.tgname = 'sales_invoice_identity_immutable_de_security_01'
      AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
      AND t.tgtype = 19 -- ROW (1) + BEFORE (2) + UPDATE (16)
      AND t.tgattr = ''::int2vector AND t.tgqual IS NULL
      AND t.tgfoid = to_regprocedure('public.prevent_invoice_identity_update_de_security_01()')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger AS t
    WHERE t.tgrelid = 'public.purchases'::regclass
      AND t.tgname = 'purchases_invoice_identity_immutable_de_security_01'
      AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
      AND t.tgtype = 19
      AND t.tgattr = ''::int2vector AND t.tgqual IS NULL
      AND t.tgfoid = to_regprocedure('public.prevent_invoice_identity_update_de_security_01()')
  ) THEN
    RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: invoice identity triggers';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.de_security_01_attestation AS att
    JOIN pg_proc AS p
      ON p.oid = to_regprocedure('public.prevent_invoice_identity_update_de_security_01()')
    JOIN pg_language AS lang ON lang.oid = p.prolang
    WHERE att.version = 'v1'
      AND lang.lanname = 'plpgsql'
      AND p.prorettype = 'pg_catalog.trigger'::regtype
      AND p.pronargs = 0
      AND NOT p.prosecdef
      AND p.provolatile = 'v'
      -- PostgreSQL stores SET search_path = '' as search_path="" in proconfig.
      AND p.proconfig @> ARRAY['search_path=""']::text[]
      AND p.prosrc = att.guard_function_source
      AND p.prosrc LIKE '%NEW.invoice_number IS DISTINCT FROM OLD.invoice_number%'
      AND p.prosrc LIKE '%NEW.tenant_id IS DISTINCT FROM OLD.tenant_id%'
      AND p.prosrc LIKE '%RAISE EXCEPTION%'
  ) THEN
    RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: invoice identity guard';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.de_security_01_attestation AS att
    JOIN pg_proc AS p
      ON p.oid = to_regprocedure(
        'public.consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)')
    JOIN pg_language AS lang ON lang.oid = p.prolang
    WHERE att.version = 'v1'
      AND lang.lanname = 'plpgsql'
      AND p.prorettype = 'pg_catalog.bool'::regtype
      AND p.pronargs = 5 AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']::text[]
      AND p.prosrc = att.invite_consume_source
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: atomic invitation RPC';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.de_security_01_attestation AS att
    JOIN pg_proc AS p
      ON p.oid = to_regprocedure(
        'public.read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)')
    JOIN pg_language AS lang ON lang.oid = p.prolang
    WHERE att.version = 'v1'
      AND lang.lanname = 'plpgsql'
      AND p.prorettype = 'pg_catalog.jsonb'::regtype
      AND p.pronargs = 4 AND p.prosecdef AND p.provolatile = 'v'
      AND p.proconfig @> ARRAY['search_path=""']::text[]
      AND p.prosrc = att.invite_read_source
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: trusted invitation reconciliation RPC';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('tenant_members', 'invitations', 'sales', 'purchases',
                        'customer_payments', 'supplier_payments')
      AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: write RLS policies remain';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('tenant_members', 'tenant_members_self_select_de_security_01'),
      ('invitations', 'invitations_owner_select_de_security_01'),
      ('sales', 'sales_tenant_select_de_security_01'),
      ('purchases', 'purchases_tenant_select_de_security_01'),
      ('customer_payments', 'customer_payments_tenant_select_de_security_01'),
      ('supplier_payments', 'supplier_payments_tenant_select_de_security_01')
    ) AS expected(table_name, policy_name)
    JOIN pg_class AS c ON c.oid = format('public.%I', expected.table_name)::regclass
    WHERE NOT c.relrowsecurity OR NOT EXISTS (
      SELECT 1 FROM pg_policies AS p
      WHERE p.schemaname = 'public' AND p.tablename = expected.table_name
        AND p.policyname = expected.policy_name AND p.cmd = 'SELECT'
    )
  ) THEN
    RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: read-only RLS policies';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.de_security_01_attestation AS att
    JOIN pg_policies AS customer_policy
      ON customer_policy.schemaname = 'public'
      AND customer_policy.tablename = 'customer_payments'
      AND customer_policy.policyname = 'customer_payments_tenant_select_de_security_01'
      AND customer_policy.cmd = 'SELECT'
      AND customer_policy.roles = ARRAY['authenticated']::name[]
      AND customer_policy.qual = att.customer_payment_read_qual
      AND (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'customer_payments') = 1
    JOIN pg_policies AS supplier_policy
      ON supplier_policy.schemaname = 'public'
      AND supplier_policy.tablename = 'supplier_payments'
      AND supplier_policy.policyname = 'supplier_payments_tenant_select_de_security_01'
      AND supplier_policy.cmd = 'SELECT'
      AND supplier_policy.roles = ARRAY['authenticated']::name[]
      AND supplier_policy.qual = att.supplier_payment_read_qual
      AND (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'supplier_payments') = 1
    WHERE att.version = 'v1'
  ) THEN
    RAISE EXCEPTION 'DE-18 prerequisite DE-SECURITY-01 missing: payment read policy contract';
  END IF;
END;
$$;

-- Hold concurrent tenant and document writes until the seed is complete.
LOCK TABLE public.tenants, public.sales, public.purchases IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE de18_approved_high_water (
  tenant_id uuid PRIMARY KEY,
  sale_high_water bigint NOT NULL,
  purchase_high_water bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO pg_temp.de18_approved_high_water
  (tenant_id, sale_high_water, purchase_high_water)
VALUES
  ('5997b6fe-7689-49b3-8651-05db1b74f109'::uuid, 30, 6),
  ('638fb542-e5bf-4358-978f-8a2e82431794'::uuid, 4, 4),
  ('7da7a475-3ab3-469d-be8f-1b93061b6f3c'::uuid, 7, 3),
  ('8a16c8fa-025f-4ee6-9395-44a8d8ea8a04'::uuid, 1, 1);

DO $$
DECLARE
  v_unapproved_tenant uuid;
BEGIN
  SELECT existing.tenant_id INTO v_unapproved_tenant
  FROM (
    SELECT id AS tenant_id FROM public.tenants
    UNION
    SELECT tenant_id FROM public.sales WHERE tenant_id IS NOT NULL
    UNION
    SELECT tenant_id FROM public.purchases WHERE tenant_id IS NOT NULL
  ) AS existing
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_temp.de18_approved_high_water AS approved
    WHERE approved.tenant_id = existing.tenant_id
  )
  ORDER BY existing.tenant_id
  LIMIT 1;

  IF v_unapproved_tenant IS NOT NULL THEN
    RAISE EXCEPTION
      'DE-18 seed aborted: unapproved tenant % exists; verify its historical invoice high-water before deployment',
      v_unapproved_tenant;
  END IF;
END;
$$;

CREATE TABLE public.invoice_counters (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  counter_type text NOT NULL CHECK (counter_type IN ('sale', 'purchase')),
  last_number bigint NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (tenant_id, counter_type)
);

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_counters FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.initialize_invoice_counters_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.invoice_counters (tenant_id, counter_type, last_number)
  VALUES (NEW.id, 'sale', 0), (NEW.id, 'purchase', 0);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_invoice_counters_v1() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER initialize_invoice_counters_v1
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.initialize_invoice_counters_v1();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sales
    WHERE tenant_id IS NOT NULL
      AND (invoice_number IS NULL OR invoice_number !~ '^SAL-[0-9]+$')
  ) THEN
    RAISE EXCEPTION 'DE-18 seed aborted: malformed tenant-scoped sale invoice number';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.purchases
    WHERE tenant_id IS NOT NULL
      AND (invoice_number IS NULL OR invoice_number !~ '^PUR-[0-9]+$')
  ) THEN
    RAISE EXCEPTION 'DE-18 seed aborted: malformed tenant-scoped purchase invoice number';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT substring(invoice_number from 5)::numeric AS invoice_value
      FROM public.sales WHERE tenant_id IS NOT NULL
      UNION ALL
      SELECT substring(invoice_number from 5)::numeric
      FROM public.purchases WHERE tenant_id IS NOT NULL
    ) AS numbered
    WHERE invoice_value >= 9223372036854775807
  ) THEN
    RAISE EXCEPTION 'DE-18 seed aborted: tenant-scoped invoice exceeds counter range';
  END IF;
END;
$$;

WITH observed AS (
  SELECT tenant_id, 'sale' AS counter_type,
         max(substring(invoice_number from 5)::numeric) AS high_water
  FROM public.sales WHERE tenant_id IS NOT NULL GROUP BY tenant_id
  UNION ALL
  SELECT tenant_id, 'purchase', max(substring(invoice_number from 5)::numeric)
  FROM public.purchases WHERE tenant_id IS NOT NULL GROUP BY tenant_id
)
INSERT INTO public.invoice_counters (tenant_id, counter_type, last_number)
SELECT t.id, kind.counter_type,
       greatest(
         CASE kind.counter_type
           WHEN 'sale' THEN approved.sale_high_water
           ELSE approved.purchase_high_water
         END,
         coalesce(o.high_water, 0)
       )::bigint
FROM public.tenants AS t
JOIN pg_temp.de18_approved_high_water AS approved ON approved.tenant_id = t.id
CROSS JOIN (VALUES ('sale'), ('purchase')) AS kind(counter_type)
LEFT JOIN observed AS o ON o.tenant_id = t.id AND o.counter_type = kind.counter_type;

-- Only the server's service-role client can call this entrypoint directly.
CREATE FUNCTION public.allocate_invoice_number_trusted_v1(
  p_tenant_id uuid,
  p_counter_type text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_next bigint;
BEGIN
  IF p_counter_type IS NULL OR p_counter_type NOT IN ('sale', 'purchase') THEN
    RAISE EXCEPTION 'Invalid invoice counter type' USING ERRCODE = '22023';
  END IF;
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invoice allocation forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.invoice_counters
  SET last_number = last_number + 1
  WHERE tenant_id = p_tenant_id AND counter_type = p_counter_type
    AND last_number < 9223372036854775807
  RETURNING last_number INTO v_next;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Invoice counter missing or exhausted for tenant % and type %',
      p_tenant_id, p_counter_type;
  END IF;

  RETURN (CASE p_counter_type WHEN 'sale' THEN 'SAL-' ELSE 'PUR-' END)
    || lpad(v_next::text, greatest(4, length(v_next::text)), '0');
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_invoice_number_trusted_v1(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number_trusted_v1(uuid, text)
  TO service_role;

CREATE FUNCTION public.allocate_invoice_number_v1(
  p_tenant_id uuid,
  p_counter_type text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_allowed boolean;
  v_permission_key text;
BEGIN
  IF p_counter_type IS NULL OR p_counter_type NOT IN ('sale', 'purchase') THEN
    RAISE EXCEPTION 'Invalid invoice counter type' USING ERRCODE = '22023';
  END IF;
  IF p_tenant_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Invoice allocation forbidden' USING ERRCODE = '42501';
  END IF;

  -- Super-admins have no database-visible selected-tenant context.
  IF EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'Invoice allocation requires a trusted server path for super-admins'
      USING ERRCODE = '42501';
  END IF;

  v_permission_key := CASE p_counter_type
    WHEN 'sale' THEN 'canViewSales'
    ELSE 'canViewPurchases'
  END;

  SELECT EXISTS (
    SELECT 1 FROM public.tenants AS t
    JOIN public.tenant_members AS m ON m.tenant_id = t.id
    WHERE t.id = p_tenant_id AND m.user_id = v_user_id
      AND (
        m.role = 'owner'
        OR (m.role = 'staff' AND CASE
          WHEN jsonb_typeof(m.permissions::jsonb) = 'object'
            AND m.permissions::jsonb ? v_permission_key
            THEN m.permissions::jsonb ->> v_permission_key = 'true'
                 AND jsonb_typeof(m.permissions::jsonb -> v_permission_key) = 'boolean'
          WHEN jsonb_typeof(m.permissions::jsonb) = 'object'
            AND m.permissions::jsonb ? (p_counter_type || 's')
            THEN m.permissions::jsonb ->> (p_counter_type || 's') = 'true'
                 AND jsonb_typeof(m.permissions::jsonb -> (p_counter_type || 's')) = 'boolean'
          ELSE true
        END)
      )
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invoice allocation forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN public.allocate_invoice_number_trusted_v1(p_tenant_id, p_counter_type);
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_invoice_number_v1(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number_v1(uuid, text) TO authenticated;

COMMIT;
