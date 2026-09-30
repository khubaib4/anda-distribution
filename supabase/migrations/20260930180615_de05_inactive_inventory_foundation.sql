-- DE-05 INACTIVE foundation. No backfill, opening stock, posting RPCs, or cutover.
-- Existing app writers omit all valuation fields and keep their current behavior.
-- Run only after separate deployment approval; this file is not an instruction
-- to apply SQL to production. See supabase/verification/de05-foundation.md.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';

-- Bound lock waits and keep the entire foundation/grant change atomic.
LOCK TABLE public.egg_categories, public.sale_items, public.stock_movements
  IN ACCESS EXCLUSIVE MODE;

-- id is already globally unique. This additional key allows tenant-coupled FKs
-- without changing nullable legacy tenant IDs or validating legacy item links.
ALTER TABLE public.egg_categories
  ADD CONSTRAINT egg_categories_tenant_id_id_key UNIQUE (tenant_id, id);

-- Only future trusted database posting will be allowed to consume this sequence.
-- Gaps are valid; it orders valuations, not invoices or gap-free business IDs.
CREATE SEQUENCE public.inventory_valuation_sequence AS bigint
  MINVALUE 1 START WITH 1 INCREMENT BY 1 NO CYCLE CACHE 1;

CREATE TABLE public.inventory_operations (
  valuation_sequence bigint PRIMARY KEY
    DEFAULT nextval('public.inventory_valuation_sequence'::regclass),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  operation_type text NOT NULL,
  operation_date date NOT NULL,
  reference_id uuid,
  supersedes_sequence bigint,
  superseded_by_sequence bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_operations_tenant_sequence_key
    UNIQUE (tenant_id, valuation_sequence),
  CONSTRAINT inventory_operations_type_check CHECK (operation_type IN (
    'purchase', 'sale', 'opening_stock', 'adjustment_in', 'adjustment_out'
  )),
  CONSTRAINT inventory_operations_sequence_check CHECK (valuation_sequence > 0),
  CONSTRAINT inventory_operations_supersedes_check CHECK (
    supersedes_sequence IS NULL OR
    (supersedes_sequence > 0 AND supersedes_sequence < valuation_sequence)
  ),
  CONSTRAINT inventory_operations_superseded_check CHECK (
    superseded_by_sequence IS NULL OR superseded_by_sequence > valuation_sequence
  ),
  CONSTRAINT inventory_operations_supersedes_key UNIQUE (tenant_id, supersedes_sequence),
  CONSTRAINT inventory_operations_superseded_key UNIQUE (tenant_id, superseded_by_sequence),
  CONSTRAINT inventory_operations_supersedes_fkey
    FOREIGN KEY (tenant_id, supersedes_sequence)
    REFERENCES public.inventory_operations (tenant_id, valuation_sequence),
  CONSTRAINT inventory_operations_superseded_fkey
    FOREIGN KEY (tenant_id, superseded_by_sequence)
    REFERENCES public.inventory_operations (tenant_id, valuation_sequence)
);
ALTER SEQUENCE public.inventory_valuation_sequence
  OWNED BY public.inventory_operations.valuation_sequence;

-- Exact before/after snapshots support later tail-only revisions. They do not
-- perform valuation, reversal, chronology checks, or cross-row reconciliation.
CREATE TABLE public.inventory_operation_categories (
  tenant_id uuid NOT NULL,
  egg_category_id uuid NOT NULL,
  valuation_sequence bigint NOT NULL,
  quantity_before_eggs bigint NOT NULL,
  value_before_paisa bigint NOT NULL,
  quantity_after_eggs bigint NOT NULL,
  value_after_paisa bigint NOT NULL,
  before_valuation_sequence bigint,
  before_valuation_date date,
  PRIMARY KEY (tenant_id, egg_category_id, valuation_sequence),
  CONSTRAINT inventory_operation_categories_operation_fkey
    FOREIGN KEY (tenant_id, valuation_sequence)
    REFERENCES public.inventory_operations (tenant_id, valuation_sequence),
  CONSTRAINT inventory_operation_categories_category_fkey
    FOREIGN KEY (tenant_id, egg_category_id)
    REFERENCES public.egg_categories (tenant_id, id),
  CONSTRAINT inventory_operation_categories_before_fkey
    FOREIGN KEY (tenant_id, egg_category_id, before_valuation_sequence)
    REFERENCES public.inventory_operation_categories
      (tenant_id, egg_category_id, valuation_sequence),
  CONSTRAINT inventory_operation_categories_nonnegative_check CHECK (
    quantity_before_eggs >= 0 AND value_before_paisa >= 0 AND
    quantity_after_eggs >= 0 AND value_after_paisa >= 0
  ),
  CONSTRAINT inventory_operation_categories_zero_value_check CHECK (
    (quantity_before_eggs <> 0 OR value_before_paisa = 0) AND
    (quantity_after_eggs <> 0 OR value_after_paisa = 0)
  ),
  CONSTRAINT inventory_operation_categories_before_state_check CHECK (
    (before_valuation_sequence IS NULL AND before_valuation_date IS NULL AND
      quantity_before_eggs = 0 AND value_before_paisa = 0) OR
    (before_valuation_sequence IS NOT NULL AND before_valuation_date IS NOT NULL AND
      before_valuation_sequence > 0 AND before_valuation_sequence < valuation_sequence)
  )
);
CREATE INDEX inventory_operation_categories_operation_idx
  ON public.inventory_operation_categories (tenant_id, valuation_sequence);

