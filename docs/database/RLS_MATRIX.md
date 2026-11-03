# iDeliveryFood — Row Level Security (RLS) & Access Matrix

**Module:** `M02` / `M03`  
**Database Verification Status:** 46 / 46 `public` tables have `rowsecurity = true`. 81 policies active across `public` and `storage.objects`.  
**Supabase Security Advisor Status:** `0` lints / warnings (`{"result":{"lints":[]}}`).

---

## 1. Security Helper Functions (`app_security` Schema)

All RLS policies delegate multi-tenant and RBAC/ABAC checks to `STABLE` functions in `app_security` with explicit `SET search_path = public, pg_temp` and `(SELECT auth.uid())` initPlan caching:

| Function | Security Mode | Purpose |
| :--- | :--- | :--- |
| `app_security.is_aal2()` | `SECURITY INVOKER` | Verifies JWT `aal = 'aal2'` for MFA step-up enforcement. |
| `app_security.has_staff_role(p_roles, p_require_mfa)` | `SECURITY DEFINER` | Checks active `public.staff_scopes` for `(SELECT auth.uid())` and enforces `aal2` when `ss.requires_mfa` or `p_require_mfa` is true. |
| `app_security.has_org_role(p_organization_id, p_roles)` | `SECURITY DEFINER` | Checks active `public.organization_members` for the given `organization_id` and `partner_role[]`. |
| `app_security.has_store_role(p_store_id, p_roles)` | `SECURITY DEFINER` | Checks active `public.organization_members` where `om.store_id IS NULL` (org-wide) or `om.store_id = p_store_id`. |
| `app_security.is_store_published(p_store_id)` | `SECURITY DEFINER` | Returns true only when `status = 'ACTIVE' AND is_published = true`. |
| `app_security.is_courier_assigned_to_order(p_order_id)` | `SECURITY DEFINER` | Returns true only when `delivery_tasks.active_courier_id = (SELECT auth.uid())`. |
| `app_security.guard_profile_self_update()` | `BEFORE UPDATE TRIGGER` | Blocks non-staff (`anon`/`authenticated`) from modifying `status`, `mfa_enforced`, `email`, or `is_test_data` on `public.profiles` (`42501`). |

---

## 2. Table-by-Actor Access Matrix

| Table Group / Table | `anon` | `customer` | `partner_operator` / `catalog` | `partner_finance` / `owner` | `courier` | `staff` (`operations` / `support`) | `staff` (`finance` / `risk` / `tech_admin` + `aal2`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `profiles` | Deny | Own (`SELECT`/`UPDATE` safe cols) | Own | Own | Own | `SELECT` | `SELECT` / Admin `UPDATE` |
| `user_preferences` | Deny | Own (`ALL`) | Own (`ALL`) | Own (`ALL`) | Own (`ALL`) | Own (`ALL`) | Own (`ALL`) |
| `organizations` | Deny | Deny | Scoped Org (`SELECT`) | Scoped Org (`SELECT`; Owner `UPDATE`) | Deny | `SELECT` | `SELECT` / `UPDATE` |
| `stores` | Published (`SELECT`) | Published (`SELECT`) | Scoped Store (`SELECT`/`UPDATE`) | Scoped Store (`SELECT`/`UPDATE`) | Published (`SELECT`) | `SELECT` | `SELECT` / `UPDATE` |
| `catalog_*` (4 tables) | Published & Active (`SELECT`) | Published & Active (`SELECT`) | Scoped Store (`ALL`) | Scoped Store (`ALL`) | Published (`SELECT`) | `SELECT` | `SELECT` |
| `customer_addresses` | Deny | Own (`ALL`) | Deny | Deny | Deny | `SELECT` (Support/Ops) | Deny (unless Support/Ops) |
| `quotes` | Deny | Own (`SELECT`/`INSERT`) | Deny | Deny | Deny | `SELECT` | `SELECT` (Finance) |
| `orders`, `order_items`, `order_item_options`, `order_events` | Deny | Own (`SELECT`; `INSERT` orders) | Scoped Store (`SELECT`; `UPDATE` orders) | Scoped Store (`SELECT`) | Assigned Order (`SELECT`) | `SELECT` (`UPDATE` w/ `aal2`) | `SELECT` |
| `delivery_tasks`, `delivery_events` | Deny | Own Order (`SELECT` tasks) | Scoped Store (`SELECT`) | Scoped Store (`SELECT`) | Assigned (`SELECT`) | `SELECT` | `SELECT` |
| `courier_location_samples` | Deny | Deny (reads sanitized realtime channel) | Deny | Deny | Own (`SELECT`/`INSERT`) | `SELECT` (Ops) | `SELECT` (Risk/TechAdmin) |
| `payment_attempts`, `refunds` | Deny | Own Order (`SELECT`) | Deny | Scoped Org (`SELECT`) | Deny | `SELECT` (Support L2) | `SELECT` (Finance/Risk) |
| `ledger_accounts`, `ledger_entries`, `settlements` | Deny | Deny | **Deny** (Segregated) | Scoped Org (`SELECT`) | Own Courier Account (`SELECT`) | **Deny** (Segregated) | `SELECT` (Requires `aal2`) |
| `ledger_journals`, `reconciliation_runs`, `payment_provider_events` | Deny | Deny | Deny | Deny | Deny | Deny | `SELECT` (Requires `aal2`) |
| `audit_logs` | Deny | `INSERT` (own actor) | `INSERT` (own actor) | Scoped Org (`SELECT` Owner) | `INSERT` (own actor) | `SELECT` (Ops w/ `aal2`) | `SELECT` (Requires `aal2`) |

---

## 3. Storage Buckets & Policies (`storage.objects`)

| Bucket ID | Visibility | Max File Size | Allowed MIME Types | Read Policy | Write Policy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `public-store-assets` | Public | 5 MB | `image/jpeg`, `image/png`, `image/webp` | `anon`, `authenticated` | `partner_owner`, `partner_manager`, `partner_catalog` for folder `<store_id>/*` |
| `private-kyc-docs` | Private | 10 MB | `image/jpeg`, `image/png`, `application/pdf` | Owner (`auth.uid()`) or `operations`/`risk_compliance`/`tech_admin` (`aal2`) | Authenticated user into folder `<auth.uid()>/*` |
| `private-pod-evidence` | Private | 10 MB | `image/jpeg`, `image/png`, `image/webp` | Courier owner or Support/Ops/Risk staff | Courier into assigned delivery task folder |
| `private-support-attachments` | Private | 10 MB | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | Case requester or Support/Ops staff | Case requester or Support staff |
| `private-financial-exports` | Private | 20 MB | `text/csv`, `application/pdf`, `application/json` | Staff `finance` or `tech_admin` (`aal2`) | Server `service_role` only |
