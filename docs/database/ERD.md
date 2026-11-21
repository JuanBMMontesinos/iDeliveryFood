# iDeliveryFood — Entity-Relationship Diagram (ERD) (`M00`–`M26`)

**Module:** `M02` / `M26` — Data Platform, Schema, RLS, Storage, Realtime & Seeds  
**Database Engine:** PostgreSQL 17.11 (Supabase Project `dwsoochnfxldfvcaijie`, `us-east-1`)  
**Total Public Tables:** `59 / 59` (`100%` RLS-enabled, `>= 1` row each)  
**Total Views (`security_invoker = true`):** `4` (`published_stores_v`, `store_catalog_v`, `ledger_account_balances_v`, `analytics_order_kpis_v`)  
**Total Storage Buckets:** `13 / 13` hardened buckets

---

## 1. Identity, Access, Multi-Tenant Organizations, Catalog & Grocery Picking ERD (`M01`–`M10`, `M22`)

```mermaid
erDiagram
    profiles ||--o| user_preferences : "has"
    profiles ||--o{ customer_addresses : "owns"
    profiles ||--o{ organization_members : "member_of"
    profiles ||--o{ staff_scopes : "assigned_scope"
    profiles ||--o{ user_devices : "registers"
    profiles ||--o{ privacy_requests : "submits"
    profiles ||--o| couriers : "is_courier"
    profiles ||--o{ audit_logs : "emits"

    organizations ||--o{ stores : "operates"
    organizations ||--o{ organization_members : "grants"
    organizations ||--o{ invitations : "issues"
    organizations ||--o{ merchant_contracts : "signs"
    organizations ||--o{ commission_rule_versions : "governs"
    organizations ||--o{ ledger_accounts : "holds"
    organizations ||--o{ settlements : "receives"
    organizations ||--o{ storage_upload_intents : "scopes"
    organizations ||--o{ bank_account_change_requests : "requests"

    stores ||--o{ store_hours : "schedules"
    stores ||--o{ store_hour_exceptions : "overrides"
    stores ||--o{ store_service_areas : "covers"
    stores ||--o{ catalog_categories : "organizes"
    stores ||--o{ catalog_products : "sells"
    stores ||--o{ promotions : "sponsors"
    stores ||--o{ quotes : "calculates"
    stores ||--o{ orders : "fulfills"
    stores ||--o{ delivery_tasks : "dispatches"
    stores ||--o{ order_pick_tasks : "picks"
    stores ||--o{ storage_upload_intents : "uploads"

    catalog_categories ||--o{ catalog_products : "contains"
    catalog_products ||--o{ catalog_option_groups : "customizes"
    catalog_option_groups ||--o{ catalog_options : "offers"

    quotes ||--o| orders : "converts_to"
    orders ||--o{ order_items : "contains"
    order_items ||--o{ order_item_options : "includes"
    orders ||--o{ order_events : "records_history"
    orders ||--o{ order_pick_tasks : "initiates_picking"
    order_pick_tasks ||--o{ order_item_substitutions : "proposes"
```

---

## 2. Logistics, Fleet Governance, Payments, Double-Entry Ledger & Settlements ERD (`M11`–`M15`)

```mermaid
erDiagram
    couriers ||--o{ courier_vehicles : "drives"
    couriers ||--o{ delivery_offers : "receives"
    couriers ||--o{ delivery_assignments : "accepts"
    couriers ||--o{ courier_location_samples : "streams"
    couriers ||--o{ delivery_events : "emits"
    couriers ||--o{ ledger_accounts : "holds"
    couriers ||--o{ settlements : "receives"

    fleet_operators ||--o{ fleet_courier_memberships : "manages"
    couriers ||--o{ fleet_courier_memberships : "belongs_to"

    orders ||--o| delivery_tasks : "triggers"
    delivery_tasks ||--o{ delivery_offers : "broadcasts"
    delivery_tasks ||--o{ delivery_assignments : "assigns_single_active"
    delivery_tasks ||--o{ delivery_events : "logs_pod"
    delivery_tasks ||--o{ courier_location_samples : "tracks_gps"

    orders ||--o{ payment_attempts : "charges"
    payment_attempts ||--o{ payment_provider_events : "receives_webhooks"
    orders ||--o{ refunds : "reverses"
    payment_attempts ||--o{ refunds : "backs"

    ledger_journals ||--o{ ledger_entries : "balances_debits_credits"
    ledger_accounts ||--o{ ledger_entries : "posts_to"
    ledger_journals ||--o{ settlements : "settles"
```

---

## 3. Support, B2B Commercial, Marketing, Transactional Outbox & Risk/LGPD Governance ERD (`M16`–`M21`)

```mermaid
erDiagram
    orders ||--o{ support_cases : "opens"
    support_cases ||--o{ support_messages : "threads"
    support_cases ||--o{ support_attachments : "attaches_evidence"
    support_cases ||--o{ support_action_requests : "requests_4_eyes_refund"

    commercial_leads ||--o{ commercial_proposals : "negotiates"
    commercial_proposals ||--o| organizations : "converts_to"
    organizations ||--o{ merchant_contracts : "versions"
    merchant_contracts ||--o{ commission_rule_versions : "activates"

    promotions ||--o{ promotion_redemptions : "consumes_budget"
    orders ||--o{ promotion_redemptions : "applies_discount"
    orders ||--o{ order_reviews : "verifies_purchase"

    outbox_events ||--o{ notification_deliveries : "dispatches"
    profiles ||--o{ notification_deliveries : "receives"

    risk_alerts ||--o{ risk_decisions : "requires_human_review"
    profiles ||--o{ risk_decisions : "decides"
```