CREATE TABLE public.inventory_balances (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  egg_category_id uuid NOT NULL,
  quantity_eggs bigint NOT NULL DEFAULT 0,
  value_paisa bigint NOT NULL DEFAULT 0,
  last_valuation_sequence bigint,
  last_valuation_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, egg_category_id),
  CONSTRAINT inventory_balances_category_fkey
    FOREIGN KEY (tenant_id, egg_category_id)
    REFERENCES public.egg_categories (tenant_id, id),
  CONSTRAINT inventory_balances_last_valuation_fkey
    FOREIGN KEY (tenant_id, egg_category_id, last_valuation_sequence)
    REFERENCES public.inventory_operation_categories
      (tenant_id, egg_category_id, valuation_sequence),
  CONSTRAINT inventory_balances_nonnegative_check CHECK (
    quantity_eggs >= 0 AND value_paisa >= 0
  ),
  CONSTRAINT inventory_balances_zero_value_check CHECK (
    quantity_eggs <> 0 OR value_paisa = 0
  ),
  CONSTRAINT inventory_balances_valuation_state_check CHECK (
    (last_valuation_sequence IS NULL AND last_valuation_date IS NULL AND
      quantity_eggs = 0 AND value_paisa = 0) OR
    (last_valuation_sequence IS NOT NULL AND last_valuation_date IS NOT NULL AND
      last_valuation_sequence > 0)
  )
);
CREATE INDEX inventory_balances_last_valuation_idx
  ON public.inventory_balances (tenant_id, egg_category_id, last_valuation_sequence);

ALTER TABLE public.stock_movements
  ALTER COLUMN quantity_trays DROP NOT NULL,
  ADD COLUMN cost_total_paisa bigint,
  ADD COLUMN valuation_sequence bigint,
  ADD COLUMN valuation_source text,
  ADD COLUMN superseded_by_sequence bigint,
  ADD CONSTRAINT stock_movements_valuation_shape_check CHECK (
    -- Preserve legacy inserts, including trays-only rows and rounded adjustments.
    (valuation_sequence IS NULL AND cost_total_paisa IS NULL AND
      valuation_source IS NULL AND superseded_by_sequence IS NULL AND
      quantity_trays IS NOT NULL) OR
    -- New valued rows must contain complete, exact, tenant-scoped metadata.
    (valuation_sequence IS NOT NULL AND valuation_sequence > 0 AND
      tenant_id IS NOT NULL AND cost_total_paisa IS NOT NULL AND cost_total_paisa >= 0 AND
      valuation_source IS NOT NULL AND btrim(valuation_source) <> '' AND
      quantity_eggs IS NOT NULL AND quantity_eggs > 0 AND
      quantity_trays IS NOT DISTINCT FROM CASE
        WHEN quantity_eggs % 30 = 0 THEN quantity_eggs / 30 ELSE NULL END AND
      (superseded_by_sequence IS NULL OR superseded_by_sequence > valuation_sequence))
  ),
  ADD CONSTRAINT stock_movements_valuation_category_fkey
    FOREIGN KEY (tenant_id, egg_category_id, valuation_sequence)
    REFERENCES public.inventory_operation_categories
      (tenant_id, egg_category_id, valuation_sequence),
  ADD CONSTRAINT stock_movements_superseded_category_fkey
    FOREIGN KEY (tenant_id, egg_category_id, superseded_by_sequence)
    REFERENCES public.inventory_operation_categories
      (tenant_id, egg_category_id, valuation_sequence);
CREATE INDEX stock_movements_valuation_category_idx
  ON public.stock_movements (tenant_id, egg_category_id, valuation_sequence)
  WHERE valuation_sequence IS NOT NULL;
CREATE INDEX stock_movements_superseded_category_idx
  ON public.stock_movements (tenant_id, egg_category_id, superseded_by_sequence)
  WHERE superseded_by_sequence IS NOT NULL;

ALTER TABLE public.sale_items
  ADD COLUMN cost_total_paisa bigint,
  ADD CONSTRAINT sale_items_cost_total_check CHECK (
    cost_total_paisa IS NULL OR cost_total_paisa >= 0
  );

-- Production default grants are broad, including TRUNCATE (which bypasses RLS)
-- and sequence UPDATE/USAGE. Close each new object explicitly in this transaction.
-- No read/write policies, app grants, helper functions, or posting paths yet.
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_operation_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_balances, public.inventory_operations,
  public.inventory_operation_categories FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.inventory_valuation_sequence
  FROM PUBLIC, anon, authenticated, service_role;

-- Detect inherited access instead of silently claiming a closed foundation.
DO $$
DECLARE
  v_role text;
  v_table text;
  v_privilege text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'inventory_balances', 'inventory_operations', 'inventory_operation_categories'
    ] LOOP
      FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ] LOOP
        IF has_table_privilege(v_role, format('public.%I', v_table), v_privilege) THEN
          RAISE EXCEPTION 'DE-05 inactive prerequisite failed: % retains % on %',
            v_role, v_privilege, v_table;
        END IF;
      END LOOP;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF has_sequence_privilege(v_role, 'public.inventory_valuation_sequence', v_privilege) THEN
        RAISE EXCEPTION 'DE-05 inactive prerequisite failed: % retains sequence %',
          v_role, v_privilege;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
COMMIT;
