# iDeliveryFood — Complete Data Dictionary (`public`, `app_security` & `storage` Schemas) (`M00`–`M26`)

**Module:** `M02` / `M26`  
**Target Supabase Project:** `dwsoochnfxldfvcaijie` (`db.dwsoochnfxldfvcaijie.supabase.co:5432/postgres`)  
**Total Public Tables:** `59 / 59` (100% RLS-enabled, 100% populated with `>= 1` row)  
**Total Security-Invoker Views:** `4` (`published_stores_v`, `store_catalog_v`, `ledger_account_balances_v`, `analytics_order_kpis_v`)  
**Total Hardened Storage Buckets:** `13`  
**Monetary Standard:** Integer `bigint` / `integer` in Brazilian Real centavos (`*_cents`). Floating-point types (`float`, `real`) are strictly prohibited for money.  
**Temporal Standard:** `timestamptz` stored in UTC, evaluated and formatted in `America/Sao_Paulo`.  
**Synthetic Seed Flag:** Every domain table includes `is_test_data boolean NOT NULL DEFAULT false` to isolate synthetic test records (`supabase/seed.sql`) from production metrics (`?excludeTestData=true`).

---

## 1. Custom Enumerated Types (`public`)

| Enum Name | Allowed Values | Purpose |
| :--- | :--- | :--- |
| `locale_code` | `'en'`, `'pt-BR'` | Supported UI & communication locales (`en` default, `pt-BR` selectable). |
| `account_status` | `'PENDING_VERIFICATION'`, `'PENDING_APPROVAL'`, `'ACTIVE'`, `'SUSPENDED'`, `'BLOCKED'`, `'DEACTIVATED'`, `'DELETED'` | Lifecycle state of profiles, organizations, and couriers. |
| `partner_role` | `'partner_owner'`, `'partner_manager'`, `'partner_operator'`, `'partner_catalog'`, `'partner_finance'`, `'partner_marketing'`, `'partner_support'` | Multi-tenant merchant roles in `organization_members`. |
| `staff_role` | `'support'`, `'support_l1'`, `'support_l2'`, `'operations'`, `'logistics'`, `'finance'`, `'commercial'`, `'marketing'`, `'growth_marketing'`, `'risk_compliance'`, `'auditor_privacy'`, `'tech_admin'` | Internal platform staff roles in `staff_scopes`. |
| `fulfillment_modality` | `'PLATFORM_DELIVERY'`, `'MERCHANT_DELIVERY'`, `'PICKUP'` | Hybrid fulfillment mode per store/quote/order. |
| `store_status` | `'DRAFT'`, `'PENDING_REVIEW'`, `'ACTIVE'`, `'PAUSED'`, `'SUSPENDED'`, `'CLOSED'` | Store operational lifecycle. |
| `order_status` | `'DRAFT'`, `'QUOTED'`, `'CREATED'`, `'AWAITING_PAYMENT'`, `'PENDING_ACCEPTANCE'`, `'PENDING_MERCHANT_ACCEPTANCE'`, `'ACCEPTED'`, `'PREPARING'`, `'READY_FOR_PICKUP'`, `'DISPATCHED'`, `'DISPATCHING'`, `'COURIER_ASSIGNED'`, `'PICKED_UP'`, `'IN_TRANSIT'`, `'OUT_FOR_DELIVERY'`, `'ARRIVED_AT_DESTINATION'`, `'DELIVERED'`, `'COMPLETED'`, `'CANCELLED'`, `'EXPIRED'`, `'REJECTED'`, `'DELIVERY_FAILED'`, `'DISPUTED'`, `'REFUNDED'` | Independent state machine #1 (`OrderStatus`). |
| `payment_status` | `'UNPAID'`, `'PENDING'`, `'REQUIRES_ACTION'`, `'AUTHORIZED'`, `'CAPTURED'`, `'PARTIALLY_REFUNDED'`, `'REFUNDED'`, `'FAILED'`, `'CANCELLED'`, `'CHARGEBACK_PENDING'`, `'CHARGEBACK_LOST'` | Independent state machine #2 (`PaymentStatus`). |
| `delivery_status` | `'NOT_APPLICABLE'`, `'NOT_REQUIRED'`, `'UNASSIGNED'`, `'PENDING_DISPATCH'`, `'OFFERED'`, `'OFFERING'`, `'ASSIGNED'`, `'COURIER_ASSIGNED'`, `'AT_STORE'`, `'ARRIVED_AT_STORE'`, `'PICKED_UP'`, `'IN_TRANSIT'`, `'AT_CUSTOMER'`, `'ARRIVED_AT_DROPOFF'`, `'DELIVERED'`, `'COMPLETED'`, `'RETURNED'`, `'FAILED'`, `'DELIVERY_FAILED'`, `'CANCELLED'` | Independent state machine #3 (`DeliveryStatus`). |
| `ledger_account_type` | `'ASSET'`, `'LIABILITY'`, `'EQUITY'`, `'REVENUE'`, `'EXPENSE'` | Double-entry accounting account classification. |
| `ledger_entry_direction` | `'DEBIT'`, `'CREDIT'` | Double-entry posting direction. |
| `provider_category` | `'PSP'`, `'MAPS'`, `'EMAIL'`, `'PUSH_ANDROID'`, `'PUSH_IOS'`, `'SMS_OTP'`, `'KYC'` | External provider adapter category. |
| `provider_readiness_status` | `'ACTIVE'`, `'ACTIVE_PRODUCTION'`, `'SANDBOX_READY'`, `'BLOCKED_MISSING_CREDENTIALS'`, `'DISABLED'` | Honest readiness state of external adapters. |

