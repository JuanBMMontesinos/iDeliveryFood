-- ============================================================================
-- iDeliveryFood — Idempotent Synthetic Development/Test Seed (supabase/seed.sql)
-- ============================================================================
-- Rules enforced:
-- 1. 100% idempotent: can be executed N times without duplication or errors.
-- 2. Stable UUIDs (00000000-0000-4000-8000-...) and explicit is_test_data = true.
-- 3. Zero real personal data (PII) and zero passwords/secrets in seed.
-- 4. Never triggers external billing or external messages (.invalid RFC 2606 emails).
-- ============================================================================

BEGIN;

-- 1. Platform Policies (Default Operational & Commercial Rules)
INSERT INTO public.platform_policies (
  policy_key,
  description,
  currency_code,
  operational_timezone,
  platform_delivery_commission_bps,
  merchant_delivery_commission_bps,
  pickup_commission_bps,
  service_fee_bps,
  service_fee_cap_cents,
  quote_ttl_seconds,
  free_cancel_window_seconds,
  feature_fleet_operators_enabled,
  feature_grocery_picking_enabled,
  feature_sponsored_ads_enabled,
  feature_subscriptions_enabled,
  is_test_data
) VALUES (
  'DEFAULT_BR_MARKETPLACE',
  'Default Brazilian food marketplace policy (hybrid fulfillment, integer BRL cents, America/Sao_Paulo)',
  'BRL',
  'America/Sao_Paulo',
  2300,
  1200,
  1000,
  500,
  499,
  900,
  120,
  false,
  false,
  false,
  false,
  true
)
ON CONFLICT (policy_key) DO UPDATE SET
  description = EXCLUDED.description,
  platform_delivery_commission_bps = EXCLUDED.platform_delivery_commission_bps,
  merchant_delivery_commission_bps = EXCLUDED.merchant_delivery_commission_bps,
  pickup_commission_bps = EXCLUDED.pickup_commission_bps,
  service_fee_bps = EXCLUDED.service_fee_bps,
  service_fee_cap_cents = EXCLUDED.service_fee_cap_cents,
  quote_ttl_seconds = EXCLUDED.quote_ttl_seconds,
  free_cancel_window_seconds = EXCLUDED.free_cancel_window_seconds,
  is_test_data = true;

