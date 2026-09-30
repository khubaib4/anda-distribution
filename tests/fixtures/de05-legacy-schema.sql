-- Reduced synthetic fixture based on the 2026-09-30 production catalog preflight.
-- Not a baseline migration or a production dump. Only for disposable local tests.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.egg_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants ON DELETE CASCADE,
  name text NOT NULL, UNIQUE (name, tenant_id)
);
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants ON DELETE CASCADE,
  sale_date date NOT NULL, invoice_number text, UNIQUE (invoice_number, tenant_id)
);
CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants ON DELETE CASCADE,
  purchase_date date NOT NULL, invoice_number text, UNIQUE (invoice_number, tenant_id)
);
CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales ON DELETE CASCADE,
  egg_category_id uuid NOT NULL REFERENCES public.egg_categories,
  quantity_trays integer NOT NULL CHECK (quantity_trays > 0),
  price_per_tray_paisa bigint NOT NULL CHECK (price_per_tray_paisa > 0),
  cost_per_tray_paisa bigint NOT NULL DEFAULT 0
);
CREATE TABLE public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants ON DELETE CASCADE,
  purchase_id uuid NOT NULL REFERENCES public.purchases ON DELETE CASCADE,
  egg_category_id uuid NOT NULL REFERENCES public.egg_categories,
  quantity_trays integer NOT NULL CHECK (quantity_trays > 0),
  price_per_tray_paisa bigint NOT NULL CHECK (price_per_tray_paisa > 0)
);
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants ON DELETE CASCADE,
  egg_category_id uuid NOT NULL REFERENCES public.egg_categories,
  movement_type text NOT NULL CHECK (movement_type IN (
    'purchase_in', 'sale_out', 'adjustment_in', 'adjustment_out', 'opening_stock'
  )),
  quantity_trays integer NOT NULL CHECK (quantity_trays > 0),
  quantity_eggs integer DEFAULT 0, price_per_egg_paisa bigint DEFAULT 0,
  reference_id uuid, movement_date date NOT NULL,
  created_by uuid REFERENCES public.profiles ON DELETE SET NULL,
  reason text, notes text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants,
  user_id uuid NOT NULL, role text NOT NULL CHECK (role IN ('owner', 'staff')),
  permissions jsonb NOT NULL DEFAULT '{}', UNIQUE (tenant_id, user_id)
);
CREATE TABLE public.customer_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid);
CREATE TABLE public.supplier_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid);
CREATE TABLE public.invoice_counters (
  tenant_id uuid NOT NULL REFERENCES public.tenants ON DELETE CASCADE,
  counter_type text NOT NULL CHECK (counter_type IN ('sale', 'purchase')),
  last_number bigint NOT NULL CHECK (last_number >= 0), PRIMARY KEY (tenant_id, counter_type)
);
-- Simulate the hardened effective grants without importing production identities.
REVOKE ALL ON public.sales, public.purchases, public.tenant_members FROM anon, authenticated;
GRANT SELECT, REFERENCES ON public.sales, public.purchases, public.tenant_members TO anon, authenticated;
REVOKE ALL ON public.customer_payments, public.supplier_payments FROM anon, authenticated, service_role;
GRANT SELECT, REFERENCES ON public.customer_payments, public.supplier_payments TO anon, authenticated;
GRANT SELECT, INSERT ON public.customer_payments, public.supplier_payments TO service_role;
REVOKE ALL ON public.invoice_counters FROM anon, authenticated;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'egg_categories', 'sales', 'purchases', 'sale_items',
    'purchase_items', 'stock_movements', 'tenant_members', 'customer_payments',
    'supplier_payments', 'invoice_counters'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['egg_categories', 'sale_items', 'purchase_items', 'stock_movements'] LOOP
    EXECUTE format('CREATE POLICY legacy_tenant_access ON public.%I TO authenticated
      USING (tenant_id = current_setting(''de05.test_tenant'', true)::uuid)
      WITH CHECK (tenant_id = current_setting(''de05.test_tenant'', true)::uuid)', t);
  END LOOP;
END $$;

CREATE FUNCTION public.prevent_invoice_identity_update_de_security_01()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Invoice identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_invoice_identity BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_identity_update_de_security_01();
CREATE TRIGGER purchase_invoice_identity BEFORE UPDATE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_identity_update_de_security_01();
CREATE FUNCTION public.initialize_invoice_counters_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
  INSERT INTO public.invoice_counters VALUES (NEW.id, 'sale', 0), (NEW.id, 'purchase', 0);
  RETURN NEW;
END $$;
CREATE TRIGGER initialize_invoice_counters_v1 AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.initialize_invoice_counters_v1();

INSERT INTO public.tenants VALUES
 ('10000000-0000-4000-8000-000000000001', 'Synthetic A'),
 ('10000000-0000-4000-8000-000000000002', 'Synthetic B');
UPDATE public.invoice_counters SET last_number = 17;
INSERT INTO public.egg_categories VALUES
 ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Large'),
 ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Medium'),
 ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Large'),
 ('20000000-0000-4000-8000-000000000004', NULL, 'Legacy unscoped');
INSERT INTO public.sales VALUES
 ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-09-30', 'SAL-0017');
INSERT INTO public.purchases VALUES
 ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-09-30', 'PUR-0017');
INSERT INTO public.sale_items (sale_id, tenant_id, egg_category_id, quantity_trays, price_per_tray_paisa)
VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001', 1, 10000);
INSERT INTO public.purchase_items (purchase_id, tenant_id, egg_category_id, quantity_trays, price_per_tray_paisa)
VALUES ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001', 3, 9000);
INSERT INTO public.stock_movements (tenant_id, egg_category_id, movement_type, quantity_trays, quantity_eggs, movement_date)
VALUES
 ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'purchase_in', 3, 0, '2026-09-30'),
 ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'sale_out', 1, NULL, '2026-09-30'),
 ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'adjustment_in', 1, 15, '2026-09-30'),
 (NULL, '20000000-0000-4000-8000-000000000004', 'opening_stock', 1, 0, '2026-09-30');
