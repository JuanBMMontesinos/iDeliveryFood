# ADR-007: Grocery & Market Extension — Scale Weighing (`HALF_UP` Centavos), Customer-Consented Substitutions & Financial Reconciliation

- **Status:** Approved
- **Date:** 2026-11-18
- **Module:** `M22`

## Context
Supermarket, butcher, and produce merchants sell variable-weight items (`KG` / `WEIGHT_GRAMS`) and frequently face stockouts of specific SKUs during in-store picking. Arbitrary item substitutions without customer approval or floating-point weight calculations cause customer disputes and accounting discrepancies.

## Decision
1. **Policy Feature Gate (`feature_grocery_picking_enabled`):**
   - All `M22` picking endpoints check `platform_policies.feature_grocery_picking_enabled` (and store/organization eligibility), returning `403 FEATURE_DISABLED_BY_POLICY` when disabled.

2. **Deterministic Integer Centavo Scale Weighing (`HALF_UP`):**
   - Variable-weight items store `estimated_weight_grams`, `actual_weight_grams`, and `price_per_kg_cents`.
   - When weighed on a scale (`POST /v1/picking/tasks/:pickTaskId/items/:orderItemId/weigh`), the line total in integer BRL centavos is calculated deterministically using `HALF_UP` integer arithmetic:
     `weighedBaseCents = Math.floor((actualWeightGrams * pricePerKgCents + 500) / 1000)`.
   - Any positive weight delta above the pre-authorized tolerance ceiling (`+10%`) is rejected with `409 PICKING_WEIGHT_EXCEEDS_PREAUTH_TOLERANCE` unless explicit customer consent is recorded.

3. **Customer-Consented Substitutions & Automated Financial Adjustment (`M22` / `M12` / `M13`):**
   - If an item's `substitution_preference` is `REFUND_IF_UNAVAILABLE`, proposing a substitution is blocked (`409 SUBSTITUTION_FORBIDDEN_BY_PREFERENCE`) and only automatic partial refund is allowed.
   - If `ALLOW_SUGGESTION` or `CONTACT_ME`, the picker proposes a substitute (`PENDING_CUSTOMER`) with an expiration window (`expires_at`). The customer approves or rejects via `POST /v1/orders/:orderId/substitutions/:subId/respond`; expired proposals default to `EXPIRED_TIMEOUT` and refund the unavailable item.
   - Upon `POST /v1/picking/tasks/:pickTaskId/complete`, if `final_picked_total_cents < pre_authorized_total_cents`, the transaction automatically creates a `PROCESSED` partial refund in `public.refunds` and posts a balanced `GROCERY_PICK_ADJUSTMENT` double-entry journal in `public.ledger_journals`.

## Consequences
- Customers are never charged more than pre-authorized without explicit consent, and every lower-weight or out-of-stock delta is automatically refunded and reconciled in the double-entry ledger.
