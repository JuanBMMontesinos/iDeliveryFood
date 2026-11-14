import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createStructuredLogEntry, inspectProviderReadiness } from "@ideliveryfood/config";
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryContract,
  NotificationDeliveryStatus,
  OutboxEventContract,
  OutboxEventStatus,
  ProviderReadinessStatus,
  SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  calculateOutboxBackoffMs,
  evaluateNotificationChannelEligibility,
  renderVersionedNotificationTemplate,
  signOutboundWebhookPayload,
} from "@ideliveryfood/domain";

export { calculateOutboxBackoffMs } from "@ideliveryfood/domain";

export interface OutboxEventRecord {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "DEAD_LETTER";
  attempts: number;
  maxAttempts: number;
  lastError?: string | undefined;
}

export function calculateRetryBackoffMs(attempts: number, baseMs = 1000, maxMs = 60000): number {
  return calculateOutboxBackoffMs(attempts, baseMs, maxMs);
}

export async function processOutboxBatch(params: {
  events: OutboxEventRecord[];
  handler: (event: OutboxEventRecord) => Promise<void>;
  correlationId?: string;
}): Promise<OutboxEventRecord[]> {
  const correlationId = params.correlationId ?? `corr_worker_${Date.now()}`;
  const updated: OutboxEventRecord[] = [];

  for (const evt of params.events) {
    if (evt.status !== "PENDING" && evt.status !== "FAILED") {
      updated.push(evt);
      continue;
    }

    const nextAttempts = evt.attempts + 1;
    try {
      await params.handler(evt);
      updated.push({
        ...evt,
        status: "COMPLETED",
        attempts: nextAttempts,
        lastError: undefined,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown worker error";
      const nextStatus = nextAttempts >= evt.maxAttempts ? "DEAD_LETTER" : "FAILED";
      createStructuredLogEntry({
        level: "ERROR",
        service: "@ideliveryfood/worker",
        correlationId,
        message: `Outbox event ${evt.id} failed (${nextStatus}): ${errorMessage}`,
      });
      updated.push({
        ...evt,
        status: nextStatus,
        attempts: nextAttempts,
        lastError: errorMessage,
      });
    }
  }

  return updated;
}

function loadDatabaseUrlFromWorkspaceEnv(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key === "DATABASE_URL" && val) {
          return val;
        }
      }
    }
  }
  return undefined;
}

export interface SupabaseOutboxBatchResult {
  processedEvents: OutboxEventContract[];
  deliveriesCreatedOrUpdated: NotificationDeliveryContract[];
  revokedDevicesCleanedCount: number;
}

function mapRowToOutboxEvent(row: Record<string, unknown>): OutboxEventContract {
  return {
    id: String(row.id),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    eventType: String(row.event_type),
    idempotencyKey: String(row.idempotency_key),
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: String(row.status) as OutboxEventStatus,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 5),
    nextAttemptAtIso: new Date(String(row.next_attempt_at)).toISOString(),
    processedAtIso: row.processed_at ? new Date(String(row.processed_at)).toISOString() : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  };
}

function mapRowToNotificationDelivery(row: Record<string, unknown>): NotificationDeliveryContract {
  return {
    id: String(row.id),
    outboxEventId: row.outbox_event_id ? String(row.outbox_event_id) : null,
    recipientUserId: String(row.recipient_user_id),
    channel: String(row.channel) as NotificationChannel,
    templateKey: String(row.template_key),
    templateVersion: Number(row.template_version ?? 1),
    category: String(row.category ?? "TRANSACTIONAL") as NotificationCategory,
    locale: (String(row.locale ?? "en") === "pt-BR" ? "pt-BR" : "en") as SupportedLocale,
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: String(row.status) as NotificationDeliveryStatus,
    providerCode: row.provider_code ? String(row.provider_code) : null,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    cursorSeq: Number(row.cursor_seq ?? 0),
    readAtIso: row.read_at ? new Date(String(row.read_at)).toISOString() : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  };
}

