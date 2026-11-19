# iDeliveryFood — Incident Response, Session Revocation & Key Rotation Runbook (`M23`)

**Operational Timezone:** `America/Sao_Paulo`  
**Audit Trail Table:** `public.audit_logs` (Immutable append-only, protected by `trg_audit_logs_immutable`)  

---

## 1. Incident Classification & SLA Response Targets

| Severity | Definition | Initial Triage SLA | Containment SLA | Required Responders |
|---|---|---|---|---|
| **SEV-1 (Critical)** | Suspected credential leak (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `STRIPE_SECRET_KEY`), cross-tenant data exposure, or ledger tampering. | **<= 15 minutes** | **<= 30 minutes** | `tech_admin` (`aal2`), `risk_compliance` (`aal2`), `finance` (`aal2`) |
| **SEV-2 (High)** | Active brute-force/credential-stuffing campaign, multi-account coupon abuse spike, or webhook replay wave. | **<= 30 minutes** | **<= 2 hours** | `risk_compliance` (`aal2`), `operations` (`aal2`) |
| **SEV-3 (Medium)** | Anomalous refund velocity or repeated courier OTP failures flagged in `public.risk_alerts`. | **<= 4 hours** | **<= 24 hours** | `risk_compliance` (`aal2`), `support` |

---

## 2. Emergency Session, Device & Scope Revocation Procedure

### 2.1 Revoking Compromised User Devices & Push Tokens
1. **Self-Service / Automated Revocation:**
   - Call `POST /v1/me/devices/revoke` with `{ "deviceIdentifier": "<device_id>" }`.
   - Sets `user_devices.is_revoked = true`, clears `push_token = NULL`, writes `DEVICE_SESSION_REVOKED` to `public.audit_logs`, and enqueues `security.device_revoked` in `public.outbox_events`.
2. **Explainable Risk Human Review Suspension (`M21`):**
   - `risk_compliance` or `tech_admin` authenticated with MFA `aal2` reviews the open alert via `POST /v1/governance/risk/alerts/:id/review` with `{ "decision": "CONFIRM_BLOCK", "reason": "<mandatory justification>", "suspendSubjectIfConfirmed": true }`.
   - Atomically transitions `profiles.status = 'SUSPENDED'`, sets `last_session_revoked_at = timezone('utc', now())`, revokes all active rows in `public.user_devices`, and records the decision in `public.risk_decisions` and `public.audit_logs`.

### 2.2 Revoking Compromised Staff or Partner Scopes
- Execute administrative governance action (`POST /v1/admin/governance-actions` with MFA `aal2` and mandatory justification `>= 5` chars) or revoke the specific scope row in `public.staff_scopes` / `public.organization_members` (`is_active = false, revoked_at = timezone('utc', now())`).

---

## 3. Cryptographic Key Rotation Procedures

### 3.1 Rotating `SUPABASE_SERVICE_ROLE_KEY` & Database Credentials
1. Generate a new service role key / database password in the Supabase project dashboard (`dwsoochnfxldfvcaijie`).
2. Update the secret manager / runtime environment variables (`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`) for `apps/api` and `apps/worker` (never in `NEXT_PUBLIC_*` or git-tracked files).
3. Restart `apps/api` and `apps/worker` rolling instances and verify `GET /v1/health/ready` returns `200 READY`.
4. Run `pnpm security:scan` to confirm zero residual secrets in the workspace.

### 3.2 Rotating `STRIPE_WEBHOOK_SECRET` / `OUTBOUND_WEBHOOK_SIGNING_SECRET`
1. Roll the webhook signing secret in the PSP dashboard (`Stripe`, `Mercado Pago`, or `Pagar.me`).
2. Update `<PROVIDER>_WEBHOOK_SECRET` and `OUTBOUND_WEBHOOK_SIGNING_SECRET` in the server environment.
3. Verify webhook signature validation on `/v1/webhooks/psp/:providerCode` (`verifyAndProcessPspWebhook` rejects invalid signatures with `401 WEBHOOK_INVALID_SIGNATURE`).

### 3.3 Rotating `SUPABASE_JWT_SECRET`
1. Coordinate a brief maintenance window, rotate the JWT secret in Supabase Auth settings, and update `SUPABASE_JWT_SECRET` in `apps/api`.
2. All previously issued HS256 access tokens are immediately invalidated upon rotation, forcing clean re-authentication and MFA `aal2` step-up for staff and partner owners.

---

## 4. Responsible Disclosure Policy
See root [`SECURITY.md`](../../SECURITY.md) for the vulnerability reporting channel, encryption guidelines, and disclosure timeline.
