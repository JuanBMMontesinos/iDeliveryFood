-- Fase E Migration: Align PostgreSQL enums, columns, and views for 100% zero-mock API persistence (M03, M04, M07, M08, M09, M10, M11, M12, M13, M14, M16)

-- 1. Extend public.order_status enum with domain state machine values
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'PENDING_MERCHANT_ACCEPTANCE';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'DISPATCHED';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'REFUNDED';

-- 2. Extend public.delivery_status enum with domain state machine values
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'UNASSIGNED';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'OFFERING';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'COURIER_ASSIGNED';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'ARRIVED_AT_STORE';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'IN_TRANSIT';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'DELIVERY_FAILED';

-- 3. Extend public.quotes with promotion_code text column for direct contract persistence
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS promotion_code text;

-- 4. Extend public.delivery_tasks with full contract and address/OTP privacy fields
ALTER TABLE public.delivery_tasks
  ADD COLUMN IF NOT EXISTS fulfillment_modality public.fulfillment_modality NOT NULL DEFAULT 'PLATFORM_DELIVERY',
  ADD COLUMN IF NOT EXISTS dropoff_neighborhood_only text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dropoff_full_address text,
  ADD COLUMN IF NOT EXISTS confirmation_code_hash text,
  ADD COLUMN IF NOT EXISTS estimated_eta_minutes integer NOT NULL DEFAULT 20;

-- 5. Extend public.delivery_offers with store name, distance, and neighborhood privacy fields
ALTER TABLE public.delivery_offers
  ADD COLUMN IF NOT EXISTS pickup_store_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS distance_meters integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dropoff_neighborhood_only text NOT NULL DEFAULT '';

-- 6. Extend public.published_stores_v to expose organization_id at the end of the column list
CREATE OR REPLACE VIEW public.published_stores_v
WITH (security_invoker = true)
AS
SELECT
  s.id,
  s.slug,
  s.name,
  s.description_en,
  s.description_pt_br,
  s.cuisine_category,
  s.is_paused,
  s.timezone,
  s.city,
  s.state_code,
  s.latitude,
  s.longitude,
  s.min_order_cents,
  s.prep_time_min_minutes,
  s.prep_time_max_minutes,
  s.supported_modalities,
  s.organization_id
FROM public.stores s
WHERE s.status = 'ACTIVE'
  AND s.is_published = true;

GRANT SELECT ON public.published_stores_v TO anon, authenticated, service_role;
