-- M02 Migration 1: Core Foundation, Schemas, Enums, IAM, Organizations, Stores & Platform Governance
CREATE SCHEMA IF NOT EXISTS app_security;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.locale_code AS ENUM ('en', 'pt-BR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.account_status AS ENUM ('ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'DEACTIVATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.org_status AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_role AS ENUM ('partner_owner', 'partner_manager', 'partner_operator', 'partner_finance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.staff_role AS ENUM (
    'operations',
    'logistics',
    'support',
    'finance',
    'commercial',
    'marketing',
    'risk_compliance',
    'auditor_privacy',
    'tech_admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invitation_status AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_target_type AS ENUM ('ORGANIZATION', 'STORE', 'COURIER', 'BANK_ACCOUNT', 'COMMERCIAL_RULE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_INFO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.fulfillment_modality AS ENUM ('PLATFORM_DELIVERY', 'MERCHANT_DELIVERY', 'PICKUP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.store_status AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.order_status AS ENUM (
    'CREATED',
    'AWAITING_PAYMENT',
    'PENDING_ACCEPTANCE',
    'ACCEPTED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'IN_TRANSIT',
    'DELIVERED',
    'CANCELLED',
    'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM (
    'PENDING',
    'REQUIRES_ACTION',
    'AUTHORIZED',
    'CAPTURED',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'FAILED',
    'CANCELLED',
    'LATE_CAPTURE_CONFLICT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.delivery_status AS ENUM (
    'NOT_APPLICABLE',
    'PENDING_DISPATCH',
    'OFFERED',
    'ASSIGNED',
    'AT_STORE',
    'PICKED_UP',
    'AT_CUSTOMER',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ledger_account_type AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ledger_entry_direction AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_case_status AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_ACTION_APPROVAL', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL_IN_ROUTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.privacy_request_type AS ENUM ('EXPORT_DATA', 'DELETE_ACCOUNT', 'CORRECTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.privacy_request_status AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'BLOCKED_LEGAL_RETENTION', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.provider_category AS ENUM ('PSP', 'MAPS', 'EMAIL', 'PUSH_ANDROID', 'PUSH_IOS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.provider_status AS ENUM ('BLOCKED_MISSING_CREDENTIALS', 'SANDBOX_READY', 'ACTIVE_PRODUCTION', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION app_security.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

-- 1. Profiles (1:1 with auth.users, zero trust on user_metadata for roles)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  phone text,
  preferred_locale public.locale_code NOT NULL DEFAULT 'en',
  status public.account_status NOT NULL DEFAULT 'ACTIVE',
  mfa_enforced boolean NOT NULL DEFAULT false,
  last_session_revoked_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION app_security.touch_updated_at();

-- 2. User Preferences
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  locale public.locale_code NOT NULL DEFAULT 'en',
  push_order_updates boolean NOT NULL DEFAULT true,
  push_promotions boolean NOT NULL DEFAULT false,
  email_transactional boolean NOT NULL DEFAULT true,
  email_marketing boolean NOT NULL DEFAULT false,
  marketing_consent_updated_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER trg_user_preferences_updated_at
BEFORE UPDATE ON public.user_preferences
FOR EACH ROW EXECUTE FUNCTION app_security.touch_updated_at();

-- 3. Organizations (Multi-tenant merchant legal entities / chains)
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  legal_name text NOT NULL,
  trade_name text NOT NULL,
  tax_id text NOT NULL UNIQUE CHECK (char_length(trim(tax_id)) >= 11),
  status public.org_status NOT NULL DEFAULT 'PENDING_REVIEW',
  is_multi_unit_enabled boolean NOT NULL DEFAULT false,
  feature_grocery_picking_enabled boolean NOT NULL DEFAULT false,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_organizations_status ON public.organizations(status);

CREATE TRIGGER trg_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION app_security.touch_updated_at();

-- 4. Stores (Units belonging to an Organization)
CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name text NOT NULL,
  description_en text NOT NULL DEFAULT '',
  description_pt_br text NOT NULL DEFAULT '',
  cuisine_category text NOT NULL,
  status public.store_status NOT NULL DEFAULT 'DRAFT',
  is_published boolean NOT NULL DEFAULT false,
  is_paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  address_line text NOT NULL,
  city text NOT NULL,
  state_code text NOT NULL CHECK (char_length(state_code) = 2),
  postal_code text NOT NULL,
  country_code text NOT NULL DEFAULT 'BR' CHECK (country_code = 'BR'),
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  min_order_cents integer NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  prep_time_min_minutes integer NOT NULL DEFAULT 25 CHECK (prep_time_min_minutes > 0),
  prep_time_max_minutes integer NOT NULL DEFAULT 45 CHECK (prep_time_max_minutes >= prep_time_min_minutes),
  supported_modalities public.fulfillment_modality[] NOT NULL DEFAULT ARRAY['PLATFORM_DELIVERY'::public.fulfillment_modality, 'PICKUP'::public.fulfillment_modality],
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_published_requires_active CHECK (NOT is_published OR status = 'ACTIVE')
);

CREATE INDEX IF NOT EXISTS idx_stores_organization_id ON public.stores(organization_id);
CREATE INDEX IF NOT EXISTS idx_stores_status_published ON public.stores(status, is_published);
CREATE INDEX IF NOT EXISTS idx_stores_geo ON public.stores(latitude, longitude);

CREATE TRIGGER trg_stores_updated_at
BEFORE UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION app_security.touch_updated_at();

-- 5. Store Operating Hours & Exceptions
CREATE TABLE IF NOT EXISTS public.store_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  is_overnight boolean NOT NULL DEFAULT false,
  is_closed boolean NOT NULL DEFAULT false,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(store_id, day_of_week, opens_at)
);

CREATE INDEX IF NOT EXISTS idx_store_hours_store_id ON public.store_hours(store_id);

CREATE TABLE IF NOT EXISTS public.store_hour_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  is_closed boolean NOT NULL DEFAULT true,
  opens_at time,
  closes_at time,
  reason text NOT NULL,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(store_id, exception_date)
);

CREATE INDEX IF NOT EXISTS idx_store_hour_exceptions_store_date ON public.store_hour_exceptions(store_id, exception_date);

-- 6. Store Service Areas & Delivery Fee Policies
CREATE TABLE IF NOT EXISTS public.store_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  radius_meters integer NOT NULL CHECK (radius_meters BETWEEN 500 AND 50000),
  base_fee_cents integer NOT NULL CHECK (base_fee_cents >= 0),
  per_km_fee_cents integer NOT NULL DEFAULT 0 CHECK (per_km_fee_cents >= 0),
  free_delivery_min_order_cents integer CHECK (free_delivery_min_order_cents IS NULL OR free_delivery_min_order_cents >= 0),
  estimated_delivery_minutes integer NOT NULL CHECK (estimated_delivery_minutes BETWEEN 5 AND 240),
  is_active boolean NOT NULL DEFAULT true,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_store_service_areas_store_id ON public.store_service_areas(store_id);

-- 7. Organization Members (Tenant-Scoped Partner RBAC)
CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.partner_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES public.profiles(id),
  revoked_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE NULLS NOT DISTINCT (organization_id, store_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON public.organization_members(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON public.organization_members(organization_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_org_members_store_id ON public.organization_members(store_id) WHERE is_active = true;

-- 8. Staff Scopes (Internal Platform Backoffice RBAC - requires MFA aal2 for sensitive actions)
CREATE TABLE IF NOT EXISTS public.staff_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.staff_role NOT NULL,
  region_code text,
  max_refund_approval_cents integer NOT NULL DEFAULT 0 CHECK (max_refund_approval_cents >= 0),
  requires_mfa boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES public.profiles(id),
  revoked_at timestamptz,
  justification text NOT NULL,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE NULLS NOT DISTINCT (user_id, role, region_code)
);

CREATE INDEX IF NOT EXISTS idx_staff_scopes_user_id ON public.staff_scopes(user_id) WHERE is_active = true;

-- 9. Team Invitations (Audited & Expiring)
CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role public.partner_role NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status public.invitation_status NOT NULL DEFAULT 'PENDING',
  invited_by uuid NOT NULL REFERENCES public.profiles(id),
  accepted_by uuid REFERENCES public.profiles(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_invitation_expiry CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_invitations_org_id ON public.invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(invited_email);

-- 10. Approval Events (Onboarding & Compliance Workflow)
CREATE TABLE IF NOT EXISTS public.approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type public.approval_target_type NOT NULL,
  target_id uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  previous_status public.approval_status,
  new_status public.approval_status NOT NULL,
  decided_by uuid REFERENCES public.profiles(id),
  reason text NOT NULL,
  evidence_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_approval_events_target ON public.approval_events(target_type, target_id);

-- 11. User Devices (Mobile/Web Push & Session Tracking)
CREATE TABLE IF NOT EXISTS public.user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ANDROID', 'IOS', 'WEB')),
  device_identifier text NOT NULL,
  push_token text,
  push_consent_granted boolean NOT NULL DEFAULT false,
  app_version text,
  is_revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(user_id, platform, device_identifier)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices(user_id) WHERE is_revoked = false;

-- 12. Privacy Requests (LGPD Export/Deletion with Legal Retention Check)
CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  request_type public.privacy_request_type NOT NULL,
  status public.privacy_request_status NOT NULL DEFAULT 'REQUESTED',
  reason text,
  retention_block_reason text,
  processed_by uuid REFERENCES public.profiles(id),
  completed_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_user_id ON public.privacy_requests(user_id);

-- 13. Audit Logs (Append-Only Immutable Security Trail)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  correlation_id text NOT NULL,
  reason text,
  redacted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON public.audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- 14. Platform Policies (Database-Backed Commercial & Operational Rules)
CREATE TABLE IF NOT EXISTS public.platform_policies (
  policy_key text PRIMARY KEY,
  description text NOT NULL,
  currency_code text NOT NULL DEFAULT 'BRL' CHECK (currency_code = 'BRL'),
  operational_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  platform_delivery_commission_bps integer NOT NULL DEFAULT 2300 CHECK (platform_delivery_commission_bps BETWEEN 0 AND 5000),
  merchant_delivery_commission_bps integer NOT NULL DEFAULT 1200 CHECK (merchant_delivery_commission_bps BETWEEN 0 AND 5000),
  pickup_commission_bps integer NOT NULL DEFAULT 1000 CHECK (pickup_commission_bps BETWEEN 0 AND 5000),
  service_fee_bps integer NOT NULL DEFAULT 500 CHECK (service_fee_bps BETWEEN 0 AND 2000),
  service_fee_cap_cents integer NOT NULL DEFAULT 499 CHECK (service_fee_cap_cents >= 0),
  quote_ttl_seconds integer NOT NULL DEFAULT 900 CHECK (quote_ttl_seconds BETWEEN 60 AND 3600),
  free_cancel_window_seconds integer NOT NULL DEFAULT 120 CHECK (free_cancel_window_seconds >= 0),
  feature_fleet_operators_enabled boolean NOT NULL DEFAULT false,
  feature_grocery_picking_enabled boolean NOT NULL DEFAULT false,
  feature_sponsored_ads_enabled boolean NOT NULL DEFAULT false,
  feature_subscriptions_enabled boolean NOT NULL DEFAULT false,
  is_test_data boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- 15. Provider Configurations (Pre-Configured External Adapters Registry)
CREATE TABLE IF NOT EXISTS public.provider_configurations (
  provider_code text PRIMARY KEY,
  category public.provider_category NOT NULL,
  display_name text NOT NULL,
  status public.provider_status NOT NULL DEFAULT 'BLOCKED_MISSING_CREDENTIALS',
  is_primary boolean NOT NULL DEFAULT false,
  required_env_vars text[] NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  webhook_tolerance_seconds integer NOT NULL DEFAULT 300,
  is_test_data boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