async function resolveEventRecipientAndContext(
  client: pg.PoolClient,
  event: OutboxEventContract
): Promise<{
  recipientUserId: string;
  enrichedPayload: Record<string, unknown>;
}> {
  const p = { ...event.payload };
  if (typeof p.recipientUserId === "string" && p.recipientUserId.length > 0) {
    return {
      recipientUserId: p.recipientUserId,
      enrichedPayload: p,
    };
  }

  const aggType = event.aggregateType.toUpperCase();
  if (aggType === "ORDER") {
    const orderRes = await client.query(
      `SELECT o.customer_id, o.order_number, o.order_status, o.total_cents, s.name AS store_name
       FROM public.orders o
       LEFT JOIN public.stores s ON s.id = o.store_id
       WHERE o.id = $1
       LIMIT 1`,
      [event.aggregateId]
    );
    if ((orderRes.rowCount ?? 0) > 0) {
      const r = orderRes.rows[0] as Record<string, unknown>;
      return {
        recipientUserId: String(r.customer_id),
        enrichedPayload: {
          ...p,
          orderId: event.aggregateId,
          orderNumber: p.orderNumber ?? Number(r.order_number),
          orderStatus: p.orderStatus ?? String(r.order_status),
          amountCents: p.amountCents ?? Number(r.total_cents),
          storeName: p.storeName ?? (r.store_name ? String(r.store_name) : undefined),
        },
      };
    }
  }

  if (aggType === "DELIVERY_TASK" || aggType === "DELIVERY") {
    const taskRes = await client.query(
      `SELECT dt.active_courier_id, dt.order_id, dt.distance_meters, o.customer_id, o.order_number, s.name AS store_name
       FROM public.delivery_tasks dt
       LEFT JOIN public.orders o ON o.id = dt.order_id
       LEFT JOIN public.stores s ON s.id = dt.store_id
       WHERE dt.id = $1
       LIMIT 1`,
      [event.aggregateId]
    );
    if ((taskRes.rowCount ?? 0) > 0) {
      const r = taskRes.rows[0] as Record<string, unknown>;
      const targetUser =
        event.eventType.toLowerCase().includes("offer") && r.active_courier_id
          ? String(r.active_courier_id)
          : r.customer_id
            ? String(r.customer_id)
            : r.active_courier_id
              ? String(r.active_courier_id)
              : "00000000-0000-4000-8000-000000000001";
      return {
        recipientUserId: targetUser,
        enrichedPayload: {
          ...p,
          deliveryTaskId: event.aggregateId,
          orderNumber: p.orderNumber ?? (r.order_number ? Number(r.order_number) : 10001),
          distanceMeters:
            p.distanceMeters ?? (r.distance_meters ? Number(r.distance_meters) : 1420),
          storeName: p.storeName ?? (r.store_name ? String(r.store_name) : undefined),
        },
      };
    }
  }

  if (aggType === "SUPPORT_CASE" || aggType === "SUPPORT") {
    const caseRes = await client.query(
      `SELECT requester_id, case_number, status
       FROM public.support_cases
       WHERE id = $1
       LIMIT 1`,
      [event.aggregateId]
    );
    if ((caseRes.rowCount ?? 0) > 0) {
      const r = caseRes.rows[0] as Record<string, unknown>;
      return {
        recipientUserId: String(r.requester_id),
        enrichedPayload: {
          ...p,
          caseId: event.aggregateId,
          caseNumber: p.caseNumber ?? Number(r.case_number),
          status: p.status ?? String(r.status),
        },
      };
    }
  }

  return {
    recipientUserId: "00000000-0000-4000-8000-000000000001",
    enrichedPayload: p,
  };
}

/**
 * Polls and processes transactional `outbox_events` (`PENDING` and retryable `FAILED`) from
 * live Supabase PostgreSQL (`FOR UPDATE SKIP LOCKED`), renders bilingual versioned (`v1`)
 * templates (`en` / `pt-BR`), cleans revoked device push tokens, records honest channel statuses
 * in `public.notification_deliveries`, and transitions exhausted failures to `DEAD_LETTER` (M20).
 */
