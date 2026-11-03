-- M04, M10, M12 Database Helpers, Views & Scoped RLS Policies

CREATE OR REPLACE FUNCTION app_security.calculate_distance_meters(
  p_lat1 numeric,
  p_lon1 numeric,
  p_lat2 numeric,
  p_lon2 numeric
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT ROUND(
    6371000.0 * 2.0 * ASIN(
      SQRT(
        POWER(SIN(RADIANS((p_lat2 - p_lat1)::double precision) / 2.0), 2.0) +
        COS(RADIANS(p_lat1::double precision)) *
        COS(RADIANS(p_lat2::double precision)) *
        POWER(SIN(RADIANS((p_lon2 - p_lon1)::double precision) / 2.0), 2.0)
      )
    )
  )::integer;
$$;

GRANT EXECUTE ON FUNCTION app_security.calculate_distance_meters(numeric, numeric, numeric, numeric)
  TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.store_catalog_v
WITH (security_invoker = true)
AS
SELECT
  cp.id AS product_id,
  cp.store_id,
  cp.category_id,
  cc.name_en AS category_name_en,
  cc.name_pt_br AS category_name_pt_br,
  cc.sort_order AS category_sort_order,
  cp.sku,
  cp.name_en AS product_name_en,
  cp.name_pt_br AS product_name_pt_br,
  cp.description_en AS product_description_en,
  cp.description_pt_br AS product_description_pt_br,
  cp.price_cents,
  cp.is_available,
  cp.is_paused,
  cp.max_per_order,
  cp.unit_of_measure,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', og.id,
          'nameEn', og.name_en,
          'namePtBr', og.name_pt_br,
          'minSelections', og.min_selections,
          'maxSelections', og.max_selections,
          'sortOrder', og.sort_order,
          'options', COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', co.id,
                  'nameEn', co.name_en,
                  'namePtBr', co.name_pt_br,
                  'additionalPriceCents', co.additional_price_cents,
                  'isAvailable', co.is_available,
                  'sortOrder', co.sort_order
                )
                ORDER BY co.sort_order ASC
              )
              FROM public.catalog_options co
              WHERE co.option_group_id = og.id
            ),
            '[]'::jsonb
          )
        )
        ORDER BY og.sort_order ASC
      )
      FROM public.catalog_option_groups og
      WHERE og.product_id = cp.id
    ),
    '[]'::jsonb
  ) AS option_groups
FROM public.catalog_products cp
JOIN public.catalog_categories cc
  ON cc.id = cp.category_id
WHERE cc.is_active = true;

GRANT SELECT ON public.store_catalog_v TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_attempts' AND policyname = 'payment_attempts_insert_customer'
  ) THEN
    CREATE POLICY payment_attempts_insert_customer ON public.payment_attempts
      FOR INSERT TO authenticated
      WITH CHECK (customer_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'refunds' AND policyname = 'refunds_insert_staff_or_customer'
  ) THEN
    CREATE POLICY refunds_insert_staff_or_customer ON public.refunds
      FOR INSERT TO authenticated
      WITH CHECK (
        requested_by = (SELECT auth.uid())
        AND (
          EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = refunds.order_id
              AND o.customer_id = (SELECT auth.uid())
          )
          OR app_security.has_staff_role(ARRAY['support', 'operations', 'finance', 'tech_admin']::public.staff_role[])
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'refunds' AND policyname = 'refunds_update_finance_staff'
  ) THEN
    CREATE POLICY refunds_update_finance_staff ON public.refunds
      FOR UPDATE TO authenticated
      USING (app_security.has_staff_role(ARRAY['finance', 'tech_admin']::public.staff_role[], true))
      WITH CHECK (app_security.has_staff_role(ARRAY['finance', 'tech_admin']::public.staff_role[], true));
  END IF;
END $$;

GRANT INSERT ON public.payment_attempts TO authenticated;
GRANT INSERT, UPDATE ON public.refunds TO authenticated;
