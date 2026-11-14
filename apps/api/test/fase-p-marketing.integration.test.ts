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

describe("Fase P (M19) — Live Supabase Atomic Coupon Budget Concurrency, Subsidy Split & Verified Reviews Moderation Tests", () => {
  const TEST_JWT_SECRET = "test_supabase_jwt_secret_phase_p_marketing_32c!!";

  const ALICE_CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
  const OTHER_CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
  const HELENA_OWNER_ID = "00000000-0000-4000-8000-000000000010";
  const MARINA_OPS_ID = "00000000-0000-4000-8000-000000000090";
  const STORE_201_ID = "00000000-0000-4000-8000-000000000201";
  const ORG_101_ID = "00000000-0000-4000-8000-000000000101";

  const CONCURRENT_PROMO_ID = "00000000-0000-4000-8000-000000009901";
  const SINGLE_USE_PROMO_ID = "00000000-0000-4000-8000-000000009902";
  const TEST_QUOTE_ID = "00000000-0000-4000-8000-000000009903";
  const TEST_ORDER_ID = "00000000-0000-4000-8000-000000009904";
  const TEST_REVIEW_ID = "00000000-0000-4000-8000-000000009905";

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

  const aliceToken = tokenFor(ALICE_CUSTOMER_ID, "customer.alice@test.ideliveryfood.invalid", "aal1");
  const otherCustomerToken = tokenFor(
    OTHER_CUSTOMER_ID,
    "customer.other@test.ideliveryfood.invalid",
    "aal1"
  );
  const helenaToken = tokenFor(HELENA_OWNER_ID, "owner.paulista@test.ideliveryfood.invalid", "aal1");
  const marinaTokenAal2 = tokenFor(MARINA_OPS_ID, "staff.ops@test.ideliveryfood.invalid", "aal2");

  async function cleanupSyntheticRows(): Promise<void> {
    await repo.pool.query(
      `DELETE FROM public.order_reviews WHERE id = $1 OR order_id = $2`,
      [TEST_REVIEW_ID, TEST_ORDER_ID]
    );
    await repo.pool.query(
      `DELETE FROM public.order_events WHERE order_id = $1`,
      [TEST_ORDER_ID]
    );
    await repo.pool.query(`DELETE FROM public.orders WHERE id = $1`, [TEST_ORDER_ID]);
    await repo.pool.query(`DELETE FROM public.quotes WHERE id = $1`, [TEST_QUOTE_ID]);
    await repo.pool.query(
      `DELETE FROM public.promotion_redemptions WHERE promotion_id IN ($1, $2)`,
      [CONCURRENT_PROMO_ID, SINGLE_USE_PROMO_ID]
    );
    await repo.pool.query(
      `DELETE FROM public.promotions WHERE id IN ($1, $2) OR code IN ('CONCURRENT3K', 'ONCEONLY10')`,
      [CONCURRENT_PROMO_ID, SINGLE_USE_PROMO_ID]
    );
  }

  before(async () => {
    repo = createSupabasePostgresRepository({
      connectionString: loadDatabaseUrl(),
      isTestData: true,
    });
    await cleanupSyntheticRows();

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
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupSyntheticRows();
    await repo.close();
  });

  it("enforces atomic PostgreSQL coupon budget guard under 20 concurrent requests (at most 3 succeed, 17 fail with 409 PROMO_BUDGET_EXHAUSTED)", async () => {
    // 1. Create SHARED promotion campaign CONCURRENT3K with budgetLimitCents = 3000 and discountValue = 1000
    const createRes = await fetch(`${baseUrl}/v1/promotions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${marinaTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: CONCURRENT_PROMO_ID,
        code: "CONCURRENT3K",
        storeId: STORE_201_ID,
        fundedBy: "SHARED",
        platformShareBps: 5000,
        discountType: "FIXED_CENTS",
        discountValue: 1000,
        maxDiscountCents: 1000,
        minOrderCents: 2500,
        budgetLimitCents: 3000,
        budgetConsumedCents: 0,
        maxUsesPerUser: 10,
        firstOrderOnly: false,
      }),
    });
    assert.equal(createRes.status, 201);
    const createdBody = (await createRes.json()) as {
      data: { id: string; code: string; budgetLimitCents: number; budgetConsumedCents: number };
    };
    assert.equal(createdBody.data.code, "CONCURRENT3K");
    assert.equal(createdBody.data.budgetLimitCents, 3000);
    assert.equal(createdBody.data.budgetConsumedCents, 0);

    // 2. Fire 20 concurrent redemption requests competing for the R$ 30,00 budget (each requesting R$ 10,00 discount)
    const concurrentRequests = Array.from({ length: 20 }, (_, idx) => {
      const syntheticCustomerId = `00000000-0000-4000-8000-0000000097${String(idx + 1).padStart(2, "0")}`;
      const idempotencyKey = `idem_conc_m19_${idx + 1}_${Date.now()}`;
      return fetch(`${baseUrl}/v1/promotions/redeem`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          code: "CONCURRENT3K",
          storeId: STORE_201_ID,
          customerId: syntheticCustomerId,
          grossMerchandiseCents: 5000,
        }),
      }).then(async (res) => ({
        status: res.status,
        idempotencyKey,
        customerId: syntheticCustomerId,
        json: (await res.json()) as Record<string, unknown>,
      }));
    });

    const results = await Promise.all(concurrentRequests);
    const winners = results.filter((r) => r.status === 201);
    const exhausted = results.filter((r) => r.status === 409);

    assert.equal(winners.length, 3, `Expected exactly 3 winners, got ${winners.length}`);
    assert.equal(exhausted.length, 17, `Expected 17 exhausted rejections, got ${exhausted.length}`);

    for (const loser of exhausted) {
      const errObj = loser.json.error as { code: string };
      assert.equal(errObj.code, "PROMO_BUDGET_EXHAUSTED");
    }

    for (const winner of winners) {
      const dataObj = winner.json.data as {
        redemption: {
          discountAppliedCents: number;
          platformSubsidyCents: number;
          merchantSubsidyCents: number;
        };
      };
      assert.equal(dataObj.redemption.discountAppliedCents, 1000);
      assert.equal(dataObj.redemption.platformSubsidyCents, 500);
      assert.equal(dataObj.redemption.merchantSubsidyCents, 500);
    }

    // 3. Verify directly in PostgreSQL that budget_consumed_cents is exactly 3000 and never exceeded budget_limit_cents
    const dbCheck = await repo.pool.query(
      `SELECT budget_limit_cents, budget_consumed_cents
       FROM public.promotions
       WHERE id = $1`,
      [CONCURRENT_PROMO_ID]
    );
    assert.equal(Number(dbCheck.rows[0]?.budget_limit_cents), 3000);
    assert.equal(Number(dbCheck.rows[0]?.budget_consumed_cents), 3000);

    const redemptionsCountRes = await repo.pool.query(
      `SELECT COUNT(*)::int AS cnt FROM public.promotion_redemptions WHERE promotion_id = $1`,
      [CONCURRENT_PROMO_ID]
    );
    assert.equal(Number(redemptionsCountRes.rows[0]?.cnt), 3);

    // 4. Verify idempotent replay of a winning request returns 201 without consuming extra budget
    const firstWinner = winners[0]!;
    const replayRes = await fetch(`${baseUrl}/v1/promotions/redeem`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": firstWinner.idempotencyKey,
      },
      body: JSON.stringify({
        code: "CONCURRENT3K",
        storeId: STORE_201_ID,
        customerId: firstWinner.customerId,
        grossMerchandiseCents: 5000,
      }),
    });
    assert.equal(replayRes.status, 201);
  });

  it("enforces maxUsesPerUser limit per customer on coupon redemption", async () => {
    const createRes = await fetch(`${baseUrl}/v1/promotions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${helenaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: SINGLE_USE_PROMO_ID,
        code: "ONCEONLY10",
        storeId: STORE_201_ID,
        fundedBy: "STORE",
        discountType: "FIXED_CENTS",
        discountValue: 1000,
        minOrderCents: 2500,
        budgetLimitCents: 20000,
        maxUsesPerUser: 1,
      }),
    });
    assert.equal(createRes.status, 201);

    // First use by Alice succeeds
    const firstUse = await fetch(`${baseUrl}/v1/promotions/redeem`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_once_1_${Date.now()}`,
      },
      body: JSON.stringify({
        code: "ONCEONLY10",
        storeId: STORE_201_ID,
        customerId: ALICE_CUSTOMER_ID,
        grossMerchandiseCents: 4000,
      }),
    });
    assert.equal(firstUse.status, 201);

    // Second use by Alice is rejected with 409 PROMO_USER_LIMIT_EXCEEDED
    const secondUse = await fetch(`${baseUrl}/v1/promotions/redeem`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `idem_once_2_${Date.now()}`,
      },
      body: JSON.stringify({
        code: "ONCEONLY10",
        storeId: STORE_201_ID,
        customerId: ALICE_CUSTOMER_ID,
        grossMerchandiseCents: 4000,
      }),
    });
    assert.equal(secondUse.status, 409);
    const secondErr = (await secondUse.json()) as { error: { code: string } };
    assert.equal(secondErr.error.code, "PROMO_USER_LIMIT_EXCEEDED");
  });

  it("enforces verified order review rules (DELIVERED/COMPLETED only, owner only), partner reply, and audited admin moderation", async () => {
    // 1. Insert a synthetic order in CREATED status for Alice
    await repo.pool.query(
      `INSERT INTO public.quotes (
         id, customer_id, store_id, fulfillment_modality, currency_code,
         subtotal_cents, addons_cents, service_fee_cents, delivery_fee_cents,
         discount_cents, total_cents, distance_meters, estimated_prep_minutes,
         estimated_delivery_minutes, items_snapshot, idempotency_key, expires_at, is_test_data
       ) VALUES (
         $1, $2, $3, 'PLATFORM_DELIVERY', 'BRL',
         4200, 0, 210, 790, 0, 5200, 1500, 25, 40, '[]'::jsonb, 'quote_m19_rev_test',
         timezone('utc', now()) + interval '1 hour', true
       )`,
      [TEST_QUOTE_ID, ALICE_CUSTOMER_ID, STORE_201_ID]
    );

    await repo.pool.query(
      `INSERT INTO public.orders (
         id, order_number, customer_id, organization_id, store_id, quote_id,
         fulfillment_modality, order_status, payment_status, delivery_status,
         currency_code, subtotal_cents, addons_cents, service_fee_cents,
         delivery_fee_cents, discount_cents, total_cents,
         platform_commission_cents, merchant_net_cents, courier_earnings_cents,
         version, idempotency_key, is_test_data
       ) VALUES (
         $1, 19904, $2, $3, $4, $5,
         'PLATFORM_DELIVERY', 'CREATED', 'CAPTURED', 'PENDING_DISPATCH',
         'BRL', 4200, 0, 210, 790, 0, 5200, 504, 3696, 790,
         1, 'ord_m19_rev_test', true
       )`,
      [TEST_ORDER_ID, ALICE_CUSTOMER_ID, ORG_101_ID, STORE_201_ID, TEST_QUOTE_ID]
    );

    // 2. Attempting to review while order is still CREATED fails with 409 REVIEW_ORDER_NOT_DELIVERED
    const prematureRevRes = await fetch(`${baseUrl}/v1/orders/${TEST_ORDER_ID}/reviews`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: TEST_REVIEW_ID,
        rating: 5,
        comment: "Trying to review before delivery!",
      }),
    });
    assert.equal(prematureRevRes.status, 409);
    const prematureErr = (await prematureRevRes.json()) as { error: { code: string } };
    assert.equal(prematureErr.error.code, "REVIEW_ORDER_NOT_DELIVERED");

    // 3. Mark order DELIVERED in DB
    await repo.pool.query(
      `UPDATE public.orders
       SET order_status = 'DELIVERED',
           delivery_status = 'DELIVERED',
           delivered_at = timezone('utc', now())
       WHERE id = $1`,
      [TEST_ORDER_ID]
    );

    // 4. Another customer attempting to review Alice's delivered order fails with 403 REVIEW_NOT_ORDER_OWNER
    const wrongOwnerRes = await fetch(`${baseUrl}/v1/orders/${TEST_ORDER_ID}/reviews`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${otherCustomerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: TEST_REVIEW_ID,
        rating: 1,
        comment: "Fake review from non-owner",
      }),
    });
    assert.equal(wrongOwnerRes.status, 403);
    const wrongOwnerErr = (await wrongOwnerRes.json()) as { error: { code: string } };
    assert.equal(wrongOwnerErr.error.code, "REVIEW_NOT_ORDER_OWNER");

    // 5. Alice submits a verified review on her DELIVERED order -> 201
    const validRevRes = await fetch(`${baseUrl}/v1/orders/${TEST_ORDER_ID}/reviews`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: TEST_REVIEW_ID,
        rating: 5,
        comment: "Smash burger crocante e entrega super rápida!",
      }),
    });
    assert.equal(validRevRes.status, 201);
    const validRevBody = (await validRevRes.json()) as {
      data: { id: string; rating: number; moderationStatus: string };
    };
    assert.equal(validRevBody.data.rating, 5);
    assert.equal(validRevBody.data.moderationStatus, "PUBLISHED");

    // 6. Partner Owner Helena replies via POST /v1/reviews/:reviewId/reply -> 200 preserving rating = 5
    const replyRes = await fetch(`${baseUrl}/v1/reviews/${TEST_REVIEW_ID}/reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${helenaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reply: "Muito obrigado pela avaliação 5 estrelas, Alice! Esperamos você novamente.",
      }),
    });
    assert.equal(replyRes.status, 200);
    const replyBody = (await replyRes.json()) as {
      data: { rating: number; comment: string; partnerReply: string };
    };
    assert.equal(replyBody.data.rating, 5);
    assert.equal(replyBody.data.comment, "Smash burger crocante e entrega super rápida!");
    assert.match(replyBody.data.partnerReply, /Muito obrigado pela avaliação 5 estrelas/);

    // 7. Admin moderation without sufficient justification (< 10 chars) is rejected with 400
    const shortModRes = await fetch(
      `${baseUrl}/v1/admin/reviews/${TEST_REVIEW_ID}/moderate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${marinaTokenAal2}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          moderationStatus: "HIDDEN_BY_MODERATION",
          reason: "curto",
        }),
      }
    );
    assert.equal(shortModRes.status, 400);

    // 8. Admin moderation with valid justification succeeds and writes audit_logs
    const beforeAuditRes = await repo.pool.query(
      `SELECT COUNT(*)::int AS c
       FROM public.audit_logs
       WHERE target_id = $1 AND action = 'ORDER_REVIEW_MODERATED_HIDDEN_BY_MODERATION'`,
      [TEST_REVIEW_ID]
    );
    const beforeAuditCount = Number(beforeAuditRes.rows[0]?.c ?? 0);

    const modRes = await fetch(
      `${baseUrl}/v1/admin/reviews/${TEST_REVIEW_ID}/moderate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${marinaTokenAal2}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          moderationStatus: "HIDDEN_BY_MODERATION",
          reason: "Ocultado temporariamente para auditoria de conformidade de conteúdo M19.",
        }),
      }
    );
    assert.equal(modRes.status, 200);
    const modBody = (await modRes.json()) as {
      data: {
        moderationStatus: string;
        moderatedBy: string;
        moderationReason: string;
        rating: number;
      };
    };
    assert.equal(modBody.data.moderationStatus, "HIDDEN_BY_MODERATION");
    assert.equal(modBody.data.moderatedBy, MARINA_OPS_ID);
    assert.equal(modBody.data.rating, 5);

    const auditRes = await repo.pool.query(
      `SELECT action, target_type, target_id, reason
       FROM public.audit_logs
       WHERE target_id = $1 AND action = 'ORDER_REVIEW_MODERATED_HIDDEN_BY_MODERATION'
       ORDER BY created_at DESC`,
      [TEST_REVIEW_ID]
    );
    assert.equal(auditRes.rowCount, beforeAuditCount + 1);
  });
});
