import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
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

describe("Fase O (M18) — Live Supabase Commercial Leads, Proposals, Versioned Contracts & Commission Rules Tests", () => {
  const TEST_JWT_SECRET = "test_supabase_jwt_secret_phase_o_commercial_32c!";

  const HELENA_OWNER_ID = "00000000-0000-4000-8000-000000000010";
  const LUCAS_OPERATOR_ID = "00000000-0000-4000-8000-000000000011";
  const MARINA_OPS_ID = "00000000-0000-4000-8000-000000000090";
  const ROBERTO_FINANCE_ID = "00000000-0000-4000-8000-000000000091";
  const COMMERCIAL_STAFF_ID = "00000000-0000-4000-8000-000000000094";
  const COMMERCIAL_SCOPE_ID = "00000000-0000-4000-8000-000000000494";

  const TEMP_LEAD_ID = "00000000-0000-4000-8000-000000009801";
  const TEMP_PROPOSAL_ID = "00000000-0000-4000-8000-000000009802";
  const TEMP_ORG_ID = "00000000-0000-4000-8000-000000009803";
  const TEMP_STORE_ID = "00000000-0000-4000-8000-000000009804";
  const TEMP_CONTRACT_ID = "00000000-0000-4000-8000-000000009805";
  const TEMP_RULE_ID = "00000000-0000-4000-8000-000000009806";

  let repo: SupabasePostgresRepositoryInstance;
  let server: ReturnType<typeof createApiServer>;
  let baseUrl = "";

  function tokenFor(sub: string, email: string, aal: "aal1" | "aal2" = "aal1"): string {
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

  const helenaToken = tokenFor(HELENA_OWNER_ID, "owner.paulista@test.ideliveryfood.invalid", "aal1");
  const lucasOperatorToken = tokenFor(
    LUCAS_OPERATOR_ID,
    "operator.paulista@test.ideliveryfood.invalid",
    "aal1"
  );
  const marinaTokenAal2 = tokenFor(MARINA_OPS_ID, "staff.ops@test.ideliveryfood.invalid", "aal2");
  const robertoFinanceTokenAal2 = tokenFor(
    ROBERTO_FINANCE_ID,
    "staff.finance@test.ideliveryfood.invalid",
    "aal2"
  );
  const commercialOnlyTokenAal2 = tokenFor(
    COMMERCIAL_STAFF_ID,
    "staff.commercial@test.ideliveryfood.invalid",
    "aal2"
  );

  before(async () => {
    repo = createSupabasePostgresRepository({
      connectionString: loadDatabaseUrl(),
      isTestData: true,
    });

    // Provision a dedicated commercial-only staff profile + scope for strict RBAC segregation tests
    await repo.pool.query(
      `INSERT INTO auth.users (
         instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at
       ) VALUES (
         '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
         'staff.commercial@test.ideliveryfood.invalid', NULL, timezone('utc', now()),
         '{"provider":"email","providers":["email"]}'::jsonb, '{"synthetic_test":true}'::jsonb,
         false, false, timezone('utc', now()), timezone('utc', now())
       ) ON CONFLICT (id) DO NOTHING`,
      [COMMERCIAL_STAFF_ID]
    );
    await repo.pool.query(
      `INSERT INTO public.profiles (id, email, full_name, phone, preferred_locale, status, mfa_enforced, is_test_data)
       VALUES ($1, 'staff.commercial@test.ideliveryfood.invalid', 'Camila Commercial Executive', '+5511900000094', 'en', 'ACTIVE', true, true)
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', is_test_data = true`,
      [COMMERCIAL_STAFF_ID]
    );
    await repo.pool.query(
      `INSERT INTO public.staff_scopes (
         id, user_id, role, region_code, max_refund_approval_cents, requires_mfa, is_active, justification, is_test_data
       ) VALUES (
         $1, $2, 'commercial', 'BR-SP', 0, true, true, 'Fase O M18 Commercial Executive Scope', true
       ) ON CONFLICT (id) DO UPDATE SET role = 'commercial', is_active = true, is_test_data = true`,
      [COMMERCIAL_SCOPE_ID, COMMERCIAL_STAFF_ID]
    );

    server = createApiServer({
      repository: repo,
      env: {
        SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
      },
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await repo.pool.query(`DELETE FROM public.commission_rule_versions WHERE id = $1`, [
      TEMP_RULE_ID,
    ]);
    await repo.pool.query(`DELETE FROM public.merchant_contracts WHERE id = $1`, [
      TEMP_CONTRACT_ID,
    ]);
    await repo.pool.query(`DELETE FROM public.commercial_proposals WHERE id = $1`, [
      TEMP_PROPOSAL_ID,
    ]);
    await repo.pool.query(`DELETE FROM public.commercial_leads WHERE id = $1`, [TEMP_LEAD_ID]);
    await repo.pool.query(`DELETE FROM public.organization_members WHERE organization_id = $1`, [
      TEMP_ORG_ID,
    ]);
    await repo.pool.query(`DELETE FROM public.stores WHERE id = $1`, [TEMP_STORE_ID]);
    await repo.pool.query(`DELETE FROM public.organizations WHERE id = $1`, [TEMP_ORG_ID]);
    await repo.pool.query(`DELETE FROM public.staff_scopes WHERE id = $1`, [COMMERCIAL_SCOPE_ID]);
    await repo.close();
  });

  it("1. returns seeded M18 commercial overview (leads, proposals, versioned contracts, and commission rules) from live Supabase", async () => {
    const res = await fetch(`${baseUrl}/commercial/overview`, {
      headers: { Authorization: `Bearer ${commercialOnlyTokenAal2}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: {
        leads: Array<{ id: string; tradeName: string }>;
        proposals: Array<{ id: string; platformDeliveryCommissionBps: number }>;
        contracts: Array<{ id: string; versionNumber: number }>;
        commissionRuleVersions: Array<{ id: string; platformDeliveryCommissionBps: number }>;
      };
    };

    assert.ok(
      body.data.leads.some((l) => l.id === "00000000-0000-4000-8000-000000001720"),
      "Expected seeded commercial lead Napoli Bela Vista"
    );
    assert.ok(
      body.data.proposals.some((p) => p.id === "00000000-0000-4000-8000-000000001729"),
      "Expected seeded commercial proposal 1729"
    );
    assert.ok(
      body.data.contracts.some((c) => c.id === "00000000-0000-4000-8000-000000001401"),
      "Expected seeded merchant contract 1401"
    );
    assert.ok(
      body.data.commissionRuleVersions.some(
        (r) => r.id === "00000000-0000-4000-8000-000000001730"
      ),
      "Expected seeded commission rule version 1730"
    );
  });

  it("2. creates a B2B commercial lead, transitions its pipeline status, issues a commercial proposal, and converts it into a tenant organization + draft store + versioned contract + commission rule", async () => {
    // 2a. Create lead
    const createLeadRes = await fetch(`${baseUrl}/commercial/leads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${commercialOnlyTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: TEMP_LEAD_ID,
        legalName: "Gelateria Moema Artesanal Ltda",
        tradeName: "Gelato Moema",
        taxId: "44556677000199",
        contactEmail: "contato.moema@test.ideliveryfood.invalid",
        contactPhone: "+5511988887777",
        city: "São Paulo",
        stateCode: "SP",
        cuisineCategory: "DESSERTS",
        legalBasis: "PARTNER_INBOUND_APPLICATION",
        notes: "Artisanal gelato shop in Moema",
      }),
    });
    assert.equal(createLeadRes.status, 201);
    const createdLead = (await createLeadRes.json()) as {
      data: { id: string; status: string; tradeName: string };
    };
    assert.equal(createdLead.data.id, TEMP_LEAD_ID);
    assert.equal(createdLead.data.status, "NEW");

    // 2b. Transition NEW -> QUALIFYING
    const qualifyRes = await fetch(`${baseUrl}/commercial/leads/${TEMP_LEAD_ID}/status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${commercialOnlyTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "QUALIFYING",
        notes: "CNPJ and sanitary license verified",
      }),
    });
    assert.equal(qualifyRes.status, 200);
    const qualifiedLead = (await qualifyRes.json()) as { data: { status: string } };
    assert.equal(qualifiedLead.data.status, "QUALIFYING");

    // 2c. Issue Commercial Proposal (automatically transitions lead QUALIFYING -> PROPOSAL_SENT)
    const propRes = await fetch(`${baseUrl}/commercial/leads/${TEMP_LEAD_ID}/proposals`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${commercialOnlyTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: TEMP_PROPOSAL_ID,
        proposalVersion: 1,
        platformDeliveryCommissionBps: 1950,
        merchantDeliveryCommissionBps: 950,
        pickupCommissionBps: 750,
        serviceFeeBps: 450,
        payoutCycleDays: 7,
        legalTemplateStatus: "PENDING_LEGAL_REVIEW",
        notes: "Special dessert tier proposal (19.5% platform delivery)",
      }),
    });
    assert.equal(propRes.status, 201);
    const createdProp = (await propRes.json()) as {
      data: {
        id: string;
        status: string;
        platformDeliveryCommissionBps: number;
        legalTemplateStatus: string;
      };
    };
    assert.equal(createdProp.data.id, TEMP_PROPOSAL_ID);
    assert.equal(createdProp.data.status, "SENT");
    assert.equal(createdProp.data.platformDeliveryCommissionBps, 1950);
    assert.equal(createdProp.data.legalTemplateStatus, "PENDING_LEGAL_REVIEW");

    // 2d. Convert Proposal into Organization + Store + Versioned Contract + Commission Rule
    const convertRes = await fetch(
      `${baseUrl}/commercial/proposals/${TEMP_PROPOSAL_ID}/convert`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${commercialOnlyTokenAal2}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: TEMP_ORG_ID,
          organizationSlug: "gelato-moema-9803",
          storeId: TEMP_STORE_ID,
          storeSlug: "gelato-moema-unit-9804",
          contractId: TEMP_CONTRACT_ID,
          commissionRuleId: TEMP_RULE_ID,
          partnerOwnerUserId: HELENA_OWNER_ID,
        }),
      }
    );
    assert.equal(convertRes.status, 201);
    const converted = (await convertRes.json()) as {
      data: {
        organizationId: string;
        storeId: string;
        lead: { status: string; convertedOrganizationId: string };
        proposal: { status: string; organizationId: string };
        contract: {
          id: string;
          versionNumber: number;
          platformDeliveryCommissionBps: number;
          acceptedByPartnerOwnerId: string | null;
        };
        commissionRule: {
          id: string;
          versionNumber: number;
          platformDeliveryCommissionBps: number;
        };
      };
    };
    assert.equal(converted.data.organizationId, TEMP_ORG_ID);
    assert.equal(converted.data.storeId, TEMP_STORE_ID);
    assert.equal(converted.data.lead.status, "CONVERTED");
    assert.equal(converted.data.lead.convertedOrganizationId, TEMP_ORG_ID);
    assert.equal(converted.data.proposal.status, "ACCEPTED");
    assert.equal(converted.data.contract.id, TEMP_CONTRACT_ID);
    assert.equal(converted.data.contract.versionNumber, 1);
    assert.equal(converted.data.contract.platformDeliveryCommissionBps, 1950);
    assert.equal(converted.data.contract.acceptedByPartnerOwnerId, null);
    assert.equal(converted.data.commissionRule.id, TEMP_RULE_ID);
    assert.equal(converted.data.commissionRule.versionNumber, 1);
  });

  it("3. enforces that only partner_owner can formally accept the versioned merchant contract and query versioned commission rules", async () => {
    // 3a. Partner operator (Lucas) cannot accept contract -> 403
    const opAttempt = await fetch(
      `${baseUrl}/commercial/contracts/${TEMP_CONTRACT_ID}/accept`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${lucasOperatorToken}` },
      }
    );
    assert.equal(opAttempt.status, 403);

    // 3b. Partner owner (Helena, assigned during onboarding conversion) accepts contract -> 200
    const ownerAccept = await fetch(
      `${baseUrl}/commercial/contracts/${TEMP_CONTRACT_ID}/accept`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${helenaToken}` },
      }
    );
    assert.equal(ownerAccept.status, 200);
    const acceptedBody = (await ownerAccept.json()) as {
      data: {
        id: string;
        acceptedByPartnerOwnerId: string | null;
        acceptedAtIso: string | null;
      };
    };
    assert.equal(acceptedBody.data.id, TEMP_CONTRACT_ID);
    assert.equal(acceptedBody.data.acceptedByPartnerOwnerId, HELENA_OWNER_ID);
    assert.ok(acceptedBody.data.acceptedAtIso);

    // 3c. Partner owner queries active commission rules for the organization
    const rulesRes = await fetch(
      `${baseUrl}/partner/organizations/${TEMP_ORG_ID}/commission-rules`,
      {
        headers: { Authorization: `Bearer ${helenaToken}` },
      }
    );
    assert.equal(rulesRes.status, 200);
    const rulesBody = (await rulesRes.json()) as {
      data: Array<{
        id: string;
        contractId: string;
        versionNumber: number;
        platformDeliveryCommissionBps: number;
      }>;
    };
    assert.equal(rulesBody.data.length, 1);
    assert.equal(rulesBody.data[0]?.id, TEMP_RULE_ID);
    assert.equal(rulesBody.data[0]?.platformDeliveryCommissionBps, 1950);
  });

  it("4. enforces strict RBAC Segregation of Duties: commercial staff cannot access finance overview or execute settlements, and finance-only staff cannot mutate commercial leads", async () => {
    // Commercial staff blocked from /v1/finance/overview (403)
    const finOverviewDenied = await fetch(`${baseUrl}/finance/overview`, {
      headers: { Authorization: `Bearer ${commercialOnlyTokenAal2}` },
    });
    assert.equal(finOverviewDenied.status, 403);

    // Commercial staff blocked from /v1/finance/settlements/:id/execute (403)
    const settleExecDenied = await fetch(
      `${baseUrl}/finance/settlements/00000000-0000-4000-8000-000000001411/execute`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${commercialOnlyTokenAal2}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": "idem_settle_segregation_test_1",
        },
        body: JSON.stringify({
          providerCode: "stripe",
          organizationId: "00000000-0000-4000-8000-000000000101",
          amountCents: 3960,
        }),
      }
    );
    assert.equal(settleExecDenied.status, 403);

    // Finance-only staff Roberto blocked from /v1/commercial/overview (403)
    const commDeniedForFinance = await fetch(`${baseUrl}/commercial/overview`, {
      headers: { Authorization: `Bearer ${robertoFinanceTokenAal2}` },
    });
    assert.equal(commDeniedForFinance.status, 403);

    // Operations staff Marina can access /v1/commercial/overview (200)
    const commAllowedForOps = await fetch(`${baseUrl}/commercial/overview`, {
      headers: { Authorization: `Bearer ${marinaTokenAal2}` },
    });
    assert.equal(commAllowedForOps.status, 200);
  });
});
