import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { verifyOutboundWebhookSignature } from "@ideliveryfood/domain";
import type { OutboundWebhookEnvelopeContract } from "@ideliveryfood/contracts";
import {
  calculateOutboxBackoffMs,
  calculateRetryBackoffMs,
  getWorkerReadinessReport,
  processOutboxBatch,
  processSupabaseOutboxBatch,
  type OutboxEventRecord,
} from "../src/index.js";

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key === "DATABASE_URL" && val) return val;
      }
    }
  }
  throw new Error("DATABASE_URL not found in environment or .env");
}

const TEST_OUTBOX_OK_ID = "00000000-0000-4000-8000-000000009701";
const TEST_OUTBOX_DLQ_ID = "00000000-0000-4000-8000-000000009702";
const TEST_OUTBOX_PT_ID = "00000000-0000-4000-8000-000000009703";
const TEST_OUTBOX_PROMO_ID = "00000000-0000-4000-8000-000000009704";
const TEST_REVOKED_DEVICE_ID = "00000000-0000-4000-8000-000000009705";

const ALICE_ID = "00000000-0000-4000-8000-000000000001"; // preferred_locale = 'en'
const BRUNO_ID = "00000000-0000-4000-8000-000000000002"; // preferred_locale = 'pt-BR'
const SEED_ORDER_ID = "00000000-0000-4000-8000-000000001001";

