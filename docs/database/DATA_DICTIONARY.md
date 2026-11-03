# iDeliveryFood — Data Dictionary (`public` & `app_security` Schemas)

**Module:** `M02`  
**Target Supabase Project:** `dwsoochnfxldfvcaijie`  
**Monetary Standard:** Integer `bigint` in Brazilian Real centavos (`*_cents`). Floating-point types (`float`, `real`) are strictly prohibited for money.  
**Temporal Standard:** `timestamptz` stored in UTC, formatted in `America/Sao_Paulo`.  
**Synthetic Seed Flag:** Every domain table includes `is_test_data boolean NOT NULL DEFAULT false` to isolate synthetic test records (`supabase/seed.sql`) from real operational records.

---

## 1. Custom Enumerated Types (`public`)

| Enum Name | Allowed Values | Purpose |
| :--- | :--- | :--- |
| `locale_code` | `'en'`, `'pt-BR'` | Supported UI & communication locales (`en` default). |
| `account_status` | `'PENDING_VERIFICATION'`, `'PENDING_APPROVAL'`, `'ACTIVE'`, `'SUSPENDED'`, `'BLOCKED'`, `'DEACTIVATED'`, `'DELETED'` | Lifecycle state of profiles, organizations, and couriers. |
| `partner_role` | `'partner_owner'`, `'partner_manager'`, `'partner_operator'`, `'partner_catalog'`, `'partner_finance'`, `'partner_marketing'`, `'partner_support'` | Multi-tenant merchant roles in `organization_members`. |
| `staff_role` | `'support_l1'`, `'support_l2'`, `'operations'`, `'finance'`, `'commercial'`, `'growth_marketing'`, `'risk_compliance'`, `'tech_admin'` | Internal platform staff roles in `staff_scopes`. |
| `fulfillment_modality` | `'PLATFORM_DELIVERY'`, `'MERCHANT_DELIVERY'`, `'PICKUP'` | Hybrid fulfillment mode per store/quote/order. |
| `store_status` | `'DRAFT'`, `'PENDING_REVIEW'`, `'ACTIVE'`, `'PAUSED'`, `'SUSPENDED'`, `'CLOSED'` | Store operational lifecycle. |
| `order_status` | `'DRAFT'`, `'QUOTED'`, `'CREATED'`, `'AWAITING_PAYMENT'`, `'PENDING_MERCHANT_ACCEPTANCE'`, `'ACCEPTED'`, `'PREPARING'`, `'READY_FOR_PICKUP'`, `'DISPATCHING'`, `'COURIER_ASSIGNED'`, `'PICKED_UP'`, `'OUT_FOR_DELIVERY'`, `'ARRIVED_AT_DESTINATION'`, `'DELIVERED'`, `'COMPLETED'`, `'CANCELLED'`, `'REJECTED'`, `'DELIVERY_FAILED'`, `'DISPUTED'`, `'REFUNDED'` | Independent state machine #1 (`OrderStatus`). |
| `payment_status` | `'UNPAID'`, `'PENDING'`, `'REQUIRES_ACTION'`, `'AUTHORIZED'`, `'CAPTURED'`, `'PARTIALLY_REFUNDED'`, `'REFUNDED'`, `'FAILED'`, `'CANCELLED'`, `'CHARGEBACK_PENDING'`, `'CHARGEBACK_LOST'` | Independent state machine #2 (`PaymentStatus`). |
| `delivery_status` | `'NOT_REQUIRED'`, `'PENDING_DISPATCH'`, `'OFFERING'`, `'ASSIGNED'`, `'ARRIVED_AT_STORE'`, `'PICKED_UP'`, `'IN_TRANSIT'`, `'ARRIVED_AT_DROPOFF'`, `'DELIVERED'`, `'RETURNED'`, `'FAILED'`, `'CANCELLED'` | Independent state machine #3 (`DeliveryStatus`). |
| `ledger_account_type` | `'ASSET'`, `'LIABILITY'`, `'EQUITY'`, `'REVENUE'`, `'EXPENSE'` | Double-entry accounting account classification. |
| `ledger_entry_direction` | `'DEBIT'`, `'CREDIT'` | Double-entry posting direction. |
| `provider_category` | `'PSP'`, `'MAPS'`, `'EMAIL'`, `'PUSH_ANDROID'`, `'PUSH_IOS'`, `'SMS_OTP'`, `'KYC'` | External provider adapter category. |
| `provider_readiness_status` | `'ACTIVE'`, `'SANDBOX_READY'`, `'BLOCKED_MISSING_CREDENTIALS'`, `'DISABLED'` | Honest readiness state of external adapters. |

