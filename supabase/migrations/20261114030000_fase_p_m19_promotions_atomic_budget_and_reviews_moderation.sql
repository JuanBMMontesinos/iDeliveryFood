-- ============================================================================
-- Fase P (M19): Marketing, Promotions with Atomic Budget Guard, Shared Subsidy & Review Moderation
-- ============================================================================

ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'growth_marketing';

-- 1. Expand public.promotions for M19 (PLATFORM, MERCHANT/STORE, SHARED subsidy + first_order_only)
ALTER TABLE public.promotions
  DROP CONSTRAINT IF EXISTS promotions_funded_by_check;

ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_funded_by_check
  CHECK (funded_by IN ('PLATFORM', 'STORE', 'MERCHANT', 'SHARED'));

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS platform_share_bps integer NOT NULL DEFAULT 10000
    CHECK (platform_share_bps BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS first_order_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2. Expand public.promotion_redemptions with subsidy split tracking and nullable order_id for atomic reservation
ALTER TABLE public.promotion_redemptions
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE public.promotion_redemptions
  ADD COLUMN IF NOT EXISTS platform_subsidy_cents integer NOT NULL DEFAULT 0 CHECK (platform_subsidy_cents >= 0),
  ADD COLUMN IF NOT EXISTS merchant_subsidy_cents integer NOT NULL DEFAULT 0 CHECK (merchant_subsidy_cents >= 0),
  ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE;

-- 3. Expand public.order_reviews with administrative moderation audit columns
ALTER TABLE public.order_reviews
  ADD COLUMN IF NOT EXISTS moderated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderated_at timestamptz,
  ADD COLUMN IF NOT EXISTS moderation_reason text;

-- 4. RLS Policies for M19 Marketing & Reviews Moderation
DROP POLICY IF EXISTS promotions_manage_staff_or_partner ON public.promotions;
CREATE POLICY promotions_manage_staff_or_partner ON public.promotions
  FOR ALL TO authenticated
  USING (
    app_security.has_staff_role(ARRAY['marketing', 'commercial', 'operations', 'tech_admin']::public.staff_role[])
    OR (
      store_id IS NOT NULL
      AND app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_marketing']::public.partner_role[])
    )
  )
  WITH CHECK (
    app_security.has_staff_role(ARRAY['marketing', 'commercial', 'operations', 'tech_admin']::public.staff_role[])
    OR (
      store_id IS NOT NULL
      AND app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_marketing']::public.partner_role[])
    )
  );

DROP POLICY IF EXISTS order_reviews_moderate_staff ON public.order_reviews;
CREATE POLICY order_reviews_moderate_staff ON public.order_reviews
  FOR UPDATE TO authenticated
  USING (
    app_security.has_staff_role(ARRAY['marketing', 'support', 'operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_support']::public.partner_role[])
  )
  WITH CHECK (
    app_security.has_staff_role(ARRAY['marketing', 'support', 'operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_support']::public.partner_role[])
  );

GRANT SELECT, INSERT, UPDATE ON public.promotions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.promotion_redemptions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_reviews TO authenticated;
