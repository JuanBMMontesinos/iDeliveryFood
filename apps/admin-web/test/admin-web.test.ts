import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedActorProfileContract } from "@ideliveryfood/contracts";
import {
  buildAdminAuditTrailExplorerModel,
  buildAdminGovernanceScreenModel,
  buildAdminRoleNavigationModules,
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
});
