import { createStructuredLogEntry, inspectProviderReadiness } from "@ideliveryfood/config";

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
  const safeAttempts = Math.max(1, attempts);
  return Math.min(baseMs * Math.pow(2, safeAttempts - 1), maxMs);
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

export function getWorkerReadinessReport(env: Record<string, string | undefined> = process.env) {
  return {
    status: "READY" as const,
    service: "@ideliveryfood/worker",
    operationalTimezone: "America/Sao_Paulo" as const,
    providers: inspectProviderReadiness(env),
  };
}
