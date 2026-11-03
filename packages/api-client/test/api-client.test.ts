import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDeliveryApiClient, IDeliveryApiError } from "../src/index.js";

describe("@ideliveryfood/api-client — Typed /v1 Client, Correlation ID & Idempotency Tests", () => {
  it("propagates Accept-Language ('en' default, 'pt-BR' switchable) and X-Correlation-Id headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    const client = new IDeliveryApiClient({
      baseUrl: "http://localhost:4000/v1",
      fetchImpl: async (_url, init) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            data: [],
            meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });

    assert.equal(client.getLocale(), "en");
    await client.listPublishedStores();
    assert.equal(capturedHeaders["Accept-Language"], "en");
    assert.match(capturedHeaders["X-Correlation-Id"] ?? "", /^corr_/);

    await client.updateLocalePreference("pt-BR", "idem_pref_update_001");
    assert.equal(client.getLocale(), "pt-BR");
    assert.equal(capturedHeaders["Accept-Language"], "pt-BR");
    assert.equal(capturedHeaders["X-Idempotency-Key"], "idem_pref_update_001");
  });

  it("enforces X-Idempotency-Key on mutations and maps error envelopes to IDeliveryApiError", async () => {
    const client = new IDeliveryApiClient({
      baseUrl: "http://localhost:4000/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "AUTH_MFA_REQUIRED",
              message: "MFA aal2 step-up required",
              correlationId: "corr_err_01",
              timestamp: "2026-11-03T12:00:00Z",
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        ),
    });

    await assert.rejects(
      () => client.updateLocalePreference("pt-BR", "short"),
      /IDEMPOTENCY_KEY_REQUIRED/
    );

    await assert.rejects(
      () =>
        client.createOrderFromQuote({
          quoteId: "quote_123",
          idempotencyKey: "short",
        }),
      /IDEMPOTENCY_KEY_REQUIRED/
    );

    await assert.rejects(
      () => client.listPublishedStores(),
      (err: unknown) => {
        assert.ok(err instanceof IDeliveryApiError);
        assert.equal(err.status, 403);
        assert.equal(err.envelope.error.code, "AUTH_MFA_REQUIRED");
        return true;
      }
    );
  });
});