---

## 2. Complete Catalog of All 59 Public Tables

### 2.1 Identity, Access, Governance & Platform Policies (`M01`–`M03`, `M16`)
1. **`profiles`**: Core identity linked `1:1` to `auth.users(id)`. Columns: `id (uuid PK)`, `email`, `full_name`, `phone`, `preferred_locale ('en' default)`, `status (account_status)`, `mfa_enforced (boolean)`, `legal_hold_until (timestamptz)`, `is_test_data`. Protected by `trg_guard_profile_self_update`.
2. **`user_preferences`**: Notification & locale preferences (`user_id PK`, `locale`, `push_order_updates`, `push_promotions`, `email_transactional`, `email_marketing`, `is_test_data`).
3. **`user_devices`**: Registered mobile/web push tokens and device sessions (`id`, `user_id`, `platform`, `push_token`, `device_identifier`, `app_version`, `push_consent_granted`, `revoked_at`, `is_test_data`).
4. **`organizations`**: Merchant legal entities (`id`, `slug UNIQUE`, `legal_name`, `trade_name`, `tax_id`, `status`, `is_multi_unit_enabled`, `feature_grocery_picking_enabled`, `is_test_data`).
5. **`organization_members`**: Multi-tenant RBAC/ABAC binding (`id`, `organization_id`, `store_id NULLABLE`, `user_id`, `role partner_role`, `is_active`, `is_test_data`). `store_id = NULL` grants organization-wide scope; non-null restricts to a single store unit.
6. **`staff_scopes`**: Internal platform staff assignments (`id`, `user_id`, `role staff_role`, `region_code`, `max_refund_approval_cents`, `requires_mfa`, `is_active`, `granted_by`, `is_test_data`). Protected by `trg_guard_staff_scope_self_grant`.
7. **`invitations`**: Single-use expiring invitations (`id`, `organization_id`, `store_id`, `invited_email`, `role`, `token_hash UNIQUE`, `status`, `invited_by`, `expires_at`, `consumed_at`, `is_test_data`).
8. **`approval_events`**: Append-only onboarding approval, rejection, and suspension history (`id`, `target_type`, `target_id`, `organization_id`, `previous_status`, `new_status`, `decided_by`, `reason`, `is_test_data`).
9. **`audit_logs`**: Append-only (`trg_audit_logs_immutable`) governance trail (`id`, `actor_id`, `action`, `target_type`, `target_id`, `correlation_id`, `reason`, `redacted_payload jsonb`, `created_at`, `is_test_data`).
10. **`platform_policies`**: Database-persisted operational & commercial rules (`policy_key PK`, `currency_code = 'BRL'`, `operational_timezone = 'America/Sao_Paulo'`, `platform_delivery_commission_bps`, `merchant_delivery_commission_bps`, `pickup_commission_bps`, `service_fee_bps`, `service_fee_cap_cents`, `quote_ttl_seconds`, `free_cancel_window_seconds`, `support_auto_refund_limit_cents`, `feature_fleet_operators_enabled`, `feature_grocery_picking_enabled`, `feature_sponsored_ads_enabled`, `feature_subscriptions_enabled`, `is_test_data`).
11. **`provider_configurations`**: Pre-configured external provider registry (`provider_code PK`, `category`, `display_name`, `is_enabled`, `is_primary`, `status`, `required_env_vars text[]`, `webhook_tolerance_seconds`, `capabilities jsonb`, `is_test_data`).
12. **`storage_upload_intents`**: Signed upload URL audit intents (`id`, `bucket_id`, `object_path`, `mime_type`, `file_size_bytes`, `uploaded_by`, `store_id`, `organization_id`, `signed_token_hash`, `expires_at`, `is_test_data`).

