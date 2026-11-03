import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedActorProfileContract } from "@ideliveryfood/contracts";
import {
  authorizePartnerScope,
  authorizeStaffAction,
  hashInvitationToken,
  isAllowedAuthRedirectUri,
  sanitizeClientUserMetadata,
  validateInvitationAcceptance,
} from "../src/index.js";

describe("@ideliveryfood/authz — RBAC, Multi-Tenant ABAC, MFA aal2, Invitations & Redirect Guard Tests", () => {
  const partnerOperatorActor: AuthenticatedActorProfileContract = {
    id: "00000000-0000-4000-8000-000000000011",
    email: "operator.paulista@test.ideliveryfood.invalid",
    fullName: "Lucas Store Operator",
    phone: "+5511900000011",
    preferredLocale: "pt-BR",
    status: "ACTIVE",
    mfaEnforced: false,
    aal: "aal1",
    organizationMemberships: [
      {
        organizationId: "00000000-0000-4000-8000-000000000101",
        storeId: "00000000-0000-4000-8000-000000000201",
        role: "partner_operator",
      },
    ],
    staffScopes: [],
  };

  it("strips any self-assigned roles or tenant scopes from client user_metadata", () => {
    const cleaned = sanitizeClientUserMetadata({
      display_theme: "dark",
      role: "tech_admin",
      is_super_admin: true,
      organization_id: "00000000-0000-4000-8000-000000000101",
      aal: "aal2",
    });

    assert.deepEqual(cleaned, { display_theme: "dark" });
  });

  it("enforces store-level and organization-level isolation and role segregation for partners", () => {
    const allowedStore201 = authorizePartnerScope({
      actor: partnerOperatorActor,
      organizationId: "00000000-0000-4000-8000-000000000101",
      storeId: "00000000-0000-4000-8000-000000000201",
      allowedRoles: ["partner_operator", "partner_manager"],
    });
    assert.equal(allowedStore201.allowed, true);

    const deniedOtherStore = authorizePartnerScope({
      actor: partnerOperatorActor,
      organizationId: "00000000-0000-4000-8000-000000000101",
      storeId: "00000000-0000-4000-8000-000000000203",
      allowedRoles: ["partner_operator"],
    });
    assert.equal(deniedOtherStore.allowed, false);
    assert.equal(deniedOtherStore.reasonCode, "DENIED_TENANT_SCOPE_MISMATCH");

    const deniedOtherOrg = authorizePartnerScope({
      actor: partnerOperatorActor,
      organizationId: "00000000-0000-4000-8000-000000000102",
      allowedRoles: ["partner_operator"],
    });
    assert.equal(deniedOtherOrg.allowed, false);
    assert.equal(deniedOtherOrg.reasonCode, "DENIED_TENANT_SCOPE_MISMATCH");

    const deniedFinanceRole = authorizePartnerScope({
      actor: partnerOperatorActor,
      organizationId: "00000000-0000-4000-8000-000000000101",
      storeId: "00000000-0000-4000-8000-000000000201",
      allowedRoles: ["partner_finance", "partner_owner"],
    });
    assert.equal(deniedFinanceRole.allowed, false);
    assert.equal(deniedFinanceRole.reasonCode, "DENIED_ROLE_INSUFFICIENT");
  });

  it("enforces MFA aal2 step-up and refund ceiling ABAC on internal staff actions", () => {
    const staffOpsAal1: AuthenticatedActorProfileContract = {
      id: "00000000-0000-4000-8000-000000000090",
      email: "staff.ops@test.ideliveryfood.invalid",
      fullName: "Marina Platform Operations",
      phone: "+5511900000090",
      preferredLocale: "en",
      status: "ACTIVE",
      mfaEnforced: true,
      aal: "aal1",
      organizationMemberships: [],
      staffScopes: [
        {
          role: "operations",
          regionCode: "BR-SP",
          maxRefundApprovalCents: 10000,
          requiresMfa: true,
        },
      ],
    };

    const deniedAal1 = authorizeStaffAction({
      actor: staffOpsAal1,
      allowedRoles: ["operations"],
    });
    assert.equal(deniedAal1.allowed, false);
    assert.equal(deniedAal1.reasonCode, "DENIED_MFA_STEP_UP_REQUIRED");

    const staffOpsAal2: AuthenticatedActorProfileContract = {
      ...staffOpsAal1,
      aal: "aal2",
    };

    const allowedAal2 = authorizeStaffAction({
      actor: staffOpsAal2,
      allowedRoles: ["operations"],
      regionCode: "BR-SP",
      refundAmountCents: 5000,
    });
    assert.equal(allowedAal2.allowed, true);

    const deniedExceedingRefundLimit = authorizeStaffAction({
      actor: staffOpsAal2,
      allowedRoles: ["operations"],
      regionCode: "BR-SP",
      refundAmountCents: 25000,
    });
    assert.equal(deniedExceedingRefundLimit.allowed, false);
    assert.equal(deniedExceedingRefundLimit.reasonCode, "DENIED_TENANT_SCOPE_MISMATCH");
  });

  it("validates single-use invitation tokens and blocks expired or consumed tokens", () => {
    const rawToken = "inv_token_secret_9876543210";
    const tokenHash = hashInvitationToken(rawToken);

    const validResult = validateInvitationAcceptance({
      rawToken,
      actorEmail: "new.manager@test.ideliveryfood.invalid",
      invitation: {
        id: "00000000-0000-4000-8000-000000009001",
        email: "new.manager@test.ideliveryfood.invalid",
        tokenHash,
        expiresAtIso: "2026-11-10T00:00:00Z",
        consumedAtIso: null,
      },
      now: new Date("2026-11-03T12:00:00Z"),
    });
    assert.equal(validResult.valid, true);

    const expiredResult = validateInvitationAcceptance({
      rawToken,
      actorEmail: "new.manager@test.ideliveryfood.invalid",
      invitation: {
        id: "00000000-0000-4000-8000-000000009001",
        email: "new.manager@test.ideliveryfood.invalid",
        tokenHash,
        expiresAtIso: "2026-11-01T00:00:00Z",
        consumedAtIso: null,
      },
      now: new Date("2026-11-03T12:00:00Z"),
    });
    assert.equal(expiredResult.valid, false);
    assert.equal(expiredResult.reasonCode, "EXPIRED");

    const consumedResult = validateInvitationAcceptance({
      rawToken,
      actorEmail: "new.manager@test.ideliveryfood.invalid",
      invitation: {
        id: "00000000-0000-4000-8000-000000009001",
        email: "new.manager@test.ideliveryfood.invalid",
        tokenHash,
        expiresAtIso: "2026-11-10T00:00:00Z",
        consumedAtIso: "2026-11-02T10:00:00Z",
      },
      now: new Date("2026-11-03T12:00:00Z"),
    });
    assert.equal(consumedResult.valid, false);
    assert.equal(consumedResult.reasonCode, "ALREADY_CONSUMED");
  });

  it("blocks open redirects while allowing allowlisted Web and Native deep links", () => {
    assert.equal(isAllowedAuthRedirectUri("http://localhost:3000/auth/callback"), true);
    assert.equal(isAllowedAuthRedirectUri("https://partner.ideliveryfood.com.br/dashboard"), true);
    assert.equal(isAllowedAuthRedirectUri("ideliveryfood-customer://auth-callback?code=123"), true);
    assert.equal(isAllowedAuthRedirectUri("ideliveryfood-courier://auth-callback?code=123"), true);
    assert.equal(isAllowedAuthRedirectUri("https://evil-phishing.example.com/callback"), false);
    assert.equal(isAllowedAuthRedirectUri("javascript:alert(1)"), false);
  });
});
