-- Fase S (M22): Grocery & Market Extension, Picking Tasks, Variable Weight Pricing (HALF_UP Cents),
-- Customer-Consented Item Substitutions & Automatic Financial Adjustments

BEGIN;

-- 1. Store-level feature flag for M22 Grocery Picking (complementing platform_policies and organizations)
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS feature_grocery_picking_enabled boolean NOT NULL DEFAULT false;

-- 2. Enrich public.catalog_products with M22 variable weight & pricing unit fields
ALTER TABLE public.catalog_products
  DROP CONSTRAINT IF EXISTS catalog_products_unit_of_measure_check;

ALTER TABLE public.catalog_products
  ADD CONSTRAINT catalog_products_unit_of_measure_check
  CHECK (unit_of_measure IN ('UNIT', 'GRAM', 'GRAM_100', 'KG'));

ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS pricing_unit text NOT NULL DEFAULT 'UNIT',
  ADD COLUMN IF NOT EXISTS estimated_weight_grams integer,
  ADD COLUMN IF NOT EXISTS price_per_kg_cents integer;

ALTER TABLE public.catalog_products
  DROP CONSTRAINT IF EXISTS catalog_products_pricing_unit_check,
  DROP CONSTRAINT IF EXISTS catalog_products_estimated_weight_check,
  DROP CONSTRAINT IF EXISTS catalog_products_price_per_kg_check;

ALTER TABLE public.catalog_products
  ADD CONSTRAINT catalog_products_pricing_unit_check
    CHECK (pricing_unit IN ('UNIT', 'KG', 'GRAM_100')),
  ADD CONSTRAINT catalog_products_estimated_weight_check
    CHECK (estimated_weight_grams IS NULL OR estimated_weight_grams > 0),
  ADD CONSTRAINT catalog_products_price_per_kg_check
    CHECK (price_per_kg_cents IS NULL OR price_per_kg_cents >= 0);

-- 3. Enrich public.order_items with customer substitution preference & weighed line tracking
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS substitution_preference text NOT NULL DEFAULT 'REFUND_IF_UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS pricing_unit text NOT NULL DEFAULT 'UNIT',
  ADD COLUMN IF NOT EXISTS estimated_weight_grams integer,
  ADD COLUMN IF NOT EXISTS actual_weight_grams integer,
  ADD COLUMN IF NOT EXISTS price_per_kg_cents integer,
  ADD COLUMN IF NOT EXISTS adjusted_line_cents integer;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_substitution_preference_check,
  DROP CONSTRAINT IF EXISTS order_items_pricing_unit_check,
  DROP CONSTRAINT IF EXISTS order_items_estimated_weight_check,
  DROP CONSTRAINT IF EXISTS order_items_actual_weight_check,
  DROP CONSTRAINT IF EXISTS order_items_price_per_kg_check,
  DROP CONSTRAINT IF EXISTS order_items_adjusted_line_cents_check;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_substitution_preference_check
    CHECK (substitution_preference IN ('ALLOW_SUGGESTION', 'CONTACT_ME', 'REFUND_IF_UNAVAILABLE')),
  ADD CONSTRAINT order_items_pricing_unit_check
    CHECK (pricing_unit IN ('UNIT', 'KG', 'GRAM_100')),
  ADD CONSTRAINT order_items_estimated_weight_check
    CHECK (estimated_weight_grams IS NULL OR estimated_weight_grams > 0),
  ADD CONSTRAINT order_items_actual_weight_check
    CHECK (actual_weight_grams IS NULL OR actual_weight_grams >= 0),
  ADD CONSTRAINT order_items_price_per_kg_check
    CHECK (price_per_kg_cents IS NULL OR price_per_kg_cents >= 0),
  ADD CONSTRAINT order_items_adjusted_line_cents_check
    CHECK (adjusted_line_cents IS NULL OR adjusted_line_cents >= 0);

