# ADR-003: Operational Fulfillment Modalities, Commercial Policies, and External Provider Adapters

- **Status:** Approved
- **Date:** 2026-11-03
- **Module:** M00 / M04 / M10 / M12 / M13 / M14 / M20

## Context
The platform requires clear defaults for delivery modalities, commercial fees, and external third-party providers (PSP, Maps, Messaging) so that development/test environments work deterministically with database-persisted policies while external integrations can be enabled via configuration without code rewrites or fake runtime responses.

## Decision
1. **Fulfillment Modalities:**
   - Hybrid fulfillment is approved and supported in schema and contracts:
     - `PLATFORM_DELIVERY` (dispatched to independent couriers via M14/M11)
     - `MERCHANT_DELIVERY` (fulfilled by the partner store's own couriers)
     - `PICKUP` (customer collects at the store)
   - Conditioned extensions `M15` (Fleet Operators) and `M22` (Grocery Picking/Substitutions) are documented in schema/contracts and disabled by default in `platform_policies`.

2. **Database-Persisted Default Commercial Policies (`public.platform_policies`):**
   - Currency: `BRL` stored strictly as integer centavos (`amount_cents`).
   - Timezone: Persisted in `UTC`, displayed and evaluated for store operating hours in `America/Sao_Paulo` (or store-specific IANA timezone).
   - Default configurable parameters (persisted in `platform_policies` and `store_delivery_policies` via `supabase/seed.sql`):
     - Platform commission: `1200` bps (12.00%) for `MERCHANT_DELIVERY`/`PICKUP`, `2300` bps (23.00%) for `PLATFORM_DELIVERY`.
     - Service fee: `199` cents (`R$ 1,99`) default cap or `500` bps.
     - Base delivery fee: `599` cents (`R$ 5,99`) up to 3 km + `150` cents (`R$ 1,50`) per additional km.
     - Quote expiration TTL: `15` minutes (`900` seconds).
     - Free cancellation window: before store preparation starts (`CREATED` / `ACCEPTED` within 2 minutes); after `PREPARING`, requires support/operations review.

3. **Pre-Configured Multi-Provider Adapters (Option 1 + Option 2):**
   - Provider configurations are registered in `public.provider_configurations` (metadata, active provider selection, webhook tolerances, capabilities) while secrets remain strictly in server environment variables:
     - **Payment Service Providers (PSP - M12):** `stripe`, `mercadopago`, `pagarme`
     - **Maps & Routing (M04/M14):** `google_maps`, `mapbox`
     - **Notifications & Messaging (M20):** `resend` (Email), `fcm` (Android Push), `apns` (iOS Push)
   - **Honest Runtime Contract:** When a provider's credentials are not present in the server environment, the adapter returns `{ status: 'BLOCKED_MISSING_CREDENTIALS', provider, requiredEnvVars }` and blocks the external operation (e.g., live payment capture or external SMS/Push dispatch) instead of returning a simulated success.
