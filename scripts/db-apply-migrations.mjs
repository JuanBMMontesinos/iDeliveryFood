#!/usr/bin/env node
/**
 * iDeliveryFood — Database Migration, Seed & RLS Test Runner (scripts/db-apply-migrations.mjs)
 *
 * Applies pending migrations, optionally runs idempotent seed.sql, and executes SQL RLS tests
 * against the configured PostgreSQL database (DATABASE_URL from .env or environment).
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

async function main() {
  loadDotEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[ERROR] DATABASE_URL is not set in environment or .env");
    process.exit(1);
  }

  const args = new Set(process.argv.slice(2));
  const runSeed = args.has("--seed");
  const runTests = args.has("--test");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const migrationsDir = path.join(rootDir, "supabase", "migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    // Only apply the latest Fase E+ migrations or all if requested with --all
    const targetFiles = args.has("--all")
      ? files
      : files.filter((f) => f.startsWith("20261107") || f > "20261103999999");

    for (const file of targetFiles) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      await client.query(sql);
      console.log(`[MIGRATION OK] ${file}`);
    }

    if (runSeed) {
      const seedPath = path.join(rootDir, "supabase", "seed.sql");
      const seedSql = fs.readFileSync(seedPath, "utf8");
      await client.query(seedSql);
      console.log("[SEED OK] supabase/seed.sql executed idempotently.");
    }

    if (runTests) {
      const testPath = path.join(rootDir, "supabase", "tests", "rls_and_constraints_test.sql");
      const testSql = fs.readFileSync(testPath, "utf8");
      await client.query(testSql);
      console.log("[RLS TEST OK] supabase/tests/rls_and_constraints_test.sql passed.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[DB RUNNER ERROR]", err.message);
  process.exit(1);
});