-- 4. Create public.order_pick_tasks (M22 Grocery Order Picking Lifecycle)
CREATE TABLE IF NOT EXISTS public.order_pick_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  picker_actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'PICKING_IN_PROGRESS'
    CHECK (
      status IN (
        'PICKING_IN_PROGRESS',
        'AWAITING_CUSTOMER_SUBSTITUTION_APPROVAL',
        'PICKING_COMPLETED',
        'CANCELLED'
      )
    ),
  pre_authorized_total_cents integer NOT NULL CHECK (pre_authorized_total_cents >= 0),
  final_picked_total_cents integer NOT NULL CHECK (final_picked_total_cents >= 0),
  weight_adjustment_delta_cents integer NOT NULL DEFAULT 0,
  refund_adjustment_cents integer NOT NULL DEFAULT 0 CHECK (refund_adjustment_cents >= 0),
  notes text,
  started_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  completed_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_order_pick_tasks_store_status
  ON public.order_pick_tasks(store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_pick_tasks_customer_id
  ON public.order_pick_tasks(customer_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_order_pick_tasks_updated_at ON public.order_pick_tasks;
CREATE TRIGGER trg_order_pick_tasks_updated_at
  BEFORE UPDATE ON public.order_pick_tasks
  FOR EACH ROW EXECUTE FUNCTION app_security.touch_updated_at();

-- 5. Create public.order_item_substitutions (M22 Customer-Consented Substitutions)
CREATE TABLE IF NOT EXISTS public.order_item_substitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_task_id uuid NOT NULL REFERENCES public.order_pick_tasks(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  original_product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
  suggested_product_id uuid REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
  suggested_product_name_en text,
  suggested_product_name_pt_br text,
  customer_preference text NOT NULL
    CHECK (customer_preference IN ('ALLOW_SUGGESTION', 'CONTACT_ME', 'REFUND_IF_UNAVAILABLE')),
  original_line_cents integer NOT NULL CHECK (original_line_cents >= 0),
  suggested_line_cents integer NOT NULL DEFAULT 0 CHECK (suggested_line_cents >= 0),
  price_delta_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING_CUSTOMER_APPROVAL'
    CHECK (
      status IN (
        'PENDING_CUSTOMER_APPROVAL',
        'APPROVED_BY_CUSTOMER',
        'REJECTED_BY_CUSTOMER',
        'EXPIRED_TIMEOUT_REFUNDED',
        'AUTO_REFUNDED_UNAVAILABLE'
      )
    ),
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  customer_decided_at timestamptz,
  customer_decision_notes text,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_order_item_substitutions_pick_task
  ON public.order_item_substitutions(pick_task_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_order_item_substitutions_order_id
  ON public.order_item_substitutions(order_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_order_item_substitutions_store_id
  ON public.order_item_substitutions(store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_item_substitutions_customer_id
  ON public.order_item_substitutions(customer_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_item_substitutions_order_item_id
  ON public.order_item_substitutions(order_item_id);

DROP TRIGGER IF EXISTS trg_order_item_substitutions_updated_at ON public.order_item_substitutions;
CREATE TRIGGER trg_order_item_substitutions_updated_at
  BEFORE UPDATE ON public.order_item_substitutions
  FOR EACH ROW EXECUTE FUNCTION app_security.touch_updated_at();

-- 6. Strict Row Level Security (RLS) on public.order_pick_tasks & public.order_item_substitutions
ALTER TABLE public.order_pick_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_pick_tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE public.order_item_substitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_substitutions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY order_pick_tasks_select_store_or_customer ON public.order_pick_tasks
    FOR SELECT TO authenticated
    USING (
      customer_id = (SELECT auth.uid())
      OR app_security.has_store_role(
        store_id,
        ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[]
      )
      OR app_security.has_staff_role(
        ARRAY['operations', 'support', 'tech_admin']::public.staff_role[],
        false
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY order_pick_tasks_insert_store ON public.order_pick_tasks
    FOR INSERT TO authenticated
    WITH CHECK (
      app_security.has_store_role(
        store_id,
        ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[]
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY order_pick_tasks_update_store ON public.order_pick_tasks
    FOR UPDATE TO authenticated
    USING (
      app_security.has_store_role(
        store_id,
        ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[]
      )
    )
    WITH CHECK (
      app_security.has_store_role(
        store_id,
        ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[]
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY order_item_substitutions_select_store_or_customer ON public.order_item_substitutions
    FOR SELECT TO authenticated
    USING (
      customer_id = (SELECT auth.uid())
      OR app_security.has_store_role(
        store_id,
        ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[]
      )
      OR app_security.has_staff_role(
        ARRAY['operations', 'support', 'tech_admin']::public.staff_role[],
        false
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY order_item_substitutions_insert_store ON public.order_item_substitutions
    FOR INSERT TO authenticated
    WITH CHECK (
      app_security.has_store_role(
        store_id,
        ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[]
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY order_item_substitutions_update_store_or_customer ON public.order_item_substitutions
    FOR UPDATE TO authenticated
    USING (
      customer_id = (SELECT auth.uid())
      OR app_security.has_store_role(
        store_id,
        ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[]
      )
    )
    WITH CHECK (
      customer_id = (SELECT auth.uid())
      OR app_security.has_store_role(
        store_id,
        ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[]
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public.order_pick_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_item_substitutions TO authenticated;

-- 7. Publish M22 tables to Supabase Realtime for live customer substitution approvals
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.order_pick_tasks;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.order_item_substitutions;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

COMMIT;