---

## 2. Public Domain Tables (46 Tables)

### 2.1 Identity, Access, Governance & Configuration (`M02` / `M03`)
1. **`profiles`**: Core identity linked `1:1` to `auth.users(id)`. Stores `email`, `full_name`, `phone`, `preferred_locale` (`en` default), `status`, `mfa_enforced`, and `legal_hold_until`. Protected by `trg_guard_profile_self_update`.
2. **`user_preferences`**: Notification & locale preferences per user (`locale`, `push_order_updates`, `push_promotions`, `email_transactional`, `email_marketing`).
3. **`organizations`**: Merchant legal entities (`slug`, `legal_name`, `trade_name`, `tax_id`, `status`, `is_multi_unit_enabled`, `feature_grocery_picking_enabled`).
4. **`stores`**: Physical or dark-kitchen merchant units linked to `organizations`. Includes `status`, `is_published`, `is_paused`, `timezone` (`America/Sao_Paulo`), `min_order_cents`, `supported_modalities`, and coordinates.
5. **`store_hours`**: Weekly operating windows (`day_of_week` 0-6, `opens_at`, `closes_at`, `is_overnight`).
6. **`store_hour_exceptions`**: Holiday or special date overrides per store.
7. **`store_service_areas`**: Delivery radius (`radius_meters`), `base_fee_cents`, `per_km_fee_cents`, and `free_delivery_min_order_cents`.
8. **`organization_members`**: Multi-tenant RBAC/ABAC binding `(organization_id, store_id, user_id, role)`. `store_id = NULL` grants organization-wide scope; non-null restricts to a single store.
9. **`staff_scopes`**: Internal platform staff assignments (`user_id`, `role`, `region_code`, `max_refund_approval_cents`, `requires_mfa`).
10. **`invitations`**: Single-use expiring invitations (`token_hash`, `expires_at`, `consumed_at`) for partner or staff onboarding.
11. **`approval_events`**: Immutable audit trail of partner/courier onboarding approvals and suspensions.
12. **`user_devices`**: Registered mobile/web push tokens and device sessions with `revoked_at` support.
13. **`privacy_requests`**: LGPD data export, anonymization, and deletion requests with legal retention hold tracking.
14. **`audit_logs`**: Append-only (`trg_audit_logs_immutable`) governance trail with `correlation_id`, `actor_id`, `action`, and `redacted_payload`.
15. **`platform_policies`**: Database-persisted operational & commercial rules (`DEFAULT_BR_MARKETPLACE`: commissions in bps, service fee cap in cents, quote TTL, cancellation window, feature flags).
16. **`provider_configurations`**: Pre-configured external provider registry (`stripe`, `mercadopago`, `pagarme`, `google_maps`, `mapbox`, `resend`, `fcm`, `apns`) with `required_env_vars` and honest `status`.