export async function processSupabaseOutboxBatch(params?: {
  pool?: pg.Pool;
  connectionString?: string;
  limit?: number;
  eventIdsFilter?: readonly string[];
  channels?: readonly NotificationChannel[];
  correlationId?: string;
  now?: Date;
  forceFailEventIds?: ReadonlySet<string>;
  webhookSigningSecret?: string;
}): Promise<SupabaseOutboxBatchResult> {
  const correlationId = params?.correlationId ?? `corr_worker_${Date.now()}`;
  const now = params?.now ?? new Date();
  const limit = params?.limit ?? 25;
  const ownsPool = !params?.pool;
  const connectionString = params?.connectionString ?? loadDatabaseUrlFromWorkspaceEnv();
  if (!params?.pool && !connectionString) {
    throw new Error("WORKER_DB_MISSING: DATABASE_URL is required to process Supabase outbox_events.");
  }

  const pool =
    params?.pool ??
    new pg.Pool({
      connectionString,
      max: 4,
      ssl: { rejectUnauthorized: false },
    });

  const processedEvents: OutboxEventContract[] = [];
  const deliveriesCreatedOrUpdated: NotificationDeliveryContract[] = [];
  let revokedDevicesCleanedCount = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const filterIds =
      params?.eventIdsFilter && params.eventIdsFilter.length > 0 ? params.eventIdsFilter : null;

    const claimQuery = filterIds
      ? `SELECT *
         FROM public.outbox_events
         WHERE id = ANY($3::uuid[])
           AND status IN ('PENDING', 'FAILED')
           AND next_attempt_at <= $1
         ORDER BY next_attempt_at ASC, created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`
      : `SELECT *
         FROM public.outbox_events
         WHERE status IN ('PENDING', 'FAILED')
           AND next_attempt_at <= $1
         ORDER BY next_attempt_at ASC, created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`;

    const claimArgs = filterIds
      ? [now.toISOString(), limit, filterIds]
      : [now.toISOString(), limit];

    const claimedRes = await client.query(claimQuery, claimArgs);
    const providerRes = await client.query(
      `SELECT provider_code, status, required_env_vars FROM public.provider_configurations`
    );
    const providerMap = new Map<
      string,
      { status: ProviderReadinessStatus; requiredEnvVars: string[] }
    >();
    for (const row of providerRes.rows as Array<Record<string, unknown>>) {
      providerMap.set(String(row.provider_code), {
        status: String(row.status) as ProviderReadinessStatus,
        requiredEnvVars: Array.isArray(row.required_env_vars)
          ? (row.required_env_vars as string[])
          : [],
      });
    }

    for (const rawRow of claimedRes.rows as Array<Record<string, unknown>>) {
      const event = mapRowToOutboxEvent(rawRow);
      const nextAttempts = event.attempts + 1;

      try {
        if (
          params?.forceFailEventIds?.has(event.id) ||
          event.payload.simulateWorkerFailure === true
        ) {
          throw new Error(
            String(
              event.payload.simulatedErrorMessage ??
                `Simulated transient outbox handler failure for event ${event.id}`
            )
          );
        }

        const { recipientUserId, enrichedPayload } = await resolveEventRecipientAndContext(
          client,
          event
        );

        // Fetch recipient profile locale & preferences sequentially on the transaction client
        const profileRes = await client.query(
          `SELECT preferred_locale FROM public.profiles WHERE id = $1 LIMIT 1`,
          [recipientUserId]
        );
        const prefRes = await client.query(
          `SELECT locale, push_order_updates, push_promotions, email_transactional, email_marketing
           FROM public.user_preferences
           WHERE user_id = $1
           LIMIT 1`,
          [recipientUserId]
        );
        const devicesRes = await client.query(
          `SELECT id, platform, push_token, push_consent_granted, is_revoked, revoked_at
           FROM public.user_devices
           WHERE user_id = $1
           ORDER BY updated_at DESC`,
          [recipientUserId]
        );

        const preferredLocale =
          (profileRes.rows[0] as { preferred_locale?: string } | undefined)?.preferred_locale ??
          (prefRes.rows[0] as { locale?: string } | undefined)?.locale ??
          "en";

        const prefRow = prefRes.rows[0] as Record<string, unknown> | undefined;
        const preferences = prefRow
          ? {
              pushOrderUpdates: Boolean(prefRow.push_order_updates ?? true),
              pushPromotions: Boolean(prefRow.push_promotions ?? false),
              emailTransactional: Boolean(prefRow.email_transactional ?? true),
              emailMarketing: Boolean(prefRow.email_marketing ?? false),
            }
          : null;

        // Immediately clear push_token on any revoked device in M03/M20
        for (const dev of devicesRes.rows as Array<Record<string, unknown>>) {
          const isRevoked = Boolean(dev.is_revoked) || Boolean(dev.revoked_at);
          if (isRevoked && dev.push_token !== null) {
            await client.query(
              `UPDATE public.user_devices
               SET push_token = NULL,
                   is_revoked = true,
                   revoked_at = COALESCE(revoked_at, $2)
               WHERE id = $1`,
              [dev.id, now.toISOString()]
            );
            revokedDevicesCleanedCount += 1;
          }
        }

        const primaryDeviceRow = (devicesRes.rows[0] ?? null) as Record<string, unknown> | null;
        const deviceInfo = primaryDeviceRow
          ? {
              isRevoked:
                Boolean(primaryDeviceRow.is_revoked) || Boolean(primaryDeviceRow.revoked_at),
              revokedAtIso: primaryDeviceRow.revoked_at
                ? new Date(String(primaryDeviceRow.revoked_at)).toISOString()
                : null,
              pushConsentGranted: Boolean(primaryDeviceRow.push_consent_granted),
              pushToken:
                Boolean(primaryDeviceRow.is_revoked) || Boolean(primaryDeviceRow.revoked_at)
                  ? null
                  : primaryDeviceRow.push_token
                    ? String(primaryDeviceRow.push_token)
                    : null,
            }
          : null;

        const renderedTemplate = renderVersionedNotificationTemplate({
          eventType: event.eventType,
          locale: preferredLocale,
          payload: enrichedPayload,
          version: 1,
        });

        const requestedChannels: NotificationChannel[] =
          params?.channels && params.channels.length > 0
            ? [...params.channels]
            : Array.isArray(enrichedPayload.channels)
              ? (enrichedPayload.channels as NotificationChannel[])
              : ["IN_APP", "EMAIL"];

        for (const channel of requestedChannels) {
          let providerCode: string | null = null;
          let providerStatus: ProviderReadinessStatus | null = null;
          let missingVars: string[] = [];

          if (channel === "EMAIL") {
            providerCode = "resend";
            const pInfo = providerMap.get("resend");
            providerStatus = pInfo?.status ?? "BLOCKED_MISSING_CREDENTIALS";
            missingVars = pInfo?.requiredEnvVars ?? ["RESEND_API_KEY", "RESEND_FROM_EMAIL"];
          } else if (channel === "PUSH" || channel === "PUSH_ANDROID") {
            providerCode = "fcm";
            const pInfo = providerMap.get("fcm");
            providerStatus = pInfo?.status ?? "BLOCKED_MISSING_CREDENTIALS";
            missingVars = pInfo?.requiredEnvVars ?? ["FCM_PROJECT_ID", "FCM_PRIVATE_KEY"];
          } else if (channel === "PUSH_IOS") {
            providerCode = "apns";
            const pInfo = providerMap.get("apns");
            providerStatus = pInfo?.status ?? "BLOCKED_MISSING_CREDENTIALS";
            missingVars = pInfo?.requiredEnvVars ?? ["APNS_KEY_ID", "APNS_PRIVATE_KEY"];
          } else if (channel === "WEBHOOK") {
            const secret =
              params?.webhookSigningSecret ?? process.env.OUTBOUND_WEBHOOK_SIGNING_SECRET;
            providerStatus =
              secret && secret.length >= 8 ? "SANDBOX_READY" : "BLOCKED_MISSING_CREDENTIALS";
            missingVars = ["OUTBOUND_WEBHOOK_SIGNING_SECRET"];
          }

          const eligibility = evaluateNotificationChannelEligibility({
            channel,
            category: renderedTemplate.category,
            preferences,
            device: deviceInfo,
            providerStatus,
          });

          let deliveryPayload: Record<string, unknown> = { ...enrichedPayload };
          if (channel === "WEBHOOK" && eligibility.eligible) {
            const secret =
              params?.webhookSigningSecret ??
              process.env.OUTBOUND_WEBHOOK_SIGNING_SECRET ??
              "whsec_default_sandbox";
            const signedEnvelope = signOutboundWebhookPayload({
              eventId: event.id,
              eventType: event.eventType,
              payload: enrichedPayload,
              secret,
              timestampSeconds: Math.floor(now.getTime() / 1000),
            });
            deliveryPayload = {
              ...enrichedPayload,
              webhookEnvelope: signedEnvelope,
            };
          }

          const lastError =
            eligibility.deliveryStatus === "BLOCKED_MISSING_CREDENTIALS"
              ? `PROVIDER_BLOCKED [${providerCode ?? channel.toLowerCase()}]: Missing ${missingVars.join(", ")}`
              : eligibility.deliveryStatus === "BLOCKED_DEVICE_REVOKED"
                ? "DEVICE_REVOKED_OR_TOKEN_CLEARED"
                : null;

          const idempotencyKey = `notif_${event.id}_${channel.toLowerCase()}_${recipientUserId}`;

          const delivRes = await client.query(
            `INSERT INTO public.notification_deliveries (
               id, outbox_event_id, recipient_user_id, channel,
               template_key, template_version, category, locale,
               title, body, payload, status, provider_code,
               idempotency_key, last_error, is_test_data
             ) VALUES (
               $1, $2, $3, $4,
               $5, $6, $7, $8,
               $9, $10, $11::jsonb, $12, $13,
               $14, $15, true
             )
             ON CONFLICT (outbox_event_id, channel, recipient_user_id)
             WHERE outbox_event_id IS NOT NULL
             DO UPDATE SET
               status = EXCLUDED.status,
               title = EXCLUDED.title,
               body = EXCLUDED.body,
               payload = EXCLUDED.payload,
               last_error = EXCLUDED.last_error
             RETURNING *`,
            [
              crypto.randomUUID(),
              event.id,
              recipientUserId,
              channel,
              renderedTemplate.templateKey,
              renderedTemplate.version,
              renderedTemplate.category,
              renderedTemplate.locale,
              renderedTemplate.title,
              renderedTemplate.body,
              JSON.stringify(deliveryPayload),
              eligibility.deliveryStatus,
              providerCode,
              idempotencyKey,
              lastError,
            ]
          );

          if ((delivRes.rowCount ?? 0) > 0) {
            deliveriesCreatedOrUpdated.push(
              mapRowToNotificationDelivery(delivRes.rows[0] as Record<string, unknown>)
            );
          }
        }

        const updatedEvtRes = await client.query(
          `UPDATE public.outbox_events
           SET status = 'COMPLETED',
               attempts = $2,
               processed_at = $3,
               last_error = NULL
           WHERE id = $1
           RETURNING *`,
          [event.id, nextAttempts, now.toISOString()]
        );
        processedEvents.push(
          mapRowToOutboxEvent(updatedEvtRes.rows[0] as Record<string, unknown>)
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown worker error";
        const nextStatus: OutboxEventStatus =
          nextAttempts >= event.maxAttempts ? "DEAD_LETTER" : "FAILED";
        const backoffMs = calculateOutboxBackoffMs(nextAttempts);
        const nextAttemptAtIso = new Date(now.getTime() + backoffMs).toISOString();

        createStructuredLogEntry({
          level: "ERROR",
          service: "@ideliveryfood/worker",
          correlationId,
          message: `Outbox event ${event.id} failed (${nextStatus}): ${errorMessage}`,
        });

        const failedEvtRes = await client.query(
          `UPDATE public.outbox_events
           SET status = $2,
               attempts = $3,
               next_attempt_at = $4,
               last_error = $5
           WHERE id = $1
           RETURNING *`,
          [event.id, nextStatus, nextAttempts, nextAttemptAtIso, errorMessage]
        );
        processedEvents.push(
          mapRowToOutboxEvent(failedEvtRes.rows[0] as Record<string, unknown>)
        );
      }
    }

    await client.query("COMMIT");
    return {
      processedEvents,
      deliveriesCreatedOrUpdated,
      revokedDevicesCleanedCount,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    if (ownsPool) {
      await pool.end();
    }
  }
}

export function getWorkerReadinessReport(env: Record<string, string | undefined> = process.env) {
  return {
    status: "READY" as const,
    service: "@ideliveryfood/worker",
    operationalTimezone: "America/Sao_Paulo" as const,
    providers: inspectProviderReadiness(env),
  };
}
