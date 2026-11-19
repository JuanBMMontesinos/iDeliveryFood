import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AnalyticalKpiSummaryContract,
  OrderGroceryPickingDetailContract,
  OrderItemSubstitutionContract,
  OrderPickTaskContract,
  OrderPickingItemContract,
  StoreGroceryPickingOverviewContract,
} from "@ideliveryfood/contracts";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
} from "../src/index.js";

function loadRootEnv(): void {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(__dirname, "../../../../.env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

describe("Fase S (M22) — Live Supabase Grocery Picking Policy Gate, Scale Pricing (HALF_UP Cents), Customer-Consented Substitutions & Reconciled Financial Adjustments", () => {
  const jwtSecret = "fase-s-m22-grocery-picking-jwt-secret-key-32-chars!!";
  const ALICE_ID = "00000000-0000-4000-8000-000000000001";
  const BRUNO_ID = "00000000-0000-4000-8000-000000000002";
  const HELENA_OWNER_101_ID = "00000000-0000-4000-8000-000000000010";
  const LUCAS_OPERATOR_201_ID = "00000000-0000-4000-8000-000000000011";
  const KENJI_OWNER_102_ID = "00000000-0000-4000-8000-000000000020";
  const TECH_ADMIN_ID = "00000000-0000-4000-8000-000000000099";

  const ORG_101_ID = "00000000-0000-4000-8000-000000000101";
  const STORE_201_ID = "00000000-0000-4000-8000-000000000201";
  const PRODUCT_601_ID = "00000000-0000-4000-8000-000000000601";
  const PRODUCT_602_ID = "00000000-0000-4000-8000-000000000602";

  let repo: ReturnType<typeof createSupabasePostgresRepository>;
  let server: http.Server;
  let baseUrl = "";

  let aliceToken = "";
  let brunoToken = "";
  let helenaToken = "";
  let lucasToken = "";
  let kenjiToken = "";
  let techAdminTokenAal2 = "";

  const createdOrderIds: string[] = [];
  const createdQuoteIds: string[] = [];
  const createdPickTaskIds: string[] = [];
  const createdJournalIds: string[] = [];

  before(async () => {
    loadRootEnv();
    const dbUrl = process.env.DATABASE_URL;
    assert.ok(dbUrl, "DATABASE_URL is required for Fase S live Supabase tests");

    repo = createSupabasePostgresRepository({
      connectionString: dbUrl,
      isTestData: true,
    });

    // Ensure default policy gate is disabled at start of suite
    await repo.pool.query(
      `UPDATE public.platform_policies
       SET feature_grocery_picking_enabled = false
       WHERE policy_key = 'DEFAULT_BR_MARKETPLACE'`
    );
    await repo.pool.query(
      `UPDATE public.organizations
       SET feature_grocery_picking_enabled = false
       WHERE id = $1`,
      [ORG_101_ID]
    );
    await repo.pool.query(
      `UPDATE public.stores
       SET feature_grocery_picking_enabled = false
       WHERE id = $1`,
      [STORE_201_ID]
    );

    server = createApiServer({
      repository: repo,
      env: {
        ...process.env,
        NODE_ENV: "test",
        SUPABASE_JWT_SECRET: jwtSecret,
      },
      allowTestActorHeaders: false,
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    const exp = Math.floor(Date.now() / 1000) + 3600;
    aliceToken = signSupabaseHs256Jwt(
      { sub: ALICE_ID, role: "authenticated", aal: "aal1", exp },
      jwtSecret
    );
    brunoToken = signSupabaseHs256Jwt(
      { sub: BRUNO_ID, role: "authenticated", aal: "aal1", exp },
      jwtSecret
    );
    helenaToken = signSupabaseHs256Jwt(
      { sub: HELENA_OWNER_101_ID, role: "authenticated", aal: "aal2", exp },
      jwtSecret
    );
    lucasToken = signSupabaseHs256Jwt(
      { sub: LUCAS_OPERATOR_201_ID, role: "authenticated", aal: "aal1", exp },
      jwtSecret
    );
    kenjiToken = signSupabaseHs256Jwt(
      { sub: KENJI_OWNER_102_ID, role: "authenticated", aal: "aal2", exp },
      jwtSecret
    );
    techAdminTokenAal2 = signSupabaseHs256Jwt(
      { sub: TECH_ADMIN_ID, role: "authenticated", aal: "aal2", exp },
      jwtSecret
    );
  });

  after(async () => {
    try {
      // Restore default disabled policy state
      await repo.pool.query(
        `UPDATE public.platform_policies
         SET feature_grocery_picking_enabled = false
         WHERE policy_key = 'DEFAULT_BR_MARKETPLACE'`
      );
      await repo.pool.query(
        `UPDATE public.organizations
         SET feature_grocery_picking_enabled = false
         WHERE id = $1`,
        [ORG_101_ID]
      );
      await repo.pool.query(
        `UPDATE public.stores
         SET feature_grocery_picking_enabled = false
         WHERE id = $1`,
        [STORE_201_ID]
      );

      if (createdOrderIds.length > 0) {
        await repo.pool.query(
          `ALTER TABLE public.ledger_entries DISABLE TRIGGER trg_ledger_entries_immutable`
        );
        await repo.pool.query(
          `ALTER TABLE public.order_events DISABLE TRIGGER trg_order_events_immutable`
        );
        try {
          if (createdJournalIds.length > 0) {
            await repo.pool.query(
              `DELETE FROM public.ledger_entries WHERE journal_id = ANY($1::uuid[])`,
              [createdJournalIds]
            );
            await repo.pool.query(
              `DELETE FROM public.ledger_journals WHERE id = ANY($1::uuid[])`,
              [createdJournalIds]
            );
          }
          await repo.pool.query(
            `DELETE FROM public.refunds WHERE order_id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
          await repo.pool.query(
            `DELETE FROM public.payment_attempts WHERE order_id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
          await repo.pool.query(
            `DELETE FROM public.order_item_substitutions WHERE order_id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
          await repo.pool.query(
            `DELETE FROM public.order_pick_tasks WHERE order_id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
          await repo.pool.query(
            `DELETE FROM public.order_items WHERE order_id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
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

  it("1. enforces FEATURE_DISABLED_BY_POLICY when feature_grocery_picking_enabled is false and blocks cross-tenant store access", async () => {
    // 1. Store 201 operator Lucas can read GET /v1/partner/stores/:storeId/picking and sees FEATURE_DISABLED_BY_POLICY + seeded rows
    const overviewRes = await fetch(
      `${baseUrl}/v1/partner/stores/${STORE_201_ID}/picking`,
      {
        headers: { Authorization: `Bearer ${lucasToken}` },
      }
    );
    assert.equal(overviewRes.status, 200);
    const overviewJson = (await overviewRes.json()) as {
      data: StoreGroceryPickingOverviewContract;
    };
    assert.equal(overviewJson.data.policyKey, "DEFAULT_BR_MARKETPLACE");
    assert.equal(overviewJson.data.featureGroceryPickingEnabled, false);
    assert.equal(overviewJson.data.status, "FEATURE_DISABLED_BY_POLICY");
    assert.equal(
      overviewJson.data.reasonCode,
      "PLATFORM_GROCERY_PICKING_DISABLED"
    );
    assert.ok(overviewJson.data.pickTasks.length >= 1);
    assert.ok(overviewJson.data.substitutions.length >= 1);

    // 2. Starting a pick task while policy is disabled returns 403 FEATURE_DISABLED_BY_POLICY
    const startBlockedRes = await fetch(
      `${baseUrl}/v1/partner/stores/${STORE_201_ID}/orders/00000000-0000-4000-8000-000000001001/pick-tasks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lucasToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notes: "Attempt when disabled" }),
      }
    );
    assert.equal(startBlockedRes.status, 403);
    const startBlockedErr = (await startBlockedRes.json()) as {
      error: { code: string };
    };
    assert.equal(startBlockedErr.error.code, "FEATURE_DISABLED_BY_POLICY");

    // 3. Cross-tenant partner Kenji (Org 102) is blocked from reading or mutating Store 201 picking (HTTP 403)
    const crossTenantGetRes = await fetch(
      `${baseUrl}/v1/partner/stores/${STORE_201_ID}/picking`,
      {
        headers: { Authorization: `Bearer ${kenjiToken}` },
      }
    );
    assert.equal(crossTenantGetRes.status, 403);
  });

  it("2. executes full M22 flow when enabled: HALF_UP scale pricing in cents, REFUND_IF_UNAVAILABLE prohibition, customer-consented substitution & M12/M13 financial adjustment", async () => {
    // Enable M22 feature flag on platform_policies and Store 201
    await repo.pool.query(
      `UPDATE public.platform_policies
       SET feature_grocery_picking_enabled = true
       WHERE policy_key = 'DEFAULT_BR_MARKETPLACE'`
    );
    await repo.pool.query(
      `UPDATE public.stores
       SET feature_grocery_picking_enabled = true
       WHERE id = $1`,
      [STORE_201_ID]
    );

    // Create a disposable captured order on Store 201 with 2 items:
    // Item 1: KG item (1000g estimated @ 3399 cents/kg = 3399 cents), substitution_preference = REFUND_IF_UNAVAILABLE
    // Item 2: UNIT item (1690 cents), substitution_preference = ALLOW_SUGGESTION
    // Delivery fee: 650 cents, Service fee: 261 cents -> Total = 3399 + 1690 + 650 + 261 = 6000 cents
    // Commission: 1170 cents, Courier: 650 cents, Merchant Net: 3919 cents (3919 + 650 + 1170 + 261 = 6000)
    const quoteId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const itemKgId = crypto.randomUUID();
    const itemUnitId = crypto.randomUUID();
    const captureJournalId = crypto.randomUUID();
    createdQuoteIds.push(quoteId);
    createdOrderIds.push(orderId);
    createdJournalIds.push(captureJournalId);

    await repo.pool.query(
      `INSERT INTO public.quotes (
         id, customer_id, store_id, address_id, fulfillment_modality, currency_code,
         subtotal_cents, addons_cents, service_fee_cents, delivery_fee_cents, discount_cents, total_cents,
         distance_meters, estimated_prep_minutes, estimated_delivery_minutes, items_snapshot,
         idempotency_key, expires_at, consumed_at, is_test_data
       ) VALUES (
         $1, $2, $3, '00000000-0000-4000-8000-000000000801', 'PLATFORM_DELIVERY', 'BRL',
         5089, 0, 261, 650, 0, 6000,
         1420, 25, 35, '[]'::jsonb,
         $4, timezone('utc', now()) + interval '1 hour', timezone('utc', now()), true
       )`,
      [quoteId, ALICE_ID, STORE_201_ID, `quote_m22_${quoteId}`]
    );

    await repo.pool.query(
      `INSERT INTO public.orders (
         id, customer_id, organization_id, store_id, quote_id, fulfillment_modality,
         order_status, payment_status, delivery_status, currency_code,
         subtotal_cents, addons_cents, service_fee_cents, delivery_fee_cents, discount_cents, total_cents,
         platform_commission_cents, merchant_net_cents, courier_earnings_cents,
         version, idempotency_key, accepted_at, is_test_data
       ) VALUES (
         $1, $2, $3, $4, $5, 'PLATFORM_DELIVERY',
         'PREPARING', 'CAPTURED', 'PENDING_DISPATCH', 'BRL',
         5089, 0, 261, 650, 0, 6000,
         1170, 3919, 650,
         2, $6, timezone('utc', now()), true
       )`,
      [orderId, ALICE_ID, ORG_101_ID, STORE_201_ID, quoteId, `order_m22_${orderId}`]
    );

    // Post balanced ORDER_CAPTURE ledger journal for the test order so M21 ledger reconciliation holds
    await repo.pool.query(
      `INSERT INTO public.ledger_journals (
         id, reference_type, reference_id, description, idempotency_key, is_test_data
       ) VALUES ($1, 'ORDER_CAPTURE', $2, 'M22 test order capture', $3, true)`,
      [captureJournalId, orderId, `jnl_cap_m22_${orderId}`]
    );
    const accRes = await repo.pool.query(
      `SELECT id, code FROM public.ledger_accounts
       WHERE code IN ('ASSET_PSP_CLEARING', 'LIABILITY_MERCHANT_ORG_101', 'LIABILITY_COURIER_030', 'REVENUE_PLATFORM_COMMISSION', 'REVENUE_SERVICE_FEE')`
    );
    const accByCode = new Map<string, string>(
      accRes.rows.map((r) => [String(r.code), String(r.id)])
    );
    await repo.pool.query(
      `INSERT INTO public.ledger_entries (id, journal_id, account_id, direction, amount_cents, is_test_data)
       VALUES
         (gen_random_uuid(), $1, $2, 'DEBIT'::public.ledger_entry_direction, 6000, true),
         (gen_random_uuid(), $1, $3, 'CREDIT'::public.ledger_entry_direction, 3919, true),
         (gen_random_uuid(), $1, $4, 'CREDIT'::public.ledger_entry_direction, 650, true),
         (gen_random_uuid(), $1, $5, 'CREDIT'::public.ledger_entry_direction, 1170, true),
         (gen_random_uuid(), $1, $6, 'CREDIT'::public.ledger_entry_direction, 261, true)`,
      [
        captureJournalId,
        accByCode.get("ASSET_PSP_CLEARING"),
        accByCode.get("LIABILITY_MERCHANT_ORG_101"),
        accByCode.get("LIABILITY_COURIER_030"),
        accByCode.get("REVENUE_PLATFORM_COMMISSION"),
        accByCode.get("REVENUE_SERVICE_FEE"),
      ]
    );

    await repo.pool.query(
      `INSERT INTO public.order_items (
         id, order_id, product_id, product_name_snapshot_en, product_name_snapshot_pt_br,
         quantity, unit_price_cents, addons_unit_price_cents, total_line_cents,
         substitution_preference, pricing_unit, estimated_weight_grams, price_per_kg_cents, is_test_data
       ) VALUES
       (
         $1, $3, $4, 'Aged Sirloin Roast (Per Kg)', 'Contrafilé Maturado (Por Kg)',
         1, 3399, 0, 3399,
         'REFUND_IF_UNAVAILABLE', 'KG', 1000, 3399, true
       ),
       (
         $2, $3, $5, 'Rosemary & Sea Salt Crinkle Fries', 'Batata Crinkle com Alecrim e Flor de Sal',
         1, 1690, 0, 1690,
         'ALLOW_SUGGESTION', 'UNIT', NULL, NULL, true
       )`,
      [itemKgId, itemUnitId, orderId, PRODUCT_601_ID, PRODUCT_602_ID]
    );

    // 1. Start pick task
    const startRes = await fetch(
      `${baseUrl}/v1/partner/stores/${STORE_201_ID}/orders/${orderId}/pick-tasks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lucasToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notes: "Starting grocery picking for order",
        }),
      }
    );
    assert.equal(startRes.status, 201);
    const startJson = (await startRes.json()) as { data: OrderPickTaskContract };
    const pickTaskId = startJson.data.id;
    createdPickTaskIds.push(pickTaskId);
    assert.equal(startJson.data.status, "PICKING_IN_PROGRESS");
    assert.equal(startJson.data.preAuthorizedTotalCents, 6000);

    // 2. Overweight scale reading (1100g @ 3399 cents/kg = 3739 cents > 3399 ceiling) is rejected with 409
    const overweightRes = await fetch(
      `${baseUrl}/v1/partner/pick-tasks/${pickTaskId}/items/${itemKgId}/weigh`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lucasToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          actualWeightGrams: 1100,
        }),
      }
    );
    assert.equal(overweightRes.status, 409);
    const overweightErr = (await overweightRes.json()) as {
      error: { code: string };
    };
    assert.equal(
      overweightErr.error.code,
      "WEIGHING_EXCEEDS_PREAUTHORIZED_CEILING"
    );

    // 3. Valid scale reading: 485g @ 3399 cents/kg = 1,648,515 / 1000 = 1648.515 -> HALF_UP -> 1649 cents
    // Delta = 1649 - 3399 = -1750 cents (1750 cents downward refund adjustment)
    const weighRes = await fetch(
      `${baseUrl}/v1/partner/pick-tasks/${pickTaskId}/items/${itemKgId}/weigh`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lucasToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          actualWeightGrams: 485,
        }),
      }
    );
    assert.equal(weighRes.status, 200);
    const weighJson = (await weighRes.json()) as {
      data: {
        orderItem: OrderPickingItemContract;
        pickTask: OrderPickTaskContract;
        weighedBaseCents: number;
        calculatedLineCents: number;
        deltaCents: number;
        refundAdjustmentCents: number;
      };
    };
    assert.equal(weighJson.data.weighedBaseCents, 1649);
    assert.equal(weighJson.data.calculatedLineCents, 1649);
    assert.equal(weighJson.data.deltaCents, -1750);
    assert.equal(weighJson.data.refundAdjustmentCents, 1750);
    assert.equal(weighJson.data.pickTask.refundAdjustmentCents, 1750);

    // 4. Attempting to propose a substitution on Item 1 (REFUND_IF_UNAVAILABLE) is rejected with 409 SUBSTITUTION_FORBIDDEN_BY_PREFERENCE
    const forbiddenSubRes = await fetch(
      `${baseUrl}/v1/partner/pick-tasks/${pickTaskId}/substitutions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lucasToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderItemId: itemKgId,
          action: "PROPOSE_SUBSTITUTION",
          suggestedProductId: PRODUCT_602_ID,
          suggestedProductNameEn: "Alternative Cut",
          suggestedProductNamePtBr: "Corte Alternativo",
          suggestedLineCents: 3000,
          reason: "Trying to substitute item marked REFUND_IF_UNAVAILABLE",
        }),
      }
    );
    assert.equal(forbiddenSubRes.status, 409);
    const forbiddenSubErr = (await forbiddenSubRes.json()) as {
      error: { code: string };
    };
    assert.equal(
      forbiddenSubErr.error.code,
      "SUBSTITUTION_FORBIDDEN_BY_PREFERENCE"
    );

    // 5. Propose substitution on Item 2 (ALLOW_SUGGESTION, 1690 -> 1490 cents = -200 cents delta)
    const proposeSubRes = await fetch(
      `${baseUrl}/v1/partner/pick-tasks/${pickTaskId}/substitutions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lucasToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderItemId: itemUnitId,
          action: "PROPOSE_SUBSTITUTION",
          suggestedProductId: PRODUCT_602_ID,
          suggestedProductNameEn: "Truffle Sweet Potato Fries",
          suggestedProductNamePtBr: "Batata Doce Rústica Trufada",
          suggestedLineCents: 1490,
          reason: "Standard crinkle cut out of stock; suggesting truffle sweet potato fries",
          timeoutSeconds: 300,
        }),
      }
    );
    assert.equal(proposeSubRes.status, 201);
    const proposeSubJson = (await proposeSubRes.json()) as {
      data: {
        substitution: OrderItemSubstitutionContract;
        pickTask: OrderPickTaskContract;
      };
    };
    const substitutionId = proposeSubJson.data.substitution.id;
    assert.equal(
      proposeSubJson.data.substitution.status,
      "PENDING_CUSTOMER_APPROVAL"
    );
    assert.equal(
      proposeSubJson.data.pickTask.status,
      "AWAITING_CUSTOMER_SUBSTITUTION_APPROVAL"
    );

    // 6. Completing pick task while substitution is still awaiting customer approval is blocked with 409
    const prematureCompleteRes = await fetch(
      `${baseUrl}/v1/partner/pick-tasks/${pickTaskId}/complete`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lucasToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notes: "Trying to complete before customer consent" }),
      }
    );
    assert.equal(prematureCompleteRes.status, 409);
    const prematureErr = (await prematureCompleteRes.json()) as {
      error: { code: string };
    };
    assert.equal(
      prematureErr.error.code,
      "PICK_TASK_AWAITING_CUSTOMER_APPROVAL"
    );

    // 7. Another customer (Bruno) is blocked from viewing or responding to Alice's substitution (HTTP 403)
    const brunoGetRes = await fetch(
      `${baseUrl}/v1/orders/${orderId}/picking`,
      {
        headers: { Authorization: `Bearer ${brunoToken}` },
      }
    );
    assert.equal(brunoGetRes.status, 403);

    const brunoRespondRes = await fetch(
      `${baseUrl}/v1/orders/${orderId}/substitutions/${substitutionId}/respond`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${brunoToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: "APPROVE",
          notes: "Bruno trying to approve Alice's substitution",
        }),
      }
    );
    assert.equal(brunoRespondRes.status, 403);

    // 8. Order owner Alice views GET /v1/orders/:orderId/picking and approves the substitution
    const aliceDetailRes = await fetch(
      `${baseUrl}/v1/orders/${orderId}/picking`,
      {
        headers: { Authorization: `Bearer ${aliceToken}` },
      }
    );
    assert.equal(aliceDetailRes.status, 200);
    const aliceDetailJson = (await aliceDetailRes.json()) as {
      data: OrderGroceryPickingDetailContract;
    };
    assert.equal(aliceDetailJson.data.status, "ACTIVE");
    assert.equal(
      aliceDetailJson.data.pickTask?.status,
      "AWAITING_CUSTOMER_SUBSTITUTION_APPROVAL"
    );
    assert.equal(aliceDetailJson.data.substitutions.length, 1);

    const aliceApproveRes = await fetch(
      `${baseUrl}/v1/orders/${orderId}/substitutions/${substitutionId}/respond`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: "APPROVE",
          notes: "Aceito a substituição por batata doce trufada com desconto.",
        }),
      }
    );
    assert.equal(aliceApproveRes.status, 200);
    const aliceApproveJson = (await aliceApproveRes.json()) as {
      data: {
        substitution: OrderItemSubstitutionContract;
        pickTask: OrderPickTaskContract;
        isExpiredTimeout: boolean;
      };
    };
    assert.equal(aliceApproveJson.data.isExpiredTimeout, false);
    assert.equal(
      aliceApproveJson.data.substitution.status,
      "APPROVED_BY_CUSTOMER"
    );
    assert.equal(aliceApproveJson.data.pickTask.status, "PICKING_IN_PROGRESS");
    assert.equal(aliceApproveJson.data.pickTask.refundAdjustmentCents, 1950);
    assert.equal(aliceApproveJson.data.pickTask.finalPickedTotalCents, 4050);

    // 9. Store operator completes the pick task -> posts M12 refund (1950 cents) & M13 balanced ORDER_REFUND ledger journal
    const completeRes = await fetch(
      `${baseUrl}/v1/partner/pick-tasks/${pickTaskId}/complete`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lucasToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notes: "All items weighed and customer substitution consented.",
        }),
      }
    );
    assert.equal(completeRes.status, 200);
    const completeJson = (await completeRes.json()) as {
      data: {
        pickTask: OrderPickTaskContract;
        refundAdjustmentCents: number;
        finalPickedTotalCents: number;
      };
    };
    assert.equal(completeJson.data.pickTask.status, "PICKING_COMPLETED");
    assert.equal(completeJson.data.refundAdjustmentCents, 1950);
    assert.equal(completeJson.data.finalPickedTotalCents, 4050);

    // Track any created ORDER_REFUND journal for cleanup
    const refundJnlRes = await repo.pool.query(
      `SELECT id FROM public.ledger_journals
       WHERE reference_type = 'ORDER_REFUND' AND reference_id = $1`,
      [orderId]
    );
    assert.equal(refundJnlRes.rowCount, 1);
    const refundJournalId = String(refundJnlRes.rows[0]?.id);
    createdJournalIds.push(refundJournalId);

    const refundEntriesRes = await repo.pool.query(
      `SELECT direction, amount_cents FROM public.ledger_entries WHERE journal_id = $1 ORDER BY direction`,
      [refundJournalId]
    );
    assert.equal(refundEntriesRes.rowCount, 2);
    assert.equal(Number(refundEntriesRes.rows[0]?.amount_cents), 1950);
    assert.equal(Number(refundEntriesRes.rows[1]?.amount_cents), 1950);

    // Verify M21 analytical overview remains reconciled with double-entry ledger
    const kpiRes = await fetch(`${baseUrl}/v1/analytics/overview`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(kpiRes.status, 200);
    const kpiJson = (await kpiRes.json()) as {
      data: AnalyticalKpiSummaryContract;
    };
    assert.equal(kpiJson.data.isReconciledWithLedger, true);
  });
});
