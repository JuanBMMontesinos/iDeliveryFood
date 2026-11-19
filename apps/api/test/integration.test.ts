import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AdminOverviewResponseContract,
  AnalyticalKpiSummaryContract,
  ApiErrorEnvelope,
  AuthenticatedActorProfileContract,
  CommercialBackofficeOverviewContract,
  CustomerAddressContract,
  FinanceBackofficeOverviewContract,
  FleetsBackofficeOverviewContract,
  GovernanceBackofficeOverviewContract,
  LogisticsBackofficeOverviewContract,
  MarketingBackofficeOverviewContract,
  OrderEventRecordContract,
  OrderGroceryPickingDetailContract,
  OrderRecordContract,
  PublishedStoreContract,
  ServerQuoteRecordContract,
  ServiceAreaEligibilityContract,
  StoreCatalogResponseContract,
  StoreGroceryPickingOverviewContract,
  SupportBackofficeOverviewContract,
  SupportCaseDetailResponseContract,
  UserNotificationsResponseContract,
  UserPreferencesContract,
} from "@ideliveryfood/contracts";
import { computePspWebhookSignature } from "@ideliveryfood/domain";
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

interface ParsedOpenApiOperations {
  openapiVersion: string;
  serverUrl: string;
  operations: Array<{ path: string; method: string }>;
  errorRequiredFields: string[];
}

function parseOpenApiV1Spec(yamlContent: string): ParsedOpenApiOperations {
  const versionMatch = yamlContent.match(/^openapi:\s*(.+)$/m);
  const serverMatch = yamlContent.match(/^\s*-\s*url:\s*(.+)$/m);

  const operations: Array<{ path: string; method: string }> = [];
  const lines = yamlContent.split(/\r?\n/);
  let inPaths = false;
  let currentPath: string | null = null;

  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^[a-zA-Z_]+:\s*$/.test(line)) {
      break;
    }
    if (!inPaths) continue;

    const pathMatch = line.match(/^  (\/[^:\s]+):\s*$/);
    if (pathMatch?.[1]) {
      currentPath = pathMatch[1];
      continue;
    }

    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (currentPath && methodMatch?.[1]) {
      operations.push({
        path: currentPath,
        method: methodMatch[1].toUpperCase(),
      });
    }
  }

  return {
    openapiVersion: versionMatch?.[1]?.trim() ?? "",
    serverUrl: serverMatch?.[1]?.trim() ?? "",
    operations,
    errorRequiredFields: ["code", "message", "correlationId", "timestamp"],
  };
}

function assertApiErrorEnvelope(
  body: unknown,
  responseHeaders: Headers,
  expectedCode?: string
): asserts body is ApiErrorEnvelope {
  assert.ok(body && typeof body === "object", "Error body must be a JSON object");
  const envBody = body as Record<string, unknown>;
  assert.ok(
    envBody.error && typeof envBody.error === "object",
    "ApiErrorEnvelope must wrap payload in .error object"
  );
  const err = envBody.error as Record<string, unknown>;
  assert.equal(typeof err.code, "string");
  assert.ok((err.code as string).length > 0, "error.code must be non-empty");
  assert.equal(typeof err.message, "string");
  assert.ok((err.message as string).length > 0, "error.message must be non-empty");
  assert.equal(typeof err.correlationId, "string");
  assert.ok(
    !Number.isNaN(Date.parse(String(err.timestamp))),
    `error.timestamp must be valid ISO-8601, got ${String(err.timestamp)}`
  );

  const corrHeader = responseHeaders.get("x-correlation-id");
  assert.ok(corrHeader, "Response must include X-Correlation-Id header");
  assert.equal(err.correlationId, corrHeader);

  if (expectedCode) {
    assert.equal(err.code, expectedCode);
  }
}

