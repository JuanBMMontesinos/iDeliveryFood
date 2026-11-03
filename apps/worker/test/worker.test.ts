import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateRetryBackoffMs,
  getWorkerReadinessReport,
  processOutboxBatch,
  type OutboxEventRecord,
} from "../src/index.js";

describe("@ideliveryfood/worker — Outbox Processor, Exponential Backoff & Dead-Letter Tests", () => {
  it("calculates exponential backoff bounded by maxMs", () => {
    assert.equal(calculateRetryBackoffMs(1, 1000, 30000), 1000);
    assert.equal(calculateRetryBackoffMs(2, 1000, 30000), 2000);
    assert.equal(calculateRetryBackoffMs(3, 1000, 30000), 4000);
    assert.equal(calculateRetryBackoffMs(10, 1000, 30000), 30000);
  });

  it("transitions events to COMPLETED on success and DEAD_LETTER when maxAttempts is reached", async () => {
    const batch: OutboxEventRecord[] = [
      {
        id: "evt_1",
        aggregateType: "ORDER",
        aggregateId: "00000000-0000-4000-8000-000000001001",
        eventType: "ORDER_CREATED",
        payload: {},
        status: "PENDING",
        attempts: 0,
        maxAttempts: 3,
      },
      {
        id: "evt_2",
        aggregateType: "NOTIFICATION",
        aggregateId: "00000000-0000-4000-8000-000000001001",
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
});