### 2.2 Stores, Operating Hours, Coverage, Catalog & Multi-Unit Batch (`M04`, `M07`, `M09`)
13. **`stores`**: Merchant units linked to `organizations` (`id`, `organization_id`, `slug UNIQUE`, `name`, `description_en`, `description_pt_br`, `cuisine_category`, `status`, `is_published`, `is_paused`, `timezone`, `address_line`, `city`, `state_code`, `postal_code`, `latitude`, `longitude`, `min_order_cents`, `prep_time_min_minutes`, `prep_time_max_minutes`, `supported_modalities fulfillment_modality[]`, `is_test_data`).
14. **`store_hours`**: Weekly operating windows (`id`, `store_id`, `day_of_week 0..6`, `opens_at`, `closes_at`, `is_overnight`, `is_closed`, `is_test_data`).
15. **`store_hour_exceptions`**: Holiday or special date overrides (`id`, `store_id`, `exception_date`, `is_closed`, `opens_at`, `closes_at`, `reason`, `is_test_data`).
16. **`store_service_areas`**: Haversine delivery radius & fee tiers (`id`, `store_id`, `name`, `radius_meters`, `base_fee_cents`, `per_km_fee_cents`, `free_delivery_min_order_cents`, `estimated_delivery_minutes`, `is_active`, `is_test_data`).
17. **`store_delivery_policies`**: Store-specific delivery SLA and modality overrides (`id`, `store_id`, `modality`, `custom_base_fee_cents`, `max_radius_meters`, `is_active`, `is_test_data`).
18. **`catalog_categories`**: Bilingual menu categories (`id`, `store_id`, `name_en`, `name_pt_br`, `sort_order`, `is_active`, `is_test_data`).
19. **`catalog_products`**: Bilingual products (`id`, `store_id`, `category_id`, `sku`, `name_en`, `name_pt_br`, `description_en`, `description_pt_br`, `price_cents`, `is_available`, `is_paused`, `max_per_order`, `unit_of_measure`, `pricing_unit ('UNIT'|'KG'|'WEIGHT_GRAMS')`, `estimated_weight_grams`, `price_per_kg_cents`, `is_test_data`).
20. **`catalog_option_groups`**: Product modifier groups (`id`, `product_id`, `store_id`, `name_en`, `name_pt_br`, `min_selections`, `max_selections`, `sort_order`, `is_test_data`). Enforces `min_selections <= max_selections`.
21. **`catalog_options`**: Individual modifiers (`id`, `option_group_id`, `store_id`, `name_en`, `name_pt_br`, `additional_price_cents`, `is_available`, `sort_order`, `is_test_data`).
22. **`catalog_item_stock`**: Optional per-product inventory counter (`product_id PK`, `store_id`, `available_quantity`, `low_stock_threshold`, `is_test_data`).
23. **`multi_unit_catalog_batches`**: Audit log of `M09` multi-unit batch catalog propagation executions (`id`, `organization_id`, `actor_id`, `operation_type`, `dry_run`, `results_json jsonb`, `is_test_data`).

