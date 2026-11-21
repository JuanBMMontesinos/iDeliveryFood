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

describe("Fase X (M24 Parte 3) — Jornada E2E 2: Cancelamento na Janela Gratuita, Chamado de Suporte M17, Escalonamento Acima da Alçada, Aprovação Financeira MFA aal2 (4-Olhos) e Reversão Proporcional no Ledger M12/M13", () => {
  const JWT_SECRET = "fase_x_e2e_journey2_support_refund_jwt_secret_32chars!!";
  const WEBHOOK_SECRET = "whsec_fase_x_e2e_journey2_stripe_secret_32chars!";

  const ALICE_ID = "00000000-0000-4000-8000-000000000001";
  const HELENA_OWNER_101_ID = "00000000-0000-4000-8000-000000000010";
  const MARINA_OPS_SUPPORT_ID = "00000000-0000-4000-8000-000000000090";
  const ROBERTO_FINANCE_ID = "00000000-0000-4000-8000-000000000091";

  const STORE_201_ID = "00000000-0000-4000-8000-000000000201";
  const PRODUCT_601_ID = "00000000-0000-4000-8000-000000000601";

  let repo;
  let server;
  let baseUrl = "";

  const createdQuoteIds = [];
  const createdOrderIds = [];
  const createdWebhookExtIds = [];
  const createdCaseIds = [];
  const createdActionReqIds = [];
  const createdRefundIds = [];

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
  const helenaToken = issueJwt(HELENA_OWNER_101_ID, "owner.paulista@test.ideliveryfood.invalid");
  const marinaTokenAal2 = issueJwt(MARINA_OPS_SUPPORT_ID, "staff.ops@test.ideliveryfood.invalid", "aal2");
  const robertoTokenAal1 = issueJwt(ROBERTO_FINANCE_ID, "staff.finance@test.ideliveryfood.invalid", "aal1");
  const robertoTokenAal2 = issueJwt(ROBERTO_FINANCE_ID, "staff.finance@test.ideliveryfood.invalid", "aal2");

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
      if (createdRefundIds.length > 0) {
        await repo.pool.query(`DELETE FROM public.refunds WHERE id = ANY($1::uuid[])`, [
          createdRefundIds,
        ]);
      }
      if (createdActionReqIds.length > 0) {
        await repo.pool.query(
          `DELETE FROM public.support_action_requests WHERE id = ANY($1::uuid[])`,
          [createdActionReqIds]
        );
      }
      if (createdCaseIds.length > 0) {
        await repo.pool.query(
          `DELETE FROM public.support_attachments WHERE case_id = ANY($1::uuid[])`,
          [createdCaseIds]
        );
        await repo.pool.query(
          `DELETE FROM public.support_messages WHERE case_id = ANY($1::uuid[])`,
          [createdCaseIds]
        );
        await repo.pool.query(`DELETE FROM public.support_cases WHERE id = ANY($1::uuid[])`, [
          createdCaseIds,
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
            `DELETE FROM public.payment_attempts WHERE order_id = ANY($1::uuid[])`,
            [createdOrderIds]
          );
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

  it("1. permite cancelamento direto pelo cliente dentro da janela pré-aceite e registra evento append-only", async () => {
    const tag = `cancel_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;

    const quoteRes = await fetch(`${baseUrl}/v1/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_q_e2e2a_${tag}`,
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
    createdQuoteIds.push(quoteJson.data.id);

    const orderRes = await fetch(`${baseUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_o_e2e2a_${tag}`,
      },
      body: JSON.stringify({
        quoteId: quoteJson.data.id,
        customerNotes: "E2E Journey 2 Free Window Cancellation",
      }),
    });
    assert.equal(orderRes.status, 201);
    const orderJson = await orderRes.json();
    createdOrderIds.push(orderJson.data.id);

    const cancelRes = await fetch(`${baseUrl}/v1/orders/${orderJson.data.id}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_cancel_e2e2a_${tag}`,
      },
      body: JSON.stringify({
        command: "CANCEL",
        expectedVersion: orderJson.data.version,
        reason: "Changed delivery address before merchant acceptance",
      }),
    });
    assert.equal(cancelRes.status, 200);
    const cancelJson = await cancelRes.json();
    assert.equal(cancelJson.data.order.orderStatus, "CANCELLED");
    assert.equal(cancelJson.data.order.cancelledByRole, "CUSTOMER");
  });

  it("2. executa chamado de suporte M17 -> nota interna oculta -> escalonamento acima da alçada (> 1500c) -> aprovação Finance MFA aal2 (4-olhos) -> reembolso M12 e reversão proporcional no ledger M13", async () => {
    const tag = `refund_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;

    // 1. Cria cotação + pedido + captura de pagamento via webhook assinado (4775 centavos)
    const quoteRes = await fetch(`${baseUrl}/v1/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_q_e2e2b_${tag}`,
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
    createdQuoteIds.push(quoteJson.data.id);

    const orderRes = await fetch(`${baseUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_o_e2e2b_${tag}`,
      },
      body: JSON.stringify({
        quoteId: quoteJson.data.id,
        customerNotes: "E2E Journey 2 Support Escalated Refund Order",
      }),
    });
    assert.equal(orderRes.status, 201);
    const orderJson = await orderRes.json();
    const orderId = orderJson.data.id;
    createdOrderIds.push(orderId);
    assert.equal(orderJson.data.totalCents, 4775);

    const webhookExtId = `evt_e2e2b_capture_${tag}`;
    createdWebhookExtIds.push(webhookExtId);
    const rawWebhook = JSON.stringify({
      orderId,
      externalEventId: webhookExtId,
      eventType: "payment.captured",
      amountCents: 4775,
      currencyCode: "BRL",
    });
    const tsSec = Math.floor(Date.now() / 1000);
    const sig = computePspWebhookSignature({
      webhookSecret: WEBHOOK_SECRET,
      timestampSeconds: tsSec,
      rawPayload: rawWebhook,
    });
    const hookRes = await fetch(`${baseUrl}/v1/webhooks/psp/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-psp-signature": sig,
        "x-psp-timestamp": String(tsSec),
      },
      body: rawWebhook,
    });
    assert.equal(hookRes.status, 200);

    // 2. Cliente Alice abre chamado em M17 vinculado ao pedido
    const openCaseRes = await fetch(`${baseUrl}/v1/support/cases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId,
        storeId: STORE_201_ID,
        category: "MISSING_ITEM",
        subject: "E2E Journey 2: Item principal veio trocado e incompleto",
        initialMessage: "Recebi apenas o acompanhamento, faltou o burger principal.",
      }),
    });
    assert.equal(openCaseRes.status, 201);
    const openCaseJson = await openCaseRes.json();
    const createdCase = openCaseJson.data.supportCase ?? openCaseJson.data;
    const caseId = createdCase.id;
    createdCaseIds.push(caseId);
    assert.equal(createdCase.priority, "MEDIUM");
    assert.equal(createdCase.status, "OPEN");

    // 3. Agente de suporte Marina adiciona nota interna e verifica que é ocultada de Alice e Helena
    const internalNoteRes = await fetch(`${baseUrl}/v1/support/cases/${caseId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${marinaTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: "NOTA INTERNA L1: Conferido peso de saída na cozinha; procedente reembolso parcial de R$ 25,00.",
        isInternalNote: true,
      }),
    });
    assert.equal(internalNoteRes.status, 201);

    const aliceCaseView = await (
      await fetch(`${baseUrl}/v1/support/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      })
    ).json();
    assert.equal(
      aliceCaseView.data.messages.some((m) => m.isInternalNote),
      false,
      "Internal notes must be stripped from customer view"
    );

    const partnerCaseView = await (
      await fetch(`${baseUrl}/v1/support/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${helenaToken}` },
      })
    ).json();
    assert.equal(
      partnerCaseView.data.messages.some((m) => m.isInternalNote),
      false,
      "Internal notes must be stripped from partner view"
    );

    // 4. Agente solicita reembolso de 2500 centavos (> 1500c alçada automática) -> ESCALATED_FINANCE / PENDING_FINANCE
    const actionReqRes = await fetch(`${baseUrl}/v1/support/cases/${caseId}/action-requests`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${marinaTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId,
        actionType: "PARTIAL_REFUND",
        amountCents: 2500,
        reason: "Reembolso parcial por item principal ausente (acima da alçada automática L1 de R$ 15,00)",
      }),
    });
    assert.equal(actionReqRes.status, 201);
    const actionReqJson = await actionReqRes.json();
    const requestId = actionReqJson.data.actionRequest.id;
    createdActionReqIds.push(requestId);
    assert.equal(actionReqJson.data.autoApproved, false);
    assert.equal(actionReqJson.data.actionRequest.status, "PENDING_FINANCE");
    assert.equal(actionReqJson.data.supportCase.status, "ESCALATED_FINANCE");
    assert.equal(actionReqJson.data.refund, null);

    // 5. Bloqueia tentativa de decisão sem MFA aal2 (Roberto com aal1) e bloqueia autoaprovação (4-olhos)
    const aal1AttemptRes = await fetch(`${baseUrl}/v1/support/action-requests/${requestId}/decide`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${robertoTokenAal1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: "APPROVED",
        decisionNotes: "Attempt without MFA aal2",
      }),
    });
    assert.equal(aal1AttemptRes.status, 403);

    const selfApproveAttemptRes = await fetch(
      `${baseUrl}/v1/support/action-requests/${requestId}/decide`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${marinaTokenAal2}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: "APPROVED",
          decisionNotes: "Requester attempting self-approval",
        }),
      }
    );
    assert.equal(selfApproveAttemptRes.status, 403);

    // 6. Analista Finance Roberto com MFA aal2 aprova a solicitação -> gera reembolso M12 e reversão balanceada no ledger M13
    const decideRes = await fetch(`${baseUrl}/v1/support/action-requests/${requestId}/decide`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${robertoTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: "APPROVED",
        decisionNotes: "Aprovado pelo Financeiro (aal2) após auditoria de evidências do pedido.",
      }),
    });
    assert.equal(decideRes.status, 200);
    const decideJson = await decideRes.json();
    assert.equal(decideJson.data.actionRequest.status, "APPROVED");
    assert.equal(decideJson.data.actionRequest.decidedBy, ROBERTO_FINANCE_ID);
    assert.equal(decideJson.data.supportCase.status, "RESOLVED");
    assert.ok(decideJson.data.refund, "Approved finance decision must create M12 refund record");
    createdRefundIds.push(decideJson.data.refund.id);
    assert.equal(decideJson.data.refund.amountCents, 2500);
    assert.equal(decideJson.data.refund.status, "PROCESSED");

    // 7. Verifica status do pedido (PARTIALLY_REFUNDED) e lançamento balanceado ORDER_REFUND no ledger M13
    const updatedOrderRes = await fetch(`${baseUrl}/v1/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(updatedOrderRes.status, 200);
    const updatedOrderJson = await updatedOrderRes.json();
    assert.equal(updatedOrderJson.data.paymentStatus, "PARTIALLY_REFUNDED");

    const refundJournalRes = await repo.pool.query(
      `SELECT lj.id, le.direction, le.amount_cents, la.code, la.account_type
       FROM public.ledger_journals lj
       JOIN public.ledger_entries le ON le.journal_id = lj.id
       JOIN public.ledger_accounts la ON la.id = le.account_id
       WHERE lj.reference_type = 'ORDER_REFUND' AND lj.reference_id = $1
       ORDER BY le.direction ASC`,
      [orderId]
    );
    assert.equal(
      refundJournalRes.rowCount,
      2,
      "ORDER_REFUND journal must have 2 balanced double-entry lines (DEBIT liability, CREDIT clearing)"
    );
    const creditEntry = refundJournalRes.rows.find((r) => r.direction === "CREDIT");
    const debitEntry = refundJournalRes.rows.find((r) => r.direction === "DEBIT");
    assert.ok(creditEntry && debitEntry);
    assert.equal(Number(creditEntry.amount_cents), 2500);
    assert.equal(Number(debitEntry.amount_cents), 2500);
    assert.equal(creditEntry.account_type, "ASSET");
    assert.equal(debitEntry.account_type, "LIABILITY");
  });
});
