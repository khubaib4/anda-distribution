-- Schema/security metadata captured read-only on 2026-10-01.
-- No production business records, Auth identities, tokens or migration seed data.
-- Disposable test database only; includes already-deployed DE-05 columns/guards.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE EXTENSION pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE SEQUENCE public.inventory_valuation_sequence AS bigint;
CREATE TABLE public."bank_accounts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "bank_name" text NOT NULL,
  "account_holder" text NOT NULL,
  "account_number" text,
  "nickname" text,
  "is_active" boolean DEFAULT true,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tenant_id" uuid
);
CREATE TABLE public."capital_transactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "partner_id" uuid,
  "type" text NOT NULL,
  "amount_paisa" bigint NOT NULL,
  "reference" text,
  "notes" text,
  "transaction_date" date NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tenant_id" uuid,
  "partner_profile_id" uuid
);
CREATE TABLE public."customer_payments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL,
  "amount_paisa" bigint NOT NULL,
  "payment_date" date NOT NULL,
  "payment_method" text,
  "reference" text,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "bank_account_id" uuid,
  "tenant_id" uuid
);
CREATE TABLE public."customers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "business_name" text,
  "contact_name" text NOT NULL,
  "phone" text,
  "address" text,
  "area" text,
  "customer_type" text,
  "notes" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tenant_id" uuid
);
CREATE TABLE public."de_security_01_attestation" (
  "version" text NOT NULL,
  "member_role_check" text NOT NULL,
  "invitation_role_check" text NOT NULL,
  "guard_function_source" text NOT NULL,
  "invite_consume_source" text NOT NULL,
  "invite_read_source" text NOT NULL,
  "customer_payment_read_qual" text NOT NULL,
  "supplier_payment_read_qual" text NOT NULL
);
CREATE TABLE public."egg_categories" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "display_order" integer DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "tenant_id" uuid
);
CREATE TABLE public."expense_categories" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "icon" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "tenant_id" uuid
);
CREATE TABLE public."expenses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "category_id" uuid NOT NULL,
  "amount_paisa" bigint NOT NULL,
  "expense_date" date NOT NULL,
  "description" text NOT NULL,
  "vehicle" text,
  "odometer_km" integer,
  "worker_name" text,
  "labor_type" text,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "bank_account_id" uuid,
  "tenant_id" uuid,
  "paid_by" text DEFAULT 'business'::text,
  "paid_by_partner_id" uuid,
  "paid_by_partner_source" text
);
CREATE TABLE public."inventory_balances" (
  "tenant_id" uuid NOT NULL,
  "egg_category_id" uuid NOT NULL,
  "quantity_eggs" bigint DEFAULT 0 NOT NULL,
  "value_paisa" bigint DEFAULT 0 NOT NULL,
  "last_valuation_sequence" bigint,
  "last_valuation_date" date,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."inventory_operation_categories" (
  "tenant_id" uuid NOT NULL,
  "egg_category_id" uuid NOT NULL,
  "valuation_sequence" bigint NOT NULL,
  "quantity_before_eggs" bigint NOT NULL,
  "value_before_paisa" bigint NOT NULL,
  "quantity_after_eggs" bigint NOT NULL,
  "value_after_paisa" bigint NOT NULL,
  "before_valuation_sequence" bigint,
  "before_valuation_date" date
);
CREATE TABLE public."inventory_operations" (
  "valuation_sequence" bigint DEFAULT nextval('inventory_valuation_sequence'::regclass) NOT NULL,
  "tenant_id" uuid NOT NULL,
  "operation_type" text NOT NULL,
  "operation_date" date NOT NULL,
  "reference_id" uuid,
  "supersedes_sequence" bigint,
  "superseded_by_sequence" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."invitations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "email" text NOT NULL,
  "role" text DEFAULT 'staff'::text NOT NULL,
  "token" text DEFAULT encode(gen_random_bytes(32), 'hex'::text) NOT NULL,
  "invited_by" uuid,
  "expires_at" timestamp with time zone DEFAULT (now() + '7 days'::interval),
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."invoice_counters" (
  "tenant_id" uuid NOT NULL,
  "counter_type" text NOT NULL,
  "last_number" bigint NOT NULL
);
CREATE TABLE public."partners" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "phone" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."profiles" (
  "id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "role" text DEFAULT 'partner'::text NOT NULL,
  "phone" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tenant_id" uuid
);
CREATE TABLE public."purchase_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "purchase_id" uuid NOT NULL,
  "egg_category_id" uuid NOT NULL,
  "quantity_trays" integer NOT NULL,
  "price_per_tray_paisa" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "tenant_id" uuid
);
CREATE TABLE public."purchases" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "supplier_id" uuid,
  "supplier_name_snapshot" text,
  "purchase_date" date NOT NULL,
  "invoice_number" text,
  "notes" text,
  "payment_status" text DEFAULT 'unpaid'::text NOT NULL,
  "amount_paid_paisa" bigint DEFAULT 0,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tenant_id" uuid,
  "paid_by" text DEFAULT 'business'::text,
  "paid_by_partner_id" uuid,
  "paid_by_partner_source" text
);
CREATE TABLE public."sale_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sale_id" uuid NOT NULL,
  "egg_category_id" uuid NOT NULL,
  "quantity_trays" integer NOT NULL,
  "price_per_tray_paisa" bigint NOT NULL,
  "cost_per_tray_paisa" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "discount_type" text,
  "discount_value" numeric DEFAULT 0,
  "discounted_price_paisa" bigint DEFAULT 0,
  "tenant_id" uuid,
  "cost_total_paisa" bigint
);
CREATE TABLE public."sales" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL,
  "sale_date" date NOT NULL,
  "invoice_number" text,
  "notes" text,
  "payment_status" text DEFAULT 'unpaid'::text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "due_date" date,
  "amount_paid_paisa" bigint DEFAULT 0,
  "discount_type" text,
  "discount_value" numeric DEFAULT 0,
  "discount_amount_paisa" bigint DEFAULT 0,
  "tenant_id" uuid,
  "paid_by" text DEFAULT 'business'::text,
  "paid_by_partner_id" uuid,
  "paid_by_partner_source" text
);
CREATE TABLE public."stock_movements" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "egg_category_id" uuid NOT NULL,
  "movement_type" text NOT NULL,
  "quantity_trays" integer,
  "reference_id" uuid,
  "notes" text,
  "movement_date" date NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "reason" text,
  "price_per_egg_paisa" bigint DEFAULT 0,
  "quantity_eggs" integer DEFAULT 0,
  "tenant_id" uuid,
  "cost_total_paisa" bigint,
  "valuation_sequence" bigint,
  "valuation_source" text,
  "superseded_by_sequence" bigint
);
CREATE TABLE public."super_admins" (
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."supplier_payments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "supplier_id" uuid NOT NULL,
  "amount_paisa" bigint NOT NULL,
  "payment_date" date NOT NULL,
  "payment_method" text,
  "reference" text,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "bank_account_id" uuid,
  "tenant_id" uuid
);
CREATE TABLE public."suppliers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "phone" text,
  "address" text,
  "notes" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tenant_id" uuid
);
CREATE TABLE public."tenant_members" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text DEFAULT 'staff'::text NOT NULL,
  "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "invited_by" uuid,
  "joined_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."tenants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "owner_id" uuid,
  "plan" text DEFAULT 'trial'::text NOT NULL,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "logo_url" text
);
ALTER TABLE public."bank_accounts" ADD CONSTRAINT "bank_accounts_pkey" PRIMARY KEY (id);
ALTER TABLE public."capital_transactions" ADD CONSTRAINT "capital_transactions_amount_paisa_check" CHECK (amount_paisa > 0);
ALTER TABLE public."capital_transactions" ADD CONSTRAINT "capital_transactions_pkey" PRIMARY KEY (id);
ALTER TABLE public."capital_transactions" ADD CONSTRAINT "capital_transactions_type_check" CHECK (type = ANY (ARRAY['contribution'::text, 'withdrawal'::text]));
ALTER TABLE public."customer_payments" ADD CONSTRAINT "customer_payments_amount_paisa_check" CHECK (amount_paisa > 0);
ALTER TABLE public."customer_payments" ADD CONSTRAINT "customer_payments_payment_method_check" CHECK (payment_method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'easypaisa'::text, 'jazzcash'::text]));
ALTER TABLE public."customer_payments" ADD CONSTRAINT "customer_payments_pkey" PRIMARY KEY (id);
ALTER TABLE public."customers" ADD CONSTRAINT "customers_customer_type_check" CHECK (customer_type = ANY (ARRAY['shop'::text, 'restaurant'::text, 'wholesaler'::text, 'other'::text]));
ALTER TABLE public."customers" ADD CONSTRAINT "customers_pkey" PRIMARY KEY (id);
ALTER TABLE public."de_security_01_attestation" ADD CONSTRAINT "de_security_01_attestation_pkey" PRIMARY KEY (version);
ALTER TABLE public."egg_categories" ADD CONSTRAINT "egg_categories_name_tenant_key" UNIQUE (name, tenant_id);
ALTER TABLE public."egg_categories" ADD CONSTRAINT "egg_categories_pkey" PRIMARY KEY (id);
ALTER TABLE public."egg_categories" ADD CONSTRAINT "egg_categories_tenant_id_id_key" UNIQUE (tenant_id, id);
ALTER TABLE public."expense_categories" ADD CONSTRAINT "expense_categories_name_tenant_key" UNIQUE (name, tenant_id);
ALTER TABLE public."expense_categories" ADD CONSTRAINT "expense_categories_pkey" PRIMARY KEY (id);
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_amount_paisa_check" CHECK (amount_paisa > 0);
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_labor_type_check" CHECK (labor_type = ANY (ARRAY['daily'::text, 'monthly'::text]));
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_pkey" PRIMARY KEY (id);
ALTER TABLE public."inventory_balances" ADD CONSTRAINT "inventory_balances_nonnegative_check" CHECK (quantity_eggs >= 0 AND value_paisa >= 0);
ALTER TABLE public."inventory_balances" ADD CONSTRAINT "inventory_balances_pkey" PRIMARY KEY (tenant_id, egg_category_id);
ALTER TABLE public."inventory_balances" ADD CONSTRAINT "inventory_balances_valuation_state_check" CHECK (last_valuation_sequence IS NULL AND last_valuation_date IS NULL AND quantity_eggs = 0 AND value_paisa = 0 OR last_valuation_sequence IS NOT NULL AND last_valuation_date IS NOT NULL AND last_valuation_sequence > 0);
ALTER TABLE public."inventory_balances" ADD CONSTRAINT "inventory_balances_zero_value_check" CHECK (quantity_eggs <> 0 OR value_paisa = 0);
ALTER TABLE public."inventory_operation_categories" ADD CONSTRAINT "inventory_operation_categories_before_state_check" CHECK (before_valuation_sequence IS NULL AND before_valuation_date IS NULL AND quantity_before_eggs = 0 AND value_before_paisa = 0 OR before_valuation_sequence IS NOT NULL AND before_valuation_date IS NOT NULL AND before_valuation_sequence > 0 AND before_valuation_sequence < valuation_sequence);
ALTER TABLE public."inventory_operation_categories" ADD CONSTRAINT "inventory_operation_categories_nonnegative_check" CHECK (quantity_before_eggs >= 0 AND value_before_paisa >= 0 AND quantity_after_eggs >= 0 AND value_after_paisa >= 0);
ALTER TABLE public."inventory_operation_categories" ADD CONSTRAINT "inventory_operation_categories_pkey" PRIMARY KEY (tenant_id, egg_category_id, valuation_sequence);
ALTER TABLE public."inventory_operation_categories" ADD CONSTRAINT "inventory_operation_categories_zero_value_check" CHECK ((quantity_before_eggs <> 0 OR value_before_paisa = 0) AND (quantity_after_eggs <> 0 OR value_after_paisa = 0));
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_pkey" PRIMARY KEY (valuation_sequence);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_sequence_check" CHECK (valuation_sequence > 0);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_superseded_check" CHECK (superseded_by_sequence IS NULL OR superseded_by_sequence > valuation_sequence);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_superseded_key" UNIQUE (tenant_id, superseded_by_sequence);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_supersedes_check" CHECK (supersedes_sequence IS NULL OR supersedes_sequence > 0 AND supersedes_sequence < valuation_sequence);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_supersedes_key" UNIQUE (tenant_id, supersedes_sequence);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_tenant_sequence_key" UNIQUE (tenant_id, valuation_sequence);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_type_check" CHECK (operation_type = ANY (ARRAY['purchase'::text, 'sale'::text, 'opening_stock'::text, 'adjustment_in'::text, 'adjustment_out'::text]));
ALTER TABLE public."invitations" ADD CONSTRAINT "invitations_pkey" PRIMARY KEY (id);
ALTER TABLE public."invitations" ADD CONSTRAINT "invitations_role_staff_only_check" CHECK (role IS NOT NULL AND role = 'staff'::text);
ALTER TABLE public."invitations" ADD CONSTRAINT "invitations_token_key" UNIQUE (token);
ALTER TABLE public."invoice_counters" ADD CONSTRAINT "invoice_counters_counter_type_check" CHECK (counter_type = ANY (ARRAY['sale'::text, 'purchase'::text]));
ALTER TABLE public."invoice_counters" ADD CONSTRAINT "invoice_counters_last_number_check" CHECK (last_number >= 0);
ALTER TABLE public."invoice_counters" ADD CONSTRAINT "invoice_counters_pkey" PRIMARY KEY (tenant_id, counter_type);
ALTER TABLE public."partners" ADD CONSTRAINT "partners_pkey" PRIMARY KEY (id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_role_check" CHECK (role = ANY (ARRAY['partner'::text, 'staff'::text]));
ALTER TABLE public."purchase_items" ADD CONSTRAINT "purchase_items_pkey" PRIMARY KEY (id);
ALTER TABLE public."purchase_items" ADD CONSTRAINT "purchase_items_price_per_tray_paisa_check" CHECK (price_per_tray_paisa > 0);
ALTER TABLE public."purchase_items" ADD CONSTRAINT "purchase_items_quantity_trays_check" CHECK (quantity_trays > 0);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_amount_paid_paisa_check" CHECK (amount_paid_paisa >= 0);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_invoice_number_tenant_key" UNIQUE (invoice_number, tenant_id);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_payment_status_check" CHECK (payment_status = ANY (ARRAY['paid'::text, 'partial'::text, 'unpaid'::text]));
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_pkey" PRIMARY KEY (id);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_cost_total_check" CHECK (cost_total_paisa IS NULL OR cost_total_paisa >= 0);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_discount_type_check" CHECK (discount_type = ANY (ARRAY['percentage'::text, 'fixed'::text]));
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_pkey" PRIMARY KEY (id);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_price_per_tray_paisa_check" CHECK (price_per_tray_paisa > 0);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_quantity_trays_check" CHECK (quantity_trays > 0);
ALTER TABLE public."sales" ADD CONSTRAINT "sales_discount_type_check" CHECK (discount_type = ANY (ARRAY['percentage'::text, 'fixed'::text]));
ALTER TABLE public."sales" ADD CONSTRAINT "sales_invoice_number_tenant_key" UNIQUE (invoice_number, tenant_id);
ALTER TABLE public."sales" ADD CONSTRAINT "sales_payment_status_check" CHECK (payment_status = ANY (ARRAY['paid'::text, 'partial'::text, 'unpaid'::text]));
ALTER TABLE public."sales" ADD CONSTRAINT "sales_pkey" PRIMARY KEY (id);
ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_movement_type_check" CHECK (movement_type = ANY (ARRAY['purchase_in'::text, 'sale_out'::text, 'adjustment_in'::text, 'adjustment_out'::text, 'opening_stock'::text]));
ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY (id);
ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_quantity_trays_check" CHECK (quantity_trays > 0);
ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_valuation_shape_check" CHECK (valuation_sequence IS NULL AND cost_total_paisa IS NULL AND valuation_source IS NULL AND superseded_by_sequence IS NULL AND quantity_trays IS NOT NULL OR valuation_sequence IS NOT NULL AND valuation_sequence > 0 AND tenant_id IS NOT NULL AND cost_total_paisa IS NOT NULL AND cost_total_paisa >= 0 AND valuation_source IS NOT NULL AND btrim(valuation_source) <> ''::text AND quantity_eggs IS NOT NULL AND quantity_eggs > 0 AND NOT quantity_trays IS DISTINCT FROM
CASE
    WHEN (quantity_eggs % 30) = 0 THEN quantity_eggs / 30
    ELSE NULL::integer
END AND (superseded_by_sequence IS NULL OR superseded_by_sequence > valuation_sequence));
ALTER TABLE public."super_admins" ADD CONSTRAINT "super_admins_pkey" PRIMARY KEY (user_id);
ALTER TABLE public."supplier_payments" ADD CONSTRAINT "supplier_payments_amount_paisa_check" CHECK (amount_paisa > 0);
ALTER TABLE public."supplier_payments" ADD CONSTRAINT "supplier_payments_payment_method_check" CHECK (payment_method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'easypaisa'::text, 'jazzcash'::text]));
ALTER TABLE public."supplier_payments" ADD CONSTRAINT "supplier_payments_pkey" PRIMARY KEY (id);
ALTER TABLE public."suppliers" ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY (id);
ALTER TABLE public."tenant_members" ADD CONSTRAINT "tenant_members_pkey" PRIMARY KEY (id);
ALTER TABLE public."tenant_members" ADD CONSTRAINT "tenant_members_role_owner_staff_check" CHECK (role IS NOT NULL AND (role = ANY (ARRAY['owner'::text, 'staff'::text])));
ALTER TABLE public."tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_user_id_key" UNIQUE (tenant_id, user_id);
ALTER TABLE public."tenants" ADD CONSTRAINT "tenants_pkey" PRIMARY KEY (id);
ALTER TABLE public."tenants" ADD CONSTRAINT "tenants_slug_key" UNIQUE (slug);
ALTER TABLE public."bank_accounts" ADD CONSTRAINT "bank_accounts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."capital_transactions" ADD CONSTRAINT "capital_transactions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."capital_transactions" ADD CONSTRAINT "capital_transactions_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES profiles(id);
ALTER TABLE public."capital_transactions" ADD CONSTRAINT "capital_transactions_partner_profile_id_fkey" FOREIGN KEY (partner_profile_id) REFERENCES partners(id) ON DELETE SET NULL;
ALTER TABLE public."capital_transactions" ADD CONSTRAINT "capital_transactions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."customer_payments" ADD CONSTRAINT "customer_payments_bank_account_id_fkey" FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public."customer_payments" ADD CONSTRAINT "customer_payments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."customer_payments" ADD CONSTRAINT "customer_payments_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public."customer_payments" ADD CONSTRAINT "customer_payments_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."egg_categories" ADD CONSTRAINT "egg_categories_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."expense_categories" ADD CONSTRAINT "expense_categories_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_bank_account_id_fkey" FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY (category_id) REFERENCES expense_categories(id);
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."inventory_balances" ADD CONSTRAINT "inventory_balances_category_fkey" FOREIGN KEY (tenant_id, egg_category_id) REFERENCES egg_categories(tenant_id, id);
ALTER TABLE public."inventory_balances" ADD CONSTRAINT "inventory_balances_last_valuation_fkey" FOREIGN KEY (tenant_id, egg_category_id, last_valuation_sequence) REFERENCES inventory_operation_categories(tenant_id, egg_category_id, valuation_sequence);
ALTER TABLE public."inventory_balances" ADD CONSTRAINT "inventory_balances_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE public."inventory_operation_categories" ADD CONSTRAINT "inventory_operation_categories_before_fkey" FOREIGN KEY (tenant_id, egg_category_id, before_valuation_sequence) REFERENCES inventory_operation_categories(tenant_id, egg_category_id, valuation_sequence);
ALTER TABLE public."inventory_operation_categories" ADD CONSTRAINT "inventory_operation_categories_category_fkey" FOREIGN KEY (tenant_id, egg_category_id) REFERENCES egg_categories(tenant_id, id);
ALTER TABLE public."inventory_operation_categories" ADD CONSTRAINT "inventory_operation_categories_operation_fkey" FOREIGN KEY (tenant_id, valuation_sequence) REFERENCES inventory_operations(tenant_id, valuation_sequence);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_superseded_fkey" FOREIGN KEY (tenant_id, superseded_by_sequence) REFERENCES inventory_operations(tenant_id, valuation_sequence);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_supersedes_fkey" FOREIGN KEY (tenant_id, supersedes_sequence) REFERENCES inventory_operations(tenant_id, valuation_sequence);
ALTER TABLE public."inventory_operations" ADD CONSTRAINT "inventory_operations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE public."invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."invoice_counters" ADD CONSTRAINT "invoice_counters_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."partners" ADD CONSTRAINT "partners_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."purchase_items" ADD CONSTRAINT "purchase_items_egg_category_id_fkey" FOREIGN KEY (egg_category_id) REFERENCES egg_categories(id);
ALTER TABLE public."purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE;
ALTER TABLE public."purchase_items" ADD CONSTRAINT "purchase_items_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_egg_category_id_fkey" FOREIGN KEY (egg_category_id) REFERENCES egg_categories(id);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."sales" ADD CONSTRAINT "sales_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public."sales" ADD CONSTRAINT "sales_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_egg_category_id_fkey" FOREIGN KEY (egg_category_id) REFERENCES egg_categories(id);
ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_superseded_category_fkey" FOREIGN KEY (tenant_id, egg_category_id, superseded_by_sequence) REFERENCES inventory_operation_categories(tenant_id, egg_category_id, valuation_sequence);
ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_valuation_category_fkey" FOREIGN KEY (tenant_id, egg_category_id, valuation_sequence) REFERENCES inventory_operation_categories(tenant_id, egg_category_id, valuation_sequence);
ALTER TABLE public."super_admins" ADD CONSTRAINT "super_admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."supplier_payments" ADD CONSTRAINT "supplier_payments_bank_account_id_fkey" FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public."supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
ALTER TABLE public."supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."tenant_members" ADD CONSTRAINT "tenant_members_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public."tenant_members" ADD CONSTRAINT "tenant_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."tenants" ADD CONSTRAINT "tenants_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.allocate_invoice_number_trusted_v1(p_tenant_id uuid, p_counter_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.allocate_invoice_number_v1(p_tenant_id uuid, p_counter_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.assert_inventory_posting_permission_de05(p_actor_user_id uuid, p_tenant_id uuid, p_operation text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_module text;
  v_key text;
  v_role text;
  v_permissions jsonb;
  v_override jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_operation IS NULL OR p_operation NOT IN (
      'sale', 'purchase', 'opening_stock', 'adjustment_in', 'adjustment_out'
    ) OR p_action IS NULL OR p_action NOT IN ('create', 'update', 'delete')
    OR (p_operation NOT IN ('sale', 'purchase') AND p_action <> 'create') THEN
    RAISE EXCEPTION 'Invalid inventory operation' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT FROM public.super_admins WHERE user_id = p_actor_user_id) THEN
    RETURN true;
  END IF;

  BEGIN
    SELECT role, permissions::jsonb INTO STRICT v_role, v_permissions
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = p_actor_user_id;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'owner' THEN RETURN true; END IF;
  -- DE-19: staff never gain deletion through stored permission overrides.
  IF p_action = 'delete' THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END IF;
  v_module := CASE p_operation WHEN 'sale' THEN 'sales'
    WHEN 'purchase' THEN 'purchases' ELSE 'stock' END;
  v_key := CASE v_module WHEN 'sales' THEN 'canViewSales'
    WHEN 'purchases' THEN 'canViewPurchases' ELSE 'canManageStock' END;
  -- Canonical key wins even when malformed; JSON boolean true is the only
  -- allowed explicit value. Missing/non-object JSON preserves staff defaults.
  IF jsonb_typeof(v_permissions) = 'object' THEN
    IF v_permissions ? v_key THEN v_override := v_permissions -> v_key;
    ELSIF v_permissions ? v_module THEN v_override := v_permissions -> v_module;
    END IF;
    IF v_override IS NOT NULL AND v_override IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN true;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.consume_staff_invitation_de_security_01(p_invitation_id text, p_token text, p_tenant_id uuid, p_user_id uuid, p_full_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM tenant_members
  WHERE user_id = auth.uid()
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tenant_id FROM tenant_members
  WHERE user_id = auth.uid()
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION public.initialize_invoice_counters_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.invoice_counters (tenant_id, counter_type, last_number)
  VALUES (NEW.id, 'sale', 0), (NEW.id, 'purchase', 0);
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS(SELECT 1 FROM super_admins WHERE user_id = auth.uid())
$function$
;
CREATE OR REPLACE FUNCTION public.keep_inventory_valuation_inactive_de05()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_row jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_row := to_jsonb(OLD);
    IF v_row ->> 'cost_total_paisa' IS NOT NULL
       OR v_row ->> 'valuation_sequence' IS NOT NULL
       OR v_row ->> 'valuation_source' IS NOT NULL
       OR v_row ->> 'superseded_by_sequence' IS NOT NULL THEN
      RAISE EXCEPTION 'DE-05 valuation is inactive' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_row := to_jsonb(NEW);
    IF v_row ->> 'cost_total_paisa' IS NOT NULL
       OR v_row ->> 'valuation_sequence' IS NOT NULL
       OR v_row ->> 'valuation_source' IS NOT NULL
       OR v_row ->> 'superseded_by_sequence' IS NOT NULL THEN
      RAISE EXCEPTION 'DE-05 valuation is inactive' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.prevent_invoice_identity_update_de_security_01()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Invoice number and tenant cannot be changed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.read_staff_invitation_acceptance_de_security_01(p_invitation_id text, p_token text, p_tenant_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
ALTER TABLE public."bank_accounts" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."bank_accounts" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."bank_accounts" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."bank_accounts" TO service_role;
ALTER TABLE public."capital_transactions" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."capital_transactions" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."capital_transactions" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."capital_transactions" TO service_role;
ALTER TABLE public."customer_payments" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, REFERENCES, MAINTAIN ON public."customer_payments" TO anon;
GRANT SELECT, REFERENCES, MAINTAIN ON public."customer_payments" TO authenticated;
GRANT INSERT, SELECT ON public."customer_payments" TO service_role;
ALTER TABLE public."customers" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."customers" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."customers" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."customers" TO service_role;
GRANT SELECT ON public."de_security_01_attestation" TO service_role;
ALTER TABLE public."egg_categories" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."egg_categories" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."egg_categories" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."egg_categories" TO service_role;
ALTER TABLE public."expense_categories" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."expense_categories" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."expense_categories" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."expense_categories" TO service_role;
ALTER TABLE public."expenses" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."expenses" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."expenses" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."expenses" TO service_role;
ALTER TABLE public."inventory_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."inventory_operation_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."inventory_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."invitations" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, REFERENCES, MAINTAIN ON public."invitations" TO anon;
GRANT SELECT, REFERENCES, MAINTAIN ON public."invitations" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."invitations" TO service_role;
ALTER TABLE public."invoice_counters" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."invoice_counters" TO service_role;
ALTER TABLE public."partners" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."partners" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."partners" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."partners" TO service_role;
ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."profiles" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."profiles" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."profiles" TO service_role;
ALTER TABLE public."purchase_items" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."purchase_items" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."purchase_items" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."purchase_items" TO service_role;
ALTER TABLE public."purchases" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, REFERENCES, MAINTAIN ON public."purchases" TO anon;
GRANT SELECT, REFERENCES, MAINTAIN ON public."purchases" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."purchases" TO service_role;
ALTER TABLE public."sale_items" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."sale_items" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."sale_items" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."sale_items" TO service_role;
ALTER TABLE public."sales" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, REFERENCES, MAINTAIN ON public."sales" TO anon;
GRANT SELECT, REFERENCES, MAINTAIN ON public."sales" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."sales" TO service_role;
ALTER TABLE public."stock_movements" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."stock_movements" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."stock_movements" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."stock_movements" TO service_role;
ALTER TABLE public."super_admins" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, REFERENCES, MAINTAIN ON public."super_admins" TO anon;
GRANT SELECT, REFERENCES, MAINTAIN ON public."super_admins" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."super_admins" TO service_role;
ALTER TABLE public."supplier_payments" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, REFERENCES, MAINTAIN ON public."supplier_payments" TO anon;
GRANT SELECT, REFERENCES, MAINTAIN ON public."supplier_payments" TO authenticated;
GRANT INSERT, SELECT ON public."supplier_payments" TO service_role;
ALTER TABLE public."suppliers" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."suppliers" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."suppliers" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."suppliers" TO service_role;
ALTER TABLE public."tenant_members" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, REFERENCES, MAINTAIN ON public."tenant_members" TO anon;
GRANT SELECT, REFERENCES, MAINTAIN ON public."tenant_members" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."tenant_members" TO service_role;
ALTER TABLE public."tenants" ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."tenants" TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."tenants" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public."tenants" TO service_role;
REVOKE ALL ON FUNCTION public."allocate_invoice_number_trusted_v1"(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."allocate_invoice_number_trusted_v1"(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public."allocate_invoice_number_v1"(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."allocate_invoice_number_v1"(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public."allocate_invoice_number_v1"(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public."assert_inventory_posting_permission_de05"(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."assert_inventory_posting_permission_de05"(uuid, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public."consume_staff_invitation_de_security_01"(text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."consume_staff_invitation_de_security_01"(text, text, uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public."get_user_role"() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."get_user_role"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."get_user_role"() TO anon;
GRANT EXECUTE ON FUNCTION public."get_user_role"() TO authenticated;
GRANT EXECUTE ON FUNCTION public."get_user_role"() TO service_role;
REVOKE ALL ON FUNCTION public."get_user_tenant_id"() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."get_user_tenant_id"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."get_user_tenant_id"() TO anon;
GRANT EXECUTE ON FUNCTION public."get_user_tenant_id"() TO authenticated;
GRANT EXECUTE ON FUNCTION public."get_user_tenant_id"() TO service_role;
REVOKE ALL ON FUNCTION public."initialize_invoice_counters_v1"() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."initialize_invoice_counters_v1"() TO service_role;
REVOKE ALL ON FUNCTION public."is_super_admin"() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."is_super_admin"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."is_super_admin"() TO anon;
GRANT EXECUTE ON FUNCTION public."is_super_admin"() TO authenticated;
GRANT EXECUTE ON FUNCTION public."is_super_admin"() TO service_role;
REVOKE ALL ON FUNCTION public."keep_inventory_valuation_inactive_de05"() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public."prevent_invoice_identity_update_de_security_01"() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."prevent_invoice_identity_update_de_security_01"() TO service_role;
REVOKE ALL ON FUNCTION public."read_staff_invitation_acceptance_de_security_01"(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public."read_staff_invitation_acceptance_de_security_01"(text, text, uuid, uuid) TO service_role;
CREATE POLICY "tenant scoped bank_accounts" ON public."bank_accounts" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "tenant scoped capital_transactions" ON public."capital_transactions" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "customer_payments_tenant_select_de_security_01" ON public."customer_payments" AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "tenant scoped customers" ON public."customers" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "tenant scoped egg_categories" ON public."egg_categories" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "tenant scoped expense_categories" ON public."expense_categories" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "tenant scoped expenses" ON public."expenses" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "invitations_owner_select_de_security_01" ON public."invitations" AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT m.tenant_id
   FROM tenant_members m
  WHERE ((m.user_id = auth.uid()) AND (m.role = 'owner'::text)))));
CREATE POLICY "tenant scoped partners" ON public."partners" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "super admin can manage profiles" ON public."profiles" AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin());
CREATE POLICY "tenant scoped profiles read" ON public."profiles" AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "users can update own profile" ON public."profiles" AS PERMISSIVE FOR UPDATE TO authenticated USING ((id = auth.uid()));
CREATE POLICY "tenant scoped purchase_items" ON public."purchase_items" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "purchases_tenant_select_de_security_01" ON public."purchases" AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "tenant scoped sale_items" ON public."sale_items" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "sales_tenant_select_de_security_01" ON public."sales" AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "tenant scoped stock_movements" ON public."stock_movements" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "super admin can read super_admins table" ON public."super_admins" AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "supplier_payments_tenant_select_de_security_01" ON public."supplier_payments" AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "tenant scoped suppliers" ON public."suppliers" AS PERMISSIVE FOR ALL TO authenticated USING (((tenant_id = get_user_tenant_id()) OR is_super_admin()));
CREATE POLICY "tenant_members_self_select_de_security_01" ON public."tenant_members" AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "authenticated can read own tenant" ON public."tenants" AS PERMISSIVE FOR SELECT TO authenticated USING ((id IN ( SELECT tenant_members.tenant_id
   FROM tenant_members
  WHERE (tenant_members.user_id = auth.uid()))));
CREATE POLICY "super admin full access tenants" ON public."tenants" AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin());
CREATE VIEW public."bank_account_balances" AS  SELECT ba.id AS bank_account_id,
    ba.bank_name,
    ba.account_holder,
    ba.account_number,
    ba.nickname,
    ba.is_active,
    COALESCE(cp.total, 0::numeric) AS total_received_paisa,
    COALESCE(sp.total, 0::numeric) AS total_supplier_paid_paisa,
    COALESCE(ex.total, 0::numeric) AS total_expenses_paisa,
    COALESCE(cp.total, 0::numeric) - COALESCE(sp.total, 0::numeric) - COALESCE(ex.total, 0::numeric) AS balance_paisa
   FROM bank_accounts ba
     LEFT JOIN ( SELECT customer_payments.bank_account_id,
            sum(customer_payments.amount_paisa) AS total
           FROM customer_payments
          WHERE customer_payments.bank_account_id IS NOT NULL
          GROUP BY customer_payments.bank_account_id) cp ON cp.bank_account_id = ba.id
     LEFT JOIN ( SELECT supplier_payments.bank_account_id,
            sum(supplier_payments.amount_paisa) AS total
           FROM supplier_payments
          WHERE supplier_payments.bank_account_id IS NOT NULL
          GROUP BY supplier_payments.bank_account_id) sp ON sp.bank_account_id = ba.id
     LEFT JOIN ( SELECT expenses.bank_account_id,
            sum(expenses.amount_paisa) AS total
           FROM expenses
          WHERE expenses.bank_account_id IS NOT NULL
          GROUP BY expenses.bank_account_id) ex ON ex.bank_account_id = ba.id;
GRANT ALL ON public."bank_account_balances" TO anon, authenticated, service_role;
CREATE VIEW public."current_stock" AS  SELECT ec.id AS egg_category_id,
    ec.name AS egg_category,
    ec.display_order,
    COALESCE(sum(
        CASE
            WHEN sm.movement_type = ANY (ARRAY['purchase_in'::text, 'adjustment_in'::text, 'opening_stock'::text]) THEN
            CASE
                WHEN sm.quantity_eggs > 0 THEN sm.quantity_eggs
                ELSE sm.quantity_trays * 30
            END
            ELSE -
            CASE
                WHEN sm.quantity_eggs > 0 THEN sm.quantity_eggs
                ELSE sm.quantity_trays * 30
            END
        END), 0::bigint) AS quantity_eggs,
    COALESCE(sum(
        CASE
            WHEN sm.movement_type = ANY (ARRAY['purchase_in'::text, 'adjustment_in'::text, 'opening_stock'::text]) THEN
            CASE
                WHEN sm.quantity_eggs > 0 THEN sm.quantity_eggs
                ELSE sm.quantity_trays * 30
            END
            ELSE -
            CASE
                WHEN sm.quantity_eggs > 0 THEN sm.quantity_eggs
                ELSE sm.quantity_trays * 30
            END
        END)::numeric / 30.0, 0::numeric) AS quantity_trays
   FROM egg_categories ec
     LEFT JOIN stock_movements sm ON sm.egg_category_id = ec.id
  WHERE ec.is_active = true
  GROUP BY ec.id, ec.name, ec.display_order
  ORDER BY ec.display_order;
GRANT ALL ON public."current_stock" TO anon, authenticated, service_role;
CREATE VIEW public."customer_balances" AS  SELECT c.id AS customer_id,
    c.contact_name,
    c.business_name,
    c.phone,
    c.customer_type,
    c.is_active,
    COALESCE(s.total, 0::numeric) AS total_sales_paisa,
    COALESCE(p.total, 0::numeric) AS total_paid_paisa,
    COALESCE(s.total, 0::numeric) - COALESCE(p.total, 0::numeric) AS balance_paisa
   FROM customers c
     LEFT JOIN ( SELECT s_1.customer_id,
            sum(si.quantity_trays * si.price_per_tray_paisa) AS total
           FROM sales s_1
             JOIN sale_items si ON si.sale_id = s_1.id
          GROUP BY s_1.customer_id) s ON s.customer_id = c.id
     LEFT JOIN ( SELECT customer_payments.customer_id,
            sum(customer_payments.amount_paisa) AS total
           FROM customer_payments
          GROUP BY customer_payments.customer_id) p ON p.customer_id = c.id;
GRANT ALL ON public."customer_balances" TO anon, authenticated, service_role;
CREATE VIEW public."partner_capital_summary" AS  SELECT p.id AS partner_id,
    p.full_name,
    COALESCE(sum(
        CASE
            WHEN ct.type = 'contribution'::text THEN ct.amount_paisa
            ELSE 0::bigint
        END), 0::numeric) AS total_contributed_paisa,
    COALESCE(sum(
        CASE
            WHEN ct.type = 'withdrawal'::text THEN ct.amount_paisa
            ELSE 0::bigint
        END), 0::numeric) AS total_withdrawn_paisa,
    COALESCE(sum(
        CASE
            WHEN ct.type = 'contribution'::text THEN ct.amount_paisa
            ELSE 0::bigint
        END), 0::numeric) - COALESCE(sum(
        CASE
            WHEN ct.type = 'withdrawal'::text THEN ct.amount_paisa
            ELSE 0::bigint
        END), 0::numeric) AS net_capital_paisa
   FROM profiles p
     LEFT JOIN capital_transactions ct ON ct.partner_id = p.id
  WHERE p.role = 'partner'::text
  GROUP BY p.id, p.full_name;
GRANT ALL ON public."partner_capital_summary" TO anon, authenticated, service_role;
CREATE VIEW public."supplier_balances" AS  SELECT s.id AS supplier_id,
    s.name,
    s.phone,
    s.is_active,
    COALESCE(p.total, 0::numeric) AS total_purchases_paisa,
    COALESCE(pay.total, 0::numeric) AS total_paid_paisa,
    COALESCE(p.total, 0::numeric) - COALESCE(pay.total, 0::numeric) AS balance_paisa
   FROM suppliers s
     LEFT JOIN ( SELECT pu.supplier_id,
            sum(pi.quantity_trays * pi.price_per_tray_paisa) AS total
           FROM purchases pu
             JOIN purchase_items pi ON pi.purchase_id = pu.id
          WHERE pu.supplier_id IS NOT NULL
          GROUP BY pu.supplier_id) p ON p.supplier_id = s.id
     LEFT JOIN ( SELECT supplier_payments.supplier_id,
            sum(supplier_payments.amount_paisa) AS total
           FROM supplier_payments
          GROUP BY supplier_payments.supplier_id) pay ON pay.supplier_id = s.id;
GRANT ALL ON public."supplier_balances" TO anon, authenticated, service_role;
CREATE VIEW public."overdue_sales" AS  SELECT s.id AS sale_id,
    s.invoice_number,
    s.sale_date,
    s.due_date,
    s.payment_status,
    CURRENT_DATE - s.due_date AS days_overdue,
    c.id AS customer_id,
    c.contact_name,
    c.business_name,
    c.phone,
    cb.balance_paisa
   FROM sales s
     JOIN customers c ON c.id = s.customer_id
     JOIN customer_balances cb ON cb.customer_id = c.id
  WHERE (s.payment_status = ANY (ARRAY['unpaid'::text, 'partial'::text])) AND s.due_date IS NOT NULL AND s.due_date < CURRENT_DATE
  ORDER BY (CURRENT_DATE - s.due_date) DESC;
GRANT ALL ON public."overdue_sales" TO anon, authenticated, service_role;
CREATE TRIGGER stock_movements_valuation_inactive_de05 AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.keep_inventory_valuation_inactive_de05();
CREATE TRIGGER sale_items_valuation_inactive_de05 AFTER INSERT OR UPDATE OR DELETE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION public.keep_inventory_valuation_inactive_de05();


-- Match the already-closed foundation’s explicit owner-only ACLs.
REVOKE ALL ON public.inventory_balances, public.inventory_operations, public.inventory_operation_categories FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.inventory_valuation_sequence FROM PUBLIC, anon, authenticated, service_role;
