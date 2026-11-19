# Security Policy & Responsible Disclosure (`iDeliveryFood`)

## Supported Versions

| Version | Supported |
|---|---|
| `0.1.x` (`main`) | Yes |

## Reporting a Vulnerability

If you discover a security issue in `iDeliveryFood`, please report it privately to the security and compliance team (`security@ideliveryfood.invalid` / private GitHub Security Advisory) rather than opening a public issue.

### What to Include
- Affected component (`apps/api`, `apps/customer-web`, `apps/partner-web`, `apps/admin-web`, `apps/worker`, mobile apps, or Supabase RLS).
- Step-by-step reproduction instructions and `X-Correlation-Id` if applicable.
- Impact assessment (e.g., cross-tenant access, privilege escalation, financial calculation, or SSRF).

### Response SLA
- **Acknowledgment:** Within 24 hours.
- **Triage & Severity Classification:** Within 48 hours.
- **Remediation & Verification:** Coordinated fix verified by automated regression tests and `pnpm security:scan` before public disclosure.
