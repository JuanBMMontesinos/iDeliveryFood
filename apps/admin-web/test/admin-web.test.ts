import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedActorProfileContract } from "@ideliveryfood/contracts";
import {
  buildAdminAuditTrailExplorerModel,
  buildAdminGovernanceScreenModel,
  buildAdminRoleNavigationModules,
  buildFinancialBackofficeModel,
  buildFleetOperatorPortalModel,
  buildLogisticsDispatchConsoleModel,
  executeAdminCadastreGovernanceAction,
  executeAdminStaffScopeGrant,
} from "../src/index.js";

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
});
