# iDeliveryFood — Row Level Security (RLS) & Multi-Tenant Access Matrix (`M00`–`M26`)

**Module:** `M02` / `M03` / `M23` / `M24` / `M26`  
**Database Verification Status:** `59 / 59` `public` tables have `rowsecurity = true` (`0` unprotected tables). `13 / 13` Storage buckets hardened with `storage.objects` RLS.  
**Automated Invariant Gate:** `27 / 27` invariants verified in [`supabase/tests/rls_and_constraints_test.sql`](file:///h:/IAProjects/iDeliveryFood/supabase/tests/rls_and_constraints_test.sql).

---

## 1. Security Helper Functions (`app_security` Schema)

All RLS policies delegate multi-tenant and RBAC/ABAC checks to hardened functions in `app_security` with explicit `SET search_path = public, pg_temp` and `(SELECT auth.uid())` initPlan caching:

| Function | Security Mode | Purpose |
| :--- | :--- | :--- |
| `app_security.is_aal2()` | `SECURITY INVOKER` | Verifies JWT claim `aal = 'aal2'` for MFA step-up enforcement. |
| `app_security.has_staff_role(p_roles, p_require_mfa)` | `SECURITY DEFINER` | Checks active `public.staff_scopes` for `(SELECT auth.uid())` and enforces `aal2` when `ss.requires_mfa` or `p_require_mfa` is true. |
| `app_security.has_org_role(p_organization_id, p_roles)` | `SECURITY DEFINER` | Checks active `public.organization_members` for the given `organization_id` and `partner_role[]`. |
| `app_security.has_store_role(p_store_id, p_roles)` | `SECURITY DEFINER` | Checks active `public.organization_members` where `om.store_id IS NULL` (org-wide) or `om.store_id = p_store_id`. |
| `app_security.is_store_published(p_store_id)` | `SECURITY DEFINER` | Returns true only when `status = 'ACTIVE' AND is_published = true`. |
| `app_security.is_courier_assigned_to_order(p_order_id)` | `SECURITY DEFINER` | Returns true only when `delivery_tasks.active_courier_id = (SELECT auth.uid())`. |
| `app_security.calculate_distance_meters(lat1, lng1, lat2, lng2)` | `IMMUTABLE` | Computes deterministic Haversine distance in integer meters for coverage verification. |
| `app_security.guard_profile_self_update()` | `BEFORE UPDATE TRIGGER` | Blocks non-staff (`anon`/`authenticated`) from modifying `status`, `mfa_enforced`, `email`, or `is_test_data` on `public.profiles` (`42501`). |
| `app_security.guard_staff_scope_self_grant()` | `BEFORE INSERT/UPDATE TRIGGER` | Prohibits any staff member (including `tech_admin`) from granting or escalating their own `public.staff_scopes` row (`42501`). |

---

## 2. Complete Table-by-Role Access Matrix (59 Tables × 17 Roles)

**17 Canonical Platform Roles:**
- **External / Public (3):** `anon`, `customer` (`authenticated`), `courier` (`public.couriers`).
- **Partner Organization / Store Roles (7):** `partner_owner`, `partner_manager`, `partner_operator`, `partner_catalog`, `partner_finance`, `partner_marketing`, `partner_support`.
- **Internal Platform Staff Roles (7+):** `support_l1` / `support_l2` (`support`), `operations` (`logistics`), `finance`, `commercial`, `growth_marketing` (`marketing`), `risk_compliance`, `auditor_privacy`, `tech_admin`.

| Table / Domain Group | `anon` | `customer` | `partner_operator` / `partner_catalog` | `partner_finance` / `partner_owner` | `courier` | `staff` (`support` / `operations` / `commercial` / `marketing`) | `staff` (`finance` / `risk_compliance` / `auditor_privacy` / `tech_admin` + `aal2`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `profiles` | Deny (`0`) | Own (`SELECT`/`UPDATE` safe cols) | Own (`SELECT`/`UPDATE`) | Own (`SELECT`/`UPDATE`) | Own (`SELECT`/`UPDATE`) | `SELECT` (Support/Ops) | `SELECT`; Admin `UPDATE` (`aal2`) |
| `user_preferences`, `user_devices` | Deny (`0`) | Own (`ALL`) | Own (`ALL`) | Own (`ALL`) | Own (`ALL`) | Own (`ALL`) | Own (`ALL`) |
| `organizations` | Deny (`0`) | Deny (`0`) | Scoped Org (`SELECT`) | Scoped Org (`SELECT`; Owner `UPDATE`) | Deny (`0`) | `SELECT` (Ops/Commercial) | `SELECT` / `UPDATE` (`aal2`) |
| `organization_members`, `invitations` | Deny (`0`) | Deny (`0`) | Scoped Org (`SELECT`) | Scoped Org (`SELECT`; Owner/Manager `INSERT`/`UPDATE`) | Deny (`0`) | `SELECT` (Ops) | `SELECT` / `ALL` (`tech_admin` `aal2`) |
| `staff_scopes`, `approval_events` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Own scope (`SELECT`); Ops `INSERT` approval (`aal2`) | `SELECT`; `tech_admin` (`aal2`, non-self) `INSERT`/`UPDATE` |
| `platform_policies`, `provider_configurations` | `SELECT` (`platform_policies` read-only); `0` providers | `SELECT` (`platform_policies` read-only) | `SELECT` (`platform_policies` read-only) | `SELECT` (`platform_policies` read-only) | `SELECT` (`platform_policies` read-only) | `SELECT` | `SELECT` / `UPDATE` (`tech_admin` `aal2` only) |
| `stores`, `store_hours`, `store_hour_exceptions`, `store_service_areas` | Published (`SELECT`) | Published (`SELECT`) | Scoped Store (`SELECT`/`UPDATE`) | Scoped Store (`ALL`) | Published (`SELECT`) | `SELECT` (Ops/Support) | `SELECT` / `UPDATE` (`aal2`) |
| `catalog_categories`, `catalog_products`, `catalog_option_groups`, `catalog_options` | Published & Active (`SELECT`) | Published & Active (`SELECT`) | Scoped Store (`ALL`) | Scoped Store (`ALL`) | Published (`SELECT`) | `SELECT` | `SELECT` |
| `storage_upload_intents` | Deny (`0`) | Own (`SELECT`/`INSERT`) | Scoped Store (`SELECT`/`INSERT`) | Scoped Org/Store (`SELECT`/`INSERT`) | Own (`SELECT`/`INSERT`) | `SELECT` (Ops/Support) | `SELECT` (`risk_compliance`/`tech_admin` `aal2`) |
| `customer_addresses` | Deny (`0`) | Own (`ALL`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | `SELECT` (Support/Ops) | Deny unless Support/Ops |
| `quotes` | Deny (`0`) | Own (`SELECT`/`INSERT`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | `SELECT` (Support/Ops) | `SELECT` (`finance` `aal2`) |
| `orders`, `order_items`, `order_item_options`, `order_events` | Deny (`0`) | Own (`SELECT`; `INSERT` orders/events) | Scoped Store (`SELECT`; `UPDATE` orders) | Scoped Store (`SELECT`) | Assigned Order (`SELECT`) | `SELECT` (`UPDATE` w/ `aal2`) | `SELECT` (`finance`/`risk_compliance` `aal2`) |
| `couriers`, `courier_vehicles` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Own (`SELECT`/`UPDATE`) | `SELECT` (Ops/Logistics) | `SELECT` / `UPDATE` (`risk_compliance`/`tech_admin` `aal2`) |
| `delivery_offers` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Own Offers (`SELECT`/`UPDATE`, **neighborhood only**) | `SELECT` / `INSERT` (Ops) | `SELECT` |
| `delivery_tasks`, `delivery_assignments`, `delivery_events` | Deny (`0`) | Own Order (`SELECT` task) | Scoped Store (`SELECT`) | Scoped Store (`SELECT`) | **Assigned Task Only** (`active_courier_id = auth.uid()`, reveals full address) | `SELECT` / `ALL` (Ops) | `SELECT` |
| `courier_location_samples` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Own (`SELECT`/`INSERT`, append-only) | `SELECT` (Ops) | `SELECT` (`risk_compliance`/`tech_admin` `aal2`) |
| `payment_attempts`, `refunds` | Deny (`0`) | Own Order (`SELECT`) | **Deny (`0`)** | Scoped Org (`SELECT`) | Deny (`0`) | `SELECT` (Support) | `SELECT` / `INSERT` (`finance` `aal2`) |
| `payment_provider_events`, `reconciliation_runs`, `ledger_journals` | Deny (`0`) | Deny (`0`) | **Deny (`0`)** | **Deny (`0`)** | **Deny (`0`)** | **Deny (`0`)** | `SELECT` / `INSERT` (`finance` / `tech_admin` **`aal2` required**) |
| `ledger_accounts`, `ledger_entries`, `settlements` | Deny (`0`) | Deny (`0`) | **Deny (`0` — segregated from operator)** | Scoped Org (`SELECT` own payable & entries) | Own Courier Account (`SELECT`) | **Deny (`0`)** | `SELECT` / `INSERT` (`finance` / `tech_admin` **`aal2` required**) |
| `support_cases` | Deny (`0`) | Own (`SELECT`/`INSERT`) | Scoped Store (`SELECT`) | Scoped Store (`SELECT`) | Own (`SELECT`/`INSERT`) | `SELECT` / `UPDATE` (Support/Ops) | `SELECT` (`finance` / `tech_admin` `aal2`) |
| `support_messages`, `support_attachments` | Deny (`0`) | Own Case **Non-Internal Only** (`is_internal_note = false`, `is_internal_only = false`) | Scoped Store **Non-Internal Only** | Scoped Store **Non-Internal Only** | Own Case **Non-Internal Only** | `SELECT` / `INSERT` (including internal notes) | `SELECT` (`finance` / `tech_admin` `aal2`) |
| `support_action_requests` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | `SELECT` / `INSERT` (Support/Ops) | `SELECT` / `UPDATE` decision (`finance` `aal2` + **4-eyes `decided_by <> requested_by`**) |
| `commercial_leads`, `commercial_proposals` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | `SELECT` / `ALL` (`commercial`, `operations`) | `SELECT` (`tech_admin`; **denied for `finance`-only**) |
| `merchant_contracts`, `commission_rule_versions` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Scoped Org (`SELECT`; `partner_owner` `UPDATE` acceptance) | Deny (`0`) | `SELECT` / `INSERT` (`commercial`, `operations`) | `SELECT` (`finance`, `tech_admin` `aal2`) |
| `promotions` | Deny (`0`) | Active (`SELECT`) | Scoped Store (`SELECT`) | Scoped Store (`ALL` for `partner_owner`/`manager`/`marketing`) | Deny (`0`) | `SELECT` / `ALL` (`growth_marketing`, `commercial`, `operations`) | `SELECT` / `ALL` (`tech_admin`) |
| `promotion_redemptions` | Deny (`0`) | Own (`SELECT`/`INSERT`) | Scoped Store (`SELECT`) | Scoped Store (`SELECT`) | Deny (`0`) | `SELECT` (`growth_marketing`, `operations`) | `SELECT` (`finance`, `tech_admin` `aal2`) |
| `order_reviews` | Published (`SELECT`) | Published (`SELECT`); Own Order (`INSERT`) | Scoped Store (`SELECT`/`UPDATE` reply) | Scoped Store (`SELECT`/`UPDATE` reply) | Published (`SELECT`) | `SELECT` / `UPDATE` moderation (`support`, `operations`, `growth_marketing`) | `SELECT` / `UPDATE` (`tech_admin`) |
| `outbox_events` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | `SELECT` (`tech_admin` `aal2` & server worker) |
| `notification_deliveries` | Deny (`0`) | Own (`recipient_user_id = auth.uid()` `SELECT`/`UPDATE` read_at) | Own (`SELECT`/`UPDATE`) | Own (`SELECT`/`UPDATE`) | Own (`SELECT`/`UPDATE`) | Own (`SELECT`); Ops `SELECT` | `SELECT` (`tech_admin` `aal2`) |
| `risk_alerts` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | `SELECT` (`operations` `aal2`) | `SELECT` / `UPDATE` (`risk_compliance`, `tech_admin` **`aal2` required**) |
| `risk_decisions` | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | Deny (`0`) | `SELECT` / `INSERT` (**`risk_compliance` `aal2` only**; append-only) |
| `privacy_requests` | Deny (`0`) | Own (`SELECT`/`INSERT`) | Own (`SELECT`/`INSERT`) | Own (`SELECT`/`INSERT`) | Own (`SELECT`/`INSERT`) | Deny (`0`) | `SELECT` / `UPDATE` (`risk_compliance`, `auditor_privacy`, `tech_admin` **`aal2` required**) |
| `order_pick_tasks`, `order_item_substitutions` | Deny (`0`) | Own Order (`SELECT`; `UPDATE` substitution decision) | Scoped Store (`SELECT`/`INSERT`/`UPDATE`) | Scoped Store (`SELECT`/`INSERT`/`UPDATE`) | **Deny (`0`)** | `SELECT` (`operations`, `support`) | `SELECT` (`tech_admin` `aal2`) |
| `audit_logs` | Deny (`0`) | `INSERT` (own actor) | `INSERT` (own actor) | Scoped Org (`SELECT` Owner) | `INSERT` (own actor) | `SELECT` (`operations` `aal2`) | `SELECT` (`finance`, `risk_compliance`, `auditor_privacy`, `tech_admin` **`aal2` required**; append-only) |

---

## 3. Hardened Storage Buckets & `storage.objects` Policies (13 Buckets)

All 13 buckets enforce explicit `file_size_limit` and `allowed_mime_types` (blocking `.svg`, `.html`, `.js`, and executables):

| # | Bucket ID | Public | Max Size | Allowed MIME Types | Read Policy (`SELECT`) | Write Policy (`INSERT`/`UPDATE`) |
| :---: | :--- | :---: | :---: | :--- | :--- | :--- |
| 1 | `public-store-assets` | `true` | 5 MB | `image/jpeg`, `image/png`, `image/webp` | `anon`, `authenticated` | `partner_owner`/`manager`/`catalog` for folder `<store_id>/*` |
| 2 | `store-assets` | `true` | 5 MB | `image/jpeg`, `image/png`, `image/webp` | `anon`, `authenticated` | `partner_owner`/`manager`/`catalog` for folder `<store_id>/*` |
| 3 | `catalog-media` | `true` | 5 MB | `image/jpeg`, `image/png`, `image/webp` | `anon`, `authenticated` (`catalog_media_public_read`) | `partner_owner`/`manager`/`catalog` for folder `<store_id>/*` |
| 4 | `private-kyc-docs` | `false` | 10 MB | `image/jpeg`, `image/png`, `application/pdf` | Owner (`<auth.uid()>/*`) or `operations`/`risk_compliance`/`tech_admin` (`aal2`) | Authenticated owner into `<auth.uid()>/*` |
| 5 | `merchant-documents` | `false` | 10 MB | `image/jpeg`, `image/png`, `application/pdf` | Org `partner_owner` or `commercial`/`risk_compliance`/`tech_admin` (`aal2`) | Org `partner_owner` into `<organization_id>/*` |
| 6 | `courier-documents` | `false` | 10 MB | `image/jpeg`, `image/png`, `application/pdf` | Courier owner (`<auth.uid()>/*`) or `operations`/`risk_compliance`/`tech_admin` (`aal2`) | Courier owner into `<auth.uid()>/*` (`courier_documents_insert_own`) |
| 7 | `private-pod-evidence` | `false` | 10 MB | `image/jpeg`, `image/png`, `image/webp` | Assigned courier or `support`/`operations`/`risk_compliance` | Assigned courier into `<delivery_task_id>/*` |
| 8 | `delivery-proofs` | `false` | 10 MB | `image/jpeg`, `image/png`, `image/webp` | Assigned courier or `support`/`operations`/`risk_compliance` | Assigned courier into `<delivery_task_id>/*` |
| 9 | `private-support-attachments` | `false` | 10 MB | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | Case requester (non-internal) or `support`/`operations` staff | Case requester or `support` staff |
| 10 | `support-attachments` | `false` | 10 MB | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | Case requester (non-internal) or `support`/`operations`/`finance` staff | Case requester or `support` staff |
| 11 | `private-financial-exports` | `false` | 20 MB | `text/csv`, `application/pdf`, `application/json` | Staff `finance` or `tech_admin` (`aal2`) | Server `service_role` only |
| 12 | `financial-statements` | `false` | 20 MB | `text/csv`, `application/pdf`, `application/json` | Scoped `partner_finance`/`partner_owner` or Staff `finance` (`aal2`) | Server `service_role` only |
| 13 | `privacy-exports` | `false` | 20 MB | `application/json` | Subject user (`<auth.uid()>/*`) or `auditor_privacy`/`risk_compliance` (`aal2`) | Server `service_role` only |