### 2.3 Customer Addresses, Carts, Server Quotes & Orders (`M05`, `M08`, `M10`)
24. **`customer_addresses`**: Saved delivery addresses and coordinates per consumer (`id`, `user_id`, `label`, `recipient_name`, `street_line`, `number`, `complement`, `neighborhood`, `city`, `state_code`, `postal_code`, `latitude`, `longitude`, `delivery_instructions`, `is_default`, `is_test_data`).
25. **`carts`**: Persistent single-store customer shopping baskets (`id`, `customer_id`, `store_id`, `fulfillment_modality`, `promotion_code`, `updated_at`, `is_test_data`).
26. **`cart_items`**: Line items inside active customer carts (`id`, `cart_id`, `product_id`, `quantity`, `selected_options jsonb`, `notes`, `is_test_data`).
27. **`quotes`**: Server-calculated immutable pricing snapshots (`id`, `customer_id`, `store_id`, `address_id`, `fulfillment_modality`, `promotion_id`, `promotion_code`, `currency_code = 'BRL'`, `subtotal_cents`, `addons_cents`, `service_fee_cents`, `delivery_fee_cents`, `discount_cents`, `total_cents`, `distance_meters`, `estimated_prep_minutes`, `estimated_delivery_minutes`, `items_snapshot jsonb`, `address_snapshot jsonb`, `idempotency_key UNIQUE`, `expires_at`, `consumed_at`, `is_test_data`).
28. **`orders`**: Core transactional entity (`id`, `order_number UNIQUE`, `customer_id`, `organization_id`, `store_id`, `quote_id UNIQUE`, `fulfillment_modality`, `order_status`, `payment_status`, `delivery_status`, `currency_code = 'BRL'`, `subtotal_cents`, `addons_cents`, `service_fee_cents`, `delivery_fee_cents`, `discount_cents`, `total_cents`, `platform_commission_cents`, `merchant_net_cents`, `courier_earnings_cents`, `delivery_address_snapshot jsonb`, `customer_notes`, `cancellation_reason`, `cancelled_by_role`, `version`, `idempotency_key`, `accepted_at`, `ready_at`, `delivered_at`, `cancelled_at`, `is_test_data`).
29. **`order_items`**: Immutable snapshot of purchased items (`id`, `order_id`, `product_id`, `product_name_snapshot_en`, `product_name_snapshot_pt_br`, `quantity`, `unit_price_cents`, `addons_unit_price_cents`, `total_line_cents`, `substitution_preference`, `pricing_unit`, `estimated_weight_grams`, `actual_weight_grams`, `price_per_kg_cents`, `adjusted_line_cents`, `is_test_data`).
30. **`order_item_options`**: Snapshot of selected item modifiers (`id`, `order_item_id`, `option_id`, `option_name_snapshot_en`, `option_name_snapshot_pt_br`, `quantity`, `additional_price_cents`, `is_test_data`).
31. **`order_events`**: Append-only (`trg_order_events_immutable`) state transition history (`id`, `order_id`, `actor_id`, `actor_role`, `event_type`, `previous_order_status`, `new_order_status`, `previous_payment_status`, `new_payment_status`, `previous_delivery_status`, `new_delivery_status`, `idempotency_key`, `payload jsonb`, `created_at`, `is_test_data`).

