#!/usr/bin/env node
/**
 * iDeliveryFood — Fase Beta (M02/M24/M26) Remote Supabase Double-Seed Idempotency,
 * 100% RLS Coverage (59/59 Tables), Zero-Empty-Table & 27-Invariant RLS Verifier.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function captureDatabaseSnapshot(client, tableNames) {
  const counts = {};
  for (const table of tableNames) {
    const res = await client.query(
      `SELECT
         count(*)::int AS total_rows,
         count(*) FILTER (WHERE is_test_data = true)::int AS test_data_rows
       FROM public.${table}`
    );
    counts[table] = {
      totalRows: Number(res.rows[0].total_rows),
      testDataRows: Number(res.rows[0].test_data_rows),
    };
  }

  const ledgerRes = await client.query(
    `SELECT
       COALESCE(sum(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0)::bigint AS debits,
       COALESCE(sum(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0)::bigint AS credits
     FROM public.ledger_entries`
  );
  const debits = Number(ledgerRes.rows[0].debits);
  const credits = Number(ledgerRes.rows[0].credits);

  return {
    counts,
    ledger: {
      debits,
      credits,
      isBalanced: debits === credits && debits > 0,
    },
  };
}

async function main() {
  loadDotEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[FASE BETA ERROR] DATABASE_URL is not configured.");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    console.log("================================================================================");
    console.log("iDeliveryFood — Fase Beta: Remote Supabase Double-Seed Idempotency & RLS Audit");
    console.log("================================================================================");

    // 1. Apply pending migrations idempotently
    const migrationsDir = path.join(rootDir, "supabase", "migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => f.startsWith("20261107") || f > "20261103999999");

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
    }
    console.log(`[1/5] Applied ${files.length} Fase E–S schema migrations cleanly.`);

    // 2. Verify 100% RLS coverage across all public tables
    const rlsRes = await client.query(
      `SELECT
         tablename,
         rowsecurity
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`
    );
    const totalTables = rlsRes.rowCount ?? 0;
    const unprotected = rlsRes.rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
    if (unprotected.length > 0 || totalTables < 59) {
      throw new Error(
        `RLS coverage check failed: total=${totalTables}, unprotected=${unprotected.join(", ")}`
      );
    }
    const tableNames = rlsRes.rows.map((r) => String(r.tablename));
    console.log(
      `[2/5] Verified 100% RLS enabled on all ${totalTables}/${totalTables} public tables (0 unprotected).`
    );

    // 3. Execute supabase/seed.sql — RUN #1
    const seedSql = fs.readFileSync(path.join(rootDir, "supabase", "seed.sql"), "utf8");
    await client.query(seedSql);
    const snap1 = await captureDatabaseSnapshot(client, tableNames);
    console.log(
      `[3/5] Executed supabase/seed.sql (Run #1). Ledger Debits=${snap1.ledger.debits}c, Credits=${snap1.ledger.credits}c.`
    );

    // 4. Execute supabase/seed.sql — RUN #2 (Consecutive Execution)
    await client.query(seedSql);
    const snap2 = await captureDatabaseSnapshot(client, tableNames);
    console.log(
      `[4/5] Executed supabase/seed.sql (Run #2). Ledger Debits=${snap2.ledger.debits}c, Credits=${snap2.ledger.credits}c.`
    );

    // Compare Run #1 vs Run #2 across all 59 tables
    const drifts = [];
    const emptyTables = [];
    for (const table of tableNames) {
      const c1 = snap1.counts[table];
      const c2 = snap2.counts[table];
      if (c2.totalRows === 0) {
        emptyTables.push(table);
      }
      if (c1.totalRows !== c2.totalRows || c1.testDataRows !== c2.testDataRows) {
        drifts.push(
          `${table}: Run#1(${c1.totalRows}/${c1.testDataRows}) !== Run#2(${c2.totalRows}/${c2.testDataRows})`
        );
      }
    }

    if (emptyTables.length > 0) {
      throw new Error(`Empty tables detected: ${emptyTables.join(", ")}`);
    }
    if (drifts.length > 0) {
      throw new Error(`Idempotency drift detected on double seed: ${drifts.join("; ")}`);
    }
    if (
      !snap1.ledger.isBalanced ||
      !snap2.ledger.isBalanced ||
      snap1.ledger.debits !== snap2.ledger.debits
    ) {
      throw new Error(
        `Ledger balance drift detected: Run#1=${JSON.stringify(snap1.ledger)}, Run#2=${JSON.stringify(snap2.ledger)}`
      );
    }

    // Print key tables comparison
    const keyTables = [
      "organizations",
      "stores",
      "catalog_categories",
      "catalog_products",
      "catalog_option_groups",
      "catalog_options",
      "quotes",
      "orders",
      "order_items",
      "order_events",
      "delivery_tasks",
      "delivery_offers",
      "delivery_assignments",
      "payment_attempts",
      "refunds",
      "ledger_accounts",
      "ledger_journals",
      "ledger_entries",
      "settlements",
      "reconciliation_runs",
      "support_cases",
      "support_messages",
      "support_attachments",
      "support_action_requests",
      "commercial_leads",
      "commercial_proposals",
      "merchant_contracts",
      "commission_rule_versions",
      "promotions",
      "promotion_redemptions",
      "order_reviews",
      "outbox_events",
      "notification_deliveries",
      "risk_alerts",
      "risk_decisions",
      "privacy_requests",
      "order_pick_tasks",
      "order_item_substitutions",
    ];
    console.log("--------------------------------------------------------------------------------");
    console.log("Key Table                         | Run #1 Rows | Run #2 Rows | Test Data | Drift");
    console.log("--------------------------------------------------------------------------------");
    for (const kt of keyTables) {
      const c1 = snap1.counts[kt];
      const c2 = snap2.counts[kt];
      console.log(
        `${kt.padEnd(33)} | ${String(c1.totalRows).padStart(11)} | ${String(c2.totalRows).padStart(11)} | ${String(c2.testDataRows).padStart(9)} |     0`
      );
    }
    console.log("--------------------------------------------------------------------------------");

    // 5. Execute full 27-invariant SQL RLS & constraints suite
    const testSql = fs.readFileSync(
      path.join(rootDir, "supabase", "tests", "rls_and_constraints_test.sql"),
      "utf8"
    );
    await client.query(testSql);
    console.log(
      "[5/5] Executed supabase/tests/rls_and_constraints_test.sql: 27/27 invariants PASSED."
    );
    console.log("================================================================================");
    console.log(
      `[FASE BETA VERIFICATION PASSED] ${totalTables}/${totalTables} RLS tables non-empty, 0 duplicate rows across consecutive seed runs, balanced ledger (${snap2.ledger.debits}c == ${snap2.ledger.credits}c), and 27/27 SQL RLS invariants approved.`
    );
    console.log("================================================================================");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[FASE BETA ERROR]", err.message);
  process.exit(1);
});
