#!/usr/bin/env node
/**
 * scripts/unit-coverage-verify.mjs
 * Fase V (M24 Parte 1): Executes the complete unit test suite with Node.js native test coverage
 * (--experimental-test-coverage) across all packages and apps and enforces >= 80% line, branch,
 * and function coverage thresholds.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const MIN_COVERAGE_THRESHOLD = 80.0;

const PACKAGE_TEST_SUITES = [
  "packages/domain/dist/test/domain.test.js",
  "packages/authz/dist/test/authz.test.js",
  "packages/i18n/dist/test/i18n.test.js",
  "packages/observability/dist/test/observability.test.js",
  "packages/config/dist/test/config.test.js",
  "packages/config/dist/test/scripts-guard.test.js",
  "packages/contracts/dist/test/contracts.test.js",
  "packages/contracts/dist/test/customer-android-fase-j.test.js",
  "packages/contracts/dist/test/customer-ios-fase-k.test.js",
  "packages/contracts/dist/test/courier-android-fase-l.test.js",
  "packages/contracts/dist/test/courier-ios-fase-m.test.js",
  "packages/contracts/dist/test/mobile-i18n-parity.test.js",
  "packages/ui-web/dist/test/ui-web.test.js",
  "packages/api-client/dist/test/api-client.test.js",
];

const APP_TEST_SUITES = [
  "apps/customer-web/dist/test/customer-web.test.js",
  "apps/partner-web/dist/test/partner-web.test.js",
  "apps/admin-web/dist/test/admin-web.test.js",
  "apps/worker/dist/test/worker.test.js",
];

const NATIVE_MOBILE_TEST_FILES = [
  "apps/customer-android/src/test/kotlin/com/ideliveryfood/customer/marketplace/CustomerMarketplaceControllerTest.kt",
  "apps/customer-android/src/test/kotlin/com/ideliveryfood/customer/network/CustomerApiClientTest.kt",
  "apps/customer-android/src/test/kotlin/com/ideliveryfood/customer/security/SecureSessionStoreTest.kt",
  "apps/customer-android/src/test/kotlin/com/ideliveryfood/customer/ui/CustomerComposeScreensTest.kt",
  "apps/courier-android/src/test/kotlin/com/ideliveryfood/courier/dispatch/CourierDispatchControllerTest.kt",
  "apps/courier-android/src/test/kotlin/com/ideliveryfood/courier/network/CourierApiClientTest.kt",
  "apps/courier-android/src/test/kotlin/com/ideliveryfood/courier/security/CourierSessionManagerTest.kt",
  "apps/courier-android/src/test/kotlin/com/ideliveryfood/courier/ui/CourierComposeScreensTest.kt",
  "apps/customer-ios/Tests/CustomerAppTests/CustomerMarketplaceControllerTests.swift",
  "apps/customer-ios/Tests/CustomerAppTests/CustomerApiClientTests.swift",
  "apps/customer-ios/Tests/CustomerAppTests/KeychainSessionVaultTests.swift",
  "apps/customer-ios/Tests/CustomerAppTests/CustomerSwiftUIViewsTests.swift",
  "apps/courier-ios/Tests/CourierAppTests/CourierDispatchControllerTests.swift",
  "apps/courier-ios/Tests/CourierAppTests/CourierApiClientTests.swift",
  "apps/courier-ios/Tests/CourierAppTests/CourierKeychainManagerTests.swift",
  "apps/courier-ios/Tests/CourierAppTests/CourierSwiftUIViewsTests.swift",
];

export function parseNodeTestCoverageTable(outputText) {
  const lines = outputText.split(/\r?\n/);
  const packageMetrics = [];
  let allFilesMetric = null;

  const ignoredHeaders = new Set(["file", "packages", "dist", "src", "scripts"]);
  let currentPackage = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/^ℹ\s?/, "");
    const pkgHeaderMatch = line.match(/^\s*([a-z0-9-]+)\s*\|\s*\|\s*\|\s*\|/i);
    if (pkgHeaderMatch) {
      const candidate = pkgHeaderMatch[1].trim();
      if (!ignoredHeaders.has(candidate.toLowerCase())) {
        currentPackage = candidate;
      }
    }

    const rowMatch = line.match(
      /^\s*([a-zA-Z0-9_.-]+|all files)\s*\|\s*(\d+\.\d+)\s*\|\s*(\d+\.\d+)\s*\|\s*(\d+\.\d+)\s*\|/
    );
    if (rowMatch) {
      const label = rowMatch[1].trim();
      const linePct = Number.parseFloat(rowMatch[2]);
      const branchPct = Number.parseFloat(rowMatch[3]);
      const funcsPct = Number.parseFloat(rowMatch[4]);

      if (label === "all files") {
        allFilesMetric = { label: "all files", linePct, branchPct, funcsPct };
      } else if (label === "index.js" && currentPackage) {
        packageMetrics.push({
          packageName: currentPackage,
          linePct,
          branchPct,
          funcsPct,
        });
      }
    }
  }

  return { packageMetrics, allFilesMetric };
}

function main() {
  console.log("[M24 COVERAGE] Verifying native mobile unit test suites (16 files across Android & iOS)...");
  for (const relFile of NATIVE_MOBILE_TEST_FILES) {
    const absPath = path.join(REPO_ROOT, relFile);
    if (!fs.existsSync(absPath)) {
      console.error(`[M24 COVERAGE FAILED] Missing native mobile unit test file: ${relFile}`);
      process.exit(1);
    }
  }

  console.log("[M24 COVERAGE] Executing packages unit test suites with --experimental-test-coverage...");
  const pkgFiles = PACKAGE_TEST_SUITES.map((f) => path.join(REPO_ROOT, f));
  for (const f of pkgFiles) {
    if (!fs.existsSync(f)) {
      console.error(`[M24 COVERAGE FAILED] Compiled test file not found: ${f}. Run 'pnpm build' first.`);
      process.exit(1);
    }
  }

  const pkgRun = spawnSync(
    process.execPath,
    ["--test", "--experimental-test-coverage", ...pkgFiles],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    }
  );

  const combinedPkgOutput = `${pkgRun.stdout ?? ""}\n${pkgRun.stderr ?? ""}`;
  process.stdout.write(combinedPkgOutput);

  if (pkgRun.status !== 0) {
    console.error("[M24 COVERAGE FAILED] One or more package unit tests failed.");
    process.exit(pkgRun.status ?? 1);
  }

  const { packageMetrics, allFilesMetric } = parseNodeTestCoverageTable(combinedPkgOutput);
  if (!allFilesMetric || packageMetrics.length < 8) {
    console.error("[M24 COVERAGE FAILED] Could not parse coverage summary table.");
    process.exit(1);
  }

  const violations = [];
  for (const pkg of packageMetrics) {
    if (
      pkg.linePct < MIN_COVERAGE_THRESHOLD ||
      pkg.branchPct < MIN_COVERAGE_THRESHOLD ||
      pkg.funcsPct < MIN_COVERAGE_THRESHOLD
    ) {
      violations.push(
        `@ideliveryfood/${pkg.packageName}: line=${pkg.linePct}%, branch=${pkg.branchPct}%, funcs=${pkg.funcsPct}% (required >= ${MIN_COVERAGE_THRESHOLD}%)`
      );
    }
  }

  if (
    allFilesMetric.linePct < MIN_COVERAGE_THRESHOLD ||
    allFilesMetric.branchPct < MIN_COVERAGE_THRESHOLD ||
    allFilesMetric.funcsPct < MIN_COVERAGE_THRESHOLD
  ) {
    violations.push(
      `Global Aggregate (all files): line=${allFilesMetric.linePct}%, branch=${allFilesMetric.branchPct}%, funcs=${allFilesMetric.funcsPct}% (required >= ${MIN_COVERAGE_THRESHOLD}%)`
    );
  }

  console.log("[M24 COVERAGE] Executing web portal & worker test suites (customer-web, partner-web, admin-web, worker)...");
  const appFiles = APP_TEST_SUITES.map((f) => path.join(REPO_ROOT, f));
  const appRun = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", ...appFiles],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    }
  );
  process.stdout.write(`${appRun.stdout ?? ""}\n${appRun.stderr ?? ""}`);
  if (appRun.status !== 0) {
    console.error("[M24 COVERAGE FAILED] One or more app test suites failed.");
    process.exit(appRun.status ?? 1);
  }

  console.log("\n================================================================================");
  console.log("iDeliveryFood — M24 Unit Test Coverage Gate Summary (Threshold: >= 80.0%)");
  console.log("================================================================================");
  for (const pkg of packageMetrics) {
    console.log(
      `  @ideliveryfood/${pkg.packageName.padEnd(15)} | Line: ${pkg.linePct.toFixed(2)}% | Branch: ${pkg.branchPct.toFixed(2)}% | Funcs: ${pkg.funcsPct.toFixed(2)}%`
    );
  }
  console.log("--------------------------------------------------------------------------------");
  console.log(
    `  GLOBAL AGGREGATE (all files)   | Line: ${allFilesMetric.linePct.toFixed(2)}% | Branch: ${allFilesMetric.branchPct.toFixed(2)}% | Funcs: ${allFilesMetric.funcsPct.toFixed(2)}%`
  );
  console.log("================================================================================");

  if (violations.length > 0) {
    console.error("[M24 COVERAGE FAILED] Coverage threshold violations detected:");
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }

  console.log(
    `[M24 UNIT COVERAGE GATE PASSED] All 8 core packages, 4 web/worker apps, and 16 native mobile test suites passed with >= ${MIN_COVERAGE_THRESHOLD}% coverage.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
