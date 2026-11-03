-- M07, M08, M16 Partner Operations, Catalog Management & Central Admin Governance

ALTER TYPE public.partner_role ADD VALUE IF NOT EXISTS 'partner_catalog';
ALTER TYPE public.partner_role ADD VALUE IF NOT EXISTS 'partner_marketing';
ALTER TYPE public.partner_role ADD VALUE IF NOT EXISTS 'partner_support';

-- Prevent any authenticated user from granting or elevating staff_scopes for themselves (M16 self-grant prohibition)
CREATE OR REPLACE FUNCTION app_security.guard_staff_scope_self_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF char_length(trim(COALESCE(NEW.justification, ''))) < 5 THEN
    RAISE EXCEPTION 'STAFF_SCOPE_JUSTIFICATION_REQUIRED: A justification of at least 5 characters is required.'
      USING ERRCODE = '23514';
  END IF;

  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.user_id = (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'STAFF_SELF_GRANT_FORBIDDEN: Staff members cannot grant or modify their own administrative scopes.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_staff_scope_self_grant
BEFORE INSERT OR UPDATE ON public.staff_scopes
FOR EACH ROW EXECUTE FUNCTION app_security.guard_staff_scope_self_grant();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'store_hour_exceptions' AND policyname = 'store_hour_exceptions_manage_partner'
  ) THEN
    CREATE POLICY store_hour_exceptions_manage_partner ON public.store_hour_exceptions
      FOR ALL TO authenticated
      USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[]))
      WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[]));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'store_service_areas' AND policyname = 'store_service_areas_manage_partner'
  ) THEN
    CREATE POLICY store_service_areas_manage_partner ON public.store_service_areas
      FOR ALL TO authenticated
      USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[]))
      WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[]));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'approval_events' AND policyname = 'approval_events_select_partner_owner'
  ) THEN
    CREATE POLICY approval_events_select_partner_owner ON public.approval_events
      FOR SELECT TO authenticated
      USING (
        organization_id IS NOT NULL
        AND app_security.has_org_role(organization_id, ARRAY['partner_owner', 'partner_finance']::public.partner_role[])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'approval_events' AND policyname = 'approval_events_insert_partner_or_staff'
  ) THEN
    CREATE POLICY approval_events_insert_partner_or_staff ON public.approval_events
      FOR INSERT TO authenticated
      WITH CHECK (
        decided_by = (SELECT auth.uid())
        AND char_length(trim(reason)) >= 3
        AND (
          (
            target_type = 'BANK_ACCOUNT'
            AND new_status = 'PENDING'
            AND organization_id IS NOT NULL
            AND app_security.has_org_role(organization_id, ARRAY['partner_owner']::public.partner_role[])
          )
          OR app_security.has_staff_role(ARRAY['operations', 'commercial', 'risk_compliance', 'tech_admin']::public.staff_role[], true)
        )
      );
  END IF;
END $$;

GRANT INSERT, UPDATE, DELETE ON public.store_hour_exceptions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.store_service_areas TO authenticated;
GRANT INSERT ON public.approval_events TO authenticated;