### 2.4 Logistics, Couriers, Dispatch, GPS Telemetry & Fleet Governance (`M11`, `M14`, `M15`)
32. **`couriers`**: Courier profiles (`id PK REFERENCES profiles`, `approval_status`, `document_number_hash`, `active_region_code`, `vehicle_type`, `is_online`, `is_test_data`).
33. **`courier_vehicles`**: Registered vehicles per courier (`id`, `courier_id`, `vehicle_type`, `plate_code`, `model_description`, `is_active`, `is_test_data`).
34. **`courier_documents`**: Courier KYC document metadata linked to `courier-documents` bucket (`id`, `courier_id`, `document_type`, `storage_path`, `verification_status`, `reviewed_by`, `is_test_data`).
35. **`courier_shifts`**: Courier availability windows and online shift sessions (`id`, `courier_id`, `region_code`, `started_at`, `ended_at`, `is_test_data`).
36. **`delivery_tasks`**: Dispatch tasks linked `1:1` to `orders` (`id`, `order_id UNIQUE`, `store_id`, `fulfillment_modality`, `status`, `pickup_latitude`, `pickup_longitude`, `dropoff_latitude`, `dropoff_longitude`, `dropoff_neighborhood_only`, `dropoff_full_address`, `confirmation_code_hash`, `courier_fee_cents`, `distance_meters`, `estimated_eta_minutes`, `active_courier_id`, `picked_up_at`, `completed_at`, `is_test_data`).
37. **`delivery_offers`**: Individual dispatch offers sent to couriers (`id`, `delivery_task_id`, `courier_id`, `offered_fee_cents`, `status`, `pickup_store_name`, `distance_meters`, `dropoff_neighborhood_only`, `expires_at`, `responded_at`, `is_test_data`).
38. **`delivery_assignments`**: Active/historical courier assignment bindings (`id`, `delivery_task_id`, `courier_id`, `offer_id`, `assigned_by_actor_id`, `status`, `assigned_at`, `ended_at`, `is_test_data`). Enforces partial unique index `uq_delivery_assignments_one_active` (`WHERE status = 'ACTIVE'`).
39. **`courier_location_samples`**: Append-only (`trg_courier_location_samples_immutable`) GPS telemetry (`id`, `courier_id`, `delivery_task_id`, `latitude`, `longitude`, `accuracy_meters`, `recorded_at`, `expires_at`, `is_test_data`).
40. **`delivery_events`**: Append-only (`trg_delivery_events_immutable`) logistics & PoD OTP event trail (`id`, `delivery_task_id`, `courier_id`, `event_type`, `payload jsonb`, `idempotency_key`, `created_at`, `is_test_data`).
41. **`fleet_operators`**: Third-party logistics fleet companies (`M15`, governed by `feature_fleet_operators_enabled`: `id`, `legal_name`, `trade_name`, `tax_id`, `status`, `region_code`, `commission_share_bps`, `is_test_data`).
42. **`fleet_courier_memberships`**: Binding between `fleet_operators` and `couriers` (`id`, `fleet_operator_id`, `courier_id`, `status`, `is_test_data`).

### 2.5 Payments, Refunds, Double-Entry Ledger, Settlements & Bank Change Requests (`M07`, `M12`, `M13`)
43. **`payment_attempts`**: Idempotent payment authorization/capture records (`id`, `order_id`, `customer_id`, `provider_code`, `payment_method`, `amount_cents`, `currency_code = 'BRL'`, `status`, `external_payment_id`, `idempotency_key UNIQUE`, `is_sandbox`, `error_code`, `is_test_data`).
44. **`payment_provider_events`**: Append-only (`trg_payment_provider_events_immutable`) deduplicated webhook events (`id`, `provider_code`, `external_event_id`, `payment_attempt_id`, `event_type`, `signature_verified`, `processed_at`, `redacted_payload jsonb`, `is_test_data`, `UNIQUE (provider_code, external_event_id)`).
45. **`refunds`**: Partial or full refund records (`id`, `order_id`, `payment_attempt_id`, `amount_cents`, `reason`, `requested_by`, `approved_by`, `status`, `idempotency_key UNIQUE`, `is_test_data`).
46. **`ledger_accounts`**: Chart of accounts (`id`, `code UNIQUE`, `name`, `account_type`, `organization_id`, `courier_id`, `currency_code = 'BRL'`, `is_test_data`).
47. **`ledger_journals`**: Double-entry journal headers (`id`, `reference_type`, `reference_id`, `description`, `idempotency_key UNIQUE`, `posted_by`, `created_at`, `is_test_data`). Enforced by deferred constraint trigger `trg_verify_journal_balanced` (`SUM(DEBIT) == SUM(CREDIT)`).
48. **`ledger_entries`**: Append-only (`trg_ledger_entries_immutable`) `DEBIT` and `CREDIT` lines in integer BRL cents (`id`, `journal_id`, `account_id`, `direction`, `amount_cents > 0`, `created_at`, `is_test_data`).
49. **`settlements`**: Merchant and courier payout batches (`id`, `organization_id`, `courier_id`, `period_start`, `period_end`, `amount_cents`, `status`, `approved_by`, `external_payout_reference`, `journal_id`, `is_test_data`).
50. **`reconciliation_runs`**: PSP vs internal ledger reconciliation execution reports (`id`, `provider_code`, `run_date`, `matched_count`, `discrepancy_count`, `discrepancy_total_cents`, `status`, `discrepancies_json jsonb`, `is_test_data`).
51. **`bank_account_change_requests`**: Pending dual-control partner bank account change requests (`id`, `organization_id`, `store_id`, `requested_by`, `bank_code`, `branch_number`, `account_number_masked`, `pix_key_type`, `status`, `approved_by`, `is_test_data`).

