import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { computePspWebhookSignature } from "../../packages/domain/dist/src/index.js";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
} from "../../apps/api/dist/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(REPO_ROOT, ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    if (match?.[1]) {
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("DATABASE_URL not found in environment or .env");
}

describe("Fase X (M24 Parte 3) — Jornada E2E 3: Concorrência e Idempotência no PostgreSQL Real (Duplo Clique Checkout, Webhook PSP Concorrente, Corrida de 2 Entregadores na Mesma Oferta/Task e Disputa Concorrente pelo Último Saldo de Orçamento de Cupom)", () => {
  const JWT_SECRET = "fase_x_e2e_journey3_concurrency_jwt_secret_32_chars!!";
  const WEBHOOK_SECRET = "whsec_fase_x_e2e_journey3_stripe_secret_32chars!";

  const ALICE_ID = "00000000-0000-4000-8000-000000000001";
  const BRUNO_SECOND_COURIER_ID = "00000000-0000-4000-8000-000000000002";
  const CARLOS_COURIER_ID = "00000000-0000-4000-8000-000000000030";
  const MARINA_OPS_STAFF_ID = "00000000-0000-4000-8000-000000000090";
  const TECH_ADMIN_STAFF_ID = "00000000-0000-4000-8000-000000000099";

  const STORE_201_ID = "00000000-0000-4000-8000-000000000201";
  const PRODUCT_601_ID = "00000000-0000-4000-8000-000000000601";

  let repo;
  let server;
  let baseUrl = "";

  const createdQuoteIds = [];
  const createdOrderIds = [];
  const createdWebhookExtIds = [];
  const createdTaskIds = [];
  const createdOfferIds = [];
  const createdPromoIds = [];
  const createdRedemptionIds = [];
  let tempSecondCourierCreated = false;

  function issueJwt(sub, email, aal = "aal1") {
    return signSupabaseHs256Jwt(
      {
        sub,
        email,
        aal,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      JWT_SECRET
    );
  }

  const aliceToken = issueJwt(ALICE_ID, "customer.alice@test.ideliveryfood.invalid");
  const carlosToken = issueJwt(CARLOS_COURIER_ID, "courier.carlos@test.ideliveryfood.invalid");
  const secondCourierToken = issueJwt(
    BRUNO_SECOND_COURIER_ID,
    "customer.bruno@test.ideliveryfood.invalid"
  );
  const marinaTokenAal2 = issueJwt(MARINA_OPS_STAFF_ID, "staff.ops@test.ideliveryfood.invalid", "aal2");
  const techAdminTokenAal2 = issueJwt(TECH_ADMIN_STAFF_ID, "staff.admin@test.ideliveryfood.invalid", "aal2");

  before(async () => {
    repo = createSupabasePostgresRepository({
      connectionString: loadDatabaseUrl(),
      isTestData: true,
    });

    server = createApiServer({
      repository: repo,
      env: {
        NODE_ENV: "test",
        SUPABASE_JWT_SECRET: JWT_SECRET,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        RATE_LIMIT_WINDOW_MS: "60000",
        RATE_LIMIT_OTP_MAX: "100",
        RATE_LIMIT_EXPORT_MAX: "100",
      },
      allowTestActorHeaders: false,
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    try {
      if (createdRedemptionIds.length > 0) {
        await repo.pool.query(
          `DELETE FROM public.promotion_redemptions WHERE id = ANY($1::uuid[])`,
          [createdRedemptionIds]
        );
      }
      if (createdPromoIds.length > 0) {
        await repo.pool.query(
          `DELETE FROM public.promotion_redemptions WHERE promotion_id = ANY($1::uuid[])`,
          [createdPromoIds]
        );
        await repo.pool.query(`DELETE FROM public.promotions WHERE id = ANY($1::uuid[])`, [
          createdPromoIds,
        ]);
      }
      if (createdTaskIds.length > 0) {
        await repo.pool.query(
          `DELETE FROM public.delivery_assignments WHERE delivery_task_id = ANY($1::uuid[])`,
          [createdTaskIds]
        );
      }
      if (createdOfferIds.length > 0) {
        await repo.pool.query(`DELETE FROM public.delivery_offers WHERE id = ANY($1::uuid[])`, [
          createdOfferIds,
        ]);
      }
      if (createdTaskIds.length > 0) {
        await repo.pool.query(`DELETE FROM public.delivery_tasks WHERE id = ANY($1::uuid[])`, [
          createdTaskIds,
        ]);
      }
      if (tempSecondCourierCreated) {
        await repo.pool.query(`DELETE FROM public.couriers WHERE id = $1`, [
          BRUNO_SECOND_COURIER_ID,
        ]);
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
            await repo.pool.query(`DELETE FROM public.ledger_journals WHERE id = ANY($1::uuid[])`, [
              jnlIds,
            ]);
          }
          if (createdWebhookExtIds.length > 0) {
            await repo.pool.query(
              `DELETE FROM public.payment_provider_events WHERE external_event_id = ANY($1::text[])`,
              [createdWebhookExtIds]
            );
          }
          await repo.pool.query(
            `DELETE FROM public.order_events WHERE order_id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
          await repo.pool.query(`DELETE FROM public.orders WHERE id = ANY($1::uuid[])`, [
            createdOrderIds,
          ]);
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
        await repo.pool.query(`DELETE FROM public.quotes WHERE id = ANY($1::uuid[])`, [
          createdQuoteIds,
        ]);
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      await repo.close();
    }
  });

  it("1. Duplo clique / 8 requisições concorrentes no checkout com mesmo X-Idempotency-Key criam 1 único pedido no banco", async () => {
    const tag = `idem_checkout_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;

    const quoteRes = await fetch(`${baseUrl}/v1/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `quote_${tag}`,
      },
      body: JSON.stringify({
        storeId: STORE_201_ID,
        fulfillmentModality: "PLATFORM_DELIVERY",
        cartItems: [{ productId: PRODUCT_601_ID, quantity: 1, selectedOptions: [] }],
        deliveryFeeCents: 690,
      }),
    });
    assert.equal(quoteRes.status, 201);
    const quoteJson = await quoteRes.json();
    const quoteId = quoteJson.data.id;
    createdQuoteIds.push(quoteId);

    const sharedOrderIdemKey = `order_double_click_${tag}`;
    const concurrentRequests = Array.from({ length: 8 }, () =>
      fetch(`${baseUrl}/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": sharedOrderIdemKey,
        },
        body: JSON.stringify({
          quoteId,
          customerNotes: "E2E Journey 3 Concurrent Double Click Checkout",
        }),
      })
    );

    const responses = await Promise.all(concurrentRequests);
    const payloads = await Promise.all(
      responses.map(async (r) => ({ status: r.status, body: await r.json() }))
    );

    for (const p of payloads) {
      assert.ok(
        p.status === 201 || p.status === 200,
        `Expected 201 or 200 on idempotent checkout race, got ${p.status}: ${JSON.stringify(p.body)}`
      );
      assert.ok(p.body.data?.id, "Every response must return the order payload");
    }

    const distinctOrderIds = new Set(payloads.map((p) => p.body.data.id));
    assert.equal(
      distinctOrderIds.size,
      1,
      "All 8 concurrent requests with the same X-Idempotency-Key MUST return the exact same order ID"
    );

    const singleOrderId = [...distinctOrderIds][0];
    createdOrderIds.push(singleOrderId);

    const dbCountRes = await repo.pool.query(
      `SELECT count(*)::int AS cnt FROM public.orders WHERE customer_id = $1 AND idempotency_key = $2`,
      [ALICE_ID, sharedOrderIdemKey]
    );
    assert.equal(
      Number(dbCountRes.rows[0].cnt),
      1,
      "PostgreSQL must store exactly 1 order row for the idempotency key"
    );
  });

  it("2. Webhook PSP repetido e concorrente (8 entregas simultâneas do mesmo externalEventId) é processado 1 única vez e gera 1 único journal no ledger", async () => {
    const tag = `idem_webhook_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const orderId = createdOrderIds[0];
    assert.ok(orderId, "Order from test 1 must exist");

    const webhookExtId = `evt_concurrent_${tag}`;
    createdWebhookExtIds.push(webhookExtId);
    const rawPayload = JSON.stringify({
      orderId,
      externalEventId: webhookExtId,
      eventType: "payment.captured",
      amountCents: 4775,
      currencyCode: "BRL",
    });
    const tsSec = Math.floor(Date.now() / 1000);
    const signature = computePspWebhookSignature({
      webhookSecret: WEBHOOK_SECRET,
      timestampSeconds: tsSec,
      rawPayload,
    });

    const concurrentWebhooks = Array.from({ length: 8 }, () =>
      fetch(`${baseUrl}/v1/webhooks/psp/stripe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-psp-signature": signature,
          "x-psp-timestamp": String(tsSec),
        },
        body: rawPayload,
      })
    );

    const hookResponses = await Promise.all(concurrentWebhooks);
    const hookPayloads = await Promise.all(
      hookResponses.map(async (r) => ({ status: r.status, body: await r.json() }))
    );

    for (const hp of hookPayloads) {
      assert.equal(hp.status, 200, `Expected 200 on concurrent webhook, got ${hp.status}`);
    }

    const firstProcessedCount = hookPayloads.filter((hp) => hp.body.data?.deduplicated === false).length;
    const deduplicatedCount = hookPayloads.filter((hp) => hp.body.data?.deduplicated === true).length;
    assert.equal(firstProcessedCount, 1, "Exactly 1 webhook delivery must win atomic processing");
    assert.equal(deduplicatedCount, 7, "All 7 duplicate concurrent deliveries must be deduplicated");

    const dbEventCount = await repo.pool.query(
      `SELECT count(*)::int AS cnt FROM public.payment_provider_events WHERE provider_code = 'stripe' AND external_event_id = $1`,
      [webhookExtId]
    );
    assert.equal(Number(dbEventCount.rows[0].cnt), 1);

    const dbJournalCount = await repo.pool.query(
      `SELECT count(*)::int AS cnt FROM public.ledger_journals WHERE reference_type = 'ORDER_CAPTURE' AND reference_id = $1`,
      [orderId]
    );
    assert.equal(
      Number(dbJournalCount.rows[0].cnt),
      1,
      "Exactly 1 ORDER_CAPTURE ledger journal must be created despite 8 concurrent webhook deliveries"
    );
  });

  it("3. 2 entregadores tentando aceitar a mesma entrega simultaneamente: apenas 1 vence (200) e o outro recebe 409 com 1 única atribuição ACTIVE", async () => {
    const tag = `race_courier_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const orderId = createdOrderIds[0];
    assert.ok(orderId);

    const taskId = crypto.randomUUID();
    const offerCarlosId = crypto.randomUUID();
    const offerCourier2Id = crypto.randomUUID();

    // 1. Cria a delivery_task e a oferta para o Entregador 1 (Carlos)
    const createOffer1Res = await fetch(`${baseUrl}/v1/logistics/offers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${marinaTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deliveryTaskId: taskId,
        offerId: offerCarlosId,
        orderId,
        storeId: STORE_201_ID,
        courierId: CARLOS_COURIER_ID,
        offeredFeeCents: 750,
        distanceMeters: 1400,
        dropoffNeighborhoodOnly: "Jardins",
        dropoffFullAddress: "Rua Oscar Freire, 950 - Apt 82, Jardins",
        confirmationCode: "7391",
      }),
    });
    const createOffer1Body = await createOffer1Res.json();
    assert.equal(createOffer1Res.status, 201, JSON.stringify(createOffer1Body));
    createdTaskIds.push(taskId);
    createdOfferIds.push(offerCarlosId);

    // 2. Registra uma segunda oferta ativa para o 2º entregador na MESMA delivery_task
    const courier2Exists = await repo.pool.query(
      `SELECT 1 FROM public.couriers WHERE id = $1 LIMIT 1`,
      [BRUNO_SECOND_COURIER_ID]
    );
    if ((courier2Exists.rowCount ?? 0) === 0) {
      await repo.pool.query(
        `INSERT INTO public.couriers (id, approval_status, document_number_hash, active_region_code, vehicle_type, is_online, is_test_data)
         VALUES ($1, 'APPROVED', 'sha256_temp_courier_2_race', 'SP-CAPITAL', 'MOTORCYCLE', true, true)
         ON CONFLICT (id) DO NOTHING`,
        [BRUNO_SECOND_COURIER_ID]
      );
      tempSecondCourierCreated = true;
    }

    await repo.pool.query(
      `INSERT INTO public.delivery_offers (
         id, delivery_task_id, courier_id, offered_fee_cents, status,
         pickup_store_name, distance_meters, dropoff_neighborhood_only, expires_at, is_test_data
       ) VALUES ($1, $2, $3, 750, 'OFFERED', 'Paulista Artisan Burgers - Jardins', 1400, 'Jardins', timezone('utc', now()) + interval '5 minutes', true)`,
      [offerCourier2Id, taskId, BRUNO_SECOND_COURIER_ID]
    );
    createdOfferIds.push(offerCourier2Id);

    // 3. Ambos os entregadores disparam POST /v1/logistics/offers/:offerId/accept simultaneamente
    const [resCarlos, resCourier2] = await Promise.all([
      fetch(`${baseUrl}/v1/logistics/offers/${offerCarlosId}/accept`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${carlosToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": `accept_carlos_${tag}`,
        },
        body: JSON.stringify({ isCourierOnline: true }),
      }),
      fetch(`${baseUrl}/v1/logistics/offers/${offerCourier2Id}/accept`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secondCourierToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": `accept_courier2_${tag}`,
        },
        body: JSON.stringify({ isCourierOnline: true }),
      }),
    ]);

    const statuses = [resCarlos.status, resCourier2.status].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      `Expected exactly one 200 winner and one 409 loser on concurrent courier offer acceptance, got ${statuses.join(", ")}`
    );

    const activeAssignmentsRes = await repo.pool.query(
      `SELECT courier_id FROM public.delivery_assignments
       WHERE delivery_task_id = $1 AND status = 'ACTIVE'`,
      [taskId]
    );
    assert.equal(
      activeAssignmentsRes.rowCount,
      1,
      "PostgreSQL partial unique index uq_delivery_assignments_one_active + FOR UPDATE must allow at most 1 ACTIVE assignment"
    );
  });

  it("4. múltiplos clientes disputando o último saldo de orçamento de um cupom (15 requisições concorrentes para 3 cotas de R$ 10,00): apenas 3 vencem e 12 recebem 409 PROMO_BUDGET_EXHAUSTED", async () => {
    const tag = `race_promo_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const promoId = crypto.randomUUID();
    const promoCode = `RACE30_${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

    const createPromoRes = await fetch(`${baseUrl}/v1/promotions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${techAdminTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: promoId,
        code: promoCode,
        fundedBy: "PLATFORM",
        platformShareBps: 10000,
        discountType: "FIXED_CENTS",
        discountValue: 1000,
        maxDiscountCents: 1000,
        minOrderCents: 2500,
        budgetLimitCents: 3000, // Exact budget for 3 redemptions of 1000 cents
        maxUsesPerUser: 20,
      }),
    });
    assert.equal(createPromoRes.status, 201);
    createdPromoIds.push(promoId);

    const concurrentRedemptions = Array.from({ length: 15 }, (_, idx) =>
      fetch(`${baseUrl}/v1/promotions/redeem`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": `race_redeem_${tag}_${idx}`,
        },
        body: JSON.stringify({
          code: promoCode,
          storeId: STORE_201_ID,
          grossMerchandiseCents: 5000,
        }),
      })
    );

    const responses = await Promise.all(concurrentRedemptions);
    const payloads = await Promise.all(
      responses.map(async (r) => ({ status: r.status, body: await r.json() }))
    );

    const winners = payloads.filter((p) => p.status === 201);
    const exhausted = payloads.filter(
      (p) => p.status === 409 && p.body.error?.code === "PROMO_BUDGET_EXHAUSTED"
    );

    for (const w of winners) {
      if (w.body.data?.redemption?.id) {
        createdRedemptionIds.push(w.body.data.redemption.id);
      }
    }

    assert.equal(winners.length, 3, `Expected exactly 3 coupon winners within 3000c budget, got ${winners.length}`);
    assert.equal(
      exhausted.length,
      12,
      `Expected 12 requests rejected with 409 PROMO_BUDGET_EXHAUSTED, got ${exhausted.length}`
    );

    const dbPromoRes = await repo.pool.query(
      `SELECT budget_limit_cents, budget_consumed_cents FROM public.promotions WHERE id = $1`,
      [promoId]
    );
    assert.equal(Number(dbPromoRes.rows[0].budget_consumed_cents), 3000);
    assert.equal(Number(dbPromoRes.rows[0].budget_limit_cents), 3000);
  });
});
