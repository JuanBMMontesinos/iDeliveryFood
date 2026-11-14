import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { computePspWebhookSignature } from "@ideliveryfood/domain";
import type {
  AnalyticalKpiSummaryContract,
  GovernanceBackofficeOverviewContract,
  OrderRecordContract,
  PrivacyRequestRecordContract,
  RiskAlertContract,
  ServerQuoteRecordContract,
} from "@ideliveryfood/contracts";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
  type SupabasePostgresRepositoryInstance,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../../../../.env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      const match = content.match(/^DATABASE_URL=(.+)$/m);
      if (match?.[1]) {
        return match[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  throw new Error("DATABASE_URL not found in environment or .env");
}

describe("Fase R (M21) — Live Supabase Analytics KPIs, Ledger Reconciliation, Explainable Risk & LGPD Governance Tests", () => {
  const TEST_JWT_SECRET = "test_supabase_jwt_secret_phase_r_governance_32c!";
  const TEST_WEBHOOK_SECRET = "whsec_default_dev_test";

  const ALICE_ID = "00000000-0000-4000-8000-000000000001";
  const MARINA_OPS_ID = "00000000-0000-4000-8000-000000000090";
  const ROBERTO_FIN_ID = "00000000-0000-4000-8000-000000000091";
  const TEMP_RISK_STAFF_ID = "00000000-0000-4000-8000-000000000092";
  const TEMP_AUDITOR_PRIVACY_ID = "00000000-0000-4000-8000-000000000093";
  const TECH_ADMIN_ID = "00000000-0000-4000-8000-000000000099";
  const STORE_201_ID = "00000000-0000-4000-8000-000000000201";
  const PRODUCT_601_ID = "00000000-0000-4000-8000-000000000601";

  const TEMP_BLOCK_TARGET_USER_ID = crypto.randomUUID();
  const TEMP_ELIGIBLE_LGPD_USER_ID = "00000000-0000-4000-8000-000000000094";

  const createdAlertIds: string[] = [];
  const createdPrivacyRequestIds: string[] = [];

  let repo: SupabasePostgresRepositoryInstance;
  let server: ReturnType<typeof createApiServer>;
  let baseUrl = "";

  function tokenFor(
    sub: string,
    email: string,
    aal: "aal1" | "aal2" = "aal1"
  ): string {
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

  const aliceToken = tokenFor(
    ALICE_ID,
    "customer.alice@test.ideliveryfood.invalid",
    "aal1"
  );
  const marinaTokenAal2 = tokenFor(
    MARINA_OPS_ID,
    "staff.ops@test.ideliveryfood.invalid",
    "aal2"
  );
  const robertoTokenAal2 = tokenFor(
    ROBERTO_FIN_ID,
    "staff.finance@test.ideliveryfood.invalid",
    "aal2"
  );
  const techAdminTokenAal2 = tokenFor(
    TECH_ADMIN_ID,
    "staff.admin@test.ideliveryfood.invalid",
    "aal2"
  );
  const riskStaffTokenAal1 = tokenFor(
    TEMP_RISK_STAFF_ID,
    `risk.${TEMP_RISK_STAFF_ID}@test.ideliveryfood.invalid`,
    "aal1"
  );
  const riskStaffTokenAal2 = tokenFor(
    TEMP_RISK_STAFF_ID,
    `risk.${TEMP_RISK_STAFF_ID}@test.ideliveryfood.invalid`,
    "aal2"
  );
  const auditorPrivacyTokenAal1 = tokenFor(
    TEMP_AUDITOR_PRIVACY_ID,
    `privacy.${TEMP_AUDITOR_PRIVACY_ID}@test.ideliveryfood.invalid`,
    "aal1"
  );
  const auditorPrivacyTokenAal2 = tokenFor(
    TEMP_AUDITOR_PRIVACY_ID,
    `privacy.${TEMP_AUDITOR_PRIVACY_ID}@test.ideliveryfood.invalid`,
    "aal2"
  );
  const eligibleLgpdUserToken = tokenFor(
    TEMP_ELIGIBLE_LGPD_USER_ID,
    `lgpd.${TEMP_ELIGIBLE_LGPD_USER_ID}@test.ideliveryfood.invalid`,
    "aal1"
  );

  async function seedDisposableUser(params: {
    id: string;
    email: string;
    fullName: string;
    phone?: string;
    staffRole?: "risk_compliance" | "auditor_privacy";
    withDeviceAndAddress?: boolean;
  }): Promise<void> {
    await repo.pool.query(
      `INSERT INTO auth.users (
         instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at
       ) VALUES (
         '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
         $2, '$2a$10$seedhash', timezone('utc', now()),
         '{"provider":"email","providers":["email"]}'::jsonb,
         '{}'::jsonb, false, false, timezone('utc', now()), timezone('utc', now())
       ) ON CONFLICT (id) DO NOTHING`,
      [params.id, params.email]
    );
    await repo.pool.query(
      `INSERT INTO public.profiles (
         id, email, full_name, phone, preferred_locale, status, mfa_enforced, is_test_data
       ) VALUES ($1, $2, $3, $4, 'pt-BR', 'ACTIVE', $5, true)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         full_name = EXCLUDED.full_name,
         phone = EXCLUDED.phone,
         status = 'ACTIVE'`,
      [
        params.id,
        params.email,
        params.fullName,
        params.phone ?? null,
        Boolean(params.staffRole),
      ]
    );
    if (params.staffRole) {
      await repo.pool.query(
        `INSERT INTO public.staff_scopes (id, user_id, role, granted_by, justification, is_active, is_test_data)
         SELECT $1, $2, $3::public.staff_role, $4, $5, true, true
         WHERE NOT EXISTS (
           SELECT 1 FROM public.staff_scopes
           WHERE user_id = $2 AND role = $3::public.staff_role AND is_active = true
         )`,
        [
          crypto.randomUUID(),
          params.id,
          params.staffRole,
          TECH_ADMIN_ID,
          "Fase R governance & privacy integration test scope",
        ]
      );
    }
    if (params.withDeviceAndAddress) {
      await repo.pool.query(
        `INSERT INTO public.user_devices (
           id, user_id, platform, device_identifier, push_token, push_consent_granted, is_revoked, is_test_data
         ) VALUES ($1, $2, 'ANDROID', $3, $4, true, false, true)
         ON CONFLICT (user_id, platform, device_identifier) DO UPDATE SET
           is_revoked = false,
           revoked_at = NULL,
           push_token = EXCLUDED.push_token`,
        [
          crypto.randomUUID(),
          params.id,
          `dev-${params.id}`,
          `fcm-token-${params.id}`,
        ]
      );
      await repo.pool.query(
        `DELETE FROM public.customer_addresses WHERE user_id = $1`,
        [params.id]
      );
      await repo.pool.query(
        `INSERT INTO public.customer_addresses (
           id, user_id, label, recipient_name, street_line, number,
           neighborhood, city, state_code, postal_code, latitude, longitude, is_default, is_test_data
         ) VALUES ($1, $2, 'Casa', $3, 'Rua Exemplo LGPD', '123', 'Bela Vista', 'São Paulo', 'SP', '01310-100', -23.56, -46.65, true, true)`,
        [crypto.randomUUID(), params.id, params.fullName]
      );
    }
  }

  async function cleanupSyntheticRows(): Promise<void> {
    if (createdAlertIds.length > 0) {
      await repo.pool.query(
        `DELETE FROM public.risk_decisions WHERE alert_id = ANY($1::uuid[])`,
        [createdAlertIds]
      );
      await repo.pool.query(
        `DELETE FROM public.risk_alerts WHERE id = ANY($1::uuid[])`,
        [createdAlertIds]
      );
    }
    if (createdPrivacyRequestIds.length > 0) {
      await repo.pool.query(
        `DELETE FROM public.privacy_requests WHERE id = ANY($1::uuid[])`,
        [createdPrivacyRequestIds]
      );
    }
    // Clean up purely disposable target account (never deletes profiles that wrote to append-only audit_logs)
    await repo.pool.query(
      `DELETE FROM public.user_devices WHERE user_id = $1`,
      [TEMP_BLOCK_TARGET_USER_ID]
    );
    await repo.pool.query(
      `DELETE FROM public.customer_addresses WHERE user_id = $1`,
      [TEMP_BLOCK_TARGET_USER_ID]
    );
    await repo.pool.query(
      `DELETE FROM public.profiles p
       WHERE p.id = $1
         AND NOT EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.actor_id = p.id)`,
      [TEMP_BLOCK_TARGET_USER_ID]
    );
    await repo.pool.query(
      `DELETE FROM auth.users u
       WHERE u.id = $1
         AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)`,
      [TEMP_BLOCK_TARGET_USER_ID]
    );
  }

  before(async () => {
    repo = createSupabasePostgresRepository({
      connectionString: loadDatabaseUrl(),
      isTestData: true,
    });

    await seedDisposableUser({
      id: TEMP_RISK_STAFF_ID,
      email: `risk.${TEMP_RISK_STAFF_ID}@test.ideliveryfood.invalid`,
      fullName: "Risk Compliance Reviewer M21",
      staffRole: "risk_compliance",
    });
    await seedDisposableUser({
      id: TEMP_AUDITOR_PRIVACY_ID,
      email: `privacy.${TEMP_AUDITOR_PRIVACY_ID}@test.ideliveryfood.invalid`,
      fullName: "Privacy DPO Auditor M21",
      staffRole: "auditor_privacy",
    });
    await seedDisposableUser({
      id: TEMP_BLOCK_TARGET_USER_ID,
      email: `target.${TEMP_BLOCK_TARGET_USER_ID}@test.ideliveryfood.invalid`,
      fullName: "Suspected Multi Account User",
      withDeviceAndAddress: true,
    });
    await seedDisposableUser({
      id: TEMP_ELIGIBLE_LGPD_USER_ID,
      email: `lgpd.${TEMP_ELIGIBLE_LGPD_USER_ID}@test.ideliveryfood.invalid`,
      fullName: "Clara Elegivel Anonimizacao",
      phone: "+5511999990000",
      withDeviceAndAddress: true,
    });

    server = createApiServer({
      repository: repo,
      env: {
        SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
        STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      },
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupSyntheticRows();
    await repo.close();
  });

  it("1. computes reproducible GMV & Net Platform Revenue reconciled cent-for-cent with double-entry ledger, supports excludeTestData filtering, and writes audited paginated CSV/JSON exports", async () => {
    // Customer must be blocked with 403
    const customerAttempt = await fetch(`${baseUrl}/v1/analytics/overview`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(customerAttempt.status, 403);

    // Baseline overview with Finance + aal2 must reconcile cent-for-cent with M13 ledger
    const baseOverviewRes = await fetch(`${baseUrl}/v1/analytics/overview`, {
      headers: { Authorization: `Bearer ${robertoTokenAal2}` },
    });
    assert.equal(baseOverviewRes.status, 200);
    const baseOverview = (await baseOverviewRes.json()) as {
      data: AnalyticalKpiSummaryContract;
    };
    assert.equal(baseOverview.data.excludeTestData, false);
    assert.ok(baseOverview.data.gmvCents > 0);
    assert.equal(
      baseOverview.data.netPlatformRevenueCents,
      baseOverview.data.ledgerReconciledNetRevenueCents
    );
    assert.equal(baseOverview.data.isReconciledWithLedger, true);

    // Filtering excludeTestData=true excludes synthetic/seed rows cleanly
    const prodOnlyRes = await fetch(
      `${baseUrl}/v1/analytics/overview?excludeTestData=true`,
      {
        headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
      }
    );
    assert.equal(prodOnlyRes.status, 200);
    const prodOnly = (await prodOnlyRes.json()) as {
      data: AnalyticalKpiSummaryContract;
    };
    assert.equal(prodOnly.data.excludeTestData, true);
    assert.equal(prodOnly.data.totalOrdersCount, 0);
    assert.equal(prodOnly.data.gmvCents, 0);
    assert.equal(prodOnly.data.isReconciledWithLedger, true);

    // Execute real live quote -> order -> signed Stripe webhook payment.captured
    const runTag = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const quoteRes = await fetch(`${baseUrl}/v1/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `quote_fase_r_${runTag}`,
      },
      body: JSON.stringify({
        storeId: STORE_201_ID,
        fulfillmentModality: "PLATFORM_DELIVERY",
        cartItems: [
          { productId: PRODUCT_601_ID, quantity: 1, selectedOptions: [] },
        ],
        deliveryFeeCents: 690,
      }),
    });
    assert.equal(quoteRes.status, 201);
    const quoteJson = (await quoteRes.json()) as {
      data: ServerQuoteRecordContract;
    };

    const orderRes = await fetch(`${baseUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `order_fase_r_${runTag}`,
      },
      body: JSON.stringify({
        quoteId: quoteJson.data.id,
        customerNotes: "Fase R live ledger capture reconciliation check",
      }),
    });
    assert.equal(orderRes.status, 201);
    const orderJson = (await orderRes.json()) as {
      data: OrderRecordContract;
    };

    const webhookPayload = JSON.stringify({
      orderId: orderJson.data.id,
      externalEventId: `evt_fase_r_${runTag}`,
      eventType: "payment.captured",
      amountCents: orderJson.data.totalCents,
      currencyCode: "BRL",
    });
    const tsSec = Math.floor(Date.now() / 1000);
    const sig = computePspWebhookSignature({
      webhookSecret: TEST_WEBHOOK_SECRET,
      timestampSeconds: tsSec,
      rawPayload: webhookPayload,
    });
    const hookRes = await fetch(`${baseUrl}/v1/webhooks/psp/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Psp-Signature": sig,
        "X-Psp-Timestamp": String(tsSec),
      },
      body: webhookPayload,
    });
    assert.equal(hookRes.status, 200);

    // Re-query analytics overview: both netPlatformRevenueCents and ledgerReconciledNetRevenueCents must advance identically
    const postCaptureRes = await fetch(`${baseUrl}/v1/analytics/overview`, {
      headers: { Authorization: `Bearer ${auditorPrivacyTokenAal2}` },
    });
    assert.equal(postCaptureRes.status, 200);
    const postCapture = (await postCaptureRes.json()) as {
      data: AnalyticalKpiSummaryContract;
    };
    const expectedOrderNetRevenue =
      orderJson.data.platformCommissionCents + orderJson.data.serviceFeeCents;
    assert.equal(
      postCapture.data.netPlatformRevenueCents,
      baseOverview.data.netPlatformRevenueCents + expectedOrderNetRevenue
    );
    assert.equal(
      postCapture.data.ledgerReconciledNetRevenueCents,
      postCapture.data.netPlatformRevenueCents
    );
    assert.equal(postCapture.data.isReconciledWithLedger, true);

    // Verify pagination guard on export (?limit=501 -> 400)
    const oversizedExport = await fetch(
      `${baseUrl}/v1/analytics/export?format=json&limit=501`,
      {
        headers: { Authorization: `Bearer ${auditorPrivacyTokenAal2}` },
      }
    );
    assert.equal(oversizedExport.status, 400);

    // Verify audited CSV export
    const beforeCsvAuditRes = await repo.pool.query(
      `SELECT COUNT(*)::int AS c FROM public.audit_logs
       WHERE actor_id = $1 AND action = 'ANALYTICS_REPORT_EXPORTED'`,
      [TEMP_AUDITOR_PRIVACY_ID]
    );
    const beforeCsvCount = Number(beforeCsvAuditRes.rows[0]?.c ?? 0);

    const csvRes = await fetch(
      `${baseUrl}/v1/analytics/export?format=csv&limit=5&offset=0`,
      {
        headers: { Authorization: `Bearer ${auditorPrivacyTokenAal2}` },
      }
    );
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.headers.get("content-type") ?? "", /text\/csv/);
    const csvText = await csvRes.text();
    const csvLines = csvText.trim().split("\n");
    assert.ok(csvLines[0]?.startsWith("order_id,order_number,store_id"));
    assert.ok(csvLines.length >= 2 && csvLines.length <= 6);

    const afterCsvAuditRes = await repo.pool.query(
      `SELECT COUNT(*)::int AS c FROM public.audit_logs
       WHERE actor_id = $1 AND action = 'ANALYTICS_REPORT_EXPORTED'`,
      [TEMP_AUDITOR_PRIVACY_ID]
    );
    assert.equal(Number(afterCsvAuditRes.rows[0]?.c ?? 0), beforeCsvCount + 1);
  });

  it("2. evaluates explainable risk rules without opaque auto-bans, rejects aal1/unauthorized reviewers, and enforces mandatory human review with risk_decisions & audit_logs", async () => {
    // Evaluate deterministic rule -> must enter OPEN_AWAITING_HUMAN_REVIEW with full explanation
    const evalRes = await fetch(`${baseUrl}/v1/governance/risk/evaluate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${riskStaffTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ruleCode: "COUPON_ABUSE_MULTI_ACCOUNT",
        subjectType: "USER",
        subjectId: TEMP_BLOCK_TARGET_USER_ID,
        observedValue: 5,
        evidenceRefs: ["device:hash_m21_test", "promo:BEMVINDO10"],
      }),
    });
    assert.equal(evalRes.status, 201);
    const evalJson = (await evalRes.json()) as {
      data: {
        triggered: boolean;
        alert: RiskAlertContract;
      };
    };
    assert.equal(evalJson.data.triggered, true);
    const alertId = evalJson.data.alert.id;
    createdAlertIds.push(alertId);

    assert.equal(evalJson.data.alert.status, "OPEN_AWAITING_HUMAN_REVIEW");
    assert.equal(evalJson.data.alert.recommendedAction, "HUMAN_REVIEW_REQUIRED");
    assert.equal(
      evalJson.data.alert.ruleExplanation.ruleCode,
      "COUPON_ABUSE_MULTI_ACCOUNT"
    );
    assert.equal(evalJson.data.alert.ruleExplanation.observedValue, 5);
    assert.ok(evalJson.data.alert.ruleExplanation.explanationPtBr.length > 20);

    // Subject MUST still be ACTIVE before human review
    const preReviewProfile = await repo.pool.query(
      `SELECT status FROM public.profiles WHERE id = $1`,
      [TEMP_BLOCK_TARGET_USER_ID]
    );
    assert.equal(preReviewProfile.rows[0]?.status, "ACTIVE");

    // 1. aal1 reviewer is rejected with 403 MFA_AAL2_REQUIRED
    const aal1Attempt = await fetch(
      `${baseUrl}/v1/governance/risk/alerts/${alertId}/review`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${riskStaffTokenAal1}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: "CONFIRM_BLOCK",
          reason: "Confirmed multiple accounts sharing same device hash.",
          suspendSubjectIfConfirmed: true,
        }),
      }
    );
    assert.equal(aal1Attempt.status, 403);
    const aal1Err = (await aal1Attempt.json()) as { error: { code: string } };
    assert.equal(aal1Err.error.code, "RISK_REVIEW_MFA_AAL2_REQUIRED");

    // 2. Operations-only staff (Marina) is rejected from final risk override decision (SoD)
    const opsAttempt = await fetch(
      `${baseUrl}/v1/governance/risk/alerts/${alertId}/review`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${marinaTokenAal2}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: "APPROVE_OVERRIDE",
          reason: "Operations trying to override risk hold directly.",
        }),
      }
    );
    assert.equal(opsAttempt.status, 403);

    // 3. Risk reviewer with aal2 but short reason (<5 chars) rejected with 400
    const shortReasonAttempt = await fetch(
      `${baseUrl}/v1/governance/risk/alerts/${alertId}/review`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${riskStaffTokenAal2}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: "CONFIRM_BLOCK",
          reason: "ok",
        }),
      }
    );
    assert.equal(shortReasonAttempt.status, 400);

    // 4. Risk reviewer with aal2 confirms block -> updates alert, writes risk_decisions & audit_logs, suspends account + revokes device
    const reviewRes = await fetch(
      `${baseUrl}/v1/governance/risk/alerts/${alertId}/review`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${riskStaffTokenAal2}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: "CONFIRM_BLOCK",
          reason: "Confirmed multi-account coupon abuse sharing identical fingerprint after human verification.",
          suspendSubjectIfConfirmed: true,
        }),
      }
    );
    assert.equal(reviewRes.status, 200);
    const reviewJson = (await reviewRes.json()) as { data: RiskAlertContract };
    assert.equal(reviewJson.data.status, "CONFIRMED_BLOCK");
    assert.equal(reviewJson.data.reviewDecision, "CONFIRM_BLOCK");
    assert.equal(reviewJson.data.reviewedBy, TEMP_RISK_STAFF_ID);

    const postProfileRes = await repo.pool.query(
      `SELECT status FROM public.profiles WHERE id = $1`,
      [TEMP_BLOCK_TARGET_USER_ID]
    );
    assert.equal(postProfileRes.rows[0]?.status, "SUSPENDED");

    const decisionsRes = await repo.pool.query(
      `SELECT decision, human_reviewer_id FROM public.risk_decisions WHERE alert_id = $1 ORDER BY created_at`,
      [alertId]
    );
    assert.equal(decisionsRes.rowCount, 2);
    assert.equal(decisionsRes.rows[0]?.decision, "FLAG_FOR_HUMAN_REVIEW");
    assert.equal(decisionsRes.rows[1]?.decision, "CONFIRM_BLOCK");
    assert.equal(decisionsRes.rows[1]?.human_reviewer_id, TEMP_RISK_STAFF_ID);

    const auditRes = await repo.pool.query(
      `SELECT action FROM public.audit_logs WHERE target_id = $1 AND action = 'RISK_ALERT_HUMAN_REVIEWED_CONFIRM_BLOCK'`,
      [alertId]
    );
    assert.equal(auditRes.rowCount, 1);

    // Consolidated governance overview returns real seeded + live items
    const govRes = await fetch(`${baseUrl}/v1/governance/overview`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(govRes.status, 200);
    const govJson = (await govRes.json()) as {
      data: GovernanceBackofficeOverviewContract;
    };
    assert.ok(govJson.data.riskAlerts.some((a) => a.id === alertId));
    assert.ok(
      govJson.data.riskAlerts.some(
        (a) => a.id === "00000000-0000-4000-8000-000000001733"
      )
    );
  });

  it("3. provides LGPD JSON portability package, enforces statutory 5-year retention hold for users with fiscal transactions, and anonymizes eligible PII with device revocation", async () => {
    // 1. Alice requests self-service JSON portability package
    const selfExportRes = await fetch(`${baseUrl}/v1/me/privacy-export`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(selfExportRes.status, 200);
    const selfExportJson = (await selfExportRes.json()) as {
      data: {
        request: { id: string };
        exportPackage: {
          subjectProfile: { id: string; email: string };
          ordersHistory: Array<{ orderNumber: number }>;
          legalBasis: string;
        };
      };
    };
    createdPrivacyRequestIds.push(selfExportJson.data.request.id);
    assert.equal(selfExportJson.data.exportPackage.subjectProfile.id, ALICE_ID);
    assert.ok(selfExportJson.data.exportPackage.ordersHistory.length >= 1);
    assert.match(selfExportJson.data.exportPackage.legalBasis, /LGPD/i);

    // 2. Alice requests account deletion / anonymization -> BLOCKED_LEGAL_RETENTION due to CAPTURED fiscal orders
    const aliceReqId = crypto.randomUUID();
    createdPrivacyRequestIds.push(aliceReqId);

    const aliceAnonReqRes = await fetch(`${baseUrl}/v1/me/privacy-requests`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: aliceReqId,
        requestType: "ANONYMIZATION",
        reason: "Gostaria de remover minha conta.",
      }),
    });
    assert.equal(aliceAnonReqRes.status, 201);
    const aliceAnonReqJson = (await aliceAnonReqRes.json()) as {
      data: {
        outcome: string;
        reasonCode: string;
        holdUntilIso: string;
      };
    };
    assert.equal(aliceAnonReqJson.data.outcome, "RETENTION_HOLD");
    assert.ok(
      ["ACTIVE_ORDER_IN_PROGRESS", "STATUTORY_FISCAL_LEDGER_RETENTION"].includes(
        aliceAnonReqJson.data.reasonCode
      )
    );
    assert.ok(aliceAnonReqJson.data.holdUntilIso);

    // Governance auditor attempting to force anonymization on Alice still enforces BLOCKED_LEGAL_RETENTION
    const blockedEnforceRes = await fetch(
      `${baseUrl}/v1/governance/privacy/requests/${aliceReqId}/anonymize`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auditorPrivacyTokenAal2}` },
      }
    );
    assert.equal(blockedEnforceRes.status, 200);
    const blockedBody = (await blockedEnforceRes.json()) as {
      data: PrivacyRequestRecordContract;
      meta: { outcome: string; reasonCode: string };
    };
    assert.equal(blockedBody.meta.outcome, "BLOCKED_LEGAL_RETENTION");
    assert.equal(blockedBody.data.status, "BLOCKED_LEGAL_RETENTION");
    assert.ok(
      ["ACTIVE_ORDER_IN_PROGRESS", "STATUTORY_FISCAL_LEDGER_RETENTION"].includes(
        blockedBody.data.retentionBlockReason ?? ""
      )
    );

    const aliceProfileCheck = await repo.pool.query(
      `SELECT email, status FROM public.profiles WHERE id = $1`,
      [ALICE_ID]
    );
    assert.equal(
      aliceProfileCheck.rows[0]?.email,
      "customer.alice@test.ideliveryfood.invalid"
    );
    assert.equal(aliceProfileCheck.rows[0]?.status, "ACTIVE");

    // 3. Eligible temporary user (zero orders, zero disputes) requests ANONYMIZATION
    const eligibleReqId = crypto.randomUUID();
    createdPrivacyRequestIds.push(eligibleReqId);

    const eligibleReqRes = await fetch(`${baseUrl}/v1/me/privacy-requests`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${eligibleLgpdUserToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: eligibleReqId,
        requestType: "ANONYMIZATION",
        reason: "Exclusão definitiva conforme Art. 18 VI da LGPD.",
      }),
    });
    assert.equal(eligibleReqRes.status, 201);
    const eligibleReqJson = (await eligibleReqRes.json()) as {
      data: { outcome: string };
    };
    assert.equal(eligibleReqJson.data.outcome, "IMMEDIATE_ANONYMIZATION");

    // auditor_privacy without MFA aal2 is rejected (403)
    const anonAal1Attempt = await fetch(
      `${baseUrl}/v1/governance/privacy/requests/${eligibleReqId}/anonymize`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auditorPrivacyTokenAal1}` },
      }
    );
    assert.equal(anonAal1Attempt.status, 403);

    // Generate audited export on the request first
    const staffExportRes = await fetch(
      `${baseUrl}/v1/governance/privacy/requests/${eligibleReqId}/export`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auditorPrivacyTokenAal2}` },
      }
    );
    assert.equal(staffExportRes.status, 200);
    const staffExportJson = (await staffExportRes.json()) as {
      data: PrivacyRequestRecordContract;
    };
    assert.ok(staffExportJson.data.exportPayload);

    // Execute anonymization with auditor_privacy + aal2 -> COMPLETED, PII scrubbed, device revoked
    const anonExecuteRes = await fetch(
      `${baseUrl}/v1/governance/privacy/requests/${eligibleReqId}/anonymize`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auditorPrivacyTokenAal2}` },
      }
    );
    assert.equal(anonExecuteRes.status, 200);
    const anonExecuteJson = (await anonExecuteRes.json()) as {
      data: PrivacyRequestRecordContract;
      meta: { outcome: string; reasonCode: string };
    };
    assert.equal(anonExecuteJson.meta.outcome, "ANONYMIZED");
    assert.equal(anonExecuteJson.data.status, "COMPLETED");
    assert.ok(anonExecuteJson.data.anonymizedAt);

    const scrubbedProfile = await repo.pool.query(
      `SELECT email, full_name, phone, status FROM public.profiles WHERE id = $1`,
      [TEMP_ELIGIBLE_LGPD_USER_ID]
    );
    assert.match(
      String(scrubbedProfile.rows[0]?.email ?? ""),
      /^anon\+.*@anonymized(\.ideliveryfood)?\.invalid$/
    );
    assert.match(
      String(scrubbedProfile.rows[0]?.full_name ?? ""),
      /^Anonymized User #[0-9a-f]{6}$/
    );
    assert.equal(scrubbedProfile.rows[0]?.phone, null);
    assert.equal(scrubbedProfile.rows[0]?.status, "DEACTIVATED");

    const deviceRes = await repo.pool.query(
      `SELECT is_revoked FROM public.user_devices WHERE user_id = $1`,
      [TEMP_ELIGIBLE_LGPD_USER_ID]
    );
    assert.equal(deviceRes.rows[0]?.is_revoked, true);

    const addrRes = await repo.pool.query(
      `SELECT street_line FROM public.customer_addresses WHERE user_id = $1`,
      [TEMP_ELIGIBLE_LGPD_USER_ID]
    );
    assert.equal(addrRes.rows[0]?.street_line, "REDACTED");

    const anonAudit = await repo.pool.query(
      `SELECT action FROM public.audit_logs WHERE target_id = $1 AND action = 'LGPD_PII_ANONYMIZED'`,
      [eligibleReqId]
    );
    assert.equal(anonAudit.rowCount, 1);
  });
});
