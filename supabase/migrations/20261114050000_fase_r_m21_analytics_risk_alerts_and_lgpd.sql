-- Fase R (M21): Reproducible Analytical KPIs, Explainable Risk Alerts with Mandatory Human Review & LGPD Privacy Governance

-- 1. Extend public.privacy_request_type enum with canonical M21 values while preserving existing ones
ALTER TYPE public.privacy_request_type ADD VALUE IF NOT EXISTS 'DATA_EXPORT';
ALTER TYPE public.privacy_request_type ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETION';
ALTER TYPE public.privacy_request_type ADD VALUE IF NOT EXISTS 'ANONYMIZATION';

-- 2. Enrich public.privacy_requests with portability payload, legal retention hold date, and anonymization timestamp
ALTER TABLE public.privacy_requests
  ADD COLUMN IF NOT EXISTS hold_until timestamptz,
  ADD COLUMN IF NOT EXISTS export_payload jsonb,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_basis_note text;

-- 3. Create public.risk_alerts for explainable risk detection requiring mandatory human review (M21)
CREATE TABLE IF NOT EXISTS public.risk_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('USER', 'ORGANIZATION', 'STORE', 'COURIER', 'ORDER')),
  subject_id uuid NOT NULL,
  rule_code text NOT NULL CHECK (
    rule_code IN (
      'VELOCITY_HIGH_REFUND_RATE',
      'COURIER_REPEATED_OTP_FAILURES',
      'COUPON_ABUSE_MULTI_ACCOUNT',
      'HIGH_VALUE_ORDER_NEW_ACCOUNT',
      'BANK_ACCOUNT_FREQUENT_CHANGES',
      'VELOCITY_CHECK_NORMAL'
    )
  ),
  severity text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN_AWAITING_HUMAN_REVIEW' CHECK (
    status IN (
      'OPEN_AWAITING_HUMAN_REVIEW',
      'APPROVED_OVERRIDE',
      'CONFIRMED_BLOCK',
      'DISMISSED_FALSE_POSITIVE'
    )
  ),
  rule_explanation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_action text NOT NULL DEFAULT 'HUMAN_REVIEW_REQUIRED',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_decision text CHECK (
    review_decision IS NULL OR review_decision IN ('APPROVE_OVERRIDE', 'CONFIRM_BLOCK', 'DISMISS_FALSE_POSITIVE')
  ),
  review_reason text,
  reviewed_at timestamptz,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_risk_alerts_status_severity
  ON public.risk_alerts(status, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_alerts_subject
  ON public.risk_alerts(subject_type, subject_id);

DROP TRIGGER IF EXISTS trg_risk_alerts_updated_at ON public.risk_alerts;
CREATE TRIGGER trg_risk_alerts_updated_at
BEFORE UPDATE ON public.risk_alerts
FOR EACH ROW EXECUTE FUNCTION app_security.touch_updated_at();

-- 4. Enrich public.risk_decisions to link with risk_alerts and accept M21 human review decisions
ALTER TABLE public.risk_decisions
  ADD COLUMN IF NOT EXISTS alert_id uuid REFERENCES public.risk_alerts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rule_explanation_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.risk_decisions
  DROP CONSTRAINT IF EXISTS risk_decisions_decision_check;

ALTER TABLE public.risk_decisions
  ADD CONSTRAINT risk_decisions_decision_check CHECK (
    decision IN (
      'ALLOW',
      'FLAG_FOR_HUMAN_REVIEW',
      'SUSPEND_CONFIRMED',
      'APPROVE_OVERRIDE',
      'CONFIRM_BLOCK',
      'DISMISS_FALSE_POSITIVE'
    )
  );

-- 5. Enable RLS and policies on public.risk_alerts
ALTER TABLE public.risk_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risk_alerts_staff_select ON public.risk_alerts;
CREATE POLICY risk_alerts_staff_select
  ON public.risk_alerts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_scopes ss
      WHERE ss.user_id = auth.uid()
        AND ss.is_active = true
        AND ss.role IN ('risk_compliance', 'auditor_privacy', 'tech_admin', 'operations', 'finance')
    )
  );

DROP POLICY IF EXISTS risk_alerts_staff_modify ON public.risk_alerts;
CREATE POLICY risk_alerts_staff_modify
  ON public.risk_alerts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_scopes ss
      WHERE ss.user_id = auth.uid()
        AND ss.is_active = true
        AND ss.role IN ('risk_compliance', 'tech_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff_scopes ss
      WHERE ss.user_id = auth.uid()
        AND ss.is_active = true
        AND ss.role IN ('risk_compliance', 'tech_admin')
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.risk_alerts TO authenticated, service_role;

-- 6. Reproducible Analytical View: public.analytics_order_kpis_v (M21)
CREATE OR REPLACE VIEW public.analytics_order_kpis_v
WITH (security_invoker = true)
AS
SELECT
  o.id AS order_id,
  o.order_number,
  o.organization_id,
  o.store_id,
  s.name AS store_name,
  s.city,
  s.state_code,
  o.customer_id,
  o.fulfillment_modality,
  o.order_status,
  o.payment_status,
  o.delivery_status,
  o.subtotal_cents,
  o.addons_cents,
  o.delivery_fee_cents,
  o.service_fee_cents,
  o.discount_cents,
  o.total_cents,
  o.platform_commission_cents,
  o.merchant_net_cents,
  o.courier_earnings_cents,
  COALESCE(pr.platform_subsidy_cents, 0) AS platform_coupon_subsidy_cents,
  COALESCE(pr.merchant_subsidy_cents, 0) AS merchant_coupon_subsidy_cents,
  CASE
    WHEN o.order_status NOT IN ('CANCELLED', 'EXPIRED')
    THEN (o.subtotal_cents + o.addons_cents + o.delivery_fee_cents + o.service_fee_cents)
    ELSE 0
  END AS gmv_cents,
  CASE
    WHEN o.order_status NOT IN ('CANCELLED', 'EXPIRED')
    THEN (o.platform_commission_cents + o.service_fee_cents - COALESCE(pr.platform_subsidy_cents, 0))
    ELSE 0
  END AS platform_net_revenue_cents,
  CASE
    WHEN o.order_status NOT IN ('CANCELLED', 'EXPIRED')
    THEN (
      (o.platform_commission_cents + o.service_fee_cents - COALESCE(pr.platform_subsidy_cents, 0))
      - GREATEST(0, o.courier_earnings_cents - o.delivery_fee_cents)
    )
    ELSE 0
  END AS operational_margin_cents,
  CASE
    WHEN o.accepted_at IS NOT NULL AND o.ready_at IS NOT NULL AND o.ready_at >= o.accepted_at
    THEN ROUND((EXTRACT(EPOCH FROM (o.ready_at - o.accepted_at)) / 60.0)::numeric, 2)
    ELSE NULL
  END AS prep_sla_minutes,
  CASE
    WHEN o.ready_at IS NOT NULL AND o.delivered_at IS NOT NULL AND o.delivered_at >= o.ready_at
    THEN ROUND((EXTRACT(EPOCH FROM (o.delivered_at - o.ready_at)) / 60.0)::numeric, 2)
    ELSE NULL
  END AS delivery_sla_minutes,
  o.cancellation_reason,
  o.cancelled_by_role,
  o.is_test_data,
  o.created_at
FROM public.orders o
JOIN public.stores s ON s.id = o.store_id
LEFT JOIN public.promotion_redemptions pr
  ON pr.order_id = o.id AND pr.status IN ('RESERVED', 'REDEEMED');

GRANT SELECT ON public.analytics_order_kpis_v TO authenticated, service_role;