describe("Fase W (M24 Parte 2) — Real Live Supabase Integration, 59-Table / 27-Invariant SQL RLS Gate & OpenAPI /v1 Contract Verification", () => {
  const TEST_JWT_SECRET = "fase_w_m24_live_supabase_integration_jwt_secret_32chars!!";
  const TEST_WEBHOOK_SECRET = "whsec_fase_w_test_webhook_secret_32chars!";

  // Seeded Canonical Actors (supabase/seed.sql)
  const ALICE_CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
  const BRUNO_CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
  const HELENA_OWNER_101_ID = "00000000-0000-4000-8000-000000000010";
  const LUCAS_OPERATOR_201_ID = "00000000-0000-4000-8000-000000000011";
  const CLARA_FINANCE_101_ID = "00000000-0000-4000-8000-000000000012";
  const KENJI_OWNER_102_ID = "00000000-0000-4000-8000-000000000020";
  const CARLOS_COURIER_ID = "00000000-0000-4000-8000-000000000030";
  const MARINA_OPS_STAFF_ID = "00000000-0000-4000-8000-000000000090";
  const ROBERTO_FINANCE_STAFF_ID = "00000000-0000-4000-8000-000000000091";
  const TECH_ADMIN_STAFF_ID = "00000000-0000-4000-8000-000000000099";

  // Seeded Canonical Tenants & Entities
  const ORG_101_ID = "00000000-0000-4000-8000-000000000101";
  const ORG_102_ID = "00000000-0000-4000-8000-000000000102";
  const STORE_201_ID = "00000000-0000-4000-8000-000000000201";
  const STORE_202_ID = "00000000-0000-4000-8000-000000000202";
  const STORE_203_DRAFT_ID = "00000000-0000-4000-8000-000000000203";
  const PRODUCT_601_ID = "00000000-0000-4000-8000-000000000601";
  const SEEDED_ORDER_1001_ID = "00000000-0000-4000-8000-000000001001";
  const SEEDED_CASE_1501_ID = "00000000-0000-4000-8000-000000001501";

  let repo: SupabasePostgresRepositoryInstance;
  let server: http.Server;
  let baseUrl = "";
  const createdAddressIds: string[] = [];
  const createdQuoteIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdWebhookExternalIds: string[] = [];

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

  const aliceToken = issueJwt(ALICE_CUSTOMER_ID, "customer.alice@test.ideliveryfood.invalid");
  const brunoToken = issueJwt(BRUNO_CUSTOMER_ID, "customer.bruno@test.ideliveryfood.invalid");
  const helenaTokenAal1 = issueJwt(HELENA_OWNER_101_ID, "owner.paulista@test.ideliveryfood.invalid");
  const lucasTokenAal1 = issueJwt(LUCAS_OPERATOR_201_ID, "operator.paulista@test.ideliveryfood.invalid");
  const claraTokenAal1 = issueJwt(CLARA_FINANCE_101_ID, "finance.paulista@test.ideliveryfood.invalid");
  const kenjiTokenAal1 = issueJwt(KENJI_OWNER_102_ID, "owner.tokyobay@test.ideliveryfood.invalid");
  const carlosTokenAal1 = issueJwt(CARLOS_COURIER_ID, "courier.carlos@test.ideliveryfood.invalid");
  const marinaTokenAal1 = issueJwt(MARINA_OPS_STAFF_ID, "staff.ops@test.ideliveryfood.invalid", "aal1");
  const marinaTokenAal2 = issueJwt(MARINA_OPS_STAFF_ID, "staff.ops@test.ideliveryfood.invalid", "aal2");
  const robertoTokenAal1 = issueJwt(
    ROBERTO_FINANCE_STAFF_ID,
    "staff.finance@test.ideliveryfood.invalid",
    "aal1"
  );
  const robertoTokenAal2 = issueJwt(
    ROBERTO_FINANCE_STAFF_ID,
    "staff.finance@test.ideliveryfood.invalid",
    "aal2"
  );
  const techAdminTokenAal1 = issueJwt(
    TECH_ADMIN_STAFF_ID,
    "staff.admin@test.ideliveryfood.invalid",
    "aal1"
  );
  const techAdminTokenAal2 = issueJwt(
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
        CORS_ALLOWED_ORIGINS:
          "https://app.ideliveryfood.com.br,https://partner.ideliveryfood.com.br,https://admin.ideliveryfood.com.br",
        RATE_LIMIT_WINDOW_MS: "60000",
        RATE_LIMIT_EXPORT_MAX: "50",
        RATE_LIMIT_OTP_MAX: "50",
      },
      allowTestActorHeaders: false,
    });

    await repo.pool.query(
      `DELETE FROM public.customer_addresses
       WHERE user_id = $1 AND label = 'Fase W Escritório'`,
      [ALICE_CUSTOMER_ID]
    );

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    try {
      for (const addrId of createdAddressIds) {
        await repo.pool
          .query(`DELETE FROM public.customer_addresses WHERE id = $1`, [addrId])
          .catch(() => undefined);
      }

      if (createdOrderIds.length > 0) {
        await repo.pool.query(
          `ALTER TABLE public.ledger_entries DISABLE TRIGGER trg_ledger_entries_immutable`
        );
        await repo.pool.query(
          `ALTER TABLE public.order_events DISABLE TRIGGER trg_order_events_immutable`
        );
        try {
          const jnlRes = await repo.pool.query(
            `SELECT id FROM public.ledger_journals WHERE reference_id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
          const jnlIds = jnlRes.rows.map((r) => String(r.id));
          if (jnlIds.length > 0) {
            await repo.pool.query(
              `DELETE FROM public.ledger_entries WHERE journal_id = ANY($1::uuid[])`,
              [jnlIds]
            );
            await repo.pool.query(
              `DELETE FROM public.ledger_journals WHERE id = ANY($1::uuid[])`,
              [jnlIds]
            );
          }
          if (createdWebhookExternalIds.length > 0) {
            await repo.pool.query(
              `DELETE FROM public.payment_provider_events WHERE external_event_id = ANY($1::text[])`,
              [createdWebhookExternalIds]
            );
          }
          await repo.pool.query(
            `DELETE FROM public.order_events WHERE order_id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
          await repo.pool.query(
            `DELETE FROM public.orders WHERE id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
        } finally {
          await repo.pool.query(
            `ALTER TABLE public.order_events ENABLE TRIGGER trg_order_events_immutable`
          );
          await repo.pool.query(
            `ALTER TABLE public.ledger_entries ENABLE TRIGGER trg_ledger_entries_immutable`
          );
        }
      }

      if (createdQuoteIds.length > 0) {
        await repo.pool.query(
          `DELETE FROM public.quotes WHERE id = ANY($1::uuid[])`,
          [createdQuoteIds]
        );
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await repo.close();
    }
  });

  it("1. proves OpenAPI 3.1 contract alignment between openapi/v1.yaml, API route implementation & ApiErrorEnvelope headers", async () => {
    const specPath = path.resolve(REPO_ROOT, "packages/contracts/openapi/v1.yaml");
    assert.equal(fs.existsSync(specPath), true, "packages/contracts/openapi/v1.yaml must exist");
    const specContent = fs.readFileSync(specPath, "utf8");
    const parsed = parseOpenApiV1Spec(specContent);

    assert.equal(parsed.openapiVersion, "3.1.0");
    assert.ok(parsed.serverUrl.endsWith("/v1"));
    assert.ok(
      parsed.operations.length >= 45,
      `Expected >= 45 OpenAPI /v1 operations, parsed ${parsed.operations.length}`
    );

    const serverSource = fs.readFileSync(path.resolve(REPO_ROOT, "apps/api/src/index.ts"), "utf8");
    for (const op of parsed.operations) {
      // Every OpenAPI /v1 route base segment must be handled in apps/api/src/index.ts
      const staticPrefix = `/v1${op.path.replace(/\/\{[^}]+\}/g, "/")}`;
      const normalizedSegment = staticPrefix.split("/").filter(Boolean)[1] ?? "";
      assert.ok(
        serverSource.includes(`/v1/${normalizedSegment}`),
        `OpenAPI operation ${op.method} ${op.path} route group '/v1/${normalizedSegment}' must exist in apps/api/src/index.ts`
      );
    }

    // Verify health & readiness endpoints + security headers + correlation ID
    const liveRes = await fetch(`${baseUrl}/v1/health/live`);
    assert.equal(liveRes.status, 200);
    assert.equal(liveRes.headers.get("x-content-type-options"), "nosniff");
    assert.equal(liveRes.headers.get("x-frame-options"), "DENY");
    assert.ok(liveRes.headers.get("x-correlation-id"));
    const liveJson = (await liveRes.json()) as Record<string, unknown>;
    assert.equal(liveJson.status, "ALIVE");
    assert.equal(liveJson.version, "v1");

    const readyRes = await fetch(`${baseUrl}/v1/health/ready`);
    assert.equal(readyRes.status, 200);
    const readyJson = (await readyRes.json()) as Record<string, unknown>;
    assert.equal(readyJson.status, "READY");
    assert.equal(readyJson.databaseProjectRef, "dwsoochnfxldfvcaijie");
    assert.equal(readyJson.operationalTimezone, "America/Sao_Paulo");
    assert.equal(readyJson.currencyCode, "BRL");
    assert.equal(readyJson.defaultLocale, "en");
    assert.ok(Array.isArray(readyJson.externalProviders));

    const providersRes = await fetch(`${baseUrl}/v1/system/providers`);
    assert.equal(providersRes.status, 200);
    const providersJson = (await providersRes.json()) as { data: Array<{ providerCode: string }> };
    assert.ok(providersJson.data.length >= 1);

    // Verify 401 and 404 strictly adhere to components.schemas.ApiErrorEnvelope
    const unauthRes = await fetch(`${baseUrl}/v1/me`);
    assert.equal(unauthRes.status, 401);
    assertApiErrorEnvelope(await unauthRes.json(), unauthRes.headers, "AUTH_UNAUTHORIZED");

    const missingStoreRes = await fetch(`${baseUrl}/v1/stores/${STORE_203_DRAFT_ID}/catalog`);
    assert.equal(missingStoreRes.status, 404);
    assertApiErrorEnvelope(await missingStoreRes.json(), missingStoreRes.headers, "STORE_NOT_FOUND");
  });

  it("2. verifies public store discovery, catalog localization (en/pt-BR), integer BRL cents & draft exclusion against Supabase", async () => {
    const storesRes = await fetch(`${baseUrl}/v1/stores?locale=pt-BR`);
    assert.equal(storesRes.status, 200);
    const storesJson = (await storesRes.json()) as {
      data: PublishedStoreContract[];
      meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
    };
    assert.equal(storesJson.meta.page, 1);
    assert.ok(storesJson.data.length >= 2);
    assert.equal(
      storesJson.data.some((s) => s.id === STORE_203_DRAFT_ID),
      false,
      "Unpublished draft store 203 must NEVER appear in public /v1/stores"
    );

    const store201Res = await fetch(`${baseUrl}/v1/stores/${STORE_201_ID}?locale=pt-BR`);
    assert.equal(store201Res.status, 200);

    const catalogRes = await fetch(`${baseUrl}/v1/stores/${STORE_201_ID}/catalog?locale=pt-BR`);
    assert.equal(catalogRes.status, 200);
    const catalogJson = (await catalogRes.json()) as { data: StoreCatalogResponseContract };
    assert.equal(catalogJson.data.store.id, STORE_201_ID);
    assert.ok(catalogJson.data.categories.length >= 1);
    const firstProd = catalogJson.data.categories[0]?.products[0];
    assert.ok(firstProd, "Store 201 must expose published catalog products");
    assert.equal(Number.isInteger(firstProd.priceCents), true);

    const availRes = await fetch(
      `${baseUrl}/v1/stores/${STORE_201_ID}/availability?lat=-23.56398&lng=-46.66912`
    );
    assert.equal(availRes.status, 200);
    const availJson = (await availRes.json()) as {
      data: {
        availability: { storeId: string; isOpen: boolean };
        coverage: ServiceAreaEligibilityContract | null;
      };
    };
    assert.ok(availJson.data.coverage, "Coverage object must be returned when coordinates are passed");
    assert.equal(availJson.data.coverage.eligible, true);
    assert.equal(typeof availJson.data.coverage.distanceMeters, "number");
  });

  it("3. verifies /v1/me profile, persistent addresses round-trip, i18n preferences round-trip & scoped notifications", async () => {
    const meRes = await fetch(`${baseUrl}/v1/me`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(meRes.status, 200);
    const meJson = (await meRes.json()) as { data: AuthenticatedActorProfileContract };
    assert.equal(meJson.data.id, ALICE_CUSTOMER_ID);

    const tempAddrId = crypto.randomUUID();
    try {
      const createAddrRes = await fetch(`${baseUrl}/v1/me/addresses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: tempAddrId,
          label: "Fase W Escritório",
          streetLine: "Av. Brigadeiro Faria Lima",
          number: "2000",
          neighborhood: "Pinheiros",
          city: "São Paulo",
          stateCode: "SP",
          postalCode: "01451-000",
          latitude: -23.5701,
          longitude: -46.6902,
          isDefault: false,
        }),
      });
      assert.equal(createAddrRes.status, 201);
      createdAddressIds.push(tempAddrId);

      const listAddrRes = await fetch(`${baseUrl}/v1/me/addresses`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      assert.equal(listAddrRes.status, 200);
      const addrJson = (await listAddrRes.json()) as { data: CustomerAddressContract[] };
      assert.equal(
        addrJson.data.some((a) => a.id === tempAddrId),
        true,
        "Persisted address must appear in live Supabase GET /v1/me/addresses"
      );
    } finally {
      await repo.pool
        .query(`DELETE FROM public.customer_addresses WHERE id = $1`, [tempAddrId])
        .catch(() => undefined);
    }

    // Preferences round-trip pt-BR -> en
    const prefPtRes = await fetch(`${baseUrl}/v1/me/preferences`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `pref_pt_${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ locale: "pt-BR" }),
    });
    assert.equal(prefPtRes.status, 200);
    const prefPtJson = (await prefPtRes.json()) as UserPreferencesContract;
    assert.equal(prefPtJson.locale, "pt-BR");

    const prefEnRes = await fetch(`${baseUrl}/v1/me/preferences`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `pref_en_${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ locale: "en" }),
    });
    assert.equal(prefEnRes.status, 200);
    const prefEnJson = (await prefEnRes.json()) as UserPreferencesContract;
    assert.equal(prefEnJson.locale, "en");

    // Devices & Notifications isolation
    const devicesRes = await fetch(`${baseUrl}/v1/me/devices`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(devicesRes.status, 200);

    const notifRes = await fetch(`${baseUrl}/v1/me/notifications`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(notifRes.status, 200);
    const notifJson = (await notifRes.json()) as { data: UserNotificationsResponseContract };
    assert.equal(notifJson.data.userId, ALICE_CUSTOMER_ID);
    assert.ok(notifJson.data.notifications.length >= 1);
    assert.equal(
      notifJson.data.notifications.every((n) => n.recipientUserId === ALICE_CUSTOMER_ID),
      true
    );
  });

  it("4. verifies quote -> idempotent order creation -> optimistic concurrency & cross-tenant IDOR protection against live Supabase", async () => {
    const tag = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const quoteIdem = `quote_w_${tag}`;
    const orderIdem = `order_w_${tag}`;

    const quoteRes = await fetch(`${baseUrl}/v1/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": quoteIdem,
      },
      body: JSON.stringify({
        storeId: STORE_201_ID,
        fulfillmentModality: "PLATFORM_DELIVERY",
        cartItems: [{ productId: PRODUCT_601_ID, quantity: 1, selectedOptions: [] }],
        deliveryFeeCents: 690,
      }),
    });
    assert.equal(quoteRes.status, 201);
    const quoteJson = (await quoteRes.json()) as { data: ServerQuoteRecordContract };
    createdQuoteIds.push(quoteJson.data.id);
    assert.equal(Number.isInteger(quoteJson.data.totalCents), true);

    // Replay same X-Idempotency-Key returns same quote (200)
    const quoteReplayRes = await fetch(`${baseUrl}/v1/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": quoteIdem,
      },
      body: JSON.stringify({
        storeId: STORE_201_ID,
        fulfillmentModality: "PLATFORM_DELIVERY",
        cartItems: [{ productId: PRODUCT_601_ID, quantity: 1, selectedOptions: [] }],
        deliveryFeeCents: 690,
      }),
    });
    assert.equal(quoteReplayRes.status, 200);
    const quoteReplayJson = (await quoteReplayRes.json()) as { data: ServerQuoteRecordContract };
    assert.equal(quoteReplayJson.data.id, quoteJson.data.id);

    // Convert quote into order
    const orderRes = await fetch(`${baseUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": orderIdem,
      },
      body: JSON.stringify({
        quoteId: quoteJson.data.id,
        customerNotes: "Fase W live API contract verification order",
      }),
    });
    assert.equal(orderRes.status, 201);
    const orderJson = (await orderRes.json()) as { data: OrderRecordContract };
    createdOrderIds.push(orderJson.data.id);
    assert.equal(orderJson.data.customerId, ALICE_CUSTOMER_ID);

    // Replay same X-Idempotency-Key returns identical order (200)
    const orderReplayRes = await fetch(`${baseUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": orderIdem,
      },
      body: JSON.stringify({
        quoteId: quoteJson.data.id,
      }),
    });
    assert.equal(orderReplayRes.status, 200);
    const orderReplayJson = (await orderReplayRes.json()) as { data: OrderRecordContract };
    assert.equal(orderReplayJson.data.id, orderJson.data.id);

    // Cross-customer Bruno & cross-tenant Partner Kenji (Org 102) MUST get 403 ORDER_FORBIDDEN on Alice/Org 101 order
    const brunoGetRes = await fetch(`${baseUrl}/v1/orders/${orderJson.data.id}`, {
      headers: { Authorization: `Bearer ${brunoToken}` },
    });
    assert.equal(brunoGetRes.status, 403);
    assertApiErrorEnvelope(await brunoGetRes.json(), brunoGetRes.headers, "ORDER_FORBIDDEN");

    const kenjiGetRes = await fetch(`${baseUrl}/v1/orders/${orderJson.data.id}`, {
      headers: { Authorization: `Bearer ${kenjiTokenAal1}` },
    });
    assert.equal(kenjiGetRes.status, 403);
    assertApiErrorEnvelope(await kenjiGetRes.json(), kenjiGetRes.headers, "ORDER_FORBIDDEN");

    const kenjiCmdRes = await fetch(`${baseUrl}/v1/orders/${orderJson.data.id}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kenjiTokenAal1}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `cmd_kenji_idor_${tag}`,
      },
      body: JSON.stringify({ command: "ACCEPT", expectedVersion: orderJson.data.version }),
    });
    assert.equal(kenjiCmdRes.status, 403);
    assertApiErrorEnvelope(await kenjiCmdRes.json(), kenjiCmdRes.headers, "ORDER_FORBIDDEN");

    // Optimistic concurrency conflict (409) when expectedVersion is stale
    const staleCmdRes = await fetch(`${baseUrl}/v1/orders/${orderJson.data.id}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lucasTokenAal1}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `cmd_stale_${tag}`,
      },
      body: JSON.stringify({
        command: "ACCEPT",
        expectedVersion: orderJson.data.version + 99,
      }),
    });
    assert.equal(staleCmdRes.status, 409);
    assertApiErrorEnvelope(await staleCmdRes.json(), staleCmdRes.headers);

    // Invalid HMAC signature MUST be rejected (401) before modifying order
    const hookExternalId = `evt_captured_${tag}`;
    createdWebhookExternalIds.push(hookExternalId);
    const rawHookBody = JSON.stringify({
      orderId: orderJson.data.id,
      externalEventId: hookExternalId,
      eventType: "payment.captured",
      amountCents: orderJson.data.totalCents,
      currencyCode: "BRL",
    });
    const tsSec = Math.floor(Date.now() / 1000);
    const badWebhookRes = await fetch(`${baseUrl}/v1/webhooks/psp/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-psp-signature": "invalid_signature",
        "x-psp-timestamp": String(tsSec),
      },
      body: rawHookBody,
    });
    assert.equal(badWebhookRes.status, 401);
    assertApiErrorEnvelope(await badWebhookRes.json(), badWebhookRes.headers);

    // Valid HMAC-signed PSP payment.captured webhook advances version to 2 and status to PENDING_MERCHANT_ACCEPTANCE
    const validSig = computePspWebhookSignature({
      webhookSecret: TEST_WEBHOOK_SECRET,
      timestampSeconds: tsSec,
      rawPayload: rawHookBody,
    });
    const hookRes = await fetch(`${baseUrl}/v1/webhooks/psp/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-psp-signature": validSig,
        "x-psp-timestamp": String(tsSec),
      },
      body: rawHookBody,
    });
    assert.equal(hookRes.status, 200);
    const hookJson = (await hookRes.json()) as {
      data: { deduplicated: boolean; orderStatus: string; paymentStatus: string; version: number };
    };
    assert.equal(hookJson.data.deduplicated, false);
    assert.equal(hookJson.data.paymentStatus, "CAPTURED");
    assert.equal(hookJson.data.version, 2);

    // Replay same webhook externalEventId is idempotently deduplicated
    const hookReplayRes = await fetch(`${baseUrl}/v1/webhooks/psp/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-psp-signature": validSig,
        "x-psp-timestamp": String(tsSec),
      },
      body: rawHookBody,
    });
    assert.equal(hookReplayRes.status, 200);
    const hookReplayJson = (await hookReplayRes.json()) as {
      data: { deduplicated: boolean };
    };
    assert.equal(hookReplayJson.data.deduplicated, true);

    // Authorized Store 201 Partner Lucas accepts order at expectedVersion = 2, then cancels cleanly
    const acceptRes = await fetch(`${baseUrl}/v1/orders/${orderJson.data.id}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lucasTokenAal1}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `cmd_accept_${tag}`,
      },
      body: JSON.stringify({
        command: "ACCEPT",
        expectedVersion: hookJson.data.version,
      }),
    });
    assert.equal(acceptRes.status, 200);
    const acceptJson = (await acceptRes.json()) as {
      data: { order: OrderRecordContract; event: OrderEventRecordContract };
    };
    assert.equal(acceptJson.data.order.orderStatus, "ACCEPTED");
    assert.equal(acceptJson.data.order.version, 3);

    const eventsRes = await fetch(`${baseUrl}/v1/orders/${orderJson.data.id}/events`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(eventsRes.status, 200);
    const eventsJson = (await eventsRes.json()) as { data: OrderEventRecordContract[] };
    assert.ok(eventsJson.data.length >= 3);

    // Transition via START_PREPARING to verify sequential optimistic concurrency (version 3 -> 4)
    const prepRes = await fetch(`${baseUrl}/v1/orders/${orderJson.data.id}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lucasTokenAal1}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `cmd_prep_${tag}`,
      },
      body: JSON.stringify({
        command: "START_PREPARING",
        expectedVersion: acceptJson.data.order.version,
      }),
    });
    assert.equal(prepRes.status, 200);
    const prepJson = (await prepRes.json()) as {
      data: { order: OrderRecordContract };
    };
    assert.equal(prepJson.data.order.orderStatus, "PREPARING");
    assert.equal(prepJson.data.order.version, 4);

    // PSP missing credentials (503)
    const payRes = await fetch(`${baseUrl}/v1/payments/attempts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `pay_attempt_${tag}`,
      },
      body: JSON.stringify({
        orderId: orderJson.data.id,
        providerCode: "stripe",
        paymentMethod: "PIX",
      }),
    });
    assert.equal(payRes.status, 503);
    assertApiErrorEnvelope(
      await payRes.json(),
      payRes.headers,
      "PSP_PROVIDER_BLOCKED_MISSING_CREDENTIALS"
    );
  });

  it("5. verifies multi-tenant Partner, Admin MFA aal2, Backoffices (Finance/Logistics/Fleets/Support/Commercial/Marketing/Governance/Picking) & Storage/SSRF contracts", async () => {
    // Organization members & partner routes: allowed on Org 101 / Store 201, denied on Org 102 / Store 202
    const orgMembersOk = await fetch(`${baseUrl}/v1/organizations/${ORG_101_ID}/members`, {
      headers: { Authorization: `Bearer ${helenaTokenAal1}` },
    });
    assert.equal(orgMembersOk.status, 200);

    const orgMembersDenied = await fetch(`${baseUrl}/v1/organizations/${ORG_101_ID}/members`, {
      headers: { Authorization: `Bearer ${kenjiTokenAal1}` },
    });
    assert.equal(orgMembersDenied.status, 403);
    assertApiErrorEnvelope(await orgMembersDenied.json(), orgMembersDenied.headers);

    const unitsRes = await fetch(`${baseUrl}/v1/organizations/${ORG_101_ID}/units-summary`, {
      headers: { Authorization: `Bearer ${helenaTokenAal1}` },
    });
    assert.equal(unitsRes.status, 200);

    const queueOk = await fetch(`${baseUrl}/v1/stores/${STORE_201_ID}/orders-queue`, {
      headers: { Authorization: `Bearer ${lucasTokenAal1}` },
    });
    assert.equal(queueOk.status, 200);

    const queueDenied = await fetch(`${baseUrl}/v1/stores/${STORE_201_ID}/orders-queue`, {
      headers: { Authorization: `Bearer ${kenjiTokenAal1}` },
    });
    assert.equal(queueDenied.status, 403);

    // Partner Operator denied financial summary; Partner Finance Clara allowed
    const lucasFinDenied = await fetch(
      `${baseUrl}/v1/partner/organizations/${ORG_101_ID}/finance-summary`,
      { headers: { Authorization: `Bearer ${lucasTokenAal1}` } }
    );
    assert.equal(lucasFinDenied.status, 403);

    const claraFinOk = await fetch(
      `${baseUrl}/v1/partner/organizations/${ORG_101_ID}/finance-summary`,
      { headers: { Authorization: `Bearer ${claraTokenAal1}` } }
    );
    assert.equal(claraFinOk.status, 200);
    const claraFinJson = (await claraFinOk.json()) as { data: FinanceBackofficeOverviewContract };
    assert.ok(claraFinJson.data);

    const commissionRulesRes = await fetch(
      `${baseUrl}/v1/partner/organizations/${ORG_101_ID}/commission-rules`,
      { headers: { Authorization: `Bearer ${helenaTokenAal1}` } }
    );
    assert.equal(commissionRulesRes.status, 200);

    // Internal Admin/Finance/Logistics/Fleets require aal2
    const adminAal1 = await fetch(`${baseUrl}/v1/admin/overview`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal1}` },
    });
    assert.equal(adminAal1.status, 403);
    assertApiErrorEnvelope(
      await adminAal1.json(),
      adminAal1.headers,
      "DENIED_MFA_STEP_UP_REQUIRED"
    );

    const adminAal2 = await fetch(`${baseUrl}/v1/admin/overview`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(adminAal2.status, 200);
    const adminJson = (await adminAal2.json()) as { data: AdminOverviewResponseContract };
    assert.ok(adminJson.data);

    const auditAal2 = await fetch(`${baseUrl}/v1/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(auditAal2.status, 200);

    const finAal1 = await fetch(`${baseUrl}/v1/finance/overview`, {
      headers: { Authorization: `Bearer ${robertoTokenAal1}` },
    });
    assert.equal(finAal1.status, 403);

    const finAal2 = await fetch(`${baseUrl}/v1/finance/overview`, {
      headers: { Authorization: `Bearer ${robertoTokenAal2}` },
    });
    assert.equal(finAal2.status, 200);

    const logAal2 = await fetch(`${baseUrl}/v1/logistics/overview`, {
      headers: { Authorization: `Bearer ${marinaTokenAal2}` },
    });
    assert.equal(logAal2.status, 200);
    const logJson = (await logAal2.json()) as { data: LogisticsBackofficeOverviewContract };
    assert.ok(logJson.data);

    const fleetsRes = await fetch(`${baseUrl}/v1/fleets/overview`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(fleetsRes.status, 200);
    const fleetsJson = (await fleetsRes.json()) as { data: FleetsBackofficeOverviewContract };
    assert.equal(fleetsJson.data.featureFleetOperatorsEnabled, false);

    // Support Case 1501: internal notes & attachments stripped for Customer Alice, visible to Staff Marina (aal2), 403 for Bruno
    const caseAliceRes = await fetch(`${baseUrl}/v1/support/cases/${SEEDED_CASE_1501_ID}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(caseAliceRes.status, 200);
    const caseAliceJson = (await caseAliceRes.json()) as { data: SupportCaseDetailResponseContract };
    assert.equal(
      caseAliceJson.data.messages.some((m) => m.isInternalNote),
      false,
      "Customer Alice must NEVER receive internal support notes"
    );

    const caseStaffRes = await fetch(`${baseUrl}/v1/support/cases/${SEEDED_CASE_1501_ID}`, {
      headers: { Authorization: `Bearer ${marinaTokenAal2}` },
    });
    assert.equal(caseStaffRes.status, 200);
    const caseStaffJson = (await caseStaffRes.json()) as { data: SupportCaseDetailResponseContract };
    assert.equal(
      caseStaffJson.data.messages.some((m) => m.isInternalNote),
      true,
      "Staff Marina must receive internal support notes"
    );

    const caseBrunoRes = await fetch(`${baseUrl}/v1/support/cases/${SEEDED_CASE_1501_ID}`, {
      headers: { Authorization: `Bearer ${brunoToken}` },
    });
    assert.equal(caseBrunoRes.status, 403);

    const supportOverviewRes = await fetch(`${baseUrl}/v1/support/overview`, {
      headers: { Authorization: `Bearer ${marinaTokenAal2}` },
    });
    assert.equal(supportOverviewRes.status, 200);
    const supportOverviewJson = (await supportOverviewRes.json()) as {
      data: SupportBackofficeOverviewContract;
    };
    assert.ok(supportOverviewJson.data);

    // Commercial, Marketing, Analytics & Governance backoffice routes
    const commercialRes = await fetch(`${baseUrl}/v1/commercial/overview`, {
      headers: { Authorization: `Bearer ${marinaTokenAal2}` },
    });
    assert.equal(commercialRes.status, 200);
    const commercialJson = (await commercialRes.json()) as {
      data: CommercialBackofficeOverviewContract;
    };
    assert.ok(commercialJson.data.leads.length >= 1);

    const marketingRes = await fetch(`${baseUrl}/v1/marketing/overview`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(marketingRes.status, 200);
    const marketingJson = (await marketingRes.json()) as {
      data: MarketingBackofficeOverviewContract;
    };
    assert.ok(marketingJson.data.promotions.length >= 2);

    const analyticsRes = await fetch(`${baseUrl}/v1/analytics/overview`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(analyticsRes.status, 200);
    const analyticsJson = (await analyticsRes.json()) as { data: AnalyticalKpiSummaryContract };
    assert.equal(Number.isInteger(analyticsJson.data.gmvCents), true);

    const govRes = await fetch(`${baseUrl}/v1/governance/overview`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(govRes.status, 200);
    const govJson = (await govRes.json()) as { data: GovernanceBackofficeOverviewContract };
    assert.ok(govJson.data.riskAlerts.length >= 2);
    assert.ok(govJson.data.privacyRequests.length >= 1);

    // M22 Grocery Picking Store & Order Endpoints
    const storePickingRes = await fetch(`${baseUrl}/v1/partner/stores/${STORE_201_ID}/picking`, {
      headers: { Authorization: `Bearer ${lucasTokenAal1}` },
    });
    assert.equal(storePickingRes.status, 200);
    const storePickingJson = (await storePickingRes.json()) as {
      data: StoreGroceryPickingOverviewContract;
    };
    assert.ok(storePickingJson.data.pickTasks.length >= 1);

    const orderPickingRes = await fetch(`${baseUrl}/v1/orders/${SEEDED_ORDER_1001_ID}/picking`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(orderPickingRes.status, 200);
    const orderPickingJson = (await orderPickingRes.json()) as {
      data: OrderGroceryPickingDetailContract;
    };
    assert.ok(orderPickingJson.data.pickTask);

    // Storage signed upload security checks & SSRF guard
    const storageExeRes = await fetch(`${baseUrl}/v1/storage/signed-upload-url`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${helenaTokenAal1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bucket: "public-store-assets",
        storeId: STORE_201_ID,
        fileName: "malware.exe",
        mimeType: "application/x-msdownload",
        fileSizeBytes: 2048,
      }),
    });
    assert.equal(storageExeRes.status, 400);
    assertApiErrorEnvelope(await storageExeRes.json(), storageExeRes.headers);

    const storageCrossTenantRes = await fetch(`${baseUrl}/v1/storage/signed-upload-url`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kenjiTokenAal1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bucket: "public-store-assets",
        storeId: STORE_201_ID,
        fileName: "banner.png",
        mimeType: "image/png",
        fileSizeBytes: 2048,
      }),
    });
    assert.equal(storageCrossTenantRes.status, 403);

    const ssrfDeniedRes = await fetch(`${baseUrl}/v1/security/webhooks/validate-target`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${techAdminTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetUrl: "http://169.254.169.254/latest/meta-data/",
      }),
    });
    assert.equal(ssrfDeniedRes.status, 400);

    // Courier Carlos denied customer/partner/admin endpoints
    const carlosFinDenied = await fetch(`${baseUrl}/v1/finance/overview`, {
      headers: { Authorization: `Bearer ${carlosTokenAal1}` },
    });
    assert.equal(carlosFinDenied.status, 403);
    assert.equal(marinaTokenAal1.length > 0, true);
  });

  it("6. executes all 27 SQL RLS & constraint invariants (rls_and_constraints_test.sql) and proves 59/59 Supabase tables have RLS enabled & >= 1 row", async () => {
    const tablesRes = await repo.pool.query(
      `SELECT tablename, rowsecurity
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`
    );
    assert.ok(
      (tablesRes.rowCount ?? 0) >= 59,
      `Expected >= 59 public tables in Supabase, found ${tablesRes.rowCount}`
    );

    const unprotected = tablesRes.rows
      .filter((r) => r.rowsecurity !== true)
      .map((r) => String(r.tablename));
    assert.deepEqual(
      unprotected,
      [],
      `Every public table must have RLS enabled; found unprotected: ${unprotected.join(", ")}`
    );

    const emptyTables: string[] = [];
    for (const row of tablesRes.rows) {
      const tableName = String(row.tablename);
      const countRes = await repo.pool.query(
        `SELECT count(*)::int AS cnt FROM public.${tableName}`
      );
      if (Number(countRes.rows[0]?.cnt ?? 0) < 1) {
        emptyTables.push(tableName);
      }
    }
    assert.deepEqual(
      emptyTables,
      [],
      `Zero empty tables allowed in Supabase; empty tables found: ${emptyTables.join(", ")}`
    );

    // Execute supabase/tests/rls_and_constraints_test.sql cleanly inside a rolled-back transaction
    const rlsSqlPath = path.resolve(REPO_ROOT, "supabase/tests/rls_and_constraints_test.sql");
    assert.equal(fs.existsSync(rlsSqlPath), true, "rls_and_constraints_test.sql must exist");
    const rlsSql = fs.readFileSync(rlsSqlPath, "utf8");

    const client = await repo.pool.connect();
    try {
      await client.query("BEGIN");
      const queryResult = (await client.query(rlsSql)) as unknown;
      const resultList = Array.isArray(queryResult) ? queryResult : [queryResult];
      const finalResult = resultList[resultList.length - 1] as {
        rows?: Array<{ verification_status?: string }>;
      };
      assert.equal(
        finalResult?.rows?.[0]?.verification_status,
        "ALL_27_SECURITY_RLS_STORAGE_AND_M00_TO_M22_INVARIANTS_PASSED"
      );
      await client.query("ROLLBACK");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
});