### 2.2 Catalog, Pricing, Cart, Quotes & Orders (`M04` - `M10`)
17. **`catalog_categories`**: Bilingual (`name_en`, `name_pt_br`) menu categories per store.
18. **`catalog_products`**: Bilingual products with `price_cents`, `is_available`, `is_paused`, `max_per_order`, and `unit_of_measure`.
19. **`catalog_option_groups`**: Modifier groups (`min_selections`, `max_selections`) for product customization.
20. **`catalog_options`**: Individual modifiers with `additional_price_cents`.
21. **`customer_addresses`**: Saved delivery addresses and coordinates per consumer.
22. **`promotions`**: Coupons and promotional campaigns (`funded_by`, `discount_type`, `discount_value`, `budget_limit_cents`, `budget_consumed_cents`).
23. **`promotion_redemptions`**: Per-user/order coupon consumption records.
24. **`quotes`**: Server-calculated immutable pricing snapshots (`subtotal_cents`, `addons_cents`, `service_fee_cents`, `delivery_fee_cents`, `discount_cents`, `total_cents`, `idempotency_key`, `expires_at`).
25. **`orders`**: Core transactional entity tracking `order_status`, `payment_status`, `delivery_status`, financial split in cents (`platform_commission_cents`, `merchant_net_cents`, `courier_earnings_cents`), optimistic locking `version`, and `idempotency_key`.
26. **`order_items`**: Snapshot of purchased items (`unit_price_cents`, `addons_unit_price_cents`, `total_line_cents`).
27. **`order_item_options`**: Snapshot of selected item modifiers.
28. **`order_events`**: Append-only (`trg_order_events_immutable`) state transition history for every order.

### 2.3 Logistics, Dispatch, Couriers & Tracking (`M11`)
29. **`couriers`**: Courier profiles (`approval_status`, `document_number_hash`, `vehicle_type`, `is_online`).
30. **`courier_vehicles`**: Registered vehicles per courier.
31. **`delivery_tasks`**: Dispatch tasks linked `1:1` to `orders`, tracking pickup/dropoff coordinates, `courier_fee_cents`, and `active_courier_id`.
32. **`delivery_offers`**: Individual dispatch offers sent to couriers with expiration and acceptance status.
33. **`delivery_assignments`**: Active/historical courier assignment bindings.
34. **`courier_location_samples`**: Append-only (`trg_courier_location_samples_immutable`) GPS telemetry samples.
35. **`delivery_events`**: Append-only (`trg_delivery_events_immutable`) logistics & proof-of-delivery (PoD) event trail.

### 2.4 Payments, Double-Entry Ledger & Settlements (`M12` / `M13`)
36. **`payment_attempts`**: Idempotent payment authorization/capture records (`provider_code`, `payment_method`, `amount_cents`, `status`).
37. **`payment_provider_events`**: Append-only (`trg_payment_provider_events_immutable`) deduplicated webhook events (`provider_code`, `provider_event_id`).
38. **`refunds`**: Partial or full refund records (`amount_cents`, `reason_code`, `requested_by`, `approved_by`).
39. **`ledger_accounts`**: Chart of accounts (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`) scoped to platform, `organization_id`, or `courier_id`.
40. **`ledger_journals`**: Double-entry journal headers (`reference_type`, `reference_id`, `idempotency_key`). Enforced by deferred constraint trigger `trg_verify_journal_balanced`.
41. **`ledger_entries`**: Append-only (`trg_ledger_entries_immutable`) `DEBIT` and `CREDIT` lines in integer cents.
42. **`settlements`**: Merchant and courier payout batches linked to `ledger_journals`.
43. **`reconciliation_runs`**: PSP vs internal ledger reconciliation execution reports.

### 2.5 Support, Commercial, Reviews, Outbox & Risk (`M14` - `M19`)
44. **`support_cases`**: Customer/partner/courier tickets with SLA tracking (`sla_due_at`).
45. **`support_messages`**: Ticket thread messages with internal-note isolation (`is_internal_note`).
46. **`support_action_requests`**: Dual-control approval workflow for sensitive support/financial overrides.
47. **`commercial_leads`**: B2B merchant acquisition pipeline.
48. **`merchant_contracts`**: Versioned commission and payout terms per organization (`legal_template_status`).
49. **`order_reviews`**: Verified post-order ratings (`store_rating`, `courier_rating`).
50. **`outbox_events`**: Transactional outbox queue for asynchronous worker processing.
51. **`notification_deliveries`**: Multi-channel push/email delivery log.
52. **`risk_decisions`**: Append-only (`trg_risk_decisions_immutable`) fraud and abuse evaluation records.
*(Note: Total public tables = 46; views = 1 `published_stores_v`).*
