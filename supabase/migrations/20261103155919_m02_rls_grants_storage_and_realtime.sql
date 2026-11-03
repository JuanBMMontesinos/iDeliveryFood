-- M02 Migration 3: Security Helper Functions, RLS on all tables, Minimum Grants, Views, Storage Buckets & Policies

-- 1. Security Helper Functions in app_security schema
CREATE OR REPLACE FUNCTION app_security.is_aal2()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
$$;

CREATE OR REPLACE FUNCTION app_security.has_staff_role(
  p_roles public.staff_role[],
  p_require_mfa boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_scopes ss
    WHERE ss.user_id = (SELECT auth.uid())
      AND ss.is_active = true
      AND ss.revoked_at IS NULL
      AND ss.role = ANY(p_roles)
      AND (
        (NOT ss.requires_mfa AND NOT p_require_mfa)
        OR COALESCE((SELECT auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_security.has_org_role(
  p_organization_id uuid,
  p_roles public.partner_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = (SELECT auth.uid())
      AND om.organization_id = p_organization_id
      AND om.is_active = true
      AND om.revoked_at IS NULL
      AND om.role = ANY(p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION app_security.has_store_role(
  p_store_id uuid,
  p_roles public.partner_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.stores s
    JOIN public.organization_members om
      ON om.organization_id = s.organization_id
    WHERE s.id = p_store_id
      AND om.user_id = (SELECT auth.uid())
      AND om.is_active = true
      AND om.revoked_at IS NULL
      AND (om.store_id IS NULL OR om.store_id = s.id)
      AND om.role = ANY(p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION app_security.is_store_published(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.stores s
    WHERE s.id = p_store_id
      AND s.status = 'ACTIVE'
      AND s.is_published = true
  );
$$;

CREATE OR REPLACE FUNCTION app_security.is_courier_assigned_to_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.delivery_tasks dt
    WHERE dt.order_id = p_order_id
      AND dt.active_courier_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION app_security.guard_profile_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.mfa_enforced IS DISTINCT FROM OLD.mfa_enforced
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.is_test_data IS DISTINCT FROM OLD.is_test_data THEN
      IF NOT app_security.has_staff_role(ARRAY['operations', 'risk_compliance', 'tech_admin']::public.staff_role[], true) THEN
        RAISE EXCEPTION 'Unauthorized modification of protected profile attributes.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_profile_self_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION app_security.guard_profile_self_update();

REVOKE ALL ON SCHEMA app_security FROM PUBLIC;
GRANT USAGE ON SCHEMA app_security TO anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_security FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_security TO anon, authenticated, service_role;

-- 2. Enable RLS on all 46 public tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_hour_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_location_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_decisions ENABLE ROW LEVEL SECURITY;

-- 3. Granular RLS Policies by Actor & Scope
CREATE POLICY profiles_select_own_or_staff ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY user_preferences_select_own ON public.user_preferences
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY user_preferences_insert_own ON public.user_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_preferences_update_own ON public.user_preferences
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY organizations_select_member_or_staff ON public.organizations
  FOR SELECT TO authenticated
  USING (
    app_security.has_org_role(id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog', 'partner_finance', 'partner_marketing', 'partner_support']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'finance', 'commercial', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY organizations_update_owner_or_staff ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    app_security.has_org_role(id, ARRAY['partner_owner']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['operations', 'commercial', 'tech_admin']::public.staff_role[], true)
  )
  WITH CHECK (
    app_security.has_org_role(id, ARRAY['partner_owner']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['operations', 'commercial', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY stores_select_public_published ON public.stores
  FOR SELECT TO anon, authenticated
  USING (status = 'ACTIVE' AND is_published = true);

CREATE POLICY stores_select_partner_or_staff ON public.stores
  FOR SELECT TO authenticated
  USING (
    app_security.has_store_role(id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog', 'partner_finance', 'partner_marketing', 'partner_support']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'finance', 'commercial', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY stores_update_partner_or_staff ON public.stores
  FOR UPDATE TO authenticated
  USING (
    app_security.has_store_role(id, ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['operations', 'tech_admin']::public.staff_role[], true)
  )
  WITH CHECK (
    app_security.has_store_role(id, ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['operations', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY store_hours_select_public_or_partner ON public.store_hours
  FOR SELECT TO anon, authenticated
  USING (
    app_security.is_store_published(store_id)
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY store_hours_manage_partner ON public.store_hours
  FOR ALL TO authenticated
  USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[]))
  WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[]));

CREATE POLICY store_hour_exceptions_select ON public.store_hour_exceptions
  FOR SELECT TO anon, authenticated
  USING (
    app_security.is_store_published(store_id)
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['operations', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY store_service_areas_select ON public.store_service_areas
  FOR SELECT TO anon, authenticated
  USING (
    (is_active = true AND app_security.is_store_published(store_id))
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['operations', 'commercial', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY org_members_select_own_or_admin ON public.organization_members
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR app_security.has_org_role(organization_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY org_members_manage_owner_or_staff ON public.organization_members
  FOR ALL TO authenticated
  USING (
    app_security.has_org_role(organization_id, ARRAY['partner_owner']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['operations', 'tech_admin']::public.staff_role[], true)
  )
  WITH CHECK (
    app_security.has_org_role(organization_id, ARRAY['partner_owner']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['operations', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY staff_scopes_select_own_or_admin ON public.staff_scopes
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['risk_compliance', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY staff_scopes_manage_tech_admin ON public.staff_scopes
  FOR ALL TO authenticated
  USING (app_security.has_staff_role(ARRAY['tech_admin']::public.staff_role[], true))
  WITH CHECK (app_security.has_staff_role(ARRAY['tech_admin']::public.staff_role[], true));

CREATE POLICY invitations_select_authorized ON public.invitations
  FOR SELECT TO authenticated
  USING (
    invited_by = (SELECT auth.uid())
    OR (organization_id IS NOT NULL AND app_security.has_org_role(organization_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[]))
    OR app_security.has_staff_role(ARRAY['operations', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY approval_events_select_staff ON public.approval_events
  FOR SELECT TO authenticated
  USING (app_security.has_staff_role(ARRAY['operations', 'commercial', 'risk_compliance', 'tech_admin']::public.staff_role[]));

CREATE POLICY user_devices_select_own ON public.user_devices
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY user_devices_manage_own ON public.user_devices
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY privacy_requests_select_own_or_compliance ON public.privacy_requests
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['risk_compliance', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY privacy_requests_insert_own ON public.privacy_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY audit_logs_select_compliance_or_org_owner ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    app_security.has_staff_role(ARRAY['operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[], true)
    OR (organization_id IS NOT NULL AND app_security.has_org_role(organization_id, ARRAY['partner_owner']::public.partner_role[]))
  );

CREATE POLICY audit_logs_insert_authenticated ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = (SELECT auth.uid()));

CREATE POLICY platform_policies_select_all ON public.platform_policies
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY platform_policies_manage_staff ON public.platform_policies
  FOR ALL TO authenticated
  USING (app_security.has_staff_role(ARRAY['operations', 'finance', 'tech_admin']::public.staff_role[], true))
  WITH CHECK (app_security.has_staff_role(ARRAY['operations', 'finance', 'tech_admin']::public.staff_role[], true));

CREATE POLICY provider_configurations_select_staff ON public.provider_configurations
  FOR SELECT TO authenticated
  USING (app_security.has_staff_role(ARRAY['operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[]));

CREATE POLICY catalog_categories_select ON public.catalog_categories
  FOR SELECT TO anon, authenticated
  USING (
    (is_active = true AND app_security.is_store_published(store_id))
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'commercial', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY catalog_categories_manage_partner ON public.catalog_categories
  FOR ALL TO authenticated
  USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[]))
  WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[]));

CREATE POLICY catalog_products_select ON public.catalog_products
  FOR SELECT TO anon, authenticated
  USING (
    (is_available = true AND app_security.is_store_published(store_id))
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'commercial', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY catalog_products_manage_partner ON public.catalog_products
  FOR ALL TO authenticated
  USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog']::public.partner_role[]))
  WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog']::public.partner_role[]));

CREATE POLICY catalog_option_groups_select ON public.catalog_option_groups
  FOR SELECT TO anon, authenticated
  USING (
    app_security.is_store_published(store_id)
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY catalog_option_groups_manage_partner ON public.catalog_option_groups
  FOR ALL TO authenticated
  USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[]))
  WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[]));

CREATE POLICY catalog_options_select ON public.catalog_options
  FOR SELECT TO anon, authenticated
  USING (
    app_security.is_store_published(store_id)
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY catalog_options_manage_partner ON public.catalog_options
  FOR ALL TO authenticated
  USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog']::public.partner_role[]))
  WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_catalog']::public.partner_role[]));

CREATE POLICY customer_addresses_select_own_or_support ON public.customer_addresses
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations']::public.staff_role[])
  );

CREATE POLICY customer_addresses_manage_own ON public.customer_addresses
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY couriers_select_own_or_staff ON public.couriers
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY couriers_update_own ON public.couriers
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY courier_vehicles_select_own_or_staff ON public.courier_vehicles
  FOR SELECT TO authenticated
  USING (
    courier_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY promotions_select_active_or_partner ON public.promotions
  FOR SELECT TO authenticated
  USING (
    is_active = true
    OR (store_id IS NOT NULL AND app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_marketing']::public.partner_role[]))
    OR app_security.has_staff_role(ARRAY['operations', 'commercial', 'finance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY promotion_redemptions_select_own_or_staff ON public.promotion_redemptions
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'finance', 'risk_compliance']::public.staff_role[])
  );

CREATE POLICY quotes_select_own_or_staff ON public.quotes
  FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'finance']::public.staff_role[])
  );

CREATE POLICY quotes_insert_own ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (customer_id = (SELECT auth.uid()));

CREATE POLICY orders_select_actor_scoped ON public.orders
  FOR SELECT TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_finance', 'partner_support']::public.partner_role[])
    OR app_security.is_courier_assigned_to_order(id)
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY orders_insert_customer ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (customer_id = (SELECT auth.uid()));

CREATE POLICY orders_update_partner_or_staff ON public.orders
  FOR UPDATE TO authenticated
  USING (
    app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l2', 'operations', 'tech_admin']::public.staff_role[], true)
  )
  WITH CHECK (
    app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l2', 'operations', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY order_items_select_actor_scoped ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.customer_id = (SELECT auth.uid())
          OR app_security.has_store_role(o.store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_finance', 'partner_support']::public.partner_role[])
          OR app_security.is_courier_assigned_to_order(o.id)
          OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
        )
    )
  );

CREATE POLICY order_item_options_select_actor_scoped ON public.order_item_options
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = order_item_options.order_item_id
        AND (
          o.customer_id = (SELECT auth.uid())
          OR app_security.has_store_role(o.store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_finance', 'partner_support']::public.partner_role[])
          OR app_security.is_courier_assigned_to_order(o.id)
          OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
        )
    )
  );

CREATE POLICY order_events_select_actor_scoped ON public.order_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_events.order_id
        AND (
          o.customer_id = (SELECT auth.uid())
          OR app_security.has_store_role(o.store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator', 'partner_support']::public.partner_role[])
          OR app_security.is_courier_assigned_to_order(o.id)
          OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
        )
    )
  );

CREATE POLICY delivery_tasks_select_actor_scoped ON public.delivery_tasks
  FOR SELECT TO authenticated
  USING (
    active_courier_id = (SELECT auth.uid())
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[])
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = delivery_tasks.order_id
        AND o.customer_id = (SELECT auth.uid())
    )
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY delivery_offers_select_courier_or_staff ON public.delivery_offers
  FOR SELECT TO authenticated
  USING (
    courier_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['operations', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY delivery_assignments_select_courier_or_staff ON public.delivery_assignments
  FOR SELECT TO authenticated
  USING (
    courier_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY courier_locations_select_own_or_staff ON public.courier_location_samples
  FOR SELECT TO authenticated
  USING (
    courier_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY courier_locations_insert_own ON public.courier_location_samples
  FOR INSERT TO authenticated
  WITH CHECK (courier_id = (SELECT auth.uid()));

CREATE POLICY delivery_events_select_actor_scoped ON public.delivery_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.delivery_tasks dt
      WHERE dt.id = delivery_events.delivery_task_id
        AND (
          dt.active_courier_id = (SELECT auth.uid())
          OR app_security.has_store_role(dt.store_id, ARRAY['partner_owner', 'partner_manager', 'partner_operator']::public.partner_role[])
          OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
        )
    )
  );

CREATE POLICY payment_attempts_select_customer_or_finance ON public.payment_attempts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = payment_attempts.order_id
        AND (
          o.customer_id = (SELECT auth.uid())
          OR app_security.has_org_role(o.organization_id, ARRAY['partner_owner', 'partner_finance']::public.partner_role[])
        )
    )
    OR app_security.has_staff_role(ARRAY['support_l2', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY payment_provider_events_select_finance_staff ON public.payment_provider_events
  FOR SELECT TO authenticated
  USING (app_security.has_staff_role(ARRAY['finance', 'risk_compliance', 'tech_admin']::public.staff_role[], true));

CREATE POLICY refunds_select_customer_or_finance ON public.refunds
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = refunds.order_id
        AND (
          o.customer_id = (SELECT auth.uid())
          OR app_security.has_org_role(o.organization_id, ARRAY['partner_owner', 'partner_finance']::public.partner_role[])
        )
    )
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY ledger_accounts_select_finance_scoped ON public.ledger_accounts
  FOR SELECT TO authenticated
  USING (
    (organization_id IS NOT NULL AND app_security.has_org_role(organization_id, ARRAY['partner_owner', 'partner_finance']::public.partner_role[]))
    OR (courier_id IS NOT NULL AND courier_id = (SELECT auth.uid()))
    OR app_security.has_staff_role(ARRAY['finance', 'risk_compliance', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY ledger_journals_select_staff_finance ON public.ledger_journals
  FOR SELECT TO authenticated
  USING (app_security.has_staff_role(ARRAY['finance', 'risk_compliance', 'tech_admin']::public.staff_role[], true));

CREATE POLICY ledger_entries_select_finance_scoped ON public.ledger_entries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ledger_accounts la
      WHERE la.id = ledger_entries.account_id
        AND (
          (la.organization_id IS NOT NULL AND app_security.has_org_role(la.organization_id, ARRAY['partner_owner', 'partner_finance']::public.partner_role[]))
          OR (la.courier_id IS NOT NULL AND la.courier_id = (SELECT auth.uid()))
        )
    )
    OR app_security.has_staff_role(ARRAY['finance', 'risk_compliance', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY settlements_select_finance_scoped ON public.settlements
  FOR SELECT TO authenticated
  USING (
    (organization_id IS NOT NULL AND app_security.has_org_role(organization_id, ARRAY['partner_owner', 'partner_finance']::public.partner_role[]))
    OR (courier_id IS NOT NULL AND courier_id = (SELECT auth.uid()))
    OR app_security.has_staff_role(ARRAY['finance', 'risk_compliance', 'tech_admin']::public.staff_role[], true)
  );

CREATE POLICY reconciliation_runs_select_staff_finance ON public.reconciliation_runs
  FOR SELECT TO authenticated
  USING (app_security.has_staff_role(ARRAY['finance', 'risk_compliance', 'tech_admin']::public.staff_role[], true));

CREATE POLICY support_cases_select_actor_scoped ON public.support_cases
  FOR SELECT TO authenticated
  USING (
    requester_id = (SELECT auth.uid())
    OR (store_id IS NOT NULL AND app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_support']::public.partner_role[]))
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY support_cases_insert_requester ON public.support_cases
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = (SELECT auth.uid()));

CREATE POLICY support_messages_select_actor_scoped ON public.support_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_cases sc
      WHERE sc.id = support_messages.case_id
        AND (
          (NOT support_messages.is_internal_note AND (
            sc.requester_id = (SELECT auth.uid())
            OR (sc.store_id IS NOT NULL AND app_security.has_store_role(sc.store_id, ARRAY['partner_owner', 'partner_manager', 'partner_support']::public.partner_role[]))
          ))
          OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
        )
    )
  );

CREATE POLICY support_action_requests_select_staff ON public.support_action_requests
  FOR SELECT TO authenticated
  USING (app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[]));

CREATE POLICY commercial_leads_select_commercial_staff ON public.commercial_leads
  FOR SELECT TO authenticated
  USING (app_security.has_staff_role(ARRAY['commercial', 'operations', 'tech_admin']::public.staff_role[]));

CREATE POLICY merchant_contracts_select_owner_or_staff ON public.merchant_contracts
  FOR SELECT TO authenticated
  USING (
    app_security.has_org_role(organization_id, ARRAY['partner_owner', 'partner_finance']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['commercial', 'finance', 'risk_compliance', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY order_reviews_select_public_or_actor ON public.order_reviews
  FOR SELECT TO anon, authenticated
  USING (
    is_visible = true
    OR customer_id = (SELECT auth.uid())
    OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_support']::public.partner_role[])
    OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'risk_compliance']::public.staff_role[])
  );

CREATE POLICY order_reviews_insert_customer ON public.order_reviews
  FOR INSERT TO authenticated
  WITH CHECK (customer_id = (SELECT auth.uid()));

CREATE POLICY outbox_events_select_tech_admin ON public.outbox_events
  FOR SELECT TO authenticated
  USING (app_security.has_staff_role(ARRAY['tech_admin']::public.staff_role[], true));

CREATE POLICY notification_deliveries_select_own_or_staff ON public.notification_deliveries
  FOR SELECT TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    OR app_security.has_staff_role(ARRAY['support_l2', 'tech_admin']::public.staff_role[])
  );

CREATE POLICY risk_decisions_select_risk_staff ON public.risk_decisions
  FOR SELECT TO authenticated
  USING (app_security.has_staff_role(ARRAY['risk_compliance', 'tech_admin']::public.staff_role[], true));

-- 4. Public Discovery View with security_invoker = true
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
  s.supported_modalities
FROM public.stores s
WHERE s.status = 'ACTIVE'
  AND s.is_published = true;

GRANT SELECT ON public.published_stores_v TO anon, authenticated;

-- 5. Storage Buckets & Storage RLS Policies
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('public-store-assets', 'public-store-assets', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('private-kyc-docs', 'private-kyc-docs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
  ('private-pod-evidence', 'private-pod-evidence', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('private-support-attachments', 'private-support-attachments', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('private-financial-exports', 'private-financial-exports', false, 20971520, ARRAY['text/csv', 'application/pdf', 'application/json'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY storage_public_store_assets_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'public-store-assets');

CREATE POLICY storage_public_store_assets_partner_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'public-store-assets'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND app_security.has_store_role(((storage.foldername(name))[1])::uuid, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[])
  );

CREATE POLICY storage_private_kyc_docs_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'private-kyc-docs'
    AND (
      owner_id = ((SELECT auth.uid()))::text
      OR app_security.has_staff_role(ARRAY['operations', 'risk_compliance', 'tech_admin']::public.staff_role[], true)
    )
  );

CREATE POLICY storage_private_kyc_docs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'private-kyc-docs'
    AND (storage.foldername(name))[1] = ((SELECT auth.uid()))::text
  );

CREATE POLICY storage_private_pod_evidence_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'private-pod-evidence'
    AND (
      owner_id = ((SELECT auth.uid()))::text
      OR app_security.has_staff_role(ARRAY['support_l1', 'support_l2', 'operations', 'risk_compliance']::public.staff_role[])
    )
  );

CREATE POLICY storage_private_financial_exports_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'private-financial-exports'
    AND app_security.has_staff_role(ARRAY['finance', 'tech_admin']::public.staff_role[], true)
  );