-- 2. Pre-Configured External Provider Adapters Registry (Option 1 + Option 2)
INSERT INTO public.provider_configurations (
  provider_code,
  category,
  display_name,
  status,
  is_primary,
  required_env_vars,
  capabilities,
  webhook_tolerance_seconds,
  is_test_data
) VALUES
  (
    'stripe',
    'PSP',
    'Stripe Brazil (PIX & Cards)',
    'BLOCKED_MISSING_CREDENTIALS',
    true,
    ARRAY['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
    '{"pix": true, "credit_card": true, "split_1_to_n": true, "refunds": true}'::jsonb,
    300,
    true
  ),
  (
    'mercadopago',
    'PSP',
    'Mercado Pago Checkout Transparente',
    'BLOCKED_MISSING_CREDENTIALS',
    false,
    ARRAY['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY'],
    '{"pix": true, "credit_card": true, "split_1_to_n": true, "refunds": true}'::jsonb,
    300,
    true
  ),
  (
    'pagarme',
    'PSP',
    'Pagar.me Stone Split V5',
    'BLOCKED_MISSING_CREDENTIALS',
    false,
    ARRAY['PAGARME_SECRET_KEY', 'PAGARME_WEBHOOK_SECRET', 'NEXT_PUBLIC_PAGARME_PUBLIC_KEY'],
    '{"pix": true, "credit_card": true, "split_1_to_n": true, "refunds": true}'::jsonb,
    300,
    true
  ),
  (
    'google_maps',
    'MAPS',
    'Google Maps Platform (Geocoding & Routes)',
    'BLOCKED_MISSING_CREDENTIALS',
    true,
    ARRAY['GOOGLE_MAPS_SERVER_API_KEY', 'NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY'],
    '{"geocoding": true, "distance_matrix": true, "directions": true}'::jsonb,
    300,
    true
  ),
  (
    'mapbox',
    'MAPS',
    'Mapbox Navigation & Isochrones',
    'BLOCKED_MISSING_CREDENTIALS',
    false,
    ARRAY['MAPBOX_SECRET_TOKEN', 'NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN'],
    '{"geocoding": true, "directions": true, "isochrones": true}'::jsonb,
    300,
    true
  ),
  (
    'resend',
    'EMAIL',
    'Resend Transactional Email',
    'BLOCKED_MISSING_CREDENTIALS',
    true,
    ARRAY['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
    '{"transactional_email": true, "webhooks": true}'::jsonb,
    300,
    true
  ),
  (
    'fcm',
    'PUSH_ANDROID',
    'Firebase Cloud Messaging (Android Native)',
    'BLOCKED_MISSING_CREDENTIALS',
    true,
    ARRAY['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'],
    '{"android_push": true}'::jsonb,
    300,
    true
  ),
  (
    'apns',
    'PUSH_IOS',
    'Apple Push Notification service (iOS Native)',
    'BLOCKED_MISSING_CREDENTIALS',
    true,
    ARRAY['APNS_TEAM_ID', 'APNS_KEY_ID', 'APNS_PRIVATE_KEY', 'APNS_BUNDLE_ID'],
    '{"ios_push": true}'::jsonb,
    300,
    true
  )
ON CONFLICT (provider_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  required_env_vars = EXCLUDED.required_env_vars,
  capabilities = EXCLUDED.capabilities,
  is_test_data = true;

-- 3. Synthetic Test Auth Users (Zero passwords, RFC 2606 .invalid domain)
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'customer.alice@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'customer.bruno@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'owner.paulista@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'operator.paulista@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'finance.paulista@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000020', 'authenticated', 'authenticated', 'owner.sushi@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000030', 'authenticated', 'authenticated', 'courier.carlos@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000090', 'authenticated', 'authenticated', 'staff.ops@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000091', 'authenticated', 'authenticated', 'staff.finance@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000099', 'authenticated', 'authenticated', 'staff.admin@test.ideliveryfood.invalid', NULL, '2026-11-01T10:00:00Z', '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb, false, false, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  updated_at = EXCLUDED.updated_at;

-- 4. Profiles & User Preferences
INSERT INTO public.profiles (id, email, full_name, phone, preferred_locale, status, mfa_enforced, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'customer.alice@test.ideliveryfood.invalid', 'Alice Test Consumer', '+5511900000001', 'en', 'ACTIVE', false, true),
  ('00000000-0000-4000-8000-000000000002', 'customer.bruno@test.ideliveryfood.invalid', 'Bruno Consumidor Teste', '+5511900000002', 'pt-BR', 'ACTIVE', false, true),
  ('00000000-0000-4000-8000-000000000010', 'owner.paulista@test.ideliveryfood.invalid', 'Helena Partner Owner', '+5511900000010', 'pt-BR', 'ACTIVE', false, true),
  ('00000000-0000-4000-8000-000000000011', 'operator.paulista@test.ideliveryfood.invalid', 'Lucas Store Operator', '+5511900000011', 'pt-BR', 'ACTIVE', false, true),
  ('00000000-0000-4000-8000-000000000012', 'finance.paulista@test.ideliveryfood.invalid', 'Clara Partner Finance', '+5511900000012', 'en', 'ACTIVE', false, true),
  ('00000000-0000-4000-8000-000000000020', 'owner.sushi@test.ideliveryfood.invalid', 'Kenji Sushi Owner', '+5511900000020', 'en', 'ACTIVE', false, true),
  ('00000000-0000-4000-8000-000000000030', 'courier.carlos@test.ideliveryfood.invalid', 'Carlos Entregador Teste', '+5511900000030', 'pt-BR', 'ACTIVE', false, true),
  ('00000000-0000-4000-8000-000000000090', 'staff.ops@test.ideliveryfood.invalid', 'Marina Platform Operations', '+5511900000090', 'en', 'ACTIVE', true, true),
  ('00000000-0000-4000-8000-000000000091', 'staff.finance@test.ideliveryfood.invalid', 'Roberto Platform Finance', '+5511900000091', 'en', 'ACTIVE', true, true),
  ('00000000-0000-4000-8000-000000000099', 'staff.admin@test.ideliveryfood.invalid', 'Admin Technical Governance', '+5511900000099', 'en', 'ACTIVE', true, true)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  preferred_locale = EXCLUDED.preferred_locale,
  is_test_data = true;

INSERT INTO public.user_preferences (user_id, locale, push_order_updates, push_promotions, email_transactional, email_marketing, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'en', true, false, true, false, true),
  ('00000000-0000-4000-8000-000000000002', 'pt-BR', true, true, true, false, true),
  ('00000000-0000-4000-8000-000000000010', 'pt-BR', true, false, true, false, true),
  ('00000000-0000-4000-8000-000000000011', 'pt-BR', true, false, true, false, true),
  ('00000000-0000-4000-8000-000000000012', 'en', true, false, true, false, true),
  ('00000000-0000-4000-8000-000000000020', 'en', true, false, true, false, true),
  ('00000000-0000-4000-8000-000000000030', 'pt-BR', true, false, true, false, true),
  ('00000000-0000-4000-8000-000000000090', 'en', true, false, true, false, true),
  ('00000000-0000-4000-8000-000000000091', 'en', true, false, true, false, true),
  ('00000000-0000-4000-8000-000000000099', 'en', true, false, true, false, true)
ON CONFLICT (user_id) DO UPDATE SET
  locale = EXCLUDED.locale,
  is_test_data = true;

-- 5. Organizations (2 isolated tenants)
INSERT INTO public.organizations (id, slug, legal_name, trade_name, tax_id, status, is_multi_unit_enabled, feature_grocery_picking_enabled, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000101', 'paulista-artisan-burgers', 'Paulista Artisan Burgers Alimentos Ltda', 'Paulista Artisan Burgers', '00000000000191', 'ACTIVE', true, false, true),
  ('00000000-0000-4000-8000-000000000102', 'tokyo-bay-sushi-group', 'Tokyo Bay Gastronomia Japonesa S.A.', 'Tokyo Bay Sushi', '00000000000272', 'ACTIVE', false, false, true)
ON CONFLICT (id) DO UPDATE SET
  trade_name = EXCLUDED.trade_name,
  status = EXCLUDED.status,
  is_test_data = true;

-- 6. Stores (2 active/published + 1 draft/unpublished)
INSERT INTO public.stores (
  id, organization_id, slug, name, description_en, description_pt_br, cuisine_category,
  status, is_published, is_paused, timezone, address_line, city, state_code, postal_code,
  latitude, longitude, min_order_cents, prep_time_min_minutes, prep_time_max_minutes,
  supported_modalities, is_test_data
) VALUES
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000101',
    'paulista-burgers-jardins',
    'Paulista Artisan Burgers - Jardins',
    'Dry-aged smash burgers, hand-cut fries, and craft shakes.',
    'Smash burgers maturados, batatas rústicas e shakes artesanais.',
    'BURGERS',
    'ACTIVE',
    true,
    false,
    'America/Sao_Paulo',
    'Av. Paulista, 1500 - Bela Vista',
    'São Paulo',
    'SP',
    '01310-100',
    -23.561414,
    -46.655881,
    2500,
    20,
    35,
    ARRAY['PLATFORM_DELIVERY'::public.fulfillment_modality, 'MERCHANT_DELIVERY'::public.fulfillment_modality, 'PICKUP'::public.fulfillment_modality],
    true
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000102',
    'tokyo-bay-sushi-pinheiros',
    'Tokyo Bay Sushi - Pinheiros',
    'Traditional omakase sets, fresh sashimi, and hot rolls.',
    'Combinados tradicionais omakase, sashimis frescos e hot rolls.',
    'JAPANESE',
    'ACTIVE',
    true,
    false,
    'America/Sao_Paulo',
    'Rua dos Pinheiros, 800 - Pinheiros',
    'São Paulo',
    'SP',
    '05422-001',
    -23.565210,
    -46.682140,
    4000,
    30,
    50,
    ARRAY['PLATFORM_DELIVERY'::public.fulfillment_modality, 'PICKUP'::public.fulfillment_modality],
    true
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000101',
    'paulista-burgers-itaim-draft',
    'Paulista Artisan Burgers - Itaim (Unpublished Unit)',
    'Upcoming unit in Itaim Bibi (unpublished draft for RLS verification).',
    'Nova unidade no Itaim Bibi (rascunho não publicado para verificação de RLS).',
    'BURGERS',
    'DRAFT',
    false,
    false,
    'America/Sao_Paulo',
    'Rua Joaquim Floriano, 400 - Itaim Bibi',
    'São Paulo',
    'SP',
    '04534-002',
    -23.584100,
    -46.674200,
    2500,
    25,
    40,
    ARRAY['PLATFORM_DELIVERY'::public.fulfillment_modality],
    true
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  is_published = EXCLUDED.is_published,
  is_test_data = true;

-- 7. Store Operating Hours (0 = Sunday .. 6 = Saturday) & Service Areas
INSERT INTO public.store_hours (id, store_id, day_of_week, opens_at, closes_at, is_overnight, is_closed, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000300', '00000000-0000-4000-8000-000000000201', 0, '11:00:00', '23:30:00', false, false, true),
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 1, '11:00:00', '23:30:00', false, false, true),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000201', 2, '11:00:00', '23:30:00', false, false, true),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000201', 3, '11:00:00', '23:30:00', false, false, true),
  ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000201', 4, '11:00:00', '23:30:00', false, false, true),
  ('00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-000000000201', 5, '11:00:00', '01:00:00', true, false, true),
  ('00000000-0000-4000-8000-000000000306', '00000000-0000-4000-8000-000000000201', 6, '11:00:00', '01:00:00', true, false, true),
  ('00000000-0000-4000-8000-000000000310', '00000000-0000-4000-8000-000000000202', 0, '12:00:00', '23:00:00', false, false, true),
  ('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000202', 1, '12:00:00', '23:00:00', false, false, true),
  ('00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000202', 2, '12:00:00', '23:00:00', false, false, true),
  ('00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000202', 3, '12:00:00', '23:00:00', false, false, true),
  ('00000000-0000-4000-8000-000000000314', '00000000-0000-4000-8000-000000000202', 4, '12:00:00', '23:00:00', false, false, true),
  ('00000000-0000-4000-8000-000000000315', '00000000-0000-4000-8000-000000000202', 5, '12:00:00', '23:59:00', false, false, true),
  ('00000000-0000-4000-8000-000000000316', '00000000-0000-4000-8000-000000000202', 6, '12:00:00', '23:59:00', false, false, true)
ON CONFLICT (id) DO UPDATE SET
  opens_at = EXCLUDED.opens_at,
  closes_at = EXCLUDED.closes_at,
  is_test_data = true;

INSERT INTO public.store_service_areas (
  id, store_id, name, radius_meters, base_fee_cents, per_km_fee_cents, free_delivery_min_order_cents, estimated_delivery_minutes, is_active, is_test_data
) VALUES
  ('00000000-0000-4000-8000-000000000351', '00000000-0000-4000-8000-000000000201', 'Jardins & Bela Vista (Up to 7km)', 7000, 690, 150, 12000, 35, true, true),
  ('00000000-0000-4000-8000-000000000352', '00000000-0000-4000-8000-000000000202', 'Pinheiros & Vila Madalena (Up to 6km)', 6000, 890, 180, 18000, 45, true, true)
ON CONFLICT (id) DO UPDATE SET
  radius_meters = EXCLUDED.radius_meters,
  base_fee_cents = EXCLUDED.base_fee_cents,
  is_test_data = true;

-- 8. Organization Members & Staff Scopes
INSERT INTO public.organization_members (id, organization_id, store_id, user_id, role, is_active, granted_by, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000101', NULL, '00000000-0000-4000-8000-000000000010', 'partner_owner', true, '00000000-0000-4000-8000-000000000099', true),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000011', 'partner_operator', true, '00000000-0000-4000-8000-000000000010', true),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000101', NULL, '00000000-0000-4000-8000-000000000012', 'partner_finance', true, '00000000-0000-4000-8000-000000000010', true),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000102', NULL, '00000000-0000-4000-8000-000000000020', 'partner_owner', true, '00000000-0000-4000-8000-000000000099', true)
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active,
  is_test_data = true;

INSERT INTO public.staff_scopes (id, user_id, role, region_code, max_refund_approval_cents, requires_mfa, is_active, granted_by, justification, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000451', '00000000-0000-4000-8000-000000000090', 'operations', 'BR-SP', 10000, true, true, '00000000-0000-4000-8000-000000000099', 'Initial Operations Lead Scope', true),
  ('00000000-0000-4000-8000-000000000452', '00000000-0000-4000-8000-000000000091', 'finance', 'BR-SP', 100000, true, true, '00000000-0000-4000-8000-000000000099', 'Initial Finance Reconciliation Lead Scope', true),
  ('00000000-0000-4000-8000-000000000453', '00000000-0000-4000-8000-000000000099', 'tech_admin', NULL, 0, true, true, NULL, 'Controlled local bootstrap tech_admin', true)
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active,
  is_test_data = true;

-- 9. Catalog: Categories, Products, Option Groups & Options
INSERT INTO public.catalog_categories (id, store_id, name_en, name_pt_br, sort_order, is_active, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000201', 'Smash Burgers', 'Smash Burgers', 1, true, true),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000201', 'Sides & Fries', 'Acompanhamentos e Batatas', 2, true, true),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000202', 'Chef Combos', 'Combinados do Chef', 1, true, true)
ON CONFLICT (id) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_pt_br = EXCLUDED.name_pt_br,
  is_test_data = true;

INSERT INTO public.catalog_products (
  id, store_id, category_id, sku, name_en, name_pt_br, description_en, description_pt_br,
  price_cents, is_available, is_paused, max_per_order, unit_of_measure, is_test_data
) VALUES
  (
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000501',
    'PAB-SMASH-01',
    'Double Paulista Truffle Smash',
    'Duplo Smash Paulista Trufado',
    'Two 90g dry-aged beef patties, English cheddar, caramelized onions, truffle aioli on brioche.',
    'Dois blends de 90g maturados, cheddar inglês, cebola caramelizada e aioli trufado no brioche.',
    3890,
    true,
    false,
    10,
    'UNIT',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000502',
    'PAB-FRIES-01',
    'Rosemary & Sea Salt Crinkle Fries',
    'Batata Crinkle com Alecrim e Flor de Sal',
    'Crispy golden crinkle fries tossed with fresh rosemary and sea salt.',
    'Batatas crinkle douradas e crocantes finalizadas com alecrim fresco e flor de sal.',
    1690,
    true,
    false,
    10,
    'UNIT',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000603',
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000503',
    'TBS-OMAKASE-24',
    'Omakase Selection (24 Pieces)',
    'Seleção Omakase (24 Peças)',
    '8 sashimi cuts, 10 nigiri, and 6 salmon uramaki prepared by the sushi bar.',
    '8 cortes de sashimi, 10 niguiris e 6 uramakis de salmão preparados pelo sushiman.',
    8990,
    true,
    false,
    5,
    'UNIT',
    true
  )
ON CONFLICT (id) DO UPDATE SET
  price_cents = EXCLUDED.price_cents,
  name_en = EXCLUDED.name_en,
  name_pt_br = EXCLUDED.name_pt_br,
  is_test_data = true;

INSERT INTO public.catalog_option_groups (id, product_id, store_id, name_en, name_pt_br, min_selections, max_selections, sort_order, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000201', 'Extra Toppings', 'Adicionais Extras', 0, 3, 1, true)
ON CONFLICT (id) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_pt_br = EXCLUDED.name_pt_br,
  is_test_data = true;

INSERT INTO public.catalog_options (id, option_group_id, store_id, name_en, name_pt_br, additional_price_cents, is_available, sort_order, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000751', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000201', 'Smoked Applewood Bacon', 'Bacon Defumado Artesanal', 650, true, 1, true),
  ('00000000-0000-4000-8000-000000000752', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000201', 'Extra English Cheddar Slice', 'Fatia Extra de Cheddar Inglês', 450, true, 2, true)
ON CONFLICT (id) DO UPDATE SET
  additional_price_cents = EXCLUDED.additional_price_cents,
  is_test_data = true;

-- 10. Customer Addresses & Couriers
INSERT INTO public.customer_addresses (
  id, user_id, label, recipient_name, street_line, number, complement, neighborhood, city, state_code, postal_code, latitude, longitude, delivery_instructions, is_default, is_test_data
) VALUES
  ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000001', 'Home', 'Alice Test Consumer', 'Rua Oscar Freire', '950', 'Apt 82', 'Jardins', 'São Paulo', 'SP', '01426-001', -23.563980, -46.669120, 'Leave at concierge desk', true, true),
  ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000002', 'Casa', 'Bruno Consumidor Teste', 'Alameda Santos', '1200', 'Conj 41', 'Cerqueira César', 'São Paulo', 'SP', '01418-100', -23.565100, -46.654200, 'Interfone 41', true, true)
ON CONFLICT (id) DO UPDATE SET
  street_line = EXCLUDED.street_line,
  is_test_data = true;

INSERT INTO public.couriers (id, approval_status, document_number_hash, active_region_code, vehicle_type, is_online, last_online_at, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000030', 'APPROVED', 'sha256_test_courier_doc_0030', 'SP-CAPITAL', 'MOTORCYCLE', true, '2026-11-03T12:00:00Z', true)
ON CONFLICT (id) DO UPDATE SET
  approval_status = EXCLUDED.approval_status,
  is_online = EXCLUDED.is_online,
  is_test_data = true;

INSERT INTO public.courier_vehicles (id, courier_id, vehicle_type, plate_code, model_description, is_verified, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000000851', '00000000-0000-4000-8000-000000000030', 'MOTORCYCLE', 'BRA2E19', 'Honda CG 160 Cargo (Test Vehicle)', true, true)
ON CONFLICT (id) DO UPDATE SET
  model_description = EXCLUDED.model_description,
  is_test_data = true;

-- 11. Promotions, Quotes & Orders (Coherent Transactional Chain)
INSERT INTO public.promotions (
  id, code, store_id, funded_by, discount_type, discount_value, max_discount_cents, min_order_cents, budget_limit_cents, budget_consumed_cents, max_uses_per_user, starts_at, ends_at, is_active, is_test_data
) VALUES
  ('00000000-0000-4000-8000-000000000901', 'WELCOME10', NULL, 'PLATFORM', 'FIXED_CENTS', 1000, 1000, 3500, 500000, 1000, 1, '2026-01-01T00:00:00Z', '2027-12-31T23:59:59Z', true, true)
ON CONFLICT (id) DO UPDATE SET
  is_active = EXCLUDED.is_active,
  is_test_data = true;

-- Quote for Alice at Paulista Burgers:
-- 1x Double Paulista Truffle Smash (3890) + 1x Bacon (650) + 1x Fries (1690) => subtotal 5580, addons 650
-- service_fee: 312 cents, delivery_fee: 690 cents, discount: 1000 cents => total = 5580 + 650 + 312 + 690 - 1000 = 6232 cents
INSERT INTO public.quotes (
  id, customer_id, store_id, address_id, fulfillment_modality, promotion_id, currency_code,
  subtotal_cents, addons_cents, service_fee_cents, delivery_fee_cents, discount_cents, total_cents,
  distance_meters, estimated_prep_minutes, estimated_delivery_minutes, items_snapshot, address_snapshot,
  idempotency_key, expires_at, consumed_at, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000000951',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000801',
  'PLATFORM_DELIVERY',
  '00000000-0000-4000-8000-000000000901',
  'BRL',
  5580,
  650,
  312,
  690,
  1000,
  6232,
  1420,
  25,
  35,
  '[{"productId":"00000000-0000-4000-8000-000000000601","quantity":1,"unitPriceCents":3890,"addonsUnitPriceCents":650},{"productId":"00000000-0000-4000-8000-000000000602","quantity":1,"unitPriceCents":1690,"addonsUnitPriceCents":0}]'::jsonb,
  '{"streetLine":"Rua Oscar Freire, 950","neighborhood":"Jardins","city":"São Paulo","stateCode":"SP"}'::jsonb,
  'seed_quote_alice_001',
  '2026-11-03T15:00:00Z',
  '2026-11-03T12:05:00Z',
  true
)
ON CONFLICT (id) DO UPDATE SET
  total_cents = EXCLUDED.total_cents,
  is_test_data = true;

INSERT INTO public.orders (
  id, order_number, customer_id, organization_id, store_id, quote_id, fulfillment_modality,
  order_status, payment_status, delivery_status, currency_code,
  subtotal_cents, addons_cents, service_fee_cents, delivery_fee_cents, discount_cents, total_cents,
  platform_commission_cents, merchant_net_cents, courier_earnings_cents,
  delivery_address_snapshot, customer_notes, version, idempotency_key,
  accepted_at, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001001',
  10001,
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000951',
  'PLATFORM_DELIVERY',
  'PREPARING',
  'CAPTURED',
  'ASSIGNED',
  'BRL',
  5580,
  650,
  312,
  690,
  1000,
  6232,
  1433,
  4797,
  690,
  '{"streetLine":"Rua Oscar Freire, 950","neighborhood":"Jardins","city":"São Paulo","stateCode":"SP"}'::jsonb,
  'No pickles please',
  3,
  'seed_order_alice_001',
  '2026-11-03T12:06:00Z',
  true
)
ON CONFLICT (id) DO UPDATE SET
  order_status = EXCLUDED.order_status,
  version = EXCLUDED.version,
  is_test_data = true;

INSERT INTO public.order_items (
  id, order_id, product_id, product_name_snapshot_en, product_name_snapshot_pt_br,
  quantity, unit_price_cents, addons_unit_price_cents, total_line_cents, is_test_data
) VALUES
  (
    '00000000-0000-4000-8000-000000001051',
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000000601',
    'Double Paulista Truffle Smash',
    'Duplo Smash Paulista Trufado',
    1,
    3890,
    650,
    4540,
    true
  ),
  (
    '00000000-0000-4000-8000-000000001052',
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000000602',
    'Rosemary & Sea Salt Crinkle Fries',
    'Batata Crinkle com Alecrim e Flor de Sal',
    1,
    1690,
    0,
    1690,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  total_line_cents = EXCLUDED.total_line_cents,
  is_test_data = true;

INSERT INTO public.order_item_options (
  id, order_item_id, option_id, option_name_snapshot_en, option_name_snapshot_pt_br, quantity, additional_price_cents, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001071',
  '00000000-0000-4000-8000-000000001051',
  '00000000-0000-4000-8000-000000000751',
  'Smoked Applewood Bacon',
  'Bacon Defumado Artesanal',
  1,
  650,
  true
)
ON CONFLICT (id) DO UPDATE SET
  additional_price_cents = EXCLUDED.additional_price_cents,
  is_test_data = true;

-- Append-only Order Events (ON CONFLICT DO NOTHING to respect immutability trigger)
INSERT INTO public.order_events (
  id, order_id, actor_id, actor_role, event_type, previous_order_status, new_order_status,
  previous_payment_status, new_payment_status, previous_delivery_status, new_delivery_status,
  idempotency_key, payload, is_test_data
) VALUES
  (
    '00000000-0000-4000-8000-000000001101',
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000000001',
    'CUSTOMER',
    'ORDER_CREATED',
    NULL,
    'CREATED',
    NULL,
    'PENDING',
    NULL,
    'PENDING_DISPATCH',
    'seed_evt_order_1001_created',
    '{"quoteId":"00000000-0000-4000-8000-000000000951"}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000001102',
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000000011',
    'PARTNER_OPERATOR',
    'ORDER_PREPARING',
    'ACCEPTED',
    'PREPARING',
    'CAPTURED',
    'CAPTURED',
    'PENDING_DISPATCH',
    'ASSIGNED',
    'seed_evt_order_1001_preparing',
    '{"prepMinutes":25}'::jsonb,
    true
  )
ON CONFLICT (id) DO NOTHING;

-- 12. Delivery Task & Assignment
INSERT INTO public.delivery_tasks (
  id, order_id, store_id, status, pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
  courier_fee_cents, distance_meters, active_courier_id, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000201',
  'ASSIGNED',
  -23.561414,
  -46.655881,
  -23.563980,
  -46.669120,
  690,
  1420,
  '00000000-0000-4000-8000-000000000030',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  active_courier_id = EXCLUDED.active_courier_id,
  is_test_data = true;

INSERT INTO public.delivery_assignments (
  id, delivery_task_id, courier_id, assigned_by_actor_id, status, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001251',
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000000030',
  '00000000-0000-4000-8000-000000000090',
  'ACTIVE',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

-- 13. Balanced Double-Entry Financial Ledger (M13)
-- Total captured from customer: 6232 cents + Platform Promo Subsidy Expense: 1000 cents = 7232 cents total debits
-- Credits: Merchant Payable (4797) + Courier Payable (690) + Platform Commission Revenue (1433) + Platform Service Fee Revenue (312) = 7232 cents total credits!
INSERT INTO public.ledger_accounts (id, code, name, account_type, organization_id, courier_id, currency_code, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000001301', 'ASSET_PSP_CLEARING', 'PSP Clearing Receivable (BRL)', 'ASSET', NULL, NULL, 'BRL', true),
  ('00000000-0000-4000-8000-000000001302', 'EXPENSE_PROMO_SUBSIDY', 'Platform Marketing Coupon Subsidy', 'EXPENSE', NULL, NULL, 'BRL', true),
  ('00000000-0000-4000-8000-000000001303', 'LIABILITY_MERCHANT_ORG_101', 'Merchant Payable - Paulista Artisan Burgers', 'LIABILITY', '00000000-0000-4000-8000-000000000101', NULL, 'BRL', true),
  ('00000000-0000-4000-8000-000000001304', 'LIABILITY_COURIER_030', 'Courier Payable - Carlos Entregador Teste', 'LIABILITY', NULL, '00000000-0000-4000-8000-000000000030', 'BRL', true),
  ('00000000-0000-4000-8000-000000001305', 'REVENUE_PLATFORM_COMMISSION', 'Platform Marketplace Commission Revenue', 'REVENUE', NULL, NULL, 'BRL', true),
  ('00000000-0000-4000-8000-000000001306', 'REVENUE_SERVICE_FEE', 'Platform Consumer Service Fee Revenue', 'REVENUE', NULL, NULL, 'BRL', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  is_test_data = true;

INSERT INTO public.ledger_journals (id, reference_type, reference_id, description, idempotency_key, posted_by, is_test_data)
VALUES (
  '00000000-0000-4000-8000-000000001351',
  'ORDER_CAPTURE',
  '00000000-0000-4000-8000-000000001001',
  'Double-entry accounting posting for Order #10001 (6232 captured + 1000 subsidy = 7232 split)',
  'seed_journal_order_1001_capture',
  '00000000-0000-4000-8000-000000000091',
  true
)
ON CONFLICT (id) DO UPDATE SET
  description = EXCLUDED.description,
  is_test_data = true;

-- Append-only Ledger Entries (Debits: 6232 + 1000 = 7232 | Credits: 4797 + 690 + 1433 + 312 = 7232)
INSERT INTO public.ledger_entries (id, journal_id, account_id, direction, amount_cents, is_test_data)
VALUES
  ('00000000-0000-4000-8000-000000001361', '00000000-0000-4000-8000-000000001351', '00000000-0000-4000-8000-000000001301', 'DEBIT', 6232, true),
  ('00000000-0000-4000-8000-000000001362', '00000000-0000-4000-8000-000000001351', '00000000-0000-4000-8000-000000001302', 'DEBIT', 1000, true),
  ('00000000-0000-4000-8000-000000001363', '00000000-0000-4000-8000-000000001351', '00000000-0000-4000-8000-000000001303', 'CREDIT', 4797, true),
  ('00000000-0000-4000-8000-000000001364', '00000000-0000-4000-8000-000000001351', '00000000-0000-4000-8000-000000001304', 'CREDIT', 690, true),
  ('00000000-0000-4000-8000-000000001365', '00000000-0000-4000-8000-000000001351', '00000000-0000-4000-8000-000000001305', 'CREDIT', 1433, true),
  ('00000000-0000-4000-8000-000000001366', '00000000-0000-4000-8000-000000001351', '00000000-0000-4000-8000-000000001306', 'CREDIT', 312, true)
ON CONFLICT (id) DO NOTHING;

-- 14. Merchant Contract & Support Case
INSERT INTO public.merchant_contracts (
  id, organization_id, version_number, platform_delivery_commission_bps, merchant_delivery_commission_bps,
  pickup_commission_bps, payout_cycle_days, legal_template_status, effective_from, approved_by, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001401',
  '00000000-0000-4000-8000-000000000101',
  1,
  2300,
  1200,
  1000,
  7,
  'PENDING_LEGAL_REVIEW',
  '2026-11-01T00:00:00Z',
  '00000000-0000-4000-8000-000000000090',
  true
)
ON CONFLICT (id) DO UPDATE SET
  legal_template_status = EXCLUDED.legal_template_status,
  is_test_data = true;

INSERT INTO public.support_cases (
  id, case_number, order_id, organization_id, store_id, requester_id, requester_role,
  assigned_staff_id, category, priority, status, subject, sla_due_at, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001501',
  5001,
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  'CUSTOMER',
  '00000000-0000-4000-8000-000000000090',
  'DELIVERY_INSTRUCTION_UPDATE',
  'LOW',
  'OPEN',
  'Added intercom note for concierge',
  '2026-11-03T16:00:00Z',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

-- 15. Append-only Audit Log Entry
INSERT INTO public.audit_logs (
  id, actor_id, actor_role, organization_id, store_id, action, target_type, target_id,
  correlation_id, reason, redacted_payload, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001601',
  '00000000-0000-4000-8000-000000000099',
  'tech_admin',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  'SEED_BOOTSTRAP_VERIFIED',
  'STORE',
  '00000000-0000-4000-8000-000000000201',
  'corr_seed_bootstrap_001',
  'Development/Test synthetic seed applied and verified',
  '{"environment":"development","isTestData":true}'::jsonb,
  true
)
ON CONFLICT (id) DO NOTHING;

-- 16. Complete Coverage of Remaining Domain & Phase E/F Tables (Zero Empty Tables Policy)
INSERT INTO public.store_hour_exceptions (
  id, store_id, exception_date, is_closed, opens_at, closes_at, reason, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001701',
  '00000000-0000-4000-8000-000000000201',
  '2027-12-25',
  true,
  NULL,
  NULL,
  'Christmas Holiday / Feriado de Natal',
  true
)
ON CONFLICT (id) DO UPDATE SET
  reason = EXCLUDED.reason,
  is_test_data = true;

INSERT INTO public.invitations (
  id, organization_id, store_id, invited_email, role, token_hash, status, invited_by, expires_at, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001702',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  'manager.invite@test.ideliveryfood.invalid',
  'partner_manager',
  'seed_token_hash_manager_001',
  'PENDING',
  '00000000-0000-4000-8000-000000000010',
  '2027-12-31T23:59:59Z',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.approval_events (
  id, target_type, target_id, organization_id, previous_status, new_status, decided_by, reason, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001703',
  'ORGANIZATION',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000101',
  'PENDING',
  'APPROVED',
  '00000000-0000-4000-8000-000000000090',
  'KYC and CNPJ verified for Paulista Artisan Burgers',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_devices (
  id, user_id, platform, push_token, device_identifier, app_version, push_consent_granted, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001704',
  '00000000-0000-4000-8000-000000000001',
  'WEB',
  'webpush_redacted_alice_001',
  'seed-web-pwa-alice-001',
  '0.1.0',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  app_version = EXCLUDED.app_version,
  is_test_data = true;

INSERT INTO public.privacy_requests (
  id, user_id, request_type, status, reason, processed_by, completed_at, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001705',
  '00000000-0000-4000-8000-000000000002',
  'EXPORT_DATA',
  'COMPLETED',
  'LGPD portability export request',
  '00000000-0000-4000-8000-000000000099',
  '2026-11-02T12:00:00Z',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.promotion_redemptions (
  id, promotion_id, order_id, customer_id, discount_applied_cents, status, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001706',
  '00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000001',
  1000,
  'REDEEMED',
  true
)
ON CONFLICT (id) DO UPDATE SET
  discount_applied_cents = EXCLUDED.discount_applied_cents,
  is_test_data = true;

INSERT INTO public.delivery_offers (
  id, delivery_task_id, courier_id, offered_fee_cents, status, pickup_store_name, distance_meters,
  dropoff_neighborhood_only, expires_at, responded_at, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001707',
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000000030',
  690,
  'ACCEPTED',
  'Paulista Artisan Burgers - Jardins',
  1420,
  'Consolação',
  '2026-11-03T15:10:00Z',
  '2026-11-03T15:02:00Z',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.courier_location_samples (
  id, courier_id, delivery_task_id, latitude, longitude, accuracy_meters, recorded_at, expires_at, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001708',
  '00000000-0000-4000-8000-000000000030',
  '00000000-0000-4000-8000-000000001201',
  -23.562100,
  -46.660200,
  8.50,
  '2026-11-03T15:05:00Z',
  '2026-12-03T15:05:00Z',
  true
)
ON CONFLICT (id) DO UPDATE SET
  accuracy_meters = EXCLUDED.accuracy_meters,
  is_test_data = true;

INSERT INTO public.delivery_events (
  id, delivery_task_id, courier_id, event_type, payload, idempotency_key, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001709',
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000000030',
  'OFFER_ACCEPTED',
  '{"offeredFeeCents":690}'::jsonb,
  'seed_delivery_evt_1201_accepted',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payment_attempts (
  id, order_id, customer_id, provider_code, payment_method, amount_cents, currency_code, status,
  external_payment_id, idempotency_key, is_sandbox, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001710',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000001',
  'stripe',
  'PIX',
  6232,
  'BRL',
  'CAPTURED',
  'pi_seed_order_1001',
  'seed_pay_attempt_1001',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.payment_provider_events (
  id, provider_code, external_event_id, payment_attempt_id, event_type, signature_verified, processed_at, redacted_payload, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001711',
  'stripe',
  'evt_seed_order_1001_captured',
  '00000000-0000-4000-8000-000000001710',
  'payment.captured',
  true,
  '2026-11-03T15:01:00Z',
  '{"orderId":"00000000-0000-4000-8000-000000001001","amountCents":6232}'::jsonb,
  true
)
ON CONFLICT (id) DO UPDATE SET
  signature_verified = EXCLUDED.signature_verified,
  is_test_data = true;

INSERT INTO public.refunds (
  id, order_id, payment_attempt_id, amount_cents, reason, requested_by, approved_by, status, idempotency_key, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001712',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000001710',
  500,
  'Missing side sauce compensation',
  '00000000-0000-4000-8000-000000000090',
  '00000000-0000-4000-8000-000000000090',
  'APPROVED',
  'seed_refund_order_1001_partial',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.settlements (
  id, organization_id, courier_id, period_start, period_end, amount_cents, status, approved_by, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001713',
  '00000000-0000-4000-8000-000000000101',
  NULL,
  '2026-11-01',
  '2026-11-07',
  4797,
  'SCHEDULED',
  '00000000-0000-4000-8000-000000000091',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.reconciliation_runs (
  id, provider_code, run_date, matched_count, discrepancy_count, discrepancy_total_cents, status, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001714',
  'stripe',
  '2026-11-03',
  1,
  0,
  0,
  'COMPLETED',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.storage_upload_intents (
  id, bucket_id, object_path, mime_type, file_size_bytes, uploaded_by, store_id, organization_id,
  signed_token_hash, expires_at, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001717',
  'store-assets',
  '00000000-0000-4000-8000-000000000201/seed-banner.webp',
  'image/webp',
  128000,
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101',
  'seed_signed_upload_hash_001',
  '2027-12-31T23:59:59Z',
  true
)
ON CONFLICT (id) DO UPDATE SET
  file_size_bytes = EXCLUDED.file_size_bytes,
  is_test_data = true;

INSERT INTO public.support_messages (
  id, case_id, sender_id, body, is_internal_note, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001718',
  '00000000-0000-4000-8000-000000001501',
  '00000000-0000-4000-8000-000000000001',
  'Please leave with building concierge at intercom #42.',
  false,
  true
)
ON CONFLICT (id) DO UPDATE SET
  body = EXCLUDED.body,
  is_test_data = true;

INSERT INTO public.support_action_requests (
  id, case_id, order_id, requested_by, action_type, amount_cents, reason, status, decided_by, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001719',
  '00000000-0000-4000-8000-000000001501',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000090',
  'PARTIAL_REFUND',
  500,
  'Courtesy adjustment for delayed condiment',
  'APPROVED',
  '00000000-0000-4000-8000-000000000091',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.commercial_leads (
  id, legal_name, trade_name, tax_id, contact_email, contact_phone, legal_basis, status, owner_staff_id, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001720',
  'Bela Vista Pizzeria Napolitana Ltda',
  'Napoli Bela Vista',
  '00000000000353',
  'contact.napoli@test.ideliveryfood.invalid',
  '+5511900000040',
  'PARTNER_INBOUND_APPLICATION',
  'QUALIFYING',
  '00000000-0000-4000-8000-000000000090',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.order_reviews (
  id, order_id, store_id, customer_id, rating, comment, partner_reply, partner_replied_at, moderation_status, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001721',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  5,
  'Crisp smash burger crust and fast delivery!',
  'Thank you for ordering with Paulista Artisan Burgers!',
  '2026-11-03T17:00:00Z',
  'PUBLISHED',
  true
)
ON CONFLICT (id) DO UPDATE SET
  rating = EXCLUDED.rating,
  is_test_data = true;

INSERT INTO public.outbox_events (
  id, aggregate_type, aggregate_id, event_type, idempotency_key, payload, status, attempts, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001722',
  'ORDER',
  '00000000-0000-4000-8000-000000001001',
  'ORDER_PREPARING',
  'seed_outbox_order_1001_preparing',
  '{"orderId":"00000000-0000-4000-8000-000000001001"}'::jsonb,
  'PUBLISHED',
  1,
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.notification_deliveries (
  id, outbox_event_id, recipient_user_id, channel, template_key, locale, status, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001723',
  '00000000-0000-4000-8000-000000001722',
  '00000000-0000-4000-8000-000000000001',
  'IN_APP',
  'order.status.preparing',
  'en',
  'DELIVERED',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_test_data = true;

INSERT INTO public.risk_decisions (
  id, subject_type, subject_id, rule_code, decision, human_reviewer_id, justification, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001724',
  'ORDER',
  '00000000-0000-4000-8000-000000001001',
  'VELOCITY_CHECK_NORMAL',
  'ALLOW',
  '00000000-0000-4000-8000-000000000090',
  'Order velocity and address match verified customer history',
  true
)
ON CONFLICT (id) DO UPDATE SET
  decision = EXCLUDED.decision,
  is_test_data = true;

-- Fase N (M17): Internal support notes, escalated case, pending finance action request, and support_attachments
INSERT INTO public.support_messages (
  id, case_id, sender_id, body, is_internal_note, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001725',
  '00000000-0000-4000-8000-000000001501',
  '00000000-0000-4000-8000-000000000090',
  'INTERNAL L1 NOTE: Verified GPS trace and store prep timestamp; eligible for courtesy R$ 5,00 refund.',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  body = EXCLUDED.body,
  is_internal_note = EXCLUDED.is_internal_note,
  is_test_data = true;

INSERT INTO public.support_cases (
  id, case_number, order_id, delivery_task_id, organization_id, store_id, requester_id, requester_role,
  assigned_staff_id, category, priority, status, subject, sla_due_at, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001502',
  5002,
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  'CUSTOMER',
  '00000000-0000-4000-8000-000000000090',
  'MISSING_ITEM',
  'HIGH',
  'ESCALATED_FINANCE',
  'Missing double smash patty on order #1001',
  '2026-11-15T18:00:00Z',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  priority = EXCLUDED.priority,
  is_test_data = true;

INSERT INTO public.support_action_requests (
  id, case_id, order_id, requested_by, action_type, amount_cents, reason, status, decided_by, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001726',
  '00000000-0000-4000-8000-000000001502',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000090',
  'PARTIAL_REFUND',
  3500,
  'Refund exceeds L1 auto-approval limit (R$ 15,00); escalated to finance officer.',
  'PENDING_FINANCE',
  NULL,
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  amount_cents = EXCLUDED.amount_cents,
  is_test_data = true;

INSERT INTO public.support_attachments (
  id, case_id, message_id, uploaded_by, storage_bucket, object_path, mime_type, byte_size, sha256_hex, is_internal_only, is_test_data
) VALUES
(
  '00000000-0000-4000-8000-000000001727',
  '00000000-0000-4000-8000-000000001501',
  '00000000-0000-4000-8000-000000001718',
  '00000000-0000-4000-8000-000000000001',
  'support-attachments',
  'cases/00000000-0000-4000-8000-000000001501/intercom-photo.jpg',
  'image/jpeg',
  184320,
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  false,
  true
),
(
  '00000000-0000-4000-8000-000000001728',
  '00000000-0000-4000-8000-000000001501',
  '00000000-0000-4000-8000-000000001725',
  '00000000-0000-4000-8000-000000000090',
  'support-attachments',
  'cases/00000000-0000-4000-8000-000000001501/internal-telemetry-audit.pdf',
  'application/pdf',
  92160,
  'a1b2c3d4e5f60123456789abcdef0123456789abcdef0123456789abcdef0123',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  object_path = EXCLUDED.object_path,
  is_internal_only = EXCLUDED.is_internal_only,
  is_test_data = true;

-- Fase O (M18): Commercial Proposals & Versioned Commission Rules
INSERT INTO public.commercial_proposals (
  id, lead_id, organization_id, proposal_version,
  platform_delivery_commission_bps, merchant_delivery_commission_bps, pickup_commission_bps,
  service_fee_bps, payout_cycle_days, legal_template_status, status,
  proposed_by_staff_id, valid_until, notes, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001729',
  '00000000-0000-4000-8000-000000001720',
  NULL,
  1,
  2100,
  1100,
  900,
  500,
  7,
  'PENDING_LEGAL_REVIEW',
  'SENT',
  '00000000-0000-4000-8000-000000000090',
  '2027-03-31T23:59:59Z',
  'Introductory commercial proposal for Napoli Bela Vista (21% platform delivery, 11% merchant delivery, 9% pickup).',
  true
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  platform_delivery_commission_bps = EXCLUDED.platform_delivery_commission_bps,
  is_test_data = true;

INSERT INTO public.commission_rule_versions (
  id, organization_id, contract_id, version_number,
  platform_delivery_commission_bps, merchant_delivery_commission_bps, pickup_commission_bps,
  service_fee_bps, effective_from, effective_until, created_by_staff_id, is_test_data
) VALUES (
  '00000000-0000-4000-8000-000000001730',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000001401',
  1,
  2300,
  1200,
  1000,
  500,
  '2026-11-01T00:00:00Z',
  NULL,
  '00000000-0000-4000-8000-000000000090',
  true
)
ON CONFLICT (id) DO UPDATE SET
  platform_delivery_commission_bps = EXCLUDED.platform_delivery_commission_bps,
  is_test_data = true;

COMMIT;
