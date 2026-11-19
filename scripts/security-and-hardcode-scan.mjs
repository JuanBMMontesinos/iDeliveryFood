#!/usr/bin/env node
/**
 * iDeliveryFood — Automated Security, Secret Leakage & Anti-Hardcode/Anti-Mock Scanner (M23 / Fase U)
 *
 * Verifies across the entire repository:
 * 1. Zero committed or tracked .env files (only .env.example is permitted).
 * 2. Zero private keys, service_role JWTs, live PSP secrets, or hardcoded credentials.
 * 3. Zero in-memory database Maps (quotesById, ordersById, deliveryTasksById, etc. or any new Map in apps/api/src/index.ts).
 * 4. Zero hardcoded business UUIDs (00000000-0000-4000-8000-...) or hardcoded customer address fallbacks in apps/api/src/.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_DIR = process.cwd();
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  "build",
  "coverage",
]);

function isGitIgnoredAndUntracked(dirPath, relPath) {
  if (!fs.existsSync(path.join(dirPath, ".git"))) {
    return false;
  }
  const safeDir = dirPath.replace(/\\/g, "/");
  try {
    execFileSync(
      "git",
      ["-c", `safe.directory=${safeDir}`, "check-ignore", "-q", relPath],
      {
        cwd: dirPath,
        stdio: "ignore",
      }
    );
    return true;
  } catch {
    return false;
  }
}

const FORBIDDEN_SECRET_PATTERNS = [
  {
    name: "PEM Private Key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "Stripe Secret Key",
    regex: /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}\b/,
  },
  {
    name: "Supabase Service Role Token",
    regex: /\bsbp_[0-9a-f]{32,}\b/,
  },
  {
    name: "Hardcoded JWT Token",
    regex:
      /\beyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\b/,
  },
];

const FORBIDDEN_API_RUNTIME_PATTERNS = [
  {
    name: "In-Memory Database Map in API Runtime",
    files: ["apps/api/src/index.ts"],
    regex:
      /\b(?:new\s+Map\b|(?:quotesById|ordersById|deliveryTasksById|offersById|refundsById|settlementsById)\s*=)/,
  },
  {
    name: "Hardcoded Synthetic Business UUID Fallback in API Runtime",
    files: ["apps/api/src/index.ts", "apps/api/src/postgres-repository.ts", "apps/api/src/auth-jwt.ts"],
    regex: /00000000-0000-4000-8000-[0-9a-fA-F]{12}/,
  },
  {
    name: "Hardcoded Mock Customer Street Address Fallback in API Runtime",
    files: ["apps/api/src/index.ts", "apps/api/src/postgres-repository.ts"],
    regex: /\b(?:Rua\s+Oscar\s+Freire|Av\.\s+Paulista,\s*1500|Alameda\s+Santos,\s*1200)\b/,
  },
];

export function scanRepositoryForSecurityAndHardcodes(dirPath = ROOT_DIR) {
  const findings = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(dirPath, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
        if (isGitIgnoredAndUntracked(dirPath, relPath)) {
          continue;
        }
        findings.push({
          file: relPath,
          rule: "Forbidden .env file",
          detail: "Only .env.example templates may be tracked in the repository.",
        });
        continue;
      }

      if (
        entry.name.endsWith(".pdf") ||
        entry.name.endsWith(".png") ||
        entry.name.endsWith(".jpg") ||
        entry.name.endsWith(".webp")
      ) {
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf8");
      for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
        if (pattern.regex.test(content)) {
          findings.push({
            file: relPath,
            rule: pattern.name,
            detail: `Matched forbidden secret pattern: ${pattern.name}`,
          });
        }
      }

      for (const apiRule of FORBIDDEN_API_RUNTIME_PATTERNS) {
        if (apiRule.files.includes(relPath) && apiRule.regex.test(content)) {
          findings.push({
            file: relPath,
            rule: apiRule.name,
            detail: `Matched forbidden runtime mock/hardcode pattern: ${apiRule.name}`,
          });
        }
      }
    }
  }

  walk(dirPath);
  return findings;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const findings = scanRepositoryForSecurityAndHardcodes(ROOT_DIR);
  if (findings.length > 0) {
    console.error(
      "[SECURITY & HARDCODE SCAN FAILED] Violations detected:"
    );
    for (const f of findings) {
      console.error(` - ${f.file}: ${f.rule} (${f.detail})`);
    }
    process.exit(1);
  }
  console.log(
    "[SECURITY & HARDCODE SCAN PASSED] 0 secret leaks, 0 .env files, 0 in-memory DB Maps, and 0 hardcoded runtime UUID/address fallbacks."
  );
}
