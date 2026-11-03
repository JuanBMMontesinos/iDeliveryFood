import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

describe("Operational Safety Scripts (db-reset-local, bootstrap-first-admin, secret-scan)", () => {
  const repoRoot = path.resolve(process.cwd(), "../..");

  it("blocks remote database hosts and production environments in db-reset-local.mjs", async () => {
    const dbResetMod = (await import(
      `file://${path.join(repoRoot, "scripts/db-reset-local.mjs").replace(/\\/g, "/")}`
    )) as {
      validateLocalDatabaseTarget: (env: Record<string, string | undefined>) => {
        allowed: boolean;
        reason: string;
      };
    };

    const allowedLocal = dbResetMod.validateLocalDatabaseTarget({
      APP_ENV: "development",
      SUPABASE_URL: "http://127.0.0.1:54321",
    });
    assert.equal(allowedLocal.allowed, true);

    const blockedRemote = dbResetMod.validateLocalDatabaseTarget({
      APP_ENV: "development",
      SUPABASE_URL: "https://dwsoochnfxldfvcaijie.supabase.co",
    });
    assert.equal(blockedRemote.allowed, false);
    assert.match(blockedRemote.reason, /Remote host 'dwsoochnfxldfvcaijie\.supabase\.co' detected/);

    const blockedProd = dbResetMod.validateLocalDatabaseTarget({
      APP_ENV: "production",
      SUPABASE_URL: "http://localhost:54321",
    });
    assert.equal(blockedProd.allowed, false);
  });

  it("enforces local-only guard and justification length in bootstrap-first-admin.mjs", async () => {
    const bootstrapMod = (await import(
      `file://${path.join(repoRoot, "scripts/bootstrap-first-admin.mjs").replace(/\\/g, "/")}`
    )) as {
      buildFirstAdminBootstrapPlan: (input: {
        appEnv?: string;
        userId?: string;
        justification?: string;
      }) => { role: string; requiresMfa: boolean };
    };

    const validPlan = bootstrapMod.buildFirstAdminBootstrapPlan({
      appEnv: "development",
      userId: "00000000-0000-4000-8000-000000000099",
      justification: "Initial local governance setup",
    });
    assert.equal(validPlan.role, "tech_admin");
    assert.equal(validPlan.requiresMfa, true);

    assert.throws(
      () =>
        bootstrapMod.buildFirstAdminBootstrapPlan({
          appEnv: "production",
          userId: "00000000-0000-4000-8000-000000000099",
          justification: "Initial local governance setup",
        }),
      /SECURITY_BLOCK/
    );
  });

  it("verifies repository has 0 secret leaks or committed .env files", async () => {
    const scanMod = (await import(
      `file://${path.join(repoRoot, "scripts/secret-scan.mjs").replace(/\\/g, "/")}`
    )) as {
      scanDirectoryForSecrets: (dirPath: string) => Array<{ file: string; rule: string }>;
    };

    const findings = scanMod.scanDirectoryForSecrets(repoRoot);
    assert.deepEqual(findings, []);
  });
});