### 2.6 Support, Commercial, Marketing, Outbox, Risk/LGPD & Grocery Picking (`M17`–`M22`)
52. **`support_cases`**: Customer/partner/courier tickets with SLA tracking (`id`, `case_number UNIQUE`, `order_id`, `delivery_task_id`, `organization_id`, `store_id`, `requester_id`, `requester_role`, `assigned_staff_id`, `category`, `priority`, `status`, `subject`, `sla_due_at`, `resolved_at`, `is_test_data`).
53. **`support_messages`**: Ticket thread messages with internal-note isolation (`id`, `case_id`, `sender_id`, `body`, `is_internal_note`, `created_at`, `is_test_data`).
54. **`support_attachments`**: SHA-256 verified ticket attachments (`id`, `case_id`, `message_id`, `uploaded_by`, `storage_bucket`, `object_path`, `mime_type`, `byte_size`, `sha256_hex`, `is_internal_only`, `is_test_data`).
55. **`support_action_requests`**: 4-eyes financial approval requests from support (`id`, `case_id`, `order_id`, `requested_by`, `action_type`, `amount_cents`, `reason`, `status`, `decided_by`, `decided_at`, `decision_notes`, `is_test_data`, `CHECK (decided_by IS NULL OR decided_by <> requested_by)`).
56. **`commercial_leads`**: B2B merchant acquisition leads (`id`, `legal_name`, `trade_name`, `tax_id`, `contact_email`, `contact_phone`, `city`, `state_code`, `cuisine_category`, `legal_basis`, `status`, `owner_staff_id`, `converted_organization_id`, `notes`, `is_test_data`).
57. **`commercial_proposals`**: B2B commercial proposals in basis points (`id`, `lead_id`, `organization_id`, `proposal_version`, `platform_delivery_commission_bps`, `merchant_delivery_commission_bps`, `pickup_commission_bps`, `service_fee_bps`, `payout_cycle_days`, `legal_template_status`, `status`, `proposed_by_staff_id`, `valid_until`, `notes`, `is_test_data`).
58. **`merchant_contracts`**: Versioned merchant contracts (`id`, `organization_id`, `version_number`, `platform_delivery_commission_bps`, `merchant_delivery_commission_bps`, `pickup_commission_bps`, `service_fee_bps`, `payout_cycle_days`, `legal_template_status`, `effective_from`, `effective_until`, `approved_by`, `accepted_by_partner_owner_id`, `accepted_at`, `is_test_data`).
59. **`commission_rule_versions`**: Active and historical commission rule versions (`id`, `organization_id`, `contract_id`, `version_number`, `platform_delivery_commission_bps`, `merchant_delivery_commission_bps`, `pickup_commission_bps`, `service_fee_bps`, `effective_from`, `effective_until`, `created_by_staff_id`, `is_test_data`).
60. **`promotions`**: Coupons and promotional campaigns (`id`, `code UNIQUE`, `store_id NULLABLE`, `funded_by ('PLATFORM'|'STORE'|'MERCHANT'|'SHARED')`, `platform_share_bps`, `discount_type`, `discount_value`, `max_discount_cents`, `min_order_cents`, `budget_limit_cents`, `budget_consumed_cents`, `max_uses_per_user`, `first_order_only`, `starts_at`, `ends_at`, `is_active`, `created_by`, `is_test_data`, `CHECK (budget_consumed_cents <= budget_limit_cents)`).
61. **`promotion_redemptions`**: Per-user/order atomic coupon consumption records (`id`, `promotion_id`, `order_id`, `customer_id`, `discount_applied_cents`, `platform_subsidy_cents`, `merchant_subsidy_cents`, `status`, `idempotency_key`, `is_test_data`).
62. **`order_reviews`**: Verified post-order ratings (`id`, `order_id UNIQUE`, `store_id`, `customer_id`, `rating 1..5`, `comment`, `partner_reply`, `partner_replied_at`, `moderation_status`, `moderated_by`, `moderation_reason`, `is_test_data`).
63. **`outbox_events`**: Transactional outbox queue (`id`, `aggregate_type`, `aggregate_id`, `event_type`, `idempotency_key UNIQUE`, `payload jsonb`, `status ('PENDING'|'FAILED_RETRY'|'PUBLISHED'|'DELIVERED'|'DEAD_LETTER')`, `attempts`, `max_attempts`, `next_attempt_at`, `last_error`, `processed_at`, `is_test_data`).
64. **`notification_deliveries`**: Multi-channel delivery log with monotonic `cursor_seq` (`id`, `cursor_seq bigserial`, `outbox_event_id`, `recipient_user_id`, `channel`, `template_key`, `template_version`, `category`, `locale`, `title`, `body`, `payload jsonb`, `status`, `provider_code`, `idempotency_key`, `read_at`, `last_error`, `is_test_data`).
65. **`risk_alerts`**: Explainable fraud/operational alerts (`id`, `subject_type`, `subject_id`, `rule_code`, `severity`, `status ('OPEN_AWAITING_HUMAN_REVIEW'|'CONFIRMED_RISK_RESTRICTED'|'APPROVED_OVERRIDE'|'DISMISSED_FALSE_POSITIVE')`, `rule_explanation_json jsonb`, `recommended_action`, `reviewed_by`, `review_decision`, `review_reason`, `reviewed_at`, `is_test_data`).
66. **`risk_decisions`**: Append-only (`trg_risk_decisions_immutable`) human review records (`id`, `alert_id`, `subject_type`, `subject_id`, `rule_code`, `decision`, `human_reviewer_id`, `justification`, `rule_explanation_json jsonb`, `created_at`, `is_test_data`).
67. **`privacy_requests`**: LGPD Art. 18 data portability, anonymization, and deletion requests (`id`, `user_id`, `request_type ('EXPORT_DATA'|'ANONYMIZE_ACCOUNT'|'DELETE_ACCOUNT')`, `status`, `reason`, `processed_by`, `export_payload jsonb`, `legal_basis_note`, `completed_at`, `is_test_data`).
68. **`order_pick_tasks`**: Grocery picking & scale weighing tasks (`id`, `order_id UNIQUE`, `store_id`, `customer_id`, `picker_actor_id`, `status`, `pre_authorized_total_cents`, `final_picked_total_cents`, `weight_adjustment_delta_cents`, `refund_adjustment_cents`, `notes`, `started_at`, `completed_at`, `is_test_data`).
69. **`order_item_substitutions`**: Customer-consented grocery item substitutions (`id`, `pick_task_id`, `order_id`, `store_id`, `customer_id`, `order_item_id`, `original_product_id`, `suggested_product_id`, `suggested_product_name_en`, `suggested_product_name_pt_br`, `customer_preference`, `original_line_cents`, `suggested_line_cents`, `price_delta_cents`, `status`, `reason`, `expires_at`, `customer_decided_at`, `customer_decision_notes`, `is_test_data`).

*(Note: All 59 active public tables in Supabase `dwsoochnfxldfvcaijie` are covered above and verified non-empty via `node scripts/db-apply-migrations.mjs --check-empty`.)*

---

## 3. Security-Invoker Views (`WITH (security_invoker = true)`)

| View Name | Module | Description |
| :--- | :--- | :--- |
| `public.published_stores_v` | `M04` / `M05` | Exposes only active, published stores (`status = 'ACTIVE' AND is_published = true`) for anonymous and authenticated discovery. |
| `public.store_catalog_v` | `M04` / `M05` | Joins published stores, active categories, products, and option groups while respecting caller RLS. |
| `public.ledger_account_balances_v` | `M13` | Computes net debit/credit balance in integer BRL centavos per `ledger_accounts` row while enforcing caller RLS (segregating merchant, courier, and platform accounts). |
| `public.analytics_order_kpis_v` | `M21` | Computes order-level GMV, Net Platform Revenue, Merchant Net, Courier Earnings, and SLA durations (`acceptance_seconds`, `prep_seconds`, `total_fulfillment_seconds`) with `is_test_data` flag and caller RLS. |
