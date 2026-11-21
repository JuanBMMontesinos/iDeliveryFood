# ADR-006: Logistics Pre-Acceptance Address Privacy, Single-Courier Concurrency Lock, 4-Digit OTP Proof-of-Delivery & Fleet Governance

- **Status:** Approved
- **Date:** 2026-11-16
- **Module:** `M11` / `M14` / `M15`

## Context
Broadcasting customer street addresses and apartment numbers to all online couriers before an offer is accepted creates a severe customer privacy leak. Furthermore, concurrent offer acceptances by multiple couriers can cause double-dispatch race conditions, and unverified dropoffs lead to "order not received" disputes.

## Decision
1. **Pre-Acceptance Customer Address Privacy (`M11` / `M14`):**
   - `public.delivery_offers` exposes only the pickup store name, distance in meters, offered fee in BRL centavos, and `dropoff_neighborhood_only` (e.g., `"Jardins"`).
   - Both PostgreSQL RLS on `public.delivery_tasks` (`active_courier_id = (SELECT auth.uid())`) and the API serializer (`getDeliveryTaskById`) hide `dropoff_full_address` (`null`) until a courier is transactionally assigned as `active_courier_id`.

2. **Transactional Single-Courier Assignment Lock (`M14`):**
   - `POST /v1/logistics/offers/:offerId/accept` locks the target `public.delivery_tasks` row with `SELECT ... FOR UPDATE` and inserts into `public.delivery_assignments` guarded by the partial unique index `uq_delivery_assignments_one_active` (`UNIQUE (delivery_task_id) WHERE status = 'ACTIVE'`).
   - If two couriers accept simultaneously, exactly one succeeds (`200 OK`) and receives the full dropoff address, while the second receives `409 DELIVERY_TASK_ALREADY_ASSIGNED`.

3. **4-Digit OTP Proof-of-Delivery (`M11` / `M14`):**
   - Delivery completion (`POST /v1/logistics/tasks/:taskId/complete`) requires the 4-digit customer confirmation code, verified in constant time against `delivery_tasks.confirmation_code_hash` (`SHA-256`). Invalid codes return `409 DELIVERY_OTP_MISMATCH` and are rate-limited (`OTP_VERIFY` bucket).

4. **Default-Disabled Fleet Operators Governance (`M15`):**
   - Third-party fleet operator tables (`public.fleet_operators`, `public.fleet_courier_memberships`) exist in the schema with RLS enabled, but all fleet mutations are gated by `platform_policies.feature_fleet_operators_enabled` (`false` by default) and write-protected to `tech_admin` with MFA `aal2`.

## Consequences
- Customer residential PII is never exposed to unassigned couriers.
- Double-assignment of a delivery task is impossible even under concurrent HTTP requests.
