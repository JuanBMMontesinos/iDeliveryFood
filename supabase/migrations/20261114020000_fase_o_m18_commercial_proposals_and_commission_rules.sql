-- ============================================================================
-- Fase O (M18): Commercial Leads Lifecycle, Proposals, Versioned Contracts & Commission Rules
-- ============================================================================

BEGIN;

-- 1. Expand commercial_leads status constraint & metadata columns
ALTER TABLE public.commercial_leads
  DROP CONSTRAINT IF EXISTS commercial_leads_status_check;

ALTER TABLE public.commercial_leads
  ADD CONSTRAINT commercial_leads_status_check
  CHECK (status IN ('NEW', 'QUALIFYING', 'PROPOSAL_SENT', 'NEGOTIATION', 'CONVERTED', 'LOST', 'ARCHIVED'));

ALTER TABLE public.commercial_leads
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT 'São Paulo',
  ADD COLUMN IF NOT EXISTS state_code text NOT NULL DEFAULT 'SP',
  ADD COLUMN IF NOT EXISTS cuisine_category text NOT NULL DEFAULT 'RESTAURANT',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT timezone('utc', now());

-- 2. Expand merchant_contracts with service_fee_bps and partner_owner acceptance tracking
ALTER TABLE public.merchant_contracts
  ADD COLUMN IF NOT EXISTS service_fee_bps integer NOT NULL DEFAULT 500 CHECK (service_fee_bps BETWEEN 0 AND 2000),
  ADD COLUMN IF NOT EXISTS accepted_by_partner_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- 3. Create public.commercial_proposals
CREATE TABLE IF NOT EXISTS public.commercial_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.commercial_leads(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  proposal_version integer NOT NULL DEFAULT 1 CHECK (proposal_version >= 1),
  platform_delivery_commission_bps integer NOT NULL CHECK (platform_delivery_commission_bps BETWEEN 0 AND 5000),
  merchant_delivery_commission_bps integer NOT NULL CHECK (merchant_delivery_commission_bps BETWEEN 0 AND 5000),
  pickup_commission_bps integer NOT NULL CHECK (pickup_commission_bps BETWEEN 0 AND 5000),
  service_fee_bps integer NOT NULL DEFAULT 500 CHECK (service_fee_bps BETWEEN 0 AND 2000),
  payout_cycle_days integer NOT NULL DEFAULT 7 CHECK (payout_cycle_days IN (1, 7, 14, 30)),
  legal_template_status text NOT NULL DEFAULT 'PENDING_LEGAL_REVIEW'
    CHECK (legal_template_status IN ('PENDING_LEGAL_REVIEW', 'APPROVED_TEMPLATE')),
  status text NOT NULL DEFAULT 'SENT'
    CHECK (status IN ('DRAFT', 'SENT', 'NEGOTIATION', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  proposed_by_staff_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  valid_until timestamptz NOT NULL,
  notes text,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_commercial_proposals_lead_id
  ON public.commercial_proposals(lead_id, proposal_version DESC);
CREATE INDEX IF NOT EXISTS idx_commercial_proposals_org_id
  ON public.commercial_proposals(organization_id);

-- 4. Create public.commission_rule_versions
CREATE TABLE IF NOT EXISTS public.commission_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.merchant_contracts(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  platform_delivery_commission_bps integer NOT NULL CHECK (platform_delivery_commission_bps BETWEEN 0 AND 5000),
  merchant_delivery_commission_bps integer NOT NULL CHECK (merchant_delivery_commission_bps BETWEEN 0 AND 5000),
  pickup_commission_bps integer NOT NULL CHECK (pickup_commission_bps BETWEEN 0 AND 5000),
  service_fee_bps integer NOT NULL DEFAULT 500 CHECK (service_fee_bps BETWEEN 0 AND 2000),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  created_by_staff_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_commission_rule_versions_org_effective
  ON public.commission_rule_versions(organization_id, effective_from DESC);

-- 5. Enable RLS and configure strict policies
ALTER TABLE public.commercial_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_rule_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_leads_manage_commercial_staff ON public.commercial_leads;
CREATE POLICY commercial_leads_manage_commercial_staff ON public.commercial_leads
  FOR ALL TO authenticated
  USING (
    app_security.has_staff_role(ARRAY['commercial', 'operations', 'tech_admin']::public.staff_role[])
  )
  WITH CHECK (
    app_security.has_staff_role(ARRAY['commercial', 'operations', 'tech_admin']::public.staff_role[])
  );

DROP POLICY IF EXISTS commercial_proposals_select_scoped ON public.commercial_proposals;
CREATE POLICY commercial_proposals_select_scoped ON public.commercial_proposals
  FOR SELECT TO authenticated
  USING (
    (organization_id IS NOT NULL AND app_security.has_org_role(organization_id, ARRAY['partner_owner']::public.partner_role[]))
    OR app_security.has_staff_role(ARRAY['commercial', 'operations', 'tech_admin']::public.staff_role[])
  );

DROP POLICY IF EXISTS commercial_proposals_manage_staff_or_owner ON public.commercial_proposals;
CREATE POLICY commercial_proposals_manage_staff_or_owner ON public.commercial_proposals
  FOR ALL TO authenticated
  USING (
    (organization_id IS NOT NULL AND app_security.has_org_role(organization_id, ARRAY['partner_owner']::public.partner_role[]))
    OR app_security.has_staff_role(ARRAY['commercial', 'operations', 'tech_admin']::public.staff_role[])
  )
  WITH CHECK (
    (organization_id IS NOT NULL AND app_security.has_org_role(organization_id, ARRAY['partner_owner']::public.partner_role[]))
    OR app_security.has_staff_role(ARRAY['commercial', 'operations', 'tech_admin']::public.staff_role[])
  );

DROP POLICY IF EXISTS commission_rule_versions_select_scoped ON public.commission_rule_versions;
CREATE POLICY commission_rule_versions_select_scoped ON public.commission_rule_versions
  FOR SELECT TO authenticated
  USING (
    app_security.has_org_role(organization_id, ARRAY['partner_owner', 'partner_finance']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['commercial', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

DROP POLICY IF EXISTS commission_rule_versions_manage_commercial_staff ON public.commission_rule_versions;
CREATE POLICY commission_rule_versions_manage_commercial_staff ON public.commission_rule_versions
  FOR ALL TO authenticated
  USING (
    app_security.has_staff_role(ARRAY['commercial', 'operations', 'tech_admin']::public.staff_role[])
  )
  WITH CHECK (
    app_security.has_staff_role(ARRAY['commercial', 'operations', 'tech_admin']::public.staff_role[])
  );

GRANT SELECT, INSERT, UPDATE ON public.commercial_proposals TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.commission_rule_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.commercial_leads TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.merchant_contracts TO authenticated;

COMMIT;
