# iDeliveryFood — Entity-Relationship Diagram (ERD)

**Module:** `M02` — Data Platform, Schema, RLS, Storage, Realtime & Seeds  
**Database Engine:** PostgreSQL 17.11 (Supabase Project `dwsoochnfxldfvcaijie`, `us-east-1`)  
**Total Public Tables:** 46 (100% RLS-enabled)

---

## 1. Core Identity, Multi-Tenant Organizations, Catalog & Orders ERD

```mermaid
erDiagram
    profiles ||--o| user_preferences : "has"
    profiles ||--o{ customer_addresses : "owns"
    profiles ||--o{ organization_members : "member_of"
    profiles ||--o{ staff_scopes : "assigned_scope"
    profiles ||--o{ user_devices : "registers"
    profiles ||--o{ privacy_requests : "submits"
    profiles ||--o| couriers : "is_courier"

    organizations ||--o{ stores : "operates"
    organizations ||--o{ organization_members : "grants"
    organizations ||--o{ merchant_contracts : "signs"
    organizations ||--o{ ledger_accounts : "holds"
    organizations ||--o{ settlements : "receives"

    stores ||--o{ store_hours : "schedules"
    stores ||--o{ store_hour_exceptions : "overrides"
    stores ||--o{ store_service_areas : "covers"
    stores ||--o{ catalog_categories : "organizes"
    stores ||--o{ catalog_products : "sells"
    stores ||--o{ quotes : "calculates"
    stores ||--o{ orders : "fulfills"
    stores ||--o{ delivery_tasks : "dispatches"

    catalog_categories ||--o{ catalog_products : "contains"
    catalog_products ||--o{ catalog_option_groups : "customizes"
    catalog_option_groups ||--o{ catalog_options : "offers"

    quotes ||--o| orders : "converts_to"
    orders ||--o{ order_items : "contains"
    order_items ||--o{ order_item_options : "includes"
    orders ||--o{ order_events : "records_history"
    orders ||--o{ payment_attempts : "charges"
    orders ||--o{ refunds : "reverses"
    orders ||--o| delivery_tasks : "triggers"
    orders ||--o{ support_cases : "opens"
    orders ||--o{ order_reviews : "evaluates"
```

---

## 2. Logistics, Double-Entry Ledger, Payments & Governance ERD

```mermaid
erDiagram
    couriers ||--o{ courier_vehicles : "drives"
    couriers ||--o{ delivery_offers : "receives"
    couriers ||--o{ delivery_assignments : "accepts"
    couriers ||--o{ courier_location_samples : "streams"
    couriers ||--o{ ledger_accounts : "holds"
    couriers ||--o{ settlements : "receives"

    delivery_tasks ||--o{ delivery_offers : "broadcasts"
    delivery_tasks ||--o{ delivery_assignments : "assigns"
    delivery_tasks ||--o{ delivery_events : "logs"
    delivery_tasks ||--o{ courier_location_samples : "tracks"

    payment_attempts ||--o{ payment_provider_events : "receives_webhooks"
    payment_attempts ||--o{ refunds : "backs"

    ledger_journals ||--o{ ledger_entries : "balances"
    ledger_accounts ||--o{ ledger_entries : "posts_to"
    ledger_journals ||--o{ settlements : "settles"

    support_cases ||--o{ support_messages : "threads"
    support_cases ||--o{ support_action_requests : "requests_dual_control"
```
