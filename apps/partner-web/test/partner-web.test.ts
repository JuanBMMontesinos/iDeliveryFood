import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedActorProfileContract } from "@ideliveryfood/contracts";
import { buildPartnerPortalScreenModel, evaluateMultiUnitCatalogBatch } from "../src/index.js";

describe("@ideliveryfood/partner-web — Multi-Tenant Scope, Partner Finance Segregation & M09 Multi-Unit Batch", () => {
  const operatorLucas: AuthenticatedActorProfileContract = {
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

  const financeClara: AuthenticatedActorProfileContract = {
    id: "00000000-0000-4000-8000-000000000012",
    email: "finance.paulista@test.ideliveryfood.invalid",
    fullName: "Clara Partner Finance",
    phone: "+5511900000012",
    preferredLocale: "en",
    status: "ACTIVE",
    mfaEnforced: false,
    aal: "aal1",
    organizationMemberships: [
      {
        organizationId: "00000000-0000-4000-8000-000000000101",
        storeId: null,
        role: "partner_finance",
      },
    ],
    staffScopes: [],
  };

  it("allows partner_operator to access Store 201 operations while segregating financial ledger", () => {
    const screen = buildPartnerPortalScreenModel({
      actor: operatorLucas,
      organizationId: "00000000-0000-4000-8000-000000000101",
      storeId: "00000000-0000-4000-8000-000000000201",
    });

    assert.equal(screen.canAccessStoreOperations, true);
    assert.equal(screen.canAccessFinancialLedger, false);
    assert.match(screen.financeSegregationNotice ?? "", /restritos aos papéis de Proprietário e Financeiro/);
  });

  it("denies partner_operator access to another tenant organization (Org 102)", () => {
    const crossTenantScreen = buildPartnerPortalScreenModel({
      actor: operatorLucas,
      organizationId: "00000000-0000-4000-8000-000000000102",
    });

    assert.equal(crossTenantScreen.canAccessStoreOperations, false);
    assert.equal(crossTenantScreen.banner?.kind, "forbidden");
  });

  it("grants partner_finance access to Organization 101 financial ledger", () => {
    const financeScreen = buildPartnerPortalScreenModel({
      actor: financeClara,
      organizationId: "00000000-0000-4000-8000-000000000101",
    });

    assert.equal(financeScreen.canAccessStoreOperations, true);
    assert.equal(financeScreen.canAccessFinancialLedger, true);
    assert.equal(financeScreen.financeSegregationNotice, null);
  });

  it("evaluates M09 multi-unit catalog batch updates with per-unit partial status reporting", () => {
    const batch = evaluateMultiUnitCatalogBatch({
      actor: operatorLucas,
      organizationId: "00000000-0000-4000-8000-000000000101",
      productId: "00000000-0000-4000-8000-000000000601",
      targetStoreIds: [
        "00000000-0000-4000-8000-000000000201",
        "00000000-0000-4000-8000-000000000203",
      ],
      locale: "en",
    });

    assert.equal(batch.results[0]?.status, "APPLIED");
    assert.equal(batch.results[1]?.status, "DENIED_SCOPE");
    assert.equal(
      batch.summaryText,
      "Batch catalog update: 1 applied, 1 denied across 2 unit targets."
    );
  });
});
