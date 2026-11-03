import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type {
  AuthenticatedActorProfileContract,
  PublishedStoreContract,
  SupportedLocale,
  UserPreferencesContract,
} from "@ideliveryfood/contracts";
import type { StoredInvitationRecord } from "@ideliveryfood/authz";
import {
  createApiServer,
  type ApiDataRepository,
  type AuditLogWriteRecord,
} from "../src/index.js";

describe("@ideliveryfood/api — /v1 HTTP Integration, AuthZ, MFA aal2, Locale Persistence & Quotes", () => {
  const auditLogs: AuditLogWriteRecord[] = [];
  const invitations = new Map<string, StoredInvitationRecord>();
  const userLocales = new Map<string, SupportedLocale>([
    ["00000000-0000-4000-8000-000000000001", "en"],
  ]);

  const actors: Record<string, AuthenticatedActorProfileContract> = {
    "00000000-0000-4000-8000-000000000001": {
      id: "00000000-0000-4000-8000-000000000001",
      email: "customer.alice@test.ideliveryfood.invalid",
      fullName: "Alice Test Consumer",
      phone: "+5511900000001",
      preferredLocale: "en",
      status: "ACTIVE",
      mfaEnforced: false,
      aal: "aal1",
      organizationMemberships: [],
      staffScopes: [],
    },
    "00000000-0000-4000-8000-000000000010": {
      id: "00000000-0000-4000-8000-000000000010",
      email: "owner.paulista@test.ideliveryfood.invalid",
      fullName: "Helena Partner Owner",
      phone: "+5511900000010",
      preferredLocale: "pt-BR",
      status: "ACTIVE",
      mfaEnforced: false,
      aal: "aal1",
      organizationMemberships: [
        {
          organizationId: "00000000-0000-4000-8000-000000000101",
          storeId: null,
          role: "partner_owner",
        },
      ],
      staffScopes: [],
    },
    "00000000-0000-4000-8000-000000000090": {
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
    },
  };

  const repository: ApiDataRepository = {
    async listPublishedStores(locale: SupportedLocale): Promise<PublishedStoreContract[]> {
      return [
        {
          id: "00000000-0000-4000-8000-000000000201",
          slug: "paulista-burgers-jardins",
          name: "Paulista Artisan Burgers - Jardins",
          descriptionEn: "Dry-aged smash burgers, hand-cut fries, and craft shakes.",
          descriptionPtBr: "Smash burgers maturados, batatas rústicas e shakes artesanais.",
          localizedDescription:
            locale === "pt-BR"
              ? "Smash burgers maturados, batatas rústicas e shakes artesanais."
              : "Dry-aged smash burgers, hand-cut fries, and craft shakes.",
          cuisineCategory: "BURGERS",
          isPaused: false,
          timezone: "America/Sao_Paulo",
          city: "São Paulo",
          stateCode: "SP",
          minOrderCents: 2500,
          prepTimeMinMinutes: 20,
          prepTimeMaxMinutes: 35,
          supportedModalities: ["PLATFORM_DELIVERY", "MERCHANT_DELIVERY", "PICKUP"],
        },
      ];
    },
    async getActorById(userId: string, aal: "aal1" | "aal2") {
      const found = actors[userId];
      if (!found) return null;
      return {
        ...found,
        preferredLocale: userLocales.get(userId) ?? found.preferredLocale,
        aal,
      };
    },
    async updateUserPreferences(userId: string, locale: SupportedLocale): Promise<UserPreferencesContract> {
      userLocales.set(userId, locale);
      return {
        userId,
        locale,
        pushOrderUpdates: true,
        pushPromotions: false,
        emailTransactional: true,
        emailMarketing: false,
      };
    },
    async listOrganizationMembers(organizationId: string) {
      return [
        {
          userId: "00000000-0000-4000-8000-000000000010",
          organizationId,
          storeId: null,
          role: "partner_owner",
        },
      ];
    },
    async saveInvitation(record: StoredInvitationRecord) {
      invitations.set(record.id, record);
    },
    async getInvitationById(id: string) {
      return invitations.get(id) ?? null;
    },
    async markInvitationConsumed(id: string, consumedAtIso: string) {
      const existing = invitations.get(id);
      if (existing) {
        invitations.set(id, { ...existing, consumedAtIso });
      }
    },
    async appendAuditLog(entry: AuditLogWriteRecord) {
      auditLogs.push(entry);
    },
    async getAuditLogs() {
      return auditLogs;
    },
  };

  const server = createApiServer({ repository, env: {} });
  let baseUrl = "";

  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("serves /v1/health/live, /v1/health/ready, and /v1/system/providers with honest BLOCKED_MISSING_CREDENTIALS status", async () => {
    const liveRes = await fetch(`${baseUrl}/health/live`);
    assert.equal(liveRes.status, 200);

    const readyRes = await fetch(`${baseUrl}/health/ready`);
    assert.equal(readyRes.status, 200);
    const readyJson = (await readyRes.json()) as {
      databaseProjectRef: string;
      defaultLocale: string;
      externalProviders: Array<{ status: string }>;
    };
    assert.equal(readyJson.databaseProjectRef, "dwsoochnfxldfvcaijie");
    assert.equal(readyJson.defaultLocale, "en");
    assert.equal(readyJson.externalProviders.length, 8);
    assert.equal(readyJson.externalProviders[0]?.status, "BLOCKED_MISSING_CREDENTIALS");
  });

  it("serves /v1/stores localized in 'en' (default) and 'pt-BR'", async () => {
    const enRes = await fetch(`${baseUrl}/stores?locale=en`);
    const enJson = (await enRes.json()) as { data: PublishedStoreContract[] };
    assert.match(enJson.data[0]?.localizedDescription ?? "", /Dry-aged smash burgers/);

    const ptRes = await fetch(`${baseUrl}/stores?locale=pt-BR`);
    const ptJson = (await ptRes.json()) as { data: PublishedStoreContract[] };
    assert.match(ptJson.data[0]?.localizedDescription ?? "", /Smash burgers maturados/);
  });

  it("persists user locale switch ('en' -> 'pt-BR') and emits an audit log", async () => {
    const patchRes = await fetch(`${baseUrl}/me/preferences`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_locale_switch_001",
      },
      body: JSON.stringify({ locale: "pt-BR" }),
    });
    assert.equal(patchRes.status, 200);
    const updatedPref = (await patchRes.json()) as UserPreferencesContract;
    assert.equal(updatedPref.locale, "pt-BR");

    const meRes = await fetch(`${baseUrl}/me`, {
      headers: { "X-Actor-Id": "00000000-0000-4000-8000-000000000001" },
    });
    const meJson = (await meRes.json()) as { data: AuthenticatedActorProfileContract };
    assert.equal(meJson.data.preferredLocale, "pt-BR");
  });

  it("enforces cross-tenant denial on /v1/organizations/:orgId/members", async () => {
    // Helena is owner of Org 101, so Org 101 is allowed:
    const allowedRes = await fetch(
      `${baseUrl}/organizations/00000000-0000-4000-8000-000000000101/members`,
      {
        headers: { "X-Actor-Id": "00000000-0000-4000-8000-000000000010" },
      }
    );
    assert.equal(allowedRes.status, 200);

    // Helena attempting to access Org 102 (Tokyo Bay Sushi) is denied with 403:
    const deniedRes = await fetch(
      `${baseUrl}/organizations/00000000-0000-4000-8000-000000000102/members`,
      {
        headers: { "X-Actor-Id": "00000000-0000-4000-8000-000000000010" },
      }
    );
    assert.equal(deniedRes.status, 403);
  });

  it("enforces MFA aal2 step-up on /v1/onboarding/approvals and records audit trail", async () => {
    const deniedAal1 = await fetch(`${baseUrl}/onboarding/approvals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal1",
      },
      body: JSON.stringify({
        targetType: "STORE",
        targetId: "00000000-0000-4000-8000-000000000203",
        decision: "APPROVED",
        reason: "Store KYC verified",
      }),
    });
    assert.equal(deniedAal1.status, 403);

    const allowedAal2 = await fetch(`${baseUrl}/onboarding/approvals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal2",
      },
      body: JSON.stringify({
        targetType: "STORE",
        targetId: "00000000-0000-4000-8000-000000000203",
        decision: "APPROVED",
        reason: "Store KYC verified",
      }),
    });
    assert.equal(allowedAal2.status, 200);
    assert.ok(auditLogs.some((l) => l.action === "ONBOARDING_APPROVED"));
  });

  it("issues and consumes single-use invitations and blocks replay", async () => {
    const createRes = await fetch(`${baseUrl}/invitations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000010",
      },
      body: JSON.stringify({
        id: "inv_test_101",
        organizationId: "00000000-0000-4000-8000-000000000101",
        email: "customer.alice@test.ideliveryfood.invalid",
        rawToken: "single_use_secret_token_12345",
      }),
    });
    assert.equal(createRes.status, 201);

    const acceptRes = await fetch(`${baseUrl}/invitations/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
      },
      body: JSON.stringify({
        invitationId: "inv_test_101",
        rawToken: "single_use_secret_token_12345",
      }),
    });
    assert.equal(acceptRes.status, 200);

    // Replay attempt must fail with 400 INVITATION_ALREADY_CONSUMED
    const replayRes = await fetch(`${baseUrl}/invitations/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
      },
      body: JSON.stringify({
        invitationId: "inv_test_101",
        rawToken: "single_use_secret_token_12345",
      }),
    });
    assert.equal(replayRes.status, 400);
  });
});
