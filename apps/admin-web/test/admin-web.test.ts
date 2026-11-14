import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
  type SupabasePostgresRepositoryInstance,
} from "@ideliveryfood/api";
import type {
  AnalyticalKpiSummaryContract,
  AuthenticatedActorProfileContract,
  PrivacyRequestRecordContract,
  RiskAlertContract,
} from "@ideliveryfood/contracts";
import {
  buildAdminAuditTrailExplorerModel,
  buildAdminGovernanceScreenModel,
  buildAdminRoleNavigationModules,
  buildFinancialBackofficeModel,
  buildFleetOperatorPortalModel,
  buildGovernanceAnalyticsConsoleModel,
  buildGovernancePrivacyQueueModel,
  buildGovernanceRiskQueueModel,
  buildLogisticsDispatchConsoleModel,
  createAdminWebServer,
  executeAdminCadastreGovernanceAction,
  executeAdminStaffScopeGrant,
} from "../src/index.js";

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
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


describe("@ideliveryfood/admin-web — Staff MFA aal2 Step-Up & Honest Provider Status Tests", () => {
  const staffAdminAal1: AuthenticatedActorProfileContract = {
    id: "00000000-0000-4000-8000-000000000099",
    email: "staff.admin@test.ideliveryfood.invalid",
    fullName: "Admin Technical Governance",
    phone: "+5511900000099",
    preferredLocale: "en",
    status: "ACTIVE",
    mfaEnforced: true,
    aal: "aal1",
    organizationMemberships: [],
    staffScopes: [
      {
        role: "tech_admin",
        regionCode: null,
        maxRefundApprovalCents: 0,
        requiresMfa: true,
      },
    ],
  };

  it("blocks access with mfa_required banner when staff session is only aal1", () => {
    const screen = buildAdminGovernanceScreenModel({
      actor: staffAdminAal1,
      locale: "en",
    });

    assert.equal(screen.authorized, false);
    assert.equal(screen.banner?.kind, "mfa_required");
    assert.match(screen.banner?.message ?? "", /MFA aal2/);
  });

  it("grants access at aal2 and renders localized BLOCKED badges for missing external credentials", () => {
    const staffAdminAal2: AuthenticatedActorProfileContract = {
      ...staffAdminAal1,
      aal: "aal2",
    };

    const screenEn = buildAdminGovernanceScreenModel({
      actor: staffAdminAal2,
      locale: "en",
      env: {},
    });
    assert.equal(screenEn.authorized, true);
    assert.equal(screenEn.providerCards.length, 8);
    assert.match(
      screenEn.providerCards[0]?.blockedBadgeText ?? "",
      /BLOCKED: Missing external credentials \(STRIPE_SECRET_KEY/
    );

    const screenPt = buildAdminGovernanceScreenModel({
      actor: staffAdminAal2,
      locale: "pt-BR",
      env: {},
    });
    assert.match(
      screenPt.providerCards[0]?.blockedBadgeText ?? "",
      /BLOQUEADO: Credenciais externas ausentes \(STRIPE_SECRET_KEY/
    );
  });

  it("segregates M16 navigation modules by staff role and blocks self-grant of administrative scopes", () => {
    const supportAgent: AuthenticatedActorProfileContract = {
      ...staffAdminAal1,
      id: "00000000-0000-4000-8000-000000000095",
      aal: "aal2",
      staffScopes: [
        {
          role: "support_l1",
          regionCode: "SP",
          maxRefundApprovalCents: 2500,
          requiresMfa: false,
        },
      ],
    };

    const supportModules = buildAdminRoleNavigationModules(supportAgent);
    assert.deepEqual(supportModules, ["SUPPORT_AND_DISPUTES"]);

    const techAdminAal2: AuthenticatedActorProfileContract = {
      ...staffAdminAal1,
      aal: "aal2",
    };

    // Self-grant attempt must be blocked
    const selfGrantAttempt = executeAdminStaffScopeGrant({
      actor: techAdminAal2,
      request: {
        targetUserId: techAdminAal2.id,
        role: "finance",
        regionCode: null,
        maxRefundApprovalCents: 500000,
        justification: "Attempting to grant finance scope to myself",
      },
      locale: "pt-BR",
    });

    assert.equal(selfGrantAttempt.allowed, false);
    assert.equal(selfGrantAttempt.reasonCode, "DENIED_SELF_GRANT_FORBIDDEN");
    assert.match(selfGrantAttempt.errorMessage ?? "", /Autoconcessão bloqueada/);

    // Granting to another staff user with MFA aal2 + justification succeeds
    const validGrant = executeAdminStaffScopeGrant({
      actor: techAdminAal2,
      request: {
        targetUserId: supportAgent.id,
        role: "support_l2",
        regionCode: "SP",
        maxRefundApprovalCents: 10000,
        justification: "Promoted to L2 support lead for São Paulo region",
      },
    });
    assert.equal(validGrant.allowed, true);
  });

  it("enforces mandatory justification and MFA aal2 for M16 cadastre suspensions and read-only audit logs", () => {
    const techAdminAal2: AuthenticatedActorProfileContract = {
      ...staffAdminAal1,
      aal: "aal2",
    };

    assert.throws(() =>
      executeAdminCadastreGovernanceAction({
        actor: techAdminAal2,
        targetType: "STORE",
        targetId: "00000000-0000-4000-8000-000000000201",
        decision: "SUSPENDED",
        reason: "bad", // too short (< 5 chars)
      })
    );

    const suspended = executeAdminCadastreGovernanceAction({
      actor: techAdminAal2,
      targetType: "STORE",
      targetId: "00000000-0000-4000-8000-000000000201",
      decision: "SUSPENDED",
      reason: "Health inspection document expired; awaiting renewal.",
    });
    assert.equal(suspended.decision, "SUSPENDED");

    const auditExplorer = buildAdminAuditTrailExplorerModel({
      actor: techAdminAal2,
      logs: [{ id: "aud_1", action: "ADMIN_GOVERNANCE_SUSPENDED" }],
      locale: "en",
    });
    assert.equal(auditExplorer.authorized, true);
    assert.equal(auditExplorer.isReadOnly, true);
    assert.equal(auditExplorer.allowMutationOrDelete, false);
    assert.equal(auditExplorer.visibleLogs.length, 1);
  });

  it("validates M13 Financial Backoffice (GMV vs Net Revenue notice & BLOCKED_NO_PSP), M14 Maps fallback & M15 Fleet isolation", () => {
    const financeAdminAal2: AuthenticatedActorProfileContract = {
      ...staffAdminAal1,
      aal: "aal2",
      staffScopes: [
        {
          role: "finance",
          regionCode: null,
          maxRefundApprovalCents: 200000,
          requiresMfa: true,
        },
        {
          role: "operations",
          regionCode: null,
          maxRefundApprovalCents: 50000,
          requiresMfa: true,
        },
      ],
    };

    const sampleOrder = {
      id: "ord_fin_1",
      orderNumber: 10088,
      customerId: "cust_1",
      organizationId: "org_101",
      storeId: "store_201",
      quoteId: "quote_1",
      fulfillmentModality: "PLATFORM_DELIVERY" as const,
      orderStatus: "DELIVERED",
      paymentStatus: "CAPTURED",
      deliveryStatus: "DELIVERED",
      currencyCode: "BRL" as const,
      subtotalCents: 4000,
      addonsCents: 500,
      serviceFeeCents: 225,
      deliveryFeeCents: 700,
      discountCents: 0,
      totalCents: 5425,
      platformCommissionCents: 540,
      merchantNetCents: 3960,
      courierEarningsCents: 700,
      deliveryAddressSnapshot: null,
      itemsSnapshot: [],
      customerNotes: null,
      cancellationReason: null,
      cancelledByRole: null,
      version: 4,
      idempotencyKey: "idem_fin_1",
      acceptedAtIso: "2026-11-03T12:02:00Z",
      readyAtIso: "2026-11-03T12:20:00Z",
      deliveredAtIso: "2026-11-03T12:40:00Z",
      cancelledAtIso: null,
      createdAtIso: "2026-11-03T12:00:00Z",
      updatedAtIso: "2026-11-03T12:40:00Z",
    };

    const finModel = buildFinancialBackofficeModel({
      actor: financeAdminAal2,
      orders: [sampleOrder],
      pspReportedCaptures: [{ orderId: "ord_fin_1", capturedCents: 5425 }],
      settlementToExecute: {
        settlement: {
          id: "settle_99",
          organizationId: "org_101",
          courierId: null,
          periodStart: "2026-11-01",
          periodEnd: "2026-11-03",
          amountCents: 3960,
          status: "SCHEDULED",
          approvedBy: null,
          externalPayoutReference: null,
          createdAtIso: "2026-11-03T15:00:00Z",
        },
        providerCode: "stripe",
        bankAccountApprovedByActorId: "different_staff_id",
      },
      env: {}, // No PSP keys configured -> honest BLOCKED_NO_PSP
      locale: "pt-BR",
    });

    assert.equal(finModel.authorized, true);
    assert.equal(finModel.gmvCents, 4500);
    assert.equal(finModel.netPlatformRevenueCents, 765);
    assert.equal(finModel.merchantPayablesCents, 3960);
    assert.equal(finModel.courierPayablesCents, 700);
    assert.match(finModel.gmvVsRevenueNoticeText, /Volume Bruto de Mercadorias/);
    assert.equal(finModel.settlementResult?.status, "BLOCKED_NO_PSP");
    assert.match(finModel.settlementNoticeText ?? "", /BLOCKED_MISSING_CREDENTIALS/);

    // M14 Logistics console renders Haversine fallback notice when Google Maps is unconfigured
    const logisticsConsole = buildLogisticsDispatchConsoleModel({
      actor: financeAdminAal2,
      tasks: [
        {
          id: "dtask_1",
          orderId: "ord_fin_1",
          storeId: "store_201",
          fulfillmentModality: "PLATFORM_DELIVERY",
          status: "ASSIGNED",
          pickupLatitude: -23.561414,
          pickupLongitude: -46.655881,
          dropoffLatitude: -23.56398,
          dropoffLongitude: -46.66912,
          dropoffNeighborhoodOnly: "Bela Vista",
          dropoffFullAddress: "Av. Paulista, 1578",
          courierFeeCents: 700,
          distanceMeters: 1420,
          estimatedEtaMinutes: 18,
          activeCourierId: "courier_1",
          pickedUpAtIso: null,
          completedAtIso: null,
          createdAtIso: "2026-11-03T12:20:00Z",
        },
      ],
      env: {},
      locale: "en",
    });
    assert.equal(logisticsConsole.authorized, true);
    assert.equal(logisticsConsole.mapsProviderStatus, "BLOCKED_MISSING_CREDENTIALS");
    assert.match(logisticsConsole.mapsFallbackNoticeText ?? "", /Haversine distance \(1420m\)/);

    // M15 Fleet Operator Portal filters out independent and cross-fleet couriers
    const fleetModel = buildFleetOperatorPortalModel({
      fleetOrganizationId: "fleet_A",
      actorOrganizationIds: ["fleet_A"],
      isFleetContractApproved: true,
      couriers: [
        { courierId: "c1", courierName: "Fleet A Courier", fleetOrganizationId: "fleet_A" },
        { courierId: "c2", courierName: "Independent Courier", fleetOrganizationId: null },
        { courierId: "c3", courierName: "Fleet B Courier", fleetOrganizationId: "fleet_B" },
      ],
    });
    assert.equal(fleetModel.portalStatus, "ACTIVE");
    assert.equal(fleetModel.visibleCouriers.length, 1);
    assert.equal(fleetModel.visibleCouriers[0]?.courierId, "c1");
  });

  it("exposes RISK_COMPLIANCE_AND_LGPD to auditor_privacy and enforces M21 analytics, explainable risk & LGPD RBAC", () => {
    const privacyAuditor: AuthenticatedActorProfileContract = {
      ...staffAdminAal1,
      id: "00000000-0000-4000-8000-000000000094",
      aal: "aal2",
      staffScopes: [
        {
          role: "auditor_privacy",
          regionCode: null,
          maxRefundApprovalCents: 0,
          requiresMfa: true,
        },
      ],
    };

    const auditorModules = buildAdminRoleNavigationModules(privacyAuditor);
    assert.deepEqual(auditorModules, ["RISK_COMPLIANCE_AND_LGPD"]);

    const sampleKpis: AnalyticalKpiSummaryContract = {
      excludeTestData: true,
      gmvCents: 12000,
      netPlatformRevenueCents: 2100,
      pendingPaymentNetRevenueCents: 0,
      ledgerReconciledNetRevenueCents: 2100,
      isReconciledWithLedger: true,
      totalPlatformCommissionCents: 1800,
      totalServiceFeeCents: 300,
      totalPlatformCouponSubsidyCents: 0,
      operationalMarginCents: 2100,
      totalQuotesCount: 5,
      consumedQuotesCount: 3,
      quoteConversionRateBps: 6000,
      totalOrdersCount: 3,
      nonCancelledOrdersCount: 3,
      cancelledOrdersCount: 0,
      cancellationRateBps: 0,
      averagePrepSlaMinutes: 14,
      averageDeliverySlaMinutes: 26,
      cancellationBreakdown: [],
      regionalBreakdown: [],
      orderRows: [],
    };

    const analyticsDeniedAal1 = buildGovernanceAnalyticsConsoleModel({
      actor: staffAdminAal1,
      kpis: sampleKpis,
      locale: "en",
    });
    assert.equal(analyticsDeniedAal1.authorized, false);
    assert.equal(analyticsDeniedAal1.reconciliationBadge, "UNAUTHORIZED");

    const analyticsModel = buildGovernanceAnalyticsConsoleModel({
      actor: privacyAuditor,
      kpis: sampleKpis,
      locale: "pt-BR",
    });
    assert.equal(analyticsModel.authorized, true);
    assert.equal(analyticsModel.reconciliationBadge, "RECONCILED_WITH_LEDGER");
    assert.match(analyticsModel.formattedGmvBrl, /120,00/);

    const sampleAlerts: RiskAlertContract[] = [
      {
        id: "alert-1",
        subjectType: "USER",
        subjectId: "user-1",
        ruleCode: "VELOCITY_HIGH_REFUND_RATE",
        severity: "HIGH",
        status: "OPEN_AWAITING_HUMAN_REVIEW",
        ruleExplanation: {
          ruleCode: "VELOCITY_HIGH_REFUND_RATE",
          observedValue: 4,
          thresholdValue: 3,
          windowDescription: "30d",
          explanationEn: "High refund velocity observed",
          explanationPtBr: "Alta velocidade de reembolsos observada",
          evidenceRefs: ["order:1"],
        },
        recommendedAction: "MANUAL_REVIEW_REQUIRED",
        reviewedBy: null,
        reviewDecision: null,
        reviewReason: null,
        reviewedAt: null,
        isTestData: false,
        createdAt: "2026-11-10T10:00:00Z",
        updatedAt: "2026-11-10T10:00:00Z",
      },
    ];

    const auditorRiskModel = buildGovernanceRiskQueueModel({
      actor: privacyAuditor,
      alerts: sampleAlerts,
      locale: "en",
    });
    assert.equal(auditorRiskModel.authorized, true);
    assert.equal(auditorRiskModel.canExecuteHumanReview, false);
    assert.equal(auditorRiskModel.openAlertsCount, 1);

    const samplePrivacy: PrivacyRequestRecordContract[] = [
      {
        id: "req-1",
        userId: "user-1",
        requestType: "ANONYMIZATION",
        status: "BLOCKED_LEGAL_RETENTION",
        reason: "Account delete",
        retentionBlockReason: "STATUTORY_FISCAL_LEDGER_RETENTION",
        holdUntil: "2031-11-10T10:00:00Z",
        exportPayload: null,
        anonymizedAt: null,
        legalBasisNote: "LGPD Art. 16",
        processedBy: null,
        completedAt: null,
        isTestData: false,
        createdAt: "2026-11-10T10:00:00Z",
      },
    ];

    const privacyModel = buildGovernancePrivacyQueueModel({
      actor: privacyAuditor,
      requests: samplePrivacy,
      locale: "en",
    });
    assert.equal(privacyModel.authorized, true);
    assert.equal(privacyModel.blockedRetentionCount, 1);
  });
});

describe("@ideliveryfood/admin-web — Live Supabase SSR Integration Tests (M16, M13, M14, M15)", () => {
  const TEST_JWT_SECRET = "test_supabase_jwt_secret_phase_i_admin_web_32chars!";
  const TECH_ADMIN_ID = "00000000-0000-4000-8000-000000000099";
  const OPS_STAFF_ID = "00000000-0000-4000-8000-000000000090";
  const FINANCE_STAFF_ID = "00000000-0000-4000-8000-000000000091";

  let repo: SupabasePostgresRepositoryInstance;
  let apiServer: ReturnType<typeof createApiServer>;
  let adminWebServer: ReturnType<typeof createAdminWebServer>;
  let adminBaseUrl = "";

  const techAdminTokenAal1 = signSupabaseHs256Jwt(
    {
      sub: TECH_ADMIN_ID,
      email: "staff.admin@test.ideliveryfood.invalid",
      aal: "aal1",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    TEST_JWT_SECRET
  );

  const techAdminTokenAal2 = signSupabaseHs256Jwt(
    {
      sub: TECH_ADMIN_ID,
      email: "staff.admin@test.ideliveryfood.invalid",
      aal: "aal2",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    TEST_JWT_SECRET
  );

  const opsStaffTokenAal2 = signSupabaseHs256Jwt(
    {
      sub: OPS_STAFF_ID,
      email: "staff.ops@test.ideliveryfood.invalid",
      aal: "aal2",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    TEST_JWT_SECRET
  );

  const financeStaffTokenAal2 = signSupabaseHs256Jwt(
    {
      sub: FINANCE_STAFF_ID,
      email: "staff.finance@test.ideliveryfood.invalid",
      aal: "aal2",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    TEST_JWT_SECRET
  );

  before(async () => {
    repo = createSupabasePostgresRepository({
      connectionString: loadDatabaseUrl(),
      isTestData: true,
    });
    apiServer = createApiServer({
      repository: repo,
      env: {
        SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
      },
    });
    await new Promise<void>((resolve) => {
      apiServer.listen(0, "127.0.0.1", () => resolve());
    });
    const apiPort = (apiServer.address() as AddressInfo).port;

    adminWebServer = createAdminWebServer({
      apiBaseUrl: `http://127.0.0.1:${apiPort}/v1`,
      env: {},
    });
    await new Promise<void>((resolve) => {
      adminWebServer.listen(0, "127.0.0.1", () => resolve());
    });
    const webPort = (adminWebServer.address() as AddressInfo).port;
    adminBaseUrl = `http://127.0.0.1:${webPort}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => adminWebServer.close(() => resolve()));
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    await repo.close();
  });

  it("blocks /admin, /finance, and /logistics with HTTP 403 when staff JWT is only MFA aal1", async () => {
    for (const route of ["/admin", "/finance", "/logistics"]) {
      const res = await fetch(`${adminBaseUrl}${route}`, {
        headers: { Authorization: `Bearer ${techAdminTokenAal1}` },
      });
      assert.equal(res.status, 403, `Expected 403 on ${route} with aal1`);
      const html = await res.text();
      assert.match(html, /MFA aal2/);
    }
  });

  it("renders M16 Central Admin Backoffice (/admin, /admin/approvals, /admin/scopes, /admin/audit) with live Supabase data at MFA aal2", async () => {
    const res = await fetch(`${adminBaseUrl}/admin?locale=en`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();

    // Verifies live organizations & all stores including draft/unpublished Store 203
    assert.match(html, /Paulista Artisan Burgers/);
    assert.match(html, /Tokyo Bay Sushi/);
    assert.match(html, /Paulista Artisan Burgers - Itaim \(Unpublished Unit\)/);
    // Verifies KYC approval events, self-grant prohibition, read-only audit badge, and provider readiness
    assert.match(html, /KYC and CNPJ verified for Paulista Artisan Burgers/);
    assert.match(html, /Self-grant blocked/);
    assert.match(html, /Immutable Audit Trail \(Read-Only\)/);
    assert.match(html, /SEED_BOOTSTRAP_VERIFIED/);
    assert.match(html, /BLOCKED_MISSING_CREDENTIALS/);
  });

  it("enforces strict role segregation between Finance (M13) and Logistics Operations (M14) against live Supabase", async () => {
    // 1. Finance staff Roberto (aal2) can access /finance and verify balanced double-entry ledger
    const finAllowed = await fetch(`${adminBaseUrl}/finance?locale=en`, {
      headers: { Authorization: `Bearer ${financeStaffTokenAal2}` },
    });
    assert.equal(finAllowed.status, 200);
    const finHtml = await finAllowed.text();
    assert.match(finHtml, /BALANCED \(DEBITS === CREDITS\)/);
    assert.match(finHtml, /ASSET_PSP_CLEARING/);
    assert.match(finHtml, /LIABILITY_MERCHANT_ORG_101/);
    assert.match(finHtml, /REVENUE_PLATFORM_COMMISSION/);
    assert.match(finHtml, /BLOCKED_MISSING_CREDENTIALS/);

    // Finance staff Roberto (aal2) is blocked from /logistics (HTTP 403)
    const logDeniedForFinance = await fetch(`${adminBaseUrl}/logistics`, {
      headers: { Authorization: `Bearer ${financeStaffTokenAal2}` },
    });
    assert.equal(logDeniedForFinance.status, 403);

    // 2. Operations staff Marina (aal2) can access /logistics and view live tasks, offers, GPS samples & Haversine fallback
    const logAllowed = await fetch(`${adminBaseUrl}/logistics?locale=en`, {
      headers: { Authorization: `Bearer ${opsStaffTokenAal2}` },
    });
    assert.equal(logAllowed.status, 200);
    const logHtml = await logAllowed.text();
    assert.match(logHtml, /Haversine distance \(1420m\)/);
    assert.match(logHtml, /Carlos Entregador Teste/);
    assert.match(logHtml, /HIGH_ACCURACY/);
    assert.match(logHtml, /Pre-acceptance privacy/);

    // Operations staff Marina (aal2) is blocked from /finance (HTTP 403)
    const finDeniedForOps = await fetch(`${adminBaseUrl}/finance`, {
      headers: { Authorization: `Bearer ${opsStaffTokenAal2}` },
    });
    assert.equal(finDeniedForOps.status, 403);
  });

  it("renders M15 Fleet Operator Portal (/fleets) governed by live platform_policies feature_fleet_operators_enabled flag", async () => {
    const res = await fetch(`${adminBaseUrl}/fleets?locale=en`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /DEFAULT_BR_MARKETPLACE/);
    assert.match(html, /DISABLED_PENDING_FLEET_CONTRACT/);
    assert.match(html, /FALSE \(DISABLED BY DEFAULT POLICY\)/);
  });

  it("renders M17 Support, SLA & Refund Authority Console (/support) with live Supabase cases, internal notes, attachments & PENDING_FINANCE queue", async () => {
    const res = await fetch(`${adminBaseUrl}/support?locale=en`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Support, SLA & Refund Authority Console \(M17\)/);
    assert.match(html, /1500 cents/);
    assert.match(html, /ESCALATED_FINANCE/);
    assert.match(html, /PENDING_FINANCE/);
    assert.match(html, /INTERNAL_STAFF_NOTE/);
    assert.match(html, /INTERNAL_ONLY/);
  });

  it("renders M18 Commercial, Leads, Proposals & Versioned Contracts Console (/commercial) with live Supabase data and finance segregation", async () => {
    const res = await fetch(`${adminBaseUrl}/commercial?locale=en`, {
      headers: { Authorization: `Bearer ${opsStaffTokenAal2}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(
      html,
      /Commercial &amp; Partner Onboarding Console — Leads, Proposals &amp; Versioned Contracts/
    );
    assert.match(html, /Napoli Bela Vista/);
    assert.match(html, /PENDING_LEGAL_REVIEW/);
    assert.match(html, /21\.00% \(2100 bps\)/);
    assert.match(html, /23\.00% \(2300 bps\)/);
    assert.match(
      html,
      /Role Segregation: Commercial staff manage leads, proposals, and commission rules/
    );

    // Finance-only staff Roberto is blocked from /commercial (HTTP 403)
    const deniedFinance = await fetch(`${adminBaseUrl}/commercial?locale=en`, {
      headers: { Authorization: `Bearer ${financeStaffTokenAal2}` },
    });
    assert.equal(deniedFinance.status, 403);
  });

  it("renders M19 Marketing, Atomic Coupon Budget & Verified Reviews Moderation Console (/marketing) with live Supabase data", async () => {
    const res = await fetch(`${adminBaseUrl}/marketing?locale=en`, {
      headers: { Authorization: `Bearer ${opsStaffTokenAal2}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(
      html,
      /Growth, Promotions, Atomic Budget &amp; Verified Reviews Moderation Console \(M19\)/
    );
    assert.match(html, /WELCOME10/);
    assert.match(html, /PAULISTA15/);
    assert.match(html, /SHARED \(50% plat\)/);
    assert.match(html, /Sponsored Ads:\s*DISABLED \(Policy Gate\)/);
    assert.match(html, /Subscriptions:\s*DISABLED \(Policy Gate\)/);
    assert.match(html, /Atomic PostgreSQL Budget Guard/);
    assert.match(html, /Crisp smash burger crust and fast delivery!/);

    // Finance-only staff Roberto is blocked from /marketing (HTTP 403)
    const deniedFinance = await fetch(`${adminBaseUrl}/marketing?locale=en`, {
      headers: { Authorization: `Bearer ${financeStaffTokenAal2}` },
    });
    assert.equal(deniedFinance.status, 403);
  });

  it("renders M21 Governance Console (/governance/analytics, /governance/risk, /governance/privacy) with MFA aal2, RBAC & live Supabase data", async () => {
    // 1. aal1 staff is blocked on all M21 governance routes (HTTP 403)
    for (const route of [
      "/governance/analytics",
      "/governance/risk",
      "/governance/privacy",
    ]) {
      const res = await fetch(`${adminBaseUrl}${route}`, {
        headers: { Authorization: `Bearer ${techAdminTokenAal1}` },
      });
      assert.equal(res.status, 403, `Expected 403 on ${route} for aal1`);
      const html = await res.text();
      assert.match(html, /MFA aal2/);
    }

    // 2. Finance staff Roberto (aal2) can view /governance/analytics but is blocked from /governance/risk & /governance/privacy
    const finAnalyticsRes = await fetch(
      `${adminBaseUrl}/governance/analytics?locale=en`,
      {
        headers: { Authorization: `Bearer ${financeStaffTokenAal2}` },
      }
    );
    assert.equal(finAnalyticsRes.status, 200);
    const finAnalyticsHtml = await finAnalyticsRes.text();
    assert.match(finAnalyticsHtml, /RECONCILED_WITH_LEDGER/);
    assert.match(finAnalyticsHtml, /Reproducible Analytical KPIs &amp; M13 Ledger Reconciliation/);

    for (const forbiddenRoute of ["/governance/risk", "/governance/privacy"]) {
      const res = await fetch(`${adminBaseUrl}${forbiddenRoute}`, {
        headers: { Authorization: `Bearer ${financeStaffTokenAal2}` },
      });
      assert.equal(
        res.status,
        403,
        `Expected finance-only staff to be blocked on ${forbiddenRoute}`
      );
    }

    // 3. Tech Admin (aal2) renders live Analytics KPIs + ?excludeTestData=true toggle
    const analyticsProdOnlyRes = await fetch(
      `${adminBaseUrl}/governance/analytics?locale=en&excludeTestData=true`,
      {
        headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
      }
    );
    assert.equal(analyticsProdOnlyRes.status, 200);
    const analyticsProdHtml = await analyticsProdOnlyRes.text();
    assert.match(analyticsProdHtml, /RECONCILED_WITH_LEDGER/);
    assert.match(analyticsProdHtml, /Showing Production Only/);

    // 4. Tech Admin (aal2) renders live Explainable Risk Queue (/governance/risk)
    const riskRes = await fetch(`${adminBaseUrl}/governance/risk?locale=en`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(riskRes.status, 200);
    const riskHtml = await riskRes.text();
    assert.match(riskHtml, /No-opaque-auto-ban policy active/);
    assert.match(riskHtml, /VELOCITY_HIGH_REFUND_RATE/);
    assert.match(riskHtml, /OPEN_AWAITING_HUMAN_REVIEW/);

    // 5. Tech Admin (aal2) renders live LGPD Privacy Queue (/governance/privacy)
    const privacyRes = await fetch(
      `${adminBaseUrl}/governance/privacy?locale=en`,
      {
        headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
      }
    );
    assert.equal(privacyRes.status, 200);
    const privacyHtml = await privacyRes.text();
    assert.match(privacyHtml, /LGPD \(Arts\. 7, 16 &amp; 18\)/);
    assert.match(privacyHtml, /EXPORT_DATA/);
    assert.match(privacyHtml, /LGPD Art\. 18, V/);
  });
});

