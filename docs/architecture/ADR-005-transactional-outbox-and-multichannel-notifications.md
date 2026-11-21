# ADR-005: Transactional Outbox Pattern, Bilingual Notification Templates, Realtime Cursor Recovery & Device Revocation

- **Status:** Approved
- **Date:** 2026-11-15
- **Module:** `M20`

## Context
State transitions in orders, deliveries, support cases, and security events must trigger reliable in-app notifications, push notifications (Android FCM / iOS APNs), transactional emails (Resend), and outbound partner webhooks without dual-write inconsistencies or message loss during network drops.

## Decision
1. **Transactional Outbox (`public.outbox_events`):**
   - Domain mutations insert an idempotent event row into `public.outbox_events` (`UNIQUE (idempotency_key)`) inside the **same PostgreSQL transaction** as the domain state change.
   - The background worker (`@ideliveryfood/worker`) polls `PENDING` and eligible `FAILED_RETRY` events, processes them idempotently into `public.notification_deliveries`, and applies bounded exponential backoff (`1s`, `2s`, `4s`, `8s`..`60s`).
   - Events that exhaust `max_attempts` (default `5`) transition to `DEAD_LETTER` with `last_error` preserved and trigger the `ALERT_OUTBOX_DEAD_LETTER_DETECTED` operational alert in `/v1/metrics`.

2. **Versioned Bilingual Templates (`en` & `pt-BR`) & Marketing Consent:**
   - Notifications are rendered from versioned templates (`template_key`, `template_version`) matching the recipient's persisted `user_preferences.locale` (`en` default, `pt-BR` selectable).
   - `MARKETING` notifications check `user_preferences.push_promotions` / `email_marketing` before dispatch and are skipped (`SKIPPED_OPT_OUT`) if the user opted out; `TRANSACTIONAL` and `SECURITY` notifications always deliver in-app.

3. **Realtime Cursor Recovery (`?sinceCursor=`) & Device Revocation Hygiene:**
   - Every row in `public.notification_deliveries` receives a monotonically increasing `cursor_seq`. When a client reconnects after a WebSocket/Realtime drop, `GET /v1/me/notifications?sinceCursor=<lastSeenSeq>` deterministically recovers all missed notifications in order.
   - Revoking a device (`POST /v1/me/devices/revoke`) immediately sets `revoked_at`, clears `push_token = NULL` in `public.user_devices`, and enqueues a `security.device_revoked` outbox event. The worker refuses push dispatch to any revoked device.

## Consequences
- Zero lost notifications on transient provider failures or client WebSocket disconnections.
- Revoked devices can never receive subsequent push notifications containing sensitive order updates.
