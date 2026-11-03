-- M11, M13, M14 Double-Entry Ledger Account Balances View & Logistics/Finance RLS Policies

CREATE OR REPLACE VIEW public.ledger_account_balances_v
WITH (security_invoker = true)
AS
SELECT
  la.id AS account_id,
  la.code,
  la.name,
  la.account_type,
  la.organization_id,
  la.courier_id,
  la.currency_code,
  COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount_cents ELSE 0 END), 0)::bigint AS total_debits_cents,
  COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount_cents ELSE 0 END), 0)::bigint AS total_credits_cents,
  CASE
    WHEN la.account_type IN ('ASSET', 'EXPENSE') THEN
      COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount_cents ELSE -le.amount_cents END), 0)::bigint
    ELSE
      COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount_cents ELSE -le.amount_cents END), 0)::bigint
  END AS net_balance_cents
FROM public.ledger_accounts la
LEFT JOIN public.ledger_entries le
  ON le.account_id = la.id
GROUP BY
  la.id,
  la.code,
  la.name,
  la.account_type,
  la.organization_id,
  la.courier_id,
  la.currency_code;

GRANT SELECT ON public.ledger_account_balances_v TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'delivery_offers' AND policyname = 'delivery_offers_update_courier_or_logistics'
  ) THEN
    CREATE POLICY delivery_offers_update_courier_or_logistics ON public.delivery_offers
      FOR UPDATE TO authenticated
      USING (
        courier_id = (SELECT auth.uid())
        OR app_security.has_staff_role(ARRAY['logistics', 'operations', 'tech_admin']::public.staff_role[])
      )
      WITH CHECK (
        courier_id = (SELECT auth.uid())
        OR app_security.has_staff_role(ARRAY['logistics', 'operations', 'tech_admin']::public.staff_role[])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'delivery_tasks' AND policyname = 'delivery_tasks_update_courier_or_logistics'
  ) THEN
    CREATE POLICY delivery_tasks_update_courier_or_logistics ON public.delivery_tasks
      FOR UPDATE TO authenticated
      USING (
        active_courier_id = (SELECT auth.uid())
        OR app_security.has_staff_role(ARRAY['logistics', 'operations', 'tech_admin']::public.staff_role[])
      )
      WITH CHECK (
        active_courier_id = (SELECT auth.uid())
        OR app_security.has_staff_role(ARRAY['logistics', 'operations', 'tech_admin']::public.staff_role[])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'delivery_events' AND policyname = 'delivery_events_insert_courier_or_logistics'
  ) THEN
    CREATE POLICY delivery_events_insert_courier_or_logistics ON public.delivery_events
      FOR INSERT TO authenticated
      WITH CHECK (
        courier_id = (SELECT auth.uid())
        OR app_security.has_staff_role(ARRAY['logistics', 'operations', 'tech_admin']::public.staff_role[])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settlements' AND policyname = 'settlements_manage_finance_staff'
  ) THEN
    CREATE POLICY settlements_manage_finance_staff ON public.settlements
      FOR ALL TO authenticated
      USING (app_security.has_staff_role(ARRAY['finance', 'tech_admin']::public.staff_role[], true))
      WITH CHECK (app_security.has_staff_role(ARRAY['finance', 'tech_admin']::public.staff_role[], true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_runs' AND policyname = 'reconciliation_runs_manage_finance_staff'
  ) THEN
    CREATE POLICY reconciliation_runs_manage_finance_staff ON public.reconciliation_runs
      FOR ALL TO authenticated
      USING (app_security.has_staff_role(ARRAY['finance', 'tech_admin']::public.staff_role[], true))
      WITH CHECK (app_security.has_staff_role(ARRAY['finance', 'tech_admin']::public.staff_role[], true));
  END IF;
END $$;

GRANT UPDATE ON public.delivery_offers TO authenticated;
GRANT UPDATE ON public.delivery_tasks TO authenticated;
GRANT INSERT ON public.delivery_events TO authenticated;
GRANT INSERT, UPDATE ON public.settlements TO authenticated;
GRANT INSERT, UPDATE ON public.reconciliation_runs TO authenticated;
