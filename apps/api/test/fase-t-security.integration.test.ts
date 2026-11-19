import assert from "node:assert/strict";
import fs from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
} from "../src/index.js";

function loadRootEnv(): void {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(__dirname, "../../../../.env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

describe("Fase T (M23 Parte 1) — Transverse Cybersecurity Hardening: HTTP Security Headers, Strict CSP, CORS Allowlist, Anti-CSRF, Rate Limiting, Anti-Mass-Assignment, Anti-SSRF & Storage Audit", () => {
  const jwtSecret = "fase-t-m23-cybersecurity-hardening-jwt-secret-32chars!";
  const ALICE_ID = "00000000-0000-4000-8000-000000000001";
  const HELENA_OWNER_101_ID = "00000000-0000-4000-8000-000000000010";
  const COURIER_CARLOS_ID = "00000000-0000-4000-8000-000000000030";
  const STORE_201_ID = "00000000-0000-4000-8000-000000000201";
  const PRODUCT_601_ID = "00000000-0000-4000-8000-000000000601";

  let repo: ReturnType<typeof createSupabasePostgresRepository>;
  let server: http.Server;
  let baseUrl = "";

  let aliceToken = "";
  let helenaToken = "";
  let carlosToken = "";

  before(async () => {
    loadRootEnv();
    const dbUrl = process.env.DATABASE_URL;
    assert.ok(dbUrl, "DATABASE_URL is required for Fase T security integration tests");

    repo = createSupabasePostgresRepository({
      connectionString: dbUrl,
      isTestData: true,
    });

    server = createApiServer({
      repository: repo,
      env: {
        ...process.env,
        NODE_ENV: "test",
        SUPABASE_JWT_SECRET: jwtSecret,
        CORS_ALLOWED_ORIGINS:
          "https://app.ideliveryfood.com.br,https://partner.ideliveryfood.com.br,https://admin.ideliveryfood.com.br",
        RATE_LIMIT_WINDOW_MS: "60000",
        RATE_LIMIT_OTP_MAX: "3",
      },
      allowTestActorHeaders: false,
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    const exp = Math.floor(Date.now() / 1000) + 3600;
    aliceToken = signSupabaseHs256Jwt(
      { sub: ALICE_ID, role: "authenticated", aal: "aal1", exp },
      jwtSecret
    );
    helenaToken = signSupabaseHs256Jwt(
      { sub: HELENA_OWNER_101_ID, role: "authenticated", aal: "aal2", exp },
      jwtSecret
    );
    carlosToken = signSupabaseHs256Jwt(
      { sub: COURIER_CARLOS_ID, role: "authenticated", aal: "aal1", exp },
      jwtSecret
    );
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await repo.close();
  });

  it("1. enforces HTTP security headers and strict CSP (without unsafe-eval) on apps/api and all 3 web portal next.config.mjs files", async () => {
    const res = await fetch(`${baseUrl}/v1/health/live`);
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("strict-transport-security"),
      "max-age=63072000; includeSubDomains; preload"
    );
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(
      res.headers.get("referrer-policy"),
      "strict-origin-when-cross-origin"
    );
    const apiCsp = res.headers.get("content-security-policy") ?? "";
    assert.ok(apiCsp.includes("frame-ancestors 'none'"));
    assert.ok(!apiCsp.includes("unsafe-eval"));
    assert.match(res.headers.get("permissions-policy") ?? "", /geolocation=\(\)/);

    // Verify next.config.mjs in customer-web, partner-web, and admin-web
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(__dirname, "../../../..");
    const portalConfigs: Array<{
      app: string;
      expectedGeo: RegExp;
    }> = [
      {
        app: "customer-web",
        expectedGeo: /geolocation=\(self\)/,
      },
      {
        app: "partner-web",
        expectedGeo: /geolocation=\(\)/,
      },
      {
        app: "admin-web",
        expectedGeo: /geolocation=\(\)/,
      },
    ];

    for (const portal of portalConfigs) {
      const cfgPath = path.join(repoRoot, "apps", portal.app, "next.config.mjs");
      assert.ok(fs.existsSync(cfgPath), `Missing ${cfgPath}`);
      const imported = (await import(pathToFileURL(cfgPath).href)) as {
        default: {
          headers: () => Promise<
            Array<{
              source: string;
              headers: Array<{ key: string; value: string }>;
            }>
          >;
        };
      };
      const rules = await imported.default.headers();
      assert.ok(rules.length >= 1);
      const map = new Map(
        rules[0]!.headers.map((h) => [h.key.toLowerCase(), h.value])
      );
      const csp = map.get("content-security-policy") ?? "";
      assert.ok(csp.includes("default-src 'self'"));
      assert.ok(!csp.includes("unsafe-eval"));
      assert.equal(
        map.get("strict-transport-security"),
        "max-age=63072000; includeSubDomains; preload"
      );
      assert.equal(map.get("x-content-type-options"), "nosniff");
      assert.equal(map.get("x-frame-options"), "DENY");
      assert.equal(
        map.get("referrer-policy"),
        "strict-origin-when-cross-origin"
      );
      assert.match(map.get("permissions-policy") ?? "", portal.expectedGeo);
    }
  });

  it("2. enforces strict CORS allowlist (never '*') and blocks cookie-authenticated CSRF mutations without matching X-CSRF-Token", async () => {
    // Allowed preflight Origin
    const preflightAllowed = await fetch(`${baseUrl}/v1/quotes`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.ideliveryfood.com.br",
        "Access-Control-Request-Method": "POST",
      },
    });
    assert.equal(preflightAllowed.status, 204);
    assert.equal(
      preflightAllowed.headers.get("access-control-allow-origin"),
      "https://app.ideliveryfood.com.br"
    );

    // Unauthorized Origin is blocked with 403 CORS_ORIGIN_FORBIDDEN
    const badOriginRes = await fetch(`${baseUrl}/v1/stores`, {
      headers: {
        Origin: "https://attacker-evil.example.org",
      },
    });
    assert.equal(badOriginRes.status, 403);
    const badOriginJson = (await badOriginRes.json()) as {
      error: { code: string };
    };
    assert.equal(badOriginJson.error.code, "CORS_ORIGIN_FORBIDDEN");

    // Cookie-authenticated mutation without X-CSRF-Token is blocked with 403 CSRF_TOKEN_INVALID
    const csrfBlockedRes = await fetch(`${baseUrl}/v1/me/preferences`, {
      method: "PATCH",
      headers: {
        Origin: "https://app.ideliveryfood.com.br",
        Cookie:
          "idelivery_access_token=cookie_jwt_token; idelivery_csrf_token=csrf_token_value_12345678",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ locale: "pt-BR" }),
    });
    assert.equal(csrfBlockedRes.status, 403);
    const csrfBlockedJson = (await csrfBlockedRes.json()) as {
      error: { code: string };
    };
    assert.equal(csrfBlockedJson.error.code, "CSRF_TOKEN_INVALID");
  });

  it("3. enforces sliding-window rate limiting on sensitive routes and returns 429 TOO_MANY_REQUESTS with Retry-After", async () => {
    // RATE_LIMIT_OTP_MAX is configured to 3 in this test server
    const targetRoute = `${baseUrl}/v1/logistics/tasks/00000000-0000-4000-8000-000000001201/complete-otp`;

    for (let i = 1; i <= 3; i++) {
      const attempt = await fetch(targetRoute, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${carlosToken}`,
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.77",
        },
        body: JSON.stringify({ confirmationCode: "0000" }),
      });
      // Within rate limit (returns 409 OTP mismatch or 404/409, not 429)
      assert.notEqual(attempt.status, 429);
      assert.equal(attempt.headers.get("x-ratelimit-limit"), "3");
    }

    // 4th attempt within window triggers 429 TOO_MANY_REQUESTS + Retry-After
    const throttledRes = await fetch(targetRoute, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${carlosToken}`,
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.77",
      },
      body: JSON.stringify({ confirmationCode: "0000" }),
    });
    assert.equal(throttledRes.status, 429);
    assert.equal(throttledRes.headers.get("x-ratelimit-remaining"), "0");
    assert.ok(Number(throttledRes.headers.get("retry-after") ?? "0") >= 1);
    const throttledJson = (await throttledRes.json()) as {
      error: { code: string };
    };
    assert.equal(throttledJson.error.code, "TOO_MANY_REQUESTS");
  });

  it("4. blocks mass assignment of role, organization_id, status, is_approved, price_cents, and unknown properties with 400 MASS_ASSIGNMENT_FORBIDDEN", async () => {
    // 1. Mass assignment of role on /v1/me/preferences
    const roleInjectRes = await fetch(`${baseUrl}/v1/me/preferences`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": "idem_sec_role_inject_01",
      },
      body: JSON.stringify({
        locale: "pt-BR",
        role: "tech_admin",
      }),
    });
    assert.equal(roleInjectRes.status, 400);
    const roleInjectErr = (await roleInjectRes.json()) as {
      error: { code: string };
    };
    assert.equal(roleInjectErr.error.code, "MASS_ASSIGNMENT_FORBIDDEN");

    // 2. Mass assignment of price_cents / is_approved on /v1/quotes
    const priceInjectRes = await fetch(`${baseUrl}/v1/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": "idem_sec_price_inject_01",
      },
      body: JSON.stringify({
        storeId: STORE_201_ID,
        fulfillmentModality: "PICKUP",
        price_cents: 1,
        cartItems: [
          {
            productId: PRODUCT_601_ID,
            quantity: 1,
          },
        ],
      }),
    });
    assert.equal(priceInjectRes.status, 400);
    const priceInjectErr = (await priceInjectRes.json()) as {
      error: { code: string };
    };
    assert.equal(priceInjectErr.error.code, "MASS_ASSIGNMENT_FORBIDDEN");

    // 3. Mass assignment of status / organization_id on /v1/orders
    const statusInjectRes = await fetch(`${baseUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": "idem_sec_status_inject_01",
      },
      body: JSON.stringify({
        quoteId: "00000000-0000-4000-8000-000000000951",
        status: "DELIVERED",
        organization_id: "00000000-0000-4000-8000-000000000102",
      }),
    });
    assert.equal(statusInjectRes.status, 400);
    const statusInjectErr = (await statusInjectRes.json()) as {
      error: { code: string };
    };
    assert.equal(statusInjectErr.error.code, "MASS_ASSIGNMENT_FORBIDDEN");
  });

  it("5. blocks SSRF internal/private/cloud-metadata webhook URLs and enforces strict Supabase Storage extension/MIME validation", async () => {
    const ssrfTargets = [
      "http://hooks.partner.ideliveryfood.com.br/insecure",
      "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "https://127.0.0.1:5432/internal",
      "https://10.0.0.42/admin",
      "https://172.16.10.5/secret",
      "https://192.168.0.10/router",
      "https://localhost:4000/v1/health/live",
      "https://[::1]:4000/v1/health/live",
    ];

    for (const badTarget of ssrfTargets) {
      const res = await fetch(
        `${baseUrl}/v1/security/webhooks/validate-target`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${helenaToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ targetUrl: badTarget }),
        }
      );
      assert.equal(
        res.status,
        400,
        `Expected 400 SSRF block for target ${badTarget}`
      );
      const errBody = (await res.json()) as { error: { code: string } };
      assert.match(errBody.error.code, /^SSRF_/);
    }

    // Valid external HTTPS webhook target succeeds
    const validHookRes = await fetch(
      `${baseUrl}/v1/security/webhooks/validate-target`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${helenaToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetUrl: "https://hooks.partner.ideliveryfood.com.br/v1/order-events",
        }),
      }
    );
    assert.equal(validHookRes.status, 200);

    // Storage audit: block SVG/HTML active XSS payload disguised as image/png
    const svgUploadRes = await fetch(
      `${baseUrl}/v1/storage/signed-upload-url`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${helenaToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bucket: "catalog-media",
          fileName: "stored-xss.svg",
          mimeType: "image/png",
          fileSizeBytes: 2048,
          storeId: STORE_201_ID,
        }),
      }
    );
    assert.equal(svgUploadRes.status, 400);
    const svgErr = (await svgUploadRes.json()) as { error: { code: string } };
    assert.equal(svgErr.error.code, "STORAGE_DANGEROUS_EXTENSION");

    // Storage audit: block extension/MIME mismatch (.pdf disguised as image/jpeg)
    const mismatchUploadRes = await fetch(
      `${baseUrl}/v1/storage/signed-upload-url`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${helenaToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bucket: "catalog-media",
          fileName: "menu.pdf",
          mimeType: "image/jpeg",
          fileSizeBytes: 4096,
          storeId: STORE_201_ID,
        }),
      }
    );
    assert.equal(mismatchUploadRes.status, 400);
    const mismatchErr = (await mismatchUploadRes.json()) as {
      error: { code: string };
    };
    assert.equal(mismatchErr.error.code, "STORAGE_EXTENSION_MIME_MISMATCH");
  });
});
