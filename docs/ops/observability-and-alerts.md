# iDeliveryFood — Observability, Structured Logging, SLIs/SLOs & Alerting Runbook (`M25`)

## 1. Arquitetura de Observabilidade e Redação de Dados Sensíveis

A camada de observabilidade do **iDeliveryFood** é implementada no pacote compartilhado [`@ideliveryfood/observability`](file:///h:/IAProjects/iDeliveryFood/packages/observability/src/index.ts) e integrada ao servidor [`@ideliveryfood/api`](file:///h:/IAProjects/iDeliveryFood/apps/api/src/index.ts) e ao [`@ideliveryfood/worker`](file:///h:/IAProjects/iDeliveryFood/apps/worker/src/index.ts).

### 1.1 Propagação Segura de `X-Correlation-Id`
- Toda requisição HTTP recebida pela API resolve ou gera um identificador único `correlationId` (`corr_<uuid>`) via `resolveOrGenerateCorrelationId(...)`.
- Valores recebidos no header `X-Correlation-Id` são validados contra a expressão regular `/^[A-Za-z0-9._:-]{6,128}$/`, bloqueando qualquer tentativa de injeção de quebras de linha (`CRLF` / Log Injection).
- O `correlationId` é retornado no header `X-Correlation-Id`, no envelope de erro padronizado `ApiErrorEnvelope`, nos logs estruturados JSON e na tabela `public.audit_logs`.

### 1.2 Redação Recursiva Obrigatória (`redactSensitiveData`)
Antes de qualquer serialização de log ou persistência em `audit_logs.redacted_payload`, a função `redactSensitiveData` mascara recursivamente:
- Chaves sensíveis: `password`, `secret`, `token`, `access_token`, `refresh_token`, `service_role_key`, `api_key`, `apiKey`, `cpf`, `cnpj`, `tax_id`, `card_number`, `cvv`, `private_key`, `webhook_secret` -> `"[REDACTED]"`.
- Tokens inline em strings: `Bearer <token>` -> `"Bearer [REDACTED_TOKEN]"`.

---

## 2. Endpoint de Telemetria Operacional (`GET /v1/metrics`)

O endpoint `GET /v1/metrics` é restrito a operadores internos com papel `tech_admin` ou `operations` e autenticação multifator **`aal2`** (`401` sem token; `403 DENIED_MFA_AAL2_REQUIRED` em `aal1`; `403 DENIED_ROLE_INSUFFICIENT` para demais perfis).

### 2.1 Formato JSON Padrão (`GET /v1/metrics`)
Retorna o relatório `OperationalMetricsReportContract`:
- **`http`:**
  - `totalRequests`, `http2xxCount`, `http4xxCount`, `http401UnauthorizedCount`, `http403ForbiddenCount`, `http429RateLimitedCount`, `http5xxCount`.
  - `pspWebhookSuccessCount`, `pspWebhookDuplicateCount`, `pspWebhookFailureCount`.
  - `latency`: `{ count, p50Ms, p95Ms, p99Ms, maxMs }`.
- **`database`:**
  - `outboxPendingCount`, `outboxDeadLetterCount`, `outboxDeliveredCount`.
  - `reconciliationDiscrepancyRunsCount`, `reconciliationDiscrepancyTotalCents`.
  - `isLedgerBalanced`, `totalDebitsCents`, `totalCreditsCents`.
  - `openRiskAlertsCount`, `activeDeliveryTasksCount`, `processedWebhookEventsCount`.
- **`alerts`:** Lista de alertas ativos (`OperationalAlertContract[]`) avaliados deterministicamente por `evaluateOperationalAlertRules(...)`.

### 2.2 Formato Prometheus (`GET /v1/metrics?format=prometheus`)
Retorna `Content-Type: text/plain; version=0.0.4; charset=utf-8` expondo as séries:
- `ideliveryfood_http_requests_total{status="all|2xx|4xx|401|403|429|5xx"}`
- `ideliveryfood_http_latency_ms{quantile="0.5|0.95|0.99|1.0"}`
- `ideliveryfood_psp_webhooks_total{outcome="success|duplicate|failure"}`
- `ideliveryfood_outbox_events_count{status="PENDING|DEAD_LETTER|DELIVERED"}`
- `ideliveryfood_ledger_balanced` (`1` = balanceado, `0` = desbalanceado)
- `ideliveryfood_reconciliation_discrepancy_cents`
- `ideliveryfood_active_alerts_count`

---

## 3. SLIs, SLOs e Catálogo de Regras de Alerta (`M25`)

| Código da Regra | Severidade | Condição de Disparo (SLI / Threshold) | Ação Recomendada (Playbook) |
| --- | --- | --- | --- |
| <a id="alert-ledger-imbalance-detected"></a>`ALERT_LEDGER_IMBALANCE_DETECTED` | `CRITICAL` | `totalDebitsCents !== totalCreditsCents` em `public.ledger_entries` | Congelar execuções de `settlements`, inspecionar último `ledger_journal` via `/v1/finance/overview` e acionar equipe Financeira + Tech Admin. |
| <a id="alert-outbox-dead-letter-detected"></a>`ALERT_OUTBOX_DEAD_LETTER_DETECTED` | `CRITICAL` | `outboxDeadLetterCount > 0` em `public.outbox_events` | Inspecionar `last_error` dos registros `DEAD_LETTER` em `public.outbox_events`, corrigir endpoint receptor e reenfileirar com `status = 'PENDING'`, `attempt_count = 0`. |
| <a id="alert-outbox-backlog-high"></a>`ALERT_OUTBOX_BACKLOG_HIGH` | `WARNING` | `outboxPendingCount > 100` | Verificar saúde e concorrência do `@ideliveryfood/worker` e latência de entrega de notificações/webhooks. |
| <a id="alert-psp-webhook-failures-detected"></a>`ALERT_PSP_WEBHOOK_FAILURES_DETECTED` | `WARNING` | `pspWebhookFailureCount > 0` | Verificar rotação de `STRIPE_WEBHOOK_SECRET`, sincronismo NTP (janela de replay de 300s) ou tentativa de spoofing externo. |
| <a id="alert-reconciliation-discrepancies-detected"></a>`ALERT_RECONCILIATION_DISCREPANCIES_DETECTED` | `WARNING` | `reconciliationDiscrepancyRunsCount > 0` | Abrir painel Financeiro (`M13`), auditar pedidos com captura tardia (`DISPUTED`) e emitir reembolso ou ajuste conciliatório. |
| <a id="alert-http-p95-latency-slo-breach"></a>`ALERT_HTTP_P95_LATENCY_SLO_BREACH` | `WARNING` | `http.latency.p95Ms > 1500ms` | Verificar pool de conexões PostgreSQL (`pg.Pool`), índices de consulta e uso de CPU/IO no Supabase. |
| <a id="alert-security-forbidden-or-rate-limit-spike"></a>`ALERT_SECURITY_FORBIDDEN_OR_RATE_LIMIT_SPIKE` | `WARNING` | `(http403ForbiddenCount + http429RateLimitedCount) >= 25` | Auditar `public.audit_logs` e IPs bloqueados pelo `SlidingWindowRateLimiter` para identificar brute-force de OTP, scraping ou tentativa de IDOR. |
