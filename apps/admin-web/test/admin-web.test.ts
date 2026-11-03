import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedActorProfileContract } from "@ideliveryfood/contracts";
import { buildAdminGovernanceScreenModel } from "../src/index.js";

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
});
