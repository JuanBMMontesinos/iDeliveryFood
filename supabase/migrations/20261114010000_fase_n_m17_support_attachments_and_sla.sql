-- =============================================================================
-- Fase N (M17): Support Cases, SLA, Internal Notes, Attachments & Refund Thresholds
-- =============================================================================

-- 1. Expand support_case_status enum idempotently for M17 state machine
ALTER TYPE public.support_case_status ADD VALUE IF NOT EXISTS 'WAITING_CUSTOMER';
ALTER TYPE public.support_case_status ADD VALUE IF NOT EXISTS 'WAITING_PARTNER';
ALTER TYPE public.support_case_status ADD VALUE IF NOT EXISTS 'ESCALATED_FINANCE';
ALTER TYPE public.support_case_status ADD VALUE IF NOT EXISTS 'ESCALATED_LOGISTICS';

-- 2. Add optional delivery_task_id on support_cases and decision metadata on support_action_requests
ALTER TABLE public.support_cases
  ADD COLUMN IF NOT EXISTS delivery_task_id uuid REFERENCES public.delivery_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_support_cases_delivery_task_id
  ON public.support_cases(delivery_task_id);

ALTER TABLE public.support_action_requests
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_notes text;

-- 3. Create support_attachments table (M17)
CREATE TABLE IF NOT EXISTS public.support_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.support_messages(id) ON DELETE SET NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  storage_bucket text NOT NULL DEFAULT 'support-attachments',
  object_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  sha256_hex text NOT NULL,
  is_internal_only boolean NOT NULL DEFAULT false,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_support_attachments_case_id
  ON public.support_attachments(case_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_support_attachments_message_id
  ON public.support_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_support_attachments_uploaded_by
  ON public.support_attachments(uploaded_by);

-- 4. Enable RLS and strict policies for M17
ALTER TABLE public.support_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_attachments_select_actor_scoped ON public.support_attachments;
CREATE POLICY support_attachments_select_actor_scoped ON public.support_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_cases sc
      LEFT JOIN public.support_messages sm ON sm.id = support_attachments.message_id
      WHERE sc.id = support_attachments.case_id
        AND (
          (
            NOT support_attachments.is_internal_only
            AND COALESCE(sm.is_internal_note, false) = false
            AND (
              sc.requester_id = (SELECT auth.uid())
              OR (sc.store_id IS NOT NULL AND app_security.has_store_role(sc.store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[]))
            )
          )
          OR app_security.has_staff_role(ARRAY['support', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
        )
    )
  );

DROP POLICY IF EXISTS support_attachments_insert_actor_scoped ON public.support_attachments;
CREATE POLICY support_attachments_insert_actor_scoped ON public.support_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND (
      NOT is_internal_only
      OR app_security.has_staff_role(ARRAY['support', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
    )
  );

DROP POLICY IF EXISTS support_cases_update_staff ON public.support_cases;
CREATE POLICY support_cases_update_staff ON public.support_cases
  FOR UPDATE TO authenticated
  USING (
    app_security.has_staff_role(ARRAY['support', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
  )
  WITH CHECK (
    app_security.has_staff_role(ARRAY['support', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

DROP POLICY IF EXISTS support_messages_insert_actor_scoped ON public.support_messages;
CREATE POLICY support_messages_insert_actor_scoped ON public.support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND (
      NOT is_internal_note
      OR app_security.has_staff_role(ARRAY['support', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
    )
  );

DROP POLICY IF EXISTS support_action_requests_insert_staff ON public.support_action_requests;
CREATE POLICY support_action_requests_insert_staff ON public.support_action_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND app_security.has_staff_role(ARRAY['support', 'operations', 'finance', 'tech_admin']::public.staff_role[])
  );

DROP POLICY IF EXISTS support_action_requests_update_finance_aal2 ON public.support_action_requests;
CREATE POLICY support_action_requests_update_finance_aal2 ON public.support_action_requests
  FOR UPDATE TO authenticated
  USING (
    app_security.has_staff_role(ARRAY['finance', 'tech_admin']::public.staff_role[], true)
  )
  WITH CHECK (
    app_security.has_staff_role(ARRAY['finance', 'tech_admin']::public.staff_role[], true)
    AND decided_by IS DISTINCT FROM requested_by
  );

-- 5. Add support_auto_refund_limit_cents column to public.platform_policies (default 1500 cents = R$ 15,00)
ALTER TABLE public.platform_policies
  ADD COLUMN IF NOT EXISTS support_auto_refund_limit_cents integer NOT NULL DEFAULT 1500 CHECK (support_auto_refund_limit_cents >= 0);

UPDATE public.platform_policies
SET support_auto_refund_limit_cents = 1500
WHERE policy_key = 'DEFAULT_BR_MARKETPLACE';
