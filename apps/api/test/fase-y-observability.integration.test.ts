import assert from "node:assert/strict";
import fs from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { OperationalMetricsReportContract } from "@ideliveryfood/observability";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
  type SupabasePostgresRepositoryInstance,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    path.resolve(REPO_ROOT, ".env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf8");
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    if (match?.[1]) {
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("DATABASE_URL not found in environment or .env");
}

describe("Fase Y (M25) — Live Operational Telemetry (/v1/metrics), Prometheus Exporter, SLI/SLO Alert Rules & Runbooks Verification", () => {
  const TEST_JWT_SECRET = "fase_y_m25_observability_live_jwt_secret_32_chars!!";
  const TEST_WEBHOOK_SECRET = "whsec_fase_y_m25_test_webhook_secret_32chars!";

  const ALICE_CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
  const TECH_ADMIN_STAFF_ID = "00000000-0000-4000-8000-000000000099";
  const SEEDED_ORDER_ID = "00000000-0000-4000-8000-000000001001";

  let repo: SupabasePostgresRepositoryInstance;
  let server: http.Server;
  let baseUrl = "";

  function issueJwt(sub: string, email: string, aal: "aal1" | "aal2" = "aal1"): string {
    return signSupabaseHs256Jwt(
      {
        sub,
        email,
        aal,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      TEST_JWT_SECRET
    );
  }

  const aliceToken = issueJwt(ALICE_CUSTOMER_ID, "customer.alice@test.ideliveryfood.invalid", "aal1");
  const techAdminAal1Token = issueJwt(
    TECH_ADMIN_STAFF_ID,
    "staff.admin@test.ideliveryfood.invalid",
    "aal1"
  );
  const techAdminAal2Token = issueJwt(
    TECH_ADMIN_STAFF_ID,
    "staff.admin@test.ideliveryfood.invalid",
    "aal2"
  );

  before(async () => {
    repo = createSupabasePostgresRepository({
      connectionString: loadDatabaseUrl(),
      isTestData: true,
    });

    server = createApiServer({
      repository: repo,
      env: {
        NODE_ENV: "test",
        SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
        STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      },
      allowTestActorHeaders: false,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await repo.close();
  });

  it("1. enforces strict RBAC (tech_admin/operations) + MFA aal2 on GET /v1/metrics and blocks CRLF correlation header injection", async () => {
    const unauthRes = await fetch(`${baseUrl}/v1/metrics`);
    assert.equal(unauthRes.status, 401);

    const customerRes = await fetch(`${baseUrl}/v1/metrics`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(customerRes.status, 403);

    const aal1Res = await fetch(`${baseUrl}/v1/metrics`, {
      headers: {
        Authorization: `Bearer ${techAdminAal1Token}`,
        "X-Correlation-Id": "bad;id!@#$%^&*()",
      },
    });
    assert.equal(aal1Res.status, 403);
    const aal1Body = (await aal1Res.json()) as {
      error: { code: string; correlationId: string };
    };
    assert.equal(aal1Body.error.code, "DENIED_MFA_STEP_UP_REQUIRED");
    // Unsafe correlation header must be replaced by a safe corr_<uuid>
    assert.match(aal1Body.error.correlationId, /^corr_[0-9a-f-]{36}$/i);
  });

  it("2. exposes live HTTP latency percentiles (p50/p95/p99), PSP webhook failures, Supabase outbox/ledger telemetry, SLI/SLO alerts & Prometheus text exposition", async () => {
    // Trigger a 200 health request and an invalid PSP webhook (401) so metrics collector records both
    const healthRes = await fetch(`${baseUrl}/v1/health/live`);
    assert.equal(healthRes.status, 200);

    const failedWebhookRes = await fetch(`${baseUrl}/v1/webhooks/psp/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-psp-signature": "v1=invalid_signature_for_m25_metrics_test",
        "x-psp-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({
        orderId: SEEDED_ORDER_ID,
        externalEventId: "evt_invalid_m25_test",
        eventType: "payment.captured",
        amountCents: 6232,
        currencyCode: "BRL",
      }),
    });
    assert.equal(failedWebhookRes.status, 401);

    // Fetch JSON metrics report as tech_admin with MFA aal2
    const metricsRes = await fetch(`${baseUrl}/v1/metrics`, {
      headers: { Authorization: `Bearer ${techAdminAal2Token}` },
    });
    assert.equal(metricsRes.status, 200);
    const metricsJson = (await metricsRes.json()) as {
      data: OperationalMetricsReportContract;
    };
    const report = metricsJson.data;

    assert.equal(report.service, "@ideliveryfood/api");
    assert.ok(report.http.totalRequests >= 4);
    assert.ok(report.http.http2xxCount >= 1);
    assert.ok(report.http.http401UnauthorizedCount >= 2);
    assert.ok(report.http.http403ForbiddenCount >= 2);
    assert.equal(report.http.pspWebhookFailureCount, 1);
    assert.ok(report.http.latency.count >= 4);
    assert.equal(typeof report.http.latency.p50Ms, "number");
    assert.equal(typeof report.http.latency.p95Ms, "number");
    assert.equal(typeof report.http.latency.p99Ms, "number");

    // Verify live Supabase PostgreSQL database metrics
    assert.equal(report.database.isLedgerBalanced, true);
    assert.ok(report.database.totalDebitsCents > 0);
    assert.equal(report.database.totalDebitsCents, report.database.totalCreditsCents);
    assert.ok(report.database.processedWebhookEventsCount >= 1);

    // Alert rule for PSP webhook failure must be active
    assert.equal(
      report.alerts.some((a) => a.ruleCode === "ALERT_PSP_WEBHOOK_FAILURES_DETECTED"),
      true,
      "Expected ALERT_PSP_WEBHOOK_FAILURES_DETECTED after invalid webhook attempt"
    );

    // Fetch Prometheus text exposition format (?format=prometheus)
    const promRes = await fetch(`${baseUrl}/v1/metrics?format=prometheus`, {
      headers: { Authorization: `Bearer ${techAdminAal2Token}` },
    });
    assert.equal(promRes.status, 200);
    assert.match(promRes.headers.get("content-type") ?? "", /text\/plain/);
    const promText = await promRes.text();
    assert.match(promText, /ideliveryfood_http_requests_total\{status="all"\}/);
    assert.match(promText, /ideliveryfood_http_latency_ms\{quantile="0.95"\}/);
    assert.match(promText, /ideliveryfood_psp_webhooks_total\{outcome="failure"\} 1/);
    assert.match(promText, /ideliveryfood_ledger_balanced 1/);

    // Verify operational runbooks exist on disk
    const requiredRunbooks = [
      "docs/ops/deploy-and-rollback-runbook.md",
      "docs/ops/backup-restore-and-dr-drill.md",
      "docs/ops/observability-and-alerts.md",
    ];
    for (const relPath of requiredRunbooks) {
      const fullPath = path.resolve(REPO_ROOT, relPath);
      assert.equal(fs.existsSync(fullPath), true, `Missing required M25 runbook: ${relPath}`);
    }
  });
});
