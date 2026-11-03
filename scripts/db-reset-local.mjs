#!/usr/bin/env node
/**
 * iDeliveryFood — Safe Local Database Reset Guard (scripts/db-reset-local.mjs)
 *
 * SECURITY RULE (M01 / M02):
 * Destructive reset commands are strictly restricted to local loopback instances
 * (localhost / 127.0.0.1). Attempting to run against any remote host (*.supabase.co,
 * staging, or production) immediately aborts with exit code 1.
 */

import { pathToFileURL } from "node:url";

const ALLOWED_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function validateLocalDatabaseTarget(env = process.env) {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? "development").toLowerCase();
  if (appEnv === "production" || appEnv === "staging") {
    return {
      allowed: false,
      reason: `Refusing database reset in environment '${appEnv}'. Only local development is permitted.`,
    };
  }

  const candidateUrls = [
    env.SUPABASE_DB_URL,
    env.DATABASE_URL,
    env.SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_URL,
  ].filter((val) => typeof val === "string" && val.trim().length > 0);

  if (candidateUrls.length === 0) {
    return {
      allowed: true,
      host: "127.0.0.1",
      reason: "Defaulting to local Supabase CLI loopback (127.0.0.1).",
    };
  }

  for (const rawUrl of candidateUrls) {
    try {
      const parsed = new URL(rawUrl);
      if (!ALLOWED_LOCAL_HOSTS.has(parsed.hostname)) {
        return {
          allowed: false,
          host: parsed.hostname,
          reason: `Remote host '${parsed.hostname}' detected in target URL. Destructive reset is blocked outside localhost/127.0.0.1.`,
        };
      }
    } catch {
      return {
        allowed: false,
        reason: `Malformed database URL '${rawUrl}'. Aborting for safety.`,
      };
    }
  }

  return {
    allowed: true,
    host: "localhost",
    reason: "Verified local loopback target.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = validateLocalDatabaseTarget(process.env);
  if (!check.allowed) {
    console.error(`[SECURITY BLOCK] ${check.reason}`);
    process.exit(1);
  }
  console.log(`[OK] ${check.reason}`);
}
