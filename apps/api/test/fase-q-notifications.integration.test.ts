import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { reconcileNotificationsSinceCursor } from "@ideliveryfood/domain";
import type {
  NotificationDeliveryContract,
  UserNotificationsResponseContract,
} from "@ideliveryfood/contracts";
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

describe("Fase Q (M20) — Live Supabase Notifications, Realtime Cursor Recovery & Device Revocation Integration Tests", () => {
  const TEST_JWT_SECRET = "test_supabase_jwt_secret_phase_q_notifications_32c!";

  const ALICE_ID = "00000000-0000-4000-8000-000000000001";
  const BRUNO_ID = "00000000-0000-4000-8000-000000000002";

  const TEST_NOTIF_1_ID = "00000000-0000-4000-8000-000000009801";
  const TEST_NOTIF_2_ID = "00000000-0000-4000-8000-000000009802";
  const TEST_DEVICE_ID = "00000000-0000-4000-8000-000000009803";
  const TEST_DEVICE_IDENTIFIER = "alice-android-phase-q-9803";

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

  const aliceToken = tokenFor(ALICE_ID, "customer.alice@test.ideliveryfood.invalid", "aal1");
  const brunoToken = tokenFor(BRUNO_ID, "customer.bruno@test.ideliveryfood.invalid", "aal1");

  async function cleanupSyntheticRows(): Promise<void> {
    await repo.pool.query(
      `DELETE FROM public.notification_deliveries WHERE id IN ($1, $2)`,
      [TEST_NOTIF_1_ID, TEST_NOTIF_2_ID]
    );
    await repo.pool.query(
      `DELETE FROM public.outbox_events WHERE idempotency_key LIKE 'outbox_device_revoked_%' AND payload->>'deviceIdentifier' = $1`,
      [TEST_DEVICE_IDENTIFIER]
    );
    await repo.pool.query(
      `DELETE FROM public.user_devices WHERE id = $1 OR device_identifier = $2`,
      [TEST_DEVICE_ID, TEST_DEVICE_IDENTIFIER]
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

  it("lists user notifications, recovers missed events via ?sinceCursor= after Realtime drop, and marks notifications as read", async () => {
    // 1. Insert first notification for Alice
    await repo.pool.query(
      `INSERT INTO public.notification_deliveries (
         id, recipient_user_id, channel, template_key, template_version, category,
         locale, title, body, payload, status, idempotency_key, is_test_data
       ) VALUES (
         $1, $2, 'IN_APP', 'order.created', 1, 'TRANSACTIONAL',
         'en', 'Order #10081 created', 'Your order #10081 was received.',
         '{"orderNumber":10081}'::jsonb, 'DELIVERED', 'test_notif_9801', true
       )`,
      [TEST_NOTIF_1_ID, ALICE_ID]
    );

    const initialRes = await fetch(`${baseUrl}/v1/me/notifications?channel=IN_APP`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
      },
    });
    assert.equal(initialRes.status, 200);
    const initialJson = (await initialRes.json()) as {
      data: UserNotificationsResponseContract;
    };
    const notif1 = initialJson.data.notifications.find((n) => n.id === TEST_NOTIF_1_ID);
    assert.ok(notif1);
    assert.equal(notif1.readAtIso, null);
    const cursorBeforeDrop = notif1.cursorSeq;
    assert.ok(cursorBeforeDrop > 0);

    // 2. Simulate Realtime WebSocket drop while a second notification arrives in Supabase
    await repo.pool.query(
      `INSERT INTO public.notification_deliveries (
         id, recipient_user_id, channel, template_key, template_version, category,
         locale, title, body, payload, status, idempotency_key, is_test_data
       ) VALUES (
         $1, $2, 'IN_APP', 'order.status_changed', 1, 'TRANSACTIONAL',
         'en', 'Order #10081 status updated: PREPARING', 'Kitchen is preparing your order.',
         '{"orderNumber":10081,"orderStatus":"PREPARING"}'::jsonb, 'DELIVERED', 'test_notif_9802', true
       )`,
      [TEST_NOTIF_2_ID, ALICE_ID]
    );

    // 3. Catch up via GET /v1/me/notifications?sinceCursor=<cursorBeforeDrop>
    const catchUpRes = await fetch(
      `${baseUrl}/v1/me/notifications?sinceCursor=${cursorBeforeDrop}&channel=IN_APP`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
        },
      }
    );
    assert.equal(catchUpRes.status, 200);
    const catchUpJson = (await catchUpRes.json()) as {
      data: UserNotificationsResponseContract;
    };
    assert.ok(
      catchUpJson.data.notifications.every((n) => n.cursorSeq > cursorBeforeDrop),
      "All catch-up notifications must have cursorSeq > sinceCursor"
    );
    const recoveredNotif2 = catchUpJson.data.notifications.find((n) => n.id === TEST_NOTIF_2_ID);
    assert.ok(recoveredNotif2);

    // Reconcile on client side with zero duplicates
    const reconciled = reconcileNotificationsSinceCursor({
      existingNotifications: initialJson.data.notifications,
      incomingBatch: catchUpJson.data.notifications,
      sinceCursorSeq: cursorBeforeDrop,
    });
    assert.equal(reconciled.newlyRecoveredCount, catchUpJson.data.notifications.length);
    assert.ok(reconciled.latestCursorSeq >= recoveredNotif2.cursorSeq);

    // 4. Verify Bruno cannot mark Alice's notification as read (404 / tenant isolation)
    const brunoAttemptRes = await fetch(
      `${baseUrl}/v1/me/notifications/${TEST_NOTIF_2_ID}/read`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${brunoToken}`,
        },
      }
    );
    assert.equal(brunoAttemptRes.status, 404);

    // 5. Alice marks her notification as read
    const markReadRes = await fetch(
      `${baseUrl}/v1/me/notifications/${TEST_NOTIF_2_ID}/read`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
        },
      }
    );
    assert.equal(markReadRes.status, 200);
    const markReadJson = (await markReadRes.json()) as {
      data: NotificationDeliveryContract;
    };
    assert.equal(markReadJson.data.id, TEST_NOTIF_2_ID);
    assert.ok(markReadJson.data.readAtIso);
  });

  it("clears push_token immediately and enqueues security.device_revoked outbox event when a device is revoked", async () => {
    await repo.pool.query(
      `INSERT INTO public.user_devices (
         id, user_id, platform, device_identifier, push_token, push_consent_granted,
         is_revoked, is_test_data
       ) VALUES (
         $1, $2, 'ANDROID', $3, 'fcm_live_token_to_be_cleared_9803', true, false, true
       )`,
      [TEST_DEVICE_ID, ALICE_ID, TEST_DEVICE_IDENTIFIER]
    );

    const revokeRes = await fetch(`${baseUrl}/v1/me/devices/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceToken}`,
        "X-Idempotency-Key": "idem_revoke_dev_9803",
      },
      body: JSON.stringify({
        deviceIdentifier: TEST_DEVICE_IDENTIFIER,
      }),
    });
    assert.equal(revokeRes.status, 200);

    const devRes = await repo.pool.query(
      `SELECT is_revoked, revoked_at, push_token
       FROM public.user_devices
       WHERE id = $1`,
      [TEST_DEVICE_ID]
    );
    assert.equal(devRes.rowCount, 1);
    const devRow = devRes.rows[0] as {
      is_revoked: boolean;
      revoked_at: unknown;
      push_token: string | null;
    };
    assert.equal(devRow.is_revoked, true);
    assert.ok(devRow.revoked_at);
    assert.equal(devRow.push_token, null);

    const outboxRes = await repo.pool.query(
      `SELECT event_type, status
       FROM public.outbox_events
       WHERE aggregate_type = 'USER_DEVICE'
         AND payload->>'deviceIdentifier' = $1
       LIMIT 1`,
      [TEST_DEVICE_IDENTIFIER]
    );
    assert.equal(outboxRes.rowCount, 1);
    assert.equal(
      (outboxRes.rows[0] as { event_type: string }).event_type,
      "security.device_revoked"
    );
  });
});
