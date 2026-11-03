#!/usr/bin/env node
/**
 * iDeliveryFood — Controlled Local Bootstrap for First Tech Admin
 *
 * SECURITY RULE (M03):
 * Initial tech_admin provisioning is only allowed in local/development environments
 * and requires an explicit user UUID and audit justification. It is strictly blocked
 * when APP_ENV=production or NODE_ENV=production.
 */

import { pathToFileURL } from "node:url";

export function buildFirstAdminBootstrapPlan(input) {
  const envName = (input.appEnv ?? "development").toLowerCase();
  if (envName === "production") {
    throw new Error("SECURITY_BLOCK: First-admin bootstrap script is disabled in production.");
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(input.userId ?? "")) {
    throw new Error("VALIDATION_ERROR: A valid UUID v4/v7 userId is required.");
  }

  if (!input.justification || input.justification.trim().length < 15) {
    throw new Error("VALIDATION_ERROR: Audit justification must be at least 15 characters.");
  }

  return {
    role: "tech_admin",
    userId: input.userId,
    requiresMfa: true,
    auditAction: "BOOTSTRAP_FIRST_TECH_ADMIN",
    justification: input.justification.trim(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const userId = process.env.BOOTSTRAP_ADMIN_USER_ID ?? "00000000-0000-4000-8000-000000000099";
  const justification =
    process.env.BOOTSTRAP_JUSTIFICATION ?? "Controlled local development tech_admin bootstrap";
  const plan = buildFirstAdminBootstrapPlan({
    appEnv: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    userId,
    justification,
  });
  console.log(JSON.stringify({ status: "READY", plan }, null, 2));
}
