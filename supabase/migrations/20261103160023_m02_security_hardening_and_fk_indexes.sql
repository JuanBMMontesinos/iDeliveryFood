-- M02 Migration 4: Remediate Security Advisor (rls_auto_enable) and Add Covering Indexes for All Foreign Keys

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_approval_events_decided_by ON public.approval_events(decided_by);
CREATE INDEX IF NOT EXISTS idx_approval_events_org_id ON public.approval_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_store_id ON public.audit_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_commercial_leads_converted_org_id ON public.commercial_leads(converted_organization_id);
CREATE INDEX IF NOT EXISTS idx_commercial_leads_owner_staff_id ON public.commercial_leads(owner_staff_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_actor_id ON public.delivery_assignments(assigned_by_actor_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_offer_id ON public.delivery_assignments(offer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_events_courier_id ON public.delivery_events(courier_id);
CREATE INDEX IF NOT EXISTS idx_invitations_accepted_by ON public.invitations(accepted_by);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON public.invitations(invited_by);
CREATE INDEX IF NOT EXISTS idx_invitations_store_id ON public.invitations(store_id);
CREATE INDEX IF NOT EXISTS idx_ledger_journals_posted_by ON public.ledger_journals(posted_by);
CREATE INDEX IF NOT EXISTS idx_merchant_contracts_approved_by ON public.merchant_contracts(approved_by);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_outbox_id ON public.notification_deliveries(outbox_event_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_provider_code ON public.notification_deliveries(provider_code);
CREATE INDEX IF NOT EXISTS idx_order_events_actor_id ON public.order_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_order_item_options_option_id ON public.order_item_options(option_id);
CREATE INDEX IF NOT EXISTS idx_order_reviews_customer_id ON public.order_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_org_members_granted_by ON public.organization_members(granted_by);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_provider_code ON public.payment_attempts(provider_code);
CREATE INDEX IF NOT EXISTS idx_payment_provider_events_attempt_id ON public.payment_provider_events(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_platform_policies_updated_by ON public.platform_policies(updated_by);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_processed_by ON public.privacy_requests(processed_by);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_customer_id ON public.promotion_redemptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_address_id ON public.quotes(address_id);
CREATE INDEX IF NOT EXISTS idx_quotes_promotion_id ON public.quotes(promotion_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_provider_code ON public.reconciliation_runs(provider_code);
CREATE INDEX IF NOT EXISTS idx_refunds_approved_by ON public.refunds(approved_by);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_attempt_id ON public.refunds(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_refunds_requested_by ON public.refunds(requested_by);
CREATE INDEX IF NOT EXISTS idx_risk_decisions_reviewer_id ON public.risk_decisions(human_reviewer_id);
CREATE INDEX IF NOT EXISTS idx_settlements_approved_by ON public.settlements(approved_by);
CREATE INDEX IF NOT EXISTS idx_staff_scopes_granted_by ON public.staff_scopes(granted_by);
CREATE INDEX IF NOT EXISTS idx_support_action_requests_case_id ON public.support_action_requests(case_id);
CREATE INDEX IF NOT EXISTS idx_support_action_requests_decided_by ON public.support_action_requests(decided_by);
CREATE INDEX IF NOT EXISTS idx_support_action_requests_order_id ON public.support_action_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_support_action_requests_requested_by ON public.support_action_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_support_cases_assigned_staff_id ON public.support_cases(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_support_cases_order_id ON public.support_cases(order_id);
CREATE INDEX IF NOT EXISTS idx_support_cases_store_id ON public.support_cases(store_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender_id ON public.support_messages(sender_id);