describe("@ideliveryfood/worker — Outbox Processor, Exponential Backoff & Dead-Letter Tests", () => {
  let pool: pg.Pool;

  async function cleanupSyntheticWorkerRows() {
    await pool.query(
      `DELETE FROM public.notification_deliveries WHERE outbox_event_id IN ($1, $2, $3, $4)`,
      [TEST_OUTBOX_OK_ID, TEST_OUTBOX_DLQ_ID, TEST_OUTBOX_PT_ID, TEST_OUTBOX_PROMO_ID]
    );
    await pool.query(`DELETE FROM public.outbox_events WHERE id IN ($1, $2, $3, $4)`, [
      TEST_OUTBOX_OK_ID,
      TEST_OUTBOX_DLQ_ID,
      TEST_OUTBOX_PT_ID,
      TEST_OUTBOX_PROMO_ID,
    ]);
    await pool.query(`DELETE FROM public.user_devices WHERE id = $1`, [TEST_REVOKED_DEVICE_ID]);
  }

  before(async () => {
    pool = new pg.Pool({
      connectionString: loadDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 4,
    });
    await cleanupSyntheticWorkerRows();
  });

  after(async () => {
    await cleanupSyntheticWorkerRows();
    await pool.end();
  });

  it("calculates exponential backoff bounded by maxMs", () => {
    assert.equal(calculateRetryBackoffMs(1, 1000, 30000), 1000);
    assert.equal(calculateRetryBackoffMs(2, 1000, 30000), 2000);
    assert.equal(calculateRetryBackoffMs(3, 1000, 30000), 4000);
    assert.equal(calculateOutboxBackoffMs(10, 1000, 30000), 30000);
  });

  it("transitions events to COMPLETED on success and DEAD_LETTER when maxAttempts is reached", async () => {
    const batch: OutboxEventRecord[] = [
      {
        id: "evt_1",
        aggregateType: "ORDER",
        aggregateId: SEED_ORDER_ID,
        eventType: "ORDER_CREATED",
        payload: {},
        status: "PENDING",
        attempts: 0,
        maxAttempts: 3,
      },
      {
        id: "evt_2",
        aggregateType: "NOTIFICATION",
        aggregateId: SEED_ORDER_ID,
        eventType: "SEND_EMAIL",
        payload: {},
        status: "FAILED",
        attempts: 2,
        maxAttempts: 3,
      },
    ];

    const results = await processOutboxBatch({
      events: batch,
      handler: async (evt) => {
        if (evt.id === "evt_2") {
          throw new Error("PROVIDER_BLOCKED [resend]: Missing RESEND_API_KEY");
        }
      },
    });

    assert.equal(results[0]?.status, "COMPLETED");
    assert.equal(results[0]?.attempts, 1);
    assert.equal(results[1]?.status, "DEAD_LETTER");
    assert.equal(results[1]?.attempts, 3);
    assert.match(results[1]?.lastError ?? "", /PROVIDER_BLOCKED \[resend\]/);

    const report = getWorkerReadinessReport({});
    assert.equal(report.status, "READY");
    assert.equal(report.providers.length, 8);
  });

  it("processes live Supabase outbox_events idempotently into notification_deliveries and transitions exhausted failures to DEAD_LETTER", async () => {
    await pool.query(
      `INSERT INTO public.outbox_events (
         id, aggregate_type, aggregate_id, event_type, idempotency_key,
         payload, status, attempts, max_attempts, next_attempt_at, is_test_data
       ) VALUES
       (
         $1, 'ORDER', $3, 'order.status_changed', 'test_worker_outbox_ok_9701',
         '{"orderId":"00000000-0000-4000-8000-000000001001","orderNumber":10001,"orderStatus":"READY_FOR_PICKUP"}'::jsonb,
         'PENDING', 0, 3, timezone('utc', now()) - interval '1 minute', true
       ),
       (
         $2, 'ORDER', $3, 'payment.captured', 'test_worker_outbox_dlq_9702',
         '{"orderId":"00000000-0000-4000-8000-000000001001","simulateWorkerFailure":true,"simulatedErrorMessage":"Transient downstream timeout"}'::jsonb,
         'FAILED', 2, 3, timezone('utc', now()) - interval '1 minute', true
       )`,
      [TEST_OUTBOX_OK_ID, TEST_OUTBOX_DLQ_ID, SEED_ORDER_ID]
    );

    const runResult = await processSupabaseOutboxBatch({
      pool,
      eventIdsFilter: [TEST_OUTBOX_OK_ID, TEST_OUTBOX_DLQ_ID],
      channels: ["IN_APP", "EMAIL"],
    });

    const okEvent = runResult.processedEvents.find((e) => e.id === TEST_OUTBOX_OK_ID);
    const dlqEvent = runResult.processedEvents.find((e) => e.id === TEST_OUTBOX_DLQ_ID);

    assert.ok(okEvent);
    assert.equal(okEvent.status, "COMPLETED");
    assert.equal(okEvent.attempts, 1);

    assert.ok(dlqEvent);
    assert.equal(dlqEvent.status, "DEAD_LETTER");
    assert.equal(dlqEvent.attempts, 3);
    assert.match(dlqEvent.lastError ?? "", /Transient downstream timeout/);

    const deliveriesForOk = runResult.deliveriesCreatedOrUpdated.filter(
      (d) => d.outboxEventId === TEST_OUTBOX_OK_ID
    );
    assert.equal(deliveriesForOk.length, 2);

    const inApp = deliveriesForOk.find((d) => d.channel === "IN_APP");
    const email = deliveriesForOk.find((d) => d.channel === "EMAIL");

    assert.ok(inApp);
    assert.equal(inApp.recipientUserId, ALICE_ID);
    assert.equal(inApp.status, "DELIVERED");
    assert.equal(inApp.templateKey, "order.status_changed");
    assert.equal(inApp.templateVersion, 1);
    assert.match(inApp.title, /Order #10001 status updated: READY_FOR_PICKUP/);

    assert.ok(email);
    assert.equal(email.status, "BLOCKED_MISSING_CREDENTIALS");
    assert.equal(email.providerCode, "resend");

    // Re-running on the same event IDs must not create duplicate notification_deliveries
    await pool.query(
      `UPDATE public.outbox_events SET status = 'PENDING', next_attempt_at = timezone('utc', now()) - interval '1 minute' WHERE id = $1`,
      [TEST_OUTBOX_OK_ID]
    );
    await processSupabaseOutboxBatch({
      pool,
      eventIdsFilter: [TEST_OUTBOX_OK_ID],
      channels: ["IN_APP", "EMAIL"],
    });

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM public.notification_deliveries WHERE outbox_event_id = $1`,
      [TEST_OUTBOX_OK_ID]
    );
    assert.equal(Number((countRes.rows[0] as { cnt: number }).cnt), 2);
  });

  it("renders pt-BR templates for pt-BR recipients, cleans revoked device push tokens, blocks push on revoked devices, respects marketing opt-out, and signs outbound webhooks", async () => {
    // Insert a revoked Android device for Bruno that still has a stale push_token
    await pool.query(
      `INSERT INTO public.user_devices (
         id, user_id, platform, device_identifier, push_token, push_consent_granted,
         is_revoked, revoked_at, updated_at, is_test_data
       ) VALUES (
         $1, $2, 'ANDROID', 'bruno-revoked-android-9705', 'fcm_stale_token_9705', true,
         true, timezone('utc', now()) - interval '5 minutes', timezone('utc', now()), true
       )`,
      [TEST_REVOKED_DEVICE_ID, BRUNO_ID]
    );

    // Event 1: Transactional delivery.completed for Bruno (pt-BR) across IN_APP, PUSH_ANDROID, WEBHOOK
    // Event 2: Marketing promo for Alice (who has push_promotions=false and email_marketing=false)
    await pool.query(
      `INSERT INTO public.outbox_events (
         id, aggregate_type, aggregate_id, event_type, idempotency_key,
         payload, status, attempts, max_attempts, next_attempt_at, is_test_data
       ) VALUES
       (
         $1, 'ORDER', $3, 'delivery.completed', 'test_worker_outbox_pt_9703',
         $4::jsonb,
         'PENDING', 0, 5, timezone('utc', now()) - interval '1 minute', true
       ),
       (
         $2, 'PROMOTION', $3, 'marketing.promo', 'test_worker_outbox_promo_9704',
         $5::jsonb,
         'PENDING', 0, 5, timezone('utc', now()) - interval '1 minute', true
       )`,
      [
        TEST_OUTBOX_PT_ID,
        TEST_OUTBOX_PROMO_ID,
        SEED_ORDER_ID,
        JSON.stringify({
          recipientUserId: BRUNO_ID,
          orderNumber: 10099,
          channels: ["IN_APP", "PUSH_ANDROID", "WEBHOOK"],
        }),
        JSON.stringify({
          recipientUserId: ALICE_ID,
          promoCode: "PAULISTA15",
          channels: ["IN_APP", "EMAIL"],
        }),
      ]
    );

    const webhookSecret = "whsec_live_worker_test_secret_2026";
    const batchRes = await processSupabaseOutboxBatch({
      pool,
      eventIdsFilter: [TEST_OUTBOX_PT_ID, TEST_OUTBOX_PROMO_ID],
      webhookSigningSecret: webhookSecret,
    });

    assert.equal(batchRes.revokedDevicesCleanedCount, 1);

    // Verify stale push_token was cleared to NULL in public.user_devices
    const devCheck = await pool.query(
      `SELECT push_token, is_revoked FROM public.user_devices WHERE id = $1`,
      [TEST_REVOKED_DEVICE_ID]
    );
    assert.equal((devCheck.rows[0] as { push_token: string | null }).push_token, null);

    // Check Bruno's deliveries (pt-BR)
    const brunoDeliveries = batchRes.deliveriesCreatedOrUpdated.filter(
      (d) => d.outboxEventId === TEST_OUTBOX_PT_ID
    );
    const brunoInApp = brunoDeliveries.find((d) => d.channel === "IN_APP");
    const brunoPush = brunoDeliveries.find((d) => d.channel === "PUSH_ANDROID");
    const brunoWebhook = brunoDeliveries.find((d) => d.channel === "WEBHOOK");

    assert.ok(brunoInApp);
    assert.equal(brunoInApp.locale, "pt-BR");
    assert.equal(brunoInApp.status, "DELIVERED");
    assert.match(brunoInApp.title, /Pedido #10099 entregue/);

    assert.ok(brunoPush);
    assert.equal(brunoPush.status, "BLOCKED_DEVICE_REVOKED");

    assert.ok(brunoWebhook);
    assert.equal(brunoWebhook.status, "SENT_TO_PROVIDER");
    const webhookEnv = brunoWebhook.payload.webhookEnvelope as OutboundWebhookEnvelopeContract;
    assert.ok(webhookEnv);
    const verifyRes = verifyOutboundWebhookSignature({
      envelope: webhookEnv,
      secret: webhookSecret,
      nowSeconds: webhookEnv.timestampSeconds + 5,
    });
    assert.equal(verifyRes.valid, true);

    // Check Alice's marketing deliveries (skipped due to opt-out)
    const alicePromoDeliveries = batchRes.deliveriesCreatedOrUpdated.filter(
      (d) => d.outboxEventId === TEST_OUTBOX_PROMO_ID
    );
    for (const deliv of alicePromoDeliveries) {
      assert.equal(deliv.category, "MARKETING");
      assert.equal(deliv.status, "SKIPPED_OPT_OUT");
    }
  });
});
