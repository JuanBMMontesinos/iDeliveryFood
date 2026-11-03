#!/usr/bin/env node
/**
 * iDeliveryFood — Repository Secret & Public Bundle Leakage Scanner
 *
 * Verifies:
 * 1. Zero committed .env files (only .env.example is permitted).
 * 2. Zero private keys, service_role JWTs, or live PSP secrets in source files.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_DIR = process.cwd();
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".next", "build", "coverage"]);

const FORBIDDEN_PATTERNS = [
  { name: "PEM Private Key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Stripe Secret Key", regex: /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}\b/ },
  { name: "Supabase Service Role Token", regex: /\bsbp_[0-9a-f]{32,}\b/ },
  { name: "Hardcoded JWT Token", regex: /\beyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\b/ },
];

export function scanDirectoryForSecrets(dirPath = ROOT_DIR) {
  const findings = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative( dirPath, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
        findings.push({
          file: relPath,
          rule: "Forbidden .env file",
          detail: "Only .env.example templates may exist in the repository.",
        });
        continue;
      }

      if (entry.name.endsWith(".pdf") || entry.name.endsWith(".png") || entry.name.endsWith(".jpg")) {
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.regex.test(content)) {
          findings.push({
            file: relPath,
            rule: pattern.name,
            detail: `Matched forbidden secret pattern: ${pattern.name}`,
          });
        }
      }
    }
  }

  walk(dirPath);
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanDirectoryForSecrets(ROOT_DIR);
  if (findings.length > 0) {
    console.error("[SECRET SCAN FAILED] Found potential secret leakage:");
    for (const f of findings) {
      console.error(` - ${f.file}: ${f.rule} (${f.detail})`);
    }
    process.exit(1);
  }
  console.log("[SECRET SCAN PASSED] 0 forbidden secrets or .env files detected.");
}
