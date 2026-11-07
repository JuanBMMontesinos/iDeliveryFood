import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer, createSupabasePostgresRepository } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnvIfPresent(): void {
  const candidates = [
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../../../../.env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
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
    break;
  }
}

async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "API_STARTUP_ERROR: DATABASE_URL is required to start @ideliveryfood/api connected to Supabase PostgreSQL."
    );
  }

  const port = Number.parseInt(process.env.API_PORT ?? "4000", 10);
  const repository = createSupabasePostgresRepository({
    connectionString: databaseUrl,
  });

  // Verify live Supabase PostgreSQL connection before accepting HTTP traffic
  await repository.pool.query("SELECT 1");

  const server = createApiServer({
    repository,
    env: process.env,
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(
      JSON.stringify({
        level: "INFO",
        service: "@ideliveryfood/api",
        message: `iDeliveryFood API listening on http://localhost:${port}/v1 (connected to Supabase PostgreSQL)`,
        timestamp: new Date().toISOString(),
      })
    );
  });
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: "ERROR",
      service: "@ideliveryfood/api",
      message: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    })
  );
  process.exit(1);
});
