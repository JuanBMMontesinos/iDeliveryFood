# ADR-002: Multi-Tenant Authorization, Supabase Auth, and Row-Level Security (RLS)

- **Status:** Approved
- **Date:** 2026-11-03
- **Module:** M00 / M02 / M03

## Context
iDeliveryFood serves consumers, couriers, multi-unit partner organizations, and segregated internal staff roles sharing a single backend (`apps/api`) and PostgreSQL database (`dwsoochnfxldfvcaijie`). Cross-tenant data leakage, privilege escalation via editable JWT metadata, or overly permissive RLS policies must be prevented by design.

## Decision
1. **Authentication vs. Authorization:**
   - **Supabase Auth** provides identity (`auth.users`, JWT validation, MFA factors `aal1`/`aal2`).
   - **`raw_user_meta_data` (`user_metadata`) is NEVER trusted for roles, permissions, or tenant assignment.**
   - Authorization is derived exclusively from server-controlled database tables:
     - `public.organization_members` (for partner roles: `partner_owner`, `partner_manager`, `partner_operator`, `partner_finance`, scoped to `organization_id` and optional `store_id`).
     - `public.staff_scopes` (for internal staff roles: `operations`, `logistics`, `support`, `finance`, `commercial`, `marketing`, `risk_compliance`, `auditor_privacy`, `tech_admin`).
     - `public.couriers` (for approved courier profiles).

2. **Row-Level Security (RLS) & Grants:**
   - Every table in `public` has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` where appropriate.
   - No `USING (true)` allow-all policies exist for writes or private reads. Public read access is restricted strictly to approved/published catalog rows (`stores` where `status = 'ACTIVE' AND is_published = true`, and active catalog items).
   - Policies use explicit `TO authenticated` / `TO anon` clauses and `(select auth.uid())` subselects for Postgres query planner caching, following Supabase Postgres best practices.
   - `UPDATE` policies always define both `USING` and `WITH CHECK` predicates.
   - Helper functions used by RLS live in the `app_security` schema (or hardened `public` functions with `SET search_path = public, pg_temp` and `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated`).
   - Views use `WITH (security_invoker = true)` (Postgres 17).

3. **MFA & Step-Up Authentication:**
   - Privileged staff roles (`staff_scopes`) and sensitive partner actions (bank account modification, payout approval, refund above threshold) require MFA (`auth.jwt() ->> 'aal' = 'aal2'`).

## Consequences
- Even if a client attempts direct PostgREST access with an `anon` or `authenticated` key, RLS enforces strict row-level and tenant-level isolation.
- `service_role` keys exist exclusively in backend server runtime (`apps/api`, `apps/worker`) and are blocked from client bundles by automated build checks.
