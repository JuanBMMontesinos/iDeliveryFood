-- M02 Migration 2: Catalog, Addresses, Couriers, Quotes, Orders, Logistics, Finance/Ledger, Support, Commercial & Outbox

-- 16. Catalog Categories
CREATE TABLE IF NOT EXISTS public.catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name_en text NOT NULL,
  name_pt_br text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_catalog_categories_store_id ON public.catalog_categories(store_id, sort_order);

-- 17. Catalog Products
CREATE TABLE IF NOT EXISTS public.catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.catalog_categories(id) ON DELETE CASCADE,
  sku text,
  name_en text NOT NULL,
  name_pt_br text NOT NULL,
  description_en text NOT NULL DEFAULT '',
  description_pt_br text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  image_path text,
  is_available boolean NOT NULL DEFAULT true,
  is_paused boolean NOT NULL DEFAULT false,
  max_per_order integer NOT NULL DEFAULT 20 CHECK (max_per_order > 0),
  unit_of_measure text NOT NULL DEFAULT 'UNIT' CHECK (unit_of_measure IN ('UNIT', 'GRAM', 'KG')),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_catalog_products_store_id ON public.catalog_products(store_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_category_id ON public.catalog_products(category_id);

-- 18. Catalog Option Groups & Options (Add-ons / Modifiers)
CREATE TABLE IF NOT EXISTS public.catalog_option_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name_en text NOT NULL,
  name_pt_br text NOT NULL,
  min_selections integer NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections integer NOT NULL DEFAULT 1 CHECK (max_selections >= 1 AND max_selections >= min_selections),
  sort_order integer NOT NULL DEFAULT 0,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_catalog_option_groups_product_id ON public.catalog_option_groups(product_id);
CREATE INDEX IF NOT EXISTS idx_catalog_option_groups_store_id ON public.catalog_option_groups(store_id);

CREATE TABLE IF NOT EXISTS public.catalog_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_group_id uuid NOT NULL REFERENCES public.catalog_option_groups(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name_en text NOT NULL,
  name_pt_br text NOT NULL,
  additional_price_cents integer NOT NULL DEFAULT 0 CHECK (additional_price_cents >= 0),
  is_available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_catalog_options_group_id ON public.catalog_options(option_group_id);
CREATE INDEX IF NOT EXISTS idx_catalog_options_store_id ON public.catalog_options(store_id);

-- 19. Customer Addresses
CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label text NOT NULL,
  recipient_name text NOT NULL,
  street_line text NOT NULL,
  number text NOT NULL,
  complement text,
  neighborhood text NOT NULL,
  city text NOT NULL,
  state_code text NOT NULL CHECK (char_length(state_code) = 2),
  postal_code text NOT NULL,
  country_code text NOT NULL DEFAULT 'BR' CHECK (country_code = 'BR'),
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  delivery_instructions text,
  is_default boolean NOT NULL DEFAULT false,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_user_id ON public.customer_addresses(user_id);

-- 20. Couriers, Vehicles & Availability
CREATE TABLE IF NOT EXISTS public.couriers (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  approval_status public.approval_status NOT NULL DEFAULT 'PENDING',
  document_number_hash text NOT NULL UNIQUE,
  active_region_code text NOT NULL DEFAULT 'SP-CAPITAL',
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('BIKE', 'MOTORCYCLE', 'CAR')),
  is_online boolean NOT NULL DEFAULT false,
  last_online_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_couriers_approval_online ON public.couriers(approval_status, is_online);

CREATE TABLE IF NOT EXISTS public.courier_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('BIKE', 'MOTORCYCLE', 'CAR')),
  plate_code text,
  model_description text NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_courier_vehicles_courier_id ON public.courier_vehicles(courier_id);

-- 21. Promotions & Redemptions (M19 Foundation)
CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  funded_by text NOT NULL CHECK (funded_by IN ('PLATFORM', 'STORE')),
  discount_type text NOT NULL CHECK (discount_type IN ('FIXED_CENTS', 'PERCENTAGE_BPS')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  max_discount_cents integer NOT NULL CHECK (max_discount_cents > 0),
  min_order_cents integer NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  budget_limit_cents integer NOT NULL CHECK (budget_limit_cents > 0),
  budget_consumed_cents integer NOT NULL DEFAULT 0 CHECK (budget_consumed_cents >= 0 AND budget_consumed_cents <= budget_limit_cents),
  max_uses_per_user integer NOT NULL DEFAULT 1 CHECK (max_uses_per_user > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_promo_dates CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_promotions_store_id ON public.promotions(store_id);

-- 22. Server-Side Quotes (M04 / M10)
CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  address_id uuid REFERENCES public.customer_addresses(id) ON DELETE SET NULL,
  fulfillment_modality public.fulfillment_modality NOT NULL,
  promotion_id uuid REFERENCES public.promotions(id) ON DELETE SET NULL,
  currency_code text NOT NULL DEFAULT 'BRL' CHECK (currency_code = 'BRL'),
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  addons_cents integer NOT NULL DEFAULT 0 CHECK (addons_cents >= 0),
  service_fee_cents integer NOT NULL DEFAULT 0 CHECK (service_fee_cents >= 0),
  delivery_fee_cents integer NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  distance_meters integer NOT NULL DEFAULT 0 CHECK (distance_meters >= 0),
  estimated_prep_minutes integer NOT NULL CHECK (estimated_prep_minutes > 0),
  estimated_delivery_minutes integer NOT NULL CHECK (estimated_delivery_minutes >= 0),
  items_snapshot jsonb NOT NULL,
  address_snapshot jsonb,
  idempotency_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_quote_total_formula CHECK (
    total_cents = GREATEST(0, subtotal_cents + addons_cents + service_fee_cents + delivery_fee_cents - discount_cents)
  ),
  UNIQUE(customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_quotes_customer_id ON public.quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_store_id ON public.quotes(store_id);

-- 23. Orders, Items, Item Options & Append-Only Order Events (M10)
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL UNIQUE REFERENCES public.quotes(id) ON DELETE RESTRICT,
  fulfillment_modality public.fulfillment_modality NOT NULL,
  order_status public.order_status NOT NULL DEFAULT 'CREATED',
  payment_status public.payment_status NOT NULL DEFAULT 'PENDING',
  delivery_status public.delivery_status NOT NULL DEFAULT 'PENDING_DISPATCH',
  currency_code text NOT NULL DEFAULT 'BRL' CHECK (currency_code = 'BRL'),
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  addons_cents integer NOT NULL DEFAULT 0 CHECK (addons_cents >= 0),
  service_fee_cents integer NOT NULL DEFAULT 0 CHECK (service_fee_cents >= 0),
  delivery_fee_cents integer NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  platform_commission_cents integer NOT NULL DEFAULT 0 CHECK (platform_commission_cents >= 0),
  merchant_net_cents integer NOT NULL DEFAULT 0 CHECK (merchant_net_cents >= 0),
  courier_earnings_cents integer NOT NULL DEFAULT 0 CHECK (courier_earnings_cents >= 0),
  delivery_address_snapshot jsonb,
  customer_notes text,
  cancellation_reason text,
  cancelled_by_role text,
  delivery_confirmation_code_hash text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  idempotency_key text NOT NULL,
  accepted_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_store_status ON public.orders(store_id, order_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_org_id ON public.orders(organization_id, created_at DESC);

CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION app_security.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
  product_name_snapshot_en text NOT NULL,
  product_name_snapshot_pt_br text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  addons_unit_price_cents integer NOT NULL DEFAULT 0 CHECK (addons_unit_price_cents >= 0),
  total_line_cents integer NOT NULL CHECK (total_line_cents = quantity * (unit_price_cents + addons_unit_price_cents)),
  notes text,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items(product_id);

CREATE TABLE IF NOT EXISTS public.order_item_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.catalog_options(id) ON DELETE RESTRICT,
  option_name_snapshot_en text NOT NULL,
  option_name_snapshot_pt_br text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  additional_price_cents integer NOT NULL CHECK (additional_price_cents >= 0),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_order_item_options_item_id ON public.order_item_options(order_item_id);

CREATE TABLE IF NOT EXISTS public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  event_type text NOT NULL,
  previous_order_status public.order_status,
  new_order_status public.order_status NOT NULL,
  previous_payment_status public.payment_status,
  new_payment_status public.payment_status,
  previous_delivery_status public.delivery_status,
  new_delivery_status public.delivery_status,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(order_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON public.order_events(order_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.promotions(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  discount_applied_cents integer NOT NULL CHECK (discount_applied_cents > 0),
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'REDEEMED', 'REVERSED')),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo_user ON public.promotion_redemptions(promotion_id, customer_id);

-- 24. Logistics & Deliveries (M14 / M11)
CREATE TABLE IF NOT EXISTS public.delivery_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  status public.delivery_status NOT NULL DEFAULT 'PENDING_DISPATCH',
  pickup_latitude numeric(9,6) NOT NULL,
  pickup_longitude numeric(9,6) NOT NULL,
  dropoff_latitude numeric(9,6) NOT NULL,
  dropoff_longitude numeric(9,6) NOT NULL,
  courier_fee_cents integer NOT NULL CHECK (courier_fee_cents >= 0),
  distance_meters integer NOT NULL CHECK (distance_meters >= 0),
  active_courier_id uuid REFERENCES public.couriers(id) ON DELETE SET NULL,
  picked_up_at timestamptz,
  completed_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_delivery_tasks_status ON public.delivery_tasks(status);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_courier_id ON public.delivery_tasks(active_courier_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_store_id ON public.delivery_tasks(store_id);

CREATE TABLE IF NOT EXISTS public.delivery_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_task_id uuid NOT NULL REFERENCES public.delivery_tasks(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  offered_fee_cents integer NOT NULL CHECK (offered_fee_cents >= 0),
  status text NOT NULL DEFAULT 'OFFERED' CHECK (status IN ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_delivery_offers_courier_status ON public.delivery_offers(courier_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_offers_task_id ON public.delivery_offers(delivery_task_id);

CREATE TABLE IF NOT EXISTS public.delivery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_task_id uuid NOT NULL REFERENCES public.delivery_tasks(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES public.couriers(id) ON DELETE RESTRICT,
  offer_id uuid REFERENCES public.delivery_offers(id) ON DELETE SET NULL,
  assigned_by_actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'UNASSIGNED_WITH_REASON')),
  unassign_reason text,
  assigned_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  ended_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false
);

-- Guarantee at most ONE active assignment per delivery_task
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_assignments_one_active
ON public.delivery_assignments(delivery_task_id)
WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_courier_id ON public.delivery_assignments(courier_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.courier_location_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  delivery_task_id uuid REFERENCES public.delivery_tasks(id) ON DELETE SET NULL,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters numeric(7,2) NOT NULL CHECK (accuracy_meters >= 0),
  recorded_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_courier_location_task ON public.courier_location_samples(delivery_task_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_courier_location_courier ON public.courier_location_samples(courier_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_task_id uuid NOT NULL REFERENCES public.delivery_tasks(id) ON DELETE CASCADE,
  courier_id uuid REFERENCES public.couriers(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(delivery_task_id, idempotency_key)
);

-- 25. Payments, Provider Events & Refunds (M12)
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider_code text NOT NULL REFERENCES public.provider_configurations(provider_code),
  payment_method text NOT NULL CHECK (payment_method IN ('PIX', 'CREDIT_CARD', 'DEBIT_CARD')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency_code text NOT NULL DEFAULT 'BRL' CHECK (currency_code = 'BRL'),
  status public.payment_status NOT NULL DEFAULT 'PENDING',
  external_payment_id text,
  idempotency_key text NOT NULL UNIQUE,
  is_sandbox boolean NOT NULL DEFAULT true,
  error_code text,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id ON public.payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_customer_id ON public.payment_attempts(customer_id);

CREATE TABLE IF NOT EXISTS public.payment_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL REFERENCES public.provider_configurations(provider_code),
  external_event_id text NOT NULL,
  payment_attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  redacted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(provider_code, external_event_id)
);

CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_attempt_id uuid NOT NULL REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'PROCESSED', 'FAILED', 'REJECTED')),
  external_refund_id text,
  idempotency_key text NOT NULL UNIQUE,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON public.refunds(order_id);

-- 26. Double-Entry Financial Ledger & Reconciliation (M13)
CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  account_type public.ledger_account_type NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  courier_id uuid REFERENCES public.couriers(id) ON DELETE RESTRICT,
  currency_code text NOT NULL DEFAULT 'BRL' CHECK (currency_code = 'BRL'),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_org_id ON public.ledger_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_courier_id ON public.ledger_accounts(courier_id);

CREATE TABLE IF NOT EXISTS public.ledger_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type text NOT NULL CHECK (reference_type IN ('ORDER_CAPTURE', 'ORDER_REFUND', 'MERCHANT_SETTLEMENT', 'COURIER_PAYOUT', 'PROMO_SUBSIDY', 'REVERSAL')),
  reference_id uuid NOT NULL,
  description text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  posted_by uuid REFERENCES public.profiles(id),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_ledger_journals_ref ON public.ledger_journals(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  direction public.ledger_entry_direction NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal_id ON public.ledger_entries(journal_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_id ON public.ledger_entries(account_id);

CREATE TABLE IF NOT EXISTS public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  courier_id uuid REFERENCES public.couriers(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'APPROVED', 'PAID_CONFIRMED', 'BLOCKED_NO_PSP')),
  approved_by uuid REFERENCES public.profiles(id),
  external_payout_reference text,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_settlement_beneficiary CHECK (
    (organization_id IS NOT NULL AND courier_id IS NULL) OR
    (organization_id IS NULL AND courier_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_settlements_org_id ON public.settlements(organization_id);
CREATE INDEX IF NOT EXISTS idx_settlements_courier_id ON public.settlements(courier_id);

CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL REFERENCES public.provider_configurations(provider_code),
  run_date date NOT NULL,
  matched_count integer NOT NULL DEFAULT 0,
  discrepancy_count integer NOT NULL DEFAULT 0,
  discrepancy_total_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- 27. Support Cases, Messages, Attachments & Action Requests (M17)
CREATE TABLE IF NOT EXISTS public.support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requester_role text NOT NULL CHECK (requester_role IN ('CUSTOMER', 'PARTNER', 'COURIER')),
  assigned_staff_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  category text NOT NULL,
  priority public.support_priority NOT NULL DEFAULT 'MEDIUM',
  status public.support_case_status NOT NULL DEFAULT 'OPEN',
  subject text NOT NULL,
  sla_due_at timestamptz NOT NULL,
  resolved_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_support_cases_requester ON public.support_cases(requester_id);
CREATE INDEX IF NOT EXISTS idx_support_cases_org ON public.support_cases(organization_id);
CREATE INDEX IF NOT EXISTS idx_support_cases_status ON public.support_cases(status, priority);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(trim(body)) >= 1),
  is_internal_note boolean NOT NULL DEFAULT false,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_support_messages_case_id ON public.support_messages(case_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.support_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  action_type text NOT NULL CHECK (action_type IN ('PARTIAL_REFUND', 'FULL_REFUND', 'COURIER_COMPENSATION')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_FINANCE' CHECK (status IN ('PENDING_FINANCE', 'APPROVED', 'REJECTED')),
  decided_by uuid REFERENCES public.profiles(id),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- 28. Commercial Leads, Contracts & Commission Rules (M18)
CREATE TABLE IF NOT EXISTS public.commercial_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text NOT NULL,
  tax_id text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  legal_basis text NOT NULL DEFAULT 'PARTNER_INBOUND_APPLICATION',
  status text NOT NULL DEFAULT 'QUALIFYING' CHECK (status IN ('QUALIFYING', 'PROPOSAL_SENT', 'CONVERTED', 'ARCHIVED')),
  owner_staff_id uuid REFERENCES public.profiles(id),
  converted_organization_id uuid REFERENCES public.organizations(id),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.merchant_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  version_number integer NOT NULL DEFAULT 1,
  platform_delivery_commission_bps integer NOT NULL CHECK (platform_delivery_commission_bps BETWEEN 0 AND 5000),
  merchant_delivery_commission_bps integer NOT NULL CHECK (merchant_delivery_commission_bps BETWEEN 0 AND 5000),
  pickup_commission_bps integer NOT NULL CHECK (pickup_commission_bps BETWEEN 0 AND 5000),
  payout_cycle_days integer NOT NULL DEFAULT 7 CHECK (payout_cycle_days IN (1, 7, 14, 30)),
  legal_template_status text NOT NULL DEFAULT 'PENDING_LEGAL_REVIEW' CHECK (legal_template_status IN ('PENDING_LEGAL_REVIEW', 'APPROVED_TEMPLATE')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_merchant_contracts_org_id ON public.merchant_contracts(organization_id);

-- 29. Order Reviews (M19)
CREATE TABLE IF NOT EXISTS public.order_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  partner_reply text,
  partner_replied_at timestamptz,
  moderation_status text NOT NULL DEFAULT 'PUBLISHED' CHECK (moderation_status IN ('PUBLISHED', 'HIDDEN_BY_MODERATION')),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_order_reviews_store_id ON public.order_reviews(store_id);

-- 30. Transactional Outbox & Notification Deliveries (M20)
CREATE TABLE IF NOT EXISTS public.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_error text,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON public.outbox_events(status, next_attempt_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id uuid REFERENCES public.outbox_events(id) ON DELETE SET NULL,
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'PUSH_ANDROID', 'PUSH_IOS', 'EMAIL')),
  template_key text NOT NULL,
  locale public.locale_code NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT_TO_PROVIDER', 'DELIVERED', 'BLOCKED_MISSING_CREDENTIALS', 'FAILED')),
  provider_code text REFERENCES public.provider_configurations(provider_code),
  read_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON public.notification_deliveries(recipient_user_id, created_at DESC);

-- 31. Risk Decisions (M21)
CREATE TABLE IF NOT EXISTS public.risk_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('USER', 'ORGANIZATION', 'STORE', 'COURIER', 'ORDER')),
  subject_id uuid NOT NULL,
  rule_code text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ALLOW', 'FLAG_FOR_HUMAN_REVIEW', 'SUSPEND_CONFIRMED')),
  human_reviewer_id uuid REFERENCES public.profiles(id),
  justification text NOT NULL,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Immutability Guard for Append-Only Tables (order_events, ledger_entries, audit_logs)
CREATE OR REPLACE FUNCTION app_security.prevent_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only and cannot be updated or deleted.', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_order_events_immutable
BEFORE UPDATE OR DELETE ON public.order_events
FOR EACH ROW EXECUTE FUNCTION app_security.prevent_append_only_mutation();

CREATE TRIGGER trg_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION app_security.prevent_append_only_mutation();

CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION app_security.prevent_append_only_mutation();

-- Constraint Trigger to Verify Double-Entry Ledger Balance at Transaction Commit
CREATE OR REPLACE FUNCTION app_security.verify_journal_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_debits bigint;
  v_credits bigint;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0)
  INTO v_debits, v_credits
  FROM public.ledger_entries
  WHERE journal_id = NEW.journal_id;

  IF v_debits = 0 OR v_debits <> v_credits THEN
    RAISE EXCEPTION 'Unbalanced ledger journal %: debits (%) != credits (%)', NEW.journal_id, v_debits, v_credits
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_verify_journal_balanced
AFTER INSERT ON public.ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_security.verify_journal_balanced();
