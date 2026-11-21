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

describe("Fase X (M24 Parte 3) — Jornada E2E 1: Happy Path Completo do Pedido (Descoberta -> Endereço -> Cupom -> Cotação -> Pedido -> Webhook PSP -> KDS -> Despacho com Endereço Oculto -> Aceite -> GPS -> OTP 4 Dígitos -> Ledger Balanceado -> Avaliação Verificada e Resposta da Loja)", () => {
  const JWT_SECRET = "fase_x_e2e_journey1_happy_path_jwt_secret_32_chars!!";
  const WEBHOOK_SECRET = "whsec_fase_x_e2e_journey1_stripe_secret_32chars!";

  const ALICE_ID = "00000000-0000-4000-8000-000000000001";
  const HELENA_OWNER_101_ID = "00000000-0000-4000-8000-000000000010";
  const LUCAS_OPERATOR_201_ID = "00000000-0000-4000-8000-000000000011";
  const CARLOS_COURIER_ID = "00000000-0000-4000-8000-000000000030";
  const MARINA_OPS_STAFF_ID = "00000000-0000-4000-8000-000000000090";
  const TECH_ADMIN_STAFF_ID = "00000000-0000-4000-8000-000000000099";

  const STORE_201_ID = "00000000-0000-4000-8000-000000000201";
  const PRODUCT_601_ID = "00000000-0000-4000-8000-000000000601";
  const PRODUCT_602_ID = "00000000-0000-4000-8000-000000000602";
  const OPTION_GROUP_701_ID = "00000000-0000-4000-8000-000000000701";
  const OPTION_751_ID = "00000000-0000-4000-8000-000000000751";

  let repo;
  let server;
  let baseUrl = "";

  const createdAddressIds = [];
  const createdPromoIds = [];
  const createdRedemptionIds = [];
  const createdQuoteIds = [];
  const createdOrderIds = [];
  const createdWebhookExtIds = [];
  const createdTaskIds = [];
  const createdOfferIds = [];
  const createdLocationSampleIds = [];
  const createdReviewIds = [];

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
  const helenaToken = issueJwt(HELENA_OWNER_101_ID, "owner.paulista@test.ideliveryfood.invalid", "aal2");
  const lucasToken = issueJwt(LUCAS_OPERATOR_201_ID, "operator.paulista@test.ideliveryfood.invalid");
  const carlosToken = issueJwt(CARLOS_COURIER_ID, "courier.carlos@test.ideliveryfood.invalid");
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
        RATE_LIMIT_OTP_MAX: "50",
        RATE_LIMIT_EXPORT_MAX: "50",
      },
      allowTestActorHeaders: false,
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    try {
      if (createdReviewIds.length > 0) {
        await repo.pool.query(`DELETE FROM public.order_reviews WHERE id = ANY($1::uuid[])`, [
          createdReviewIds,
        ]);
      }
      if (createdLocationSampleIds.length > 0) {
        await repo.pool.query(
          `DELETE FROM public.courier_location_samples WHERE id = ANY($1::uuid[])`,
          [createdLocationSampleIds]
        );
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
      if (createdRedemptionIds.length > 0) {
        await repo.pool.query(
          `DELETE FROM public.promotion_redemptions WHERE id = ANY($1::uuid[])`,
          [createdRedemptionIds]
        );
      }
      if (createdPromoIds.length > 0) {
        await repo.pool.query(`DELETE FROM public.promotions WHERE id = ANY($1::uuid[])`, [
          createdPromoIds,
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
      if (createdAddressIds.length > 0) {
        await repo.pool.query(
          `DELETE FROM public.customer_addresses WHERE id = ANY($1::uuid[])`,
          [createdAddressIds]
        );
      }
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      await repo.close();
    }
  });

  it("executes full E2E Happy Path from Store Discovery & Coupon Redemption to OTP Delivery Completion, Balanced Double-Entry Ledger & Verified Review Reply", async () => {
    const tag = `${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;

    // 1. Cliente autenticado cadastra endereço de entrega
    const addressId = crypto.randomUUID();
    const addrRes = await fetch(`${baseUrl}/v1/me/addresses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: addressId,
        label: "E2E Happy Path Home",
        streetLine: "Rua Oscar Freire",
        number: "950",
        complement: "Apt 82",
        neighborhood: "Jardins",
        city: "São Paulo",
        stateCode: "SP",
        postalCode: "01426-001",
        latitude: -23.56398,
        longitude: -46.66912,
        isDefault: false,
      }),
    });
    assert.equal(addrRes.status, 201);
    createdAddressIds.push(addressId);

    // 2. Descobre loja publicada com horário e cobertura ativa
    const storesRes = await fetch(`${baseUrl}/v1/stores?locale=pt-BR&search=Paulista`);
    assert.equal(storesRes.status, 200);
    const storesJson = await storesRes.json();
    const store201 = storesJson.data.find((s) => s.id === STORE_201_ID);
    assert.ok(store201, "Store 201 must be discoverable in /v1/stores");

    const availRes = await fetch(
      `${baseUrl}/v1/stores/${STORE_201_ID}/availability?lat=-23.56398&lng=-46.66912&basketCents=5580`
    );
    assert.equal(availRes.status, 200);
    const availJson = await availRes.json();
    assert.equal(availJson.data.coverage.eligible, true);
    assert.equal(availJson.data.coverage.deliveryFeeCents, 840);

    const catalogRes = await fetch(`${baseUrl}/v1/stores/${STORE_201_ID}/catalog?locale=pt-BR`);
    assert.equal(catalogRes.status, 200);
    const catalogJson = await catalogRes.json();
    assert.ok(catalogJson.data.categories.length >= 1);

    // 3. Aplica cupom com orçamento atômico
    const promoId = crypto.randomUUID();
    const promoCode = `E2E10_${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
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
        minOrderCents: 3500,
        budgetLimitCents: 10000,
        maxUsesPerUser: 1,
      }),
    });
    assert.equal(createPromoRes.status, 201);
    createdPromoIds.push(promoId);

    const redeemRes = await fetch(`${baseUrl}/v1/promotions/redeem`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_redeem_e2e1_${tag}`,
      },
      body: JSON.stringify({
        code: promoCode,
        storeId: STORE_201_ID,
        grossMerchandiseCents: 6230,
      }),
    });
    assert.equal(redeemRes.status, 201);
    const redeemJson = await redeemRes.json();
    createdRedemptionIds.push(redeemJson.data.redemption.id);
    assert.equal(redeemJson.data.redemption.discountAppliedCents, 1000);
    assert.equal(redeemJson.data.redemption.platformSubsidyCents, 1000);
    assert.equal(redeemJson.data.promotion.budgetConsumedCents, 1000);

    // 4. Gera cotação no servidor (POST /v1/quotes) em centavos inteiros BRL
    const quoteRes = await fetch(`${baseUrl}/v1/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_quote_e2e1_${tag}`,
      },
      body: JSON.stringify({
        storeId: STORE_201_ID,
        addressId,
        fulfillmentModality: "PLATFORM_DELIVERY",
        promotionCode: promoCode,
        discountCents: redeemJson.data.redemption.discountAppliedCents,
        discountFundedBy: "PLATFORM",
        deliveryFeeCents: 690,
        cartItems: [
          {
            productId: PRODUCT_601_ID,
            quantity: 1,
            selectedOptions: [
              {
                optionGroupId: OPTION_GROUP_701_ID,
                optionId: OPTION_751_ID,
                quantity: 1,
              },
            ],
          },
          {
            productId: PRODUCT_602_ID,
            quantity: 1,
            selectedOptions: [],
          },
        ],
      }),
    });
    assert.equal(quoteRes.status, 201);
    const quoteJson = await quoteRes.json();
    const quoteId = quoteJson.data.id;
    createdQuoteIds.push(quoteId);
    // 3890 + 1690 = 5580 subtotal; + 650 addon = 6230 merchandise; + 312 service fee + 690 delivery - 1000 discount = 6232 total
    assert.equal(quoteJson.data.subtotalCents, 5580);
    assert.equal(quoteJson.data.addonsCents, 650);
    assert.equal(quoteJson.data.serviceFeeCents, 312);
    assert.equal(quoteJson.data.deliveryFeeCents, 690);
    assert.equal(quoteJson.data.discountCents, 1000);
    assert.equal(quoteJson.data.totalCents, 6232);

    // 5. Converte cotação em pedido (POST /v1/orders)
    const orderRes = await fetch(`${baseUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_order_e2e1_${tag}`,
      },
      body: JSON.stringify({
        quoteId,
        discountFundedBy: "PLATFORM",
        customerNotes: "E2E Journey 1 Happy Path Order",
      }),
    });
    assert.equal(orderRes.status, 201);
    const orderJson = await orderRes.json();
    const orderId = orderJson.data.id;
    createdOrderIds.push(orderId);
    assert.equal(orderJson.data.totalCents, 6232);
    assert.equal(orderJson.data.version, 1);

    // Link redemption row to orderId for ledger subsidy capture verification
    await repo.pool.query(
      `UPDATE public.promotion_redemptions SET order_id = $1, status = 'REDEEMED' WHERE id = $2`,
      [orderId, redeemJson.data.redemption.id]
    );

    // 6. Recebe webhook HMAC assinado do PSP (payment.captured)
    const webhookExtId = `evt_e2e1_capture_${tag}`;
    createdWebhookExtIds.push(webhookExtId);
    const rawWebhookPayload = JSON.stringify({
      orderId,
      externalEventId: webhookExtId,
      eventType: "payment.captured",
      amountCents: 6232,
      currencyCode: "BRL",
    });
    const tsSeconds = Math.floor(Date.now() / 1000);
    const signature = computePspWebhookSignature({
      webhookSecret: WEBHOOK_SECRET,
      timestampSeconds: tsSeconds,
      rawPayload: rawWebhookPayload,
    });
    const hookRes = await fetch(`${baseUrl}/v1/webhooks/psp/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-psp-signature": signature,
        "x-psp-timestamp": String(tsSeconds),
      },
      body: rawWebhookPayload,
    });
    assert.equal(hookRes.status, 200);
    const hookJson = await hookRes.json();
    assert.equal(hookJson.data.deduplicated, false);
    assert.equal(hookJson.data.orderStatus, "PENDING_MERCHANT_ACCEPTANCE");
    assert.equal(hookJson.data.paymentStatus, "CAPTURED");
    assert.equal(hookJson.data.version, 2);

    // 7. Loja recebe no KDS e avança (ACCEPTED -> PREPARING -> READY_FOR_PICKUP)
    const kdsQueueRes = await fetch(`${baseUrl}/v1/stores/${STORE_201_ID}/orders-queue`, {
      headers: { Authorization: `Bearer ${lucasToken}` },
    });
    assert.equal(kdsQueueRes.status, 200);
    const kdsQueueJson = await kdsQueueRes.json();
    assert.equal(
      kdsQueueJson.data.columns.NEW.some((o) => o.orderId === orderId),
      true,
      "New captured order must appear in Store 201 KDS queue (NEW column)"
    );

    const acceptRes = await fetch(`${baseUrl}/v1/orders/${orderId}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lucasToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_e2e1_accept_${tag}`,
      },
      body: JSON.stringify({ command: "ACCEPT", expectedVersion: 2 }),
    });
    assert.equal(acceptRes.status, 200);
    const acceptJson = await acceptRes.json();
    assert.equal(acceptJson.data.order.orderStatus, "ACCEPTED");
    assert.equal(acceptJson.data.order.version, 3);

    const prepRes = await fetch(`${baseUrl}/v1/orders/${orderId}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lucasToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_e2e1_prep_${tag}`,
      },
      body: JSON.stringify({ command: "START_PREPARING", expectedVersion: 3 }),
    });
    assert.equal(prepRes.status, 200);
    const prepJson = await prepRes.json();
    assert.equal(prepJson.data.order.orderStatus, "PREPARING");
    assert.equal(prepJson.data.order.version, 4);

    const readyRes = await fetch(`${baseUrl}/v1/orders/${orderId}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lucasToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_e2e1_ready_${tag}`,
      },
      body: JSON.stringify({ command: "MARK_READY", expectedVersion: 4 }),
    });
    assert.equal(readyRes.status, 200);
    const readyJson = await readyRes.json();
    assert.equal(readyJson.data.order.orderStatus, "READY_FOR_PICKUP");
    assert.equal(readyJson.data.order.version, 5);

    // 8. Despacho gera delivery_task e delivery_offer (endereço completo do cliente oculto antes do aceite)
    const taskId = crypto.randomUUID();
    const offerId = crypto.randomUUID();
    const otpCode = "4829";
    const fullCustomerAddress = "Rua Oscar Freire, 950 - Apt 82, Jardins, São Paulo - SP";

    const offerCreateRes = await fetch(`${baseUrl}/v1/logistics/offers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${marinaTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deliveryTaskId: taskId,
        offerId,
        orderId,
        storeId: STORE_201_ID,
        courierId: CARLOS_COURIER_ID,
        offeredFeeCents: 690,
        distanceMeters: 1420,
        dropoffNeighborhoodOnly: "Jardins",
        dropoffFullAddress: fullCustomerAddress,
        confirmationCode: otpCode,
      }),
    });
    assert.equal(offerCreateRes.status, 201);
    createdTaskIds.push(taskId);
    createdOfferIds.push(offerId);
    const offerCreateJson = await offerCreateRes.json();
    assert.equal(
      offerCreateJson.data.task.dropoffFullAddress,
      null,
      "Customer full street address MUST be hidden (null) before courier accepts the offer"
    );
    assert.equal(offerCreateJson.data.offer.dropoffNeighborhoodOnly, "Jardins");

    // 9. Entregador aceita oferta (recebe endereço completo), coleta pedido, envia GPS e conclui com OTP de 4 dígitos
    const offerAcceptRes = await fetch(`${baseUrl}/v1/logistics/offers/${offerId}/accept`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${carlosToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_e2e1_offer_accept_${tag}`,
      },
      body: JSON.stringify({ isCourierOnline: true }),
    });
    assert.equal(offerAcceptRes.status, 200);
    const offerAcceptJson = await offerAcceptRes.json();
    assert.equal(offerAcceptJson.data.offer.status, "ACCEPTED");
    assert.equal(offerAcceptJson.data.task.status, "ASSIGNED");
    assert.equal(offerAcceptJson.data.task.activeCourierId, CARLOS_COURIER_ID);
    assert.equal(
      offerAcceptJson.data.task.dropoffFullAddress,
      fullCustomerAddress,
      "Customer full address MUST be revealed to the assigned courier after offer acceptance"
    );

    const pickupCmdRes = await fetch(`${baseUrl}/v1/orders/${orderId}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lucasToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_e2e1_pickup_${tag}`,
      },
      body: JSON.stringify({ command: "PICK_UP", expectedVersion: 5 }),
    });
    assert.equal(pickupCmdRes.status, 200);
    const pickupCmdJson = await pickupCmdRes.json();
    assert.equal(pickupCmdJson.data.order.orderStatus, "PICKED_UP");
    assert.equal(pickupCmdJson.data.order.version, 6);

    const gpsRes = await fetch(`${baseUrl}/v1/logistics/location-samples`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${carlosToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_e2e1_gps_${tag}`,
      },
      body: JSON.stringify({
        deliveryTaskId: taskId,
        latitude: -23.5628,
        longitude: -46.6621,
        accuracyMeters: 8,
        recordedAtIso: new Date().toISOString(),
      }),
    });
    assert.equal(gpsRes.status, 201);
    const gpsJson = await gpsRes.json();
    createdLocationSampleIds.push(gpsJson.data.id);
    assert.equal(gpsJson.data.isStaleOrLowAccuracy, false);

    // Invalid OTP attempt must be rejected with 409 DELIVERY_OTP_MISMATCH
    const wrongOtpRes = await fetch(`${baseUrl}/v1/logistics/tasks/${taskId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${carlosToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_e2e1_bad_otp_${tag}`,
      },
      body: JSON.stringify({ confirmationCode: "0000" }),
    });
    assert.equal(wrongOtpRes.status, 409);

    // Valid 4-digit OTP completes delivery task and transitions order to DELIVERED
    const completeDeliveryRes = await fetch(`${baseUrl}/v1/logistics/tasks/${taskId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${carlosToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_e2e1_good_otp_${tag}`,
      },
      body: JSON.stringify({ confirmationCode: otpCode }),
    });
    assert.equal(completeDeliveryRes.status, 200);
    const completeDeliveryJson = await completeDeliveryRes.json();
    assert.equal(completeDeliveryJson.data.status, "DELIVERED");
    assert.ok(completeDeliveryJson.data.completedAtIso);

    const deliveredOrderRes = await fetch(`${baseUrl}/v1/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(deliveredOrderRes.status, 200);
    const deliveredOrderJson = await deliveredOrderRes.json();
    assert.equal(deliveredOrderJson.data.orderStatus, "DELIVERED");
    assert.equal(deliveredOrderJson.data.deliveryStatus, "DELIVERED");

    // 10. Verifica lançamento balanceado de comissão/repasse/subsídio no Ledger M13 e reconciliação no BI M21
    const journalRes = await repo.pool.query(
      `SELECT le.direction, le.amount_cents, la.code, la.account_type
       FROM public.ledger_journals lj
       JOIN public.ledger_entries le ON le.journal_id = lj.id
       JOIN public.ledger_accounts la ON la.id = le.account_id
       WHERE lj.reference_type = 'ORDER_CAPTURE' AND lj.reference_id = $1`,
      [orderId]
    );
    assert.ok((journalRes.rowCount ?? 0) >= 5, "ORDER_CAPTURE journal must record all split lines");
    const totalDebits = journalRes.rows
      .filter((r) => r.direction === "DEBIT")
      .reduce((acc, r) => acc + Number(r.amount_cents), 0);
    const totalCredits = journalRes.rows
      .filter((r) => r.direction === "CREDIT")
      .reduce((acc, r) => acc + Number(r.amount_cents), 0);
    assert.equal(totalDebits, 7232, "Total debits must equal 6232 PSP clearing + 1000 promo subsidy");
    assert.equal(totalCredits, 7232, "Total credits must equal 7232 (merchant + courier + commission + service fee)");

    const analyticsRes = await fetch(`${baseUrl}/v1/analytics/overview`, {
      headers: { Authorization: `Bearer ${techAdminTokenAal2}` },
    });
    assert.equal(analyticsRes.status, 200);
    const analyticsJson = await analyticsRes.json();
    assert.equal(analyticsJson.data.isReconciledWithLedger, true);

    // 11. Cliente publica avaliação verificada e Loja responde preservando a nota
    const reviewId = crypto.randomUUID();
    const createReviewRes = await fetch(`${baseUrl}/v1/orders/${orderId}/reviews`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: reviewId,
        rating: 5,
        comment: "Jornada E2E 1 concluída com sucesso: entrega rápida e burger impecável!",
      }),
    });
    assert.equal(createReviewRes.status, 201);
    createdReviewIds.push(reviewId);
    const createReviewJson = await createReviewRes.json();
    assert.equal(createReviewJson.data.rating, 5);
    assert.equal(createReviewJson.data.moderationStatus, "PUBLISHED");

    const replyRes = await fetch(`${baseUrl}/v1/reviews/${reviewId}/reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${helenaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reply: "Muito obrigado pela avaliação 5 estrelas, Alice! Equipe Paulista Burgers.",
      }),
    });
    assert.equal(replyRes.status, 200);
    const replyJson = await replyRes.json();
    assert.equal(replyJson.data.rating, 5);
    assert.equal(
      replyJson.data.partnerReply,
      "Muito obrigado pela avaliação 5 estrelas, Alice! Equipe Paulista Burgers."
    );
  });
});
