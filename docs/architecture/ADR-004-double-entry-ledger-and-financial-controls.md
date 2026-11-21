# ADR-004: Three Independent Order State Machines, Double-Entry Ledger in BRL Centavos & 4-Eyes Financial Controls

- **Status:** Approved
- **Date:** 2026-11-14
- **Module:** `M10` / `M12` / `M13` / `M17`

## Context
Marketplace orders involve independent lifecycle progressions across kitchen preparation, payment settlement, and courier logistics, as well as multi-party financial splits (Customer payment, Platform commission & service fee, Platform/Merchant promotional subsidy, Merchant net payable, and Courier earnings). Using floating-point numbers or a single conflated status column leads to rounding drift and race conditions (such as a late PSP capture arriving after an order is cancelled).

## Decision
1. **Three Independent State Machines (`M10`):**
   - Every row in `public.orders` maintains three orthogonal state machines guarded by optimistic concurrency (`version`) and recorded in append-only `public.order_events` (`trg_order_events_immutable`):
     - `order_status` (`OrderStatus`: `CREATED` -> `PENDING_MERCHANT_ACCEPTANCE` -> `ACCEPTED` -> `PREPARING` -> `READY_FOR_PICKUP` -> `PICKED_UP` -> `DELIVERED` -> `COMPLETED`, plus `CANCELLED`, `REJECTED`, `DISPUTED`, `REFUNDED`).
     - `payment_status` (`PaymentStatus`: `PENDING` -> `AUTHORIZED` -> `CAPTURED` -> `PARTIALLY_REFUNDED` | `REFUNDED` | `FAILED`).
     - `delivery_status` (`DeliveryStatus`: `PENDING_DISPATCH` -> `OFFERING` -> `ASSIGNED` -> `PICKED_UP` -> `IN_TRANSIT` -> `DELIVERED` | `CANCELLED`).
   - Late PSP capture webhooks arriving on an already `CANCELLED` or `REJECTED` order transition the order to `DISPUTED` (`LATE_CAPTURE_CONFLICT_QUEUED_FOR_REFUND`) for financial reconciliation rather than silently dropping funds.

2. **Immutable Double-Entry Accounting Ledger in Integer BRL Centavos (`M13`):**
   - All monetary values are stored and calculated exclusively in integer Brazilian Real centavos (`*_cents`).
   - Every financial event (`ORDER_CAPTURE`, `ORDER_REFUND`, `SETTLEMENT_PAYOUT`, `GROCERY_PICK_ADJUSTMENT`) posts a journal in `public.ledger_journals` with lines in append-only `public.ledger_entries` (`trg_ledger_entries_immutable`).
   - A deferred constraint trigger (`trg_verify_journal_balanced`) enforces at transaction commit that `SUM(DEBIT) == SUM(CREDIT) > 0` for every journal (`SQLSTATE 23514` on any imbalance).
   - GMV (`subtotal_cents + addons_cents`) is explicitly separated from Net Platform Revenue (`platform_commission_cents + service_fee_cents - platform_promo_subsidy_cents`) and segregated from Merchant Payables (`LIABILITY_MERCHANT_*`) and Courier Payables (`LIABILITY_COURIER_*`).

3. **4-Eyes Segregation of Duties & MFA `aal2` Step-Up (`M12` / `M13` / `M17`):**
   - Support agents can auto-approve refunds up to `support_auto_refund_limit_cents` (`1500` centavos = `R$ 15,00`). Refunds above this threshold are created as `PENDING_FINANCE` in `public.support_action_requests`.
   - Approving an escalated refund (`POST /v1/support/action-requests/:id/decide`) or executing a settlement payout (`POST /v1/finance/settlements/:id/execute`) requires:
     1. Staff role `finance` or `tech_admin`.
     2. Multi-Factor Authentication step-up (`aal = 'aal2'`).
     3. **4-Eyes Segregation of Duties:** the approver (`decided_by` / `actor.id`) must be strictly different from the requester (`requested_by` / bank account creator).

## Consequences
- Financial ledgers are provably balanced cent-for-cent at all times (`isLedgerBalanced: true` in `/v1/finance/overview` and `/v1/metrics`).
- No single compromised support or partner session can drain funds or self-approve large refunds or payout bank changes.
