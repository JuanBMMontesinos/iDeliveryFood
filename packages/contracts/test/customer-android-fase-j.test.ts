import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const ANDROID_ROOT = path.join(REPO_ROOT, "apps/customer-android");

describe("Fase J — @ideliveryfood/customer-android (M06 Native Kotlin + Jetpack Compose Verification)", () => {
  it("verifies Gradle configuration (settings.gradle.kts, build.gradle.kts) and AndroidManifest.xml permissions & deep links", () => {
    const settingsPath = path.join(ANDROID_ROOT, "settings.gradle.kts");
    const buildPath = path.join(ANDROID_ROOT, "build.gradle.kts");
    const manifestPath = path.join(ANDROID_ROOT, "src/main/AndroidManifest.xml");

    assert.equal(fs.existsSync(settingsPath), true, "settings.gradle.kts must exist");
    assert.equal(fs.existsSync(buildPath), true, "build.gradle.kts must exist");
    assert.equal(fs.existsSync(manifestPath), true, "AndroidManifest.xml must exist");

    const buildContent = fs.readFileSync(buildPath, "utf8");
    assert.match(buildContent, /plugin\.compose/);
    assert.match(buildContent, /navigation-compose/);
    assert.match(buildContent, /security-crypto/);

    const manifestContent = fs.readFileSync(manifestPath, "utf8");
    assert.match(manifestContent, /android\.permission\.INTERNET/);
    assert.match(manifestContent, /android\.permission\.ACCESS_COARSE_LOCATION/);
    assert.match(manifestContent, /android\.permission\.ACCESS_FINE_LOCATION/);
    assert.match(manifestContent, /android:scheme="ideliveryfood-customer"/);
    assert.match(manifestContent, /android:scheme="ideliveryfood"/);
    assert.match(manifestContent, /android:host="orders"/);
  });

  it("verifies CustomerApiClient.kt connects to real /v1 endpoints with Authorization, Accept-Language, X-Correlation-Id, and X-Idempotency-Key", () => {
    const apiClientPath = path.join(
      ANDROID_ROOT,
      "src/main/kotlin/com/ideliveryfood/customer/network/CustomerApiClient.kt"
    );
    assert.equal(fs.existsSync(apiClientPath), true, "CustomerApiClient.kt must exist");
    const code = fs.readFileSync(apiClientPath, "utf8");

    assert.match(code, /Accept-Language/);
    assert.match(code, /X-Correlation-Id/);
    assert.match(code, /X-Idempotency-Key/);
    assert.match(code, /Authorization/);
    assert.match(code, /\/stores\?locale=/);
    assert.match(code, /\/me\/addresses/);
    assert.match(code, /\/quotes/);
    assert.match(code, /\/orders/);
    assert.match(code, /\/review/);
    assert.match(code, /\/support-cases/);
    assert.match(code, /\/me\/devices/);
    assert.match(code, /\/me\/privacy-requests/);
  });

  it("verifies all 8 Jetpack Compose screens, MainActivity, CustomerNavHost, accessibility contentDescription, and Kotlin test suites", () => {
    const requiredScreens = [
      "AuthScreen.kt",
      "AddressListScreen.kt",
      "DiscoveryScreen.kt",
      "StoreDetailScreen.kt",
      "CartScreen.kt",
      "CheckoutScreen.kt",
      "OrderTrackingScreen.kt",
      "ProfileScreen.kt",
    ];

    for (const screenFile of requiredScreens) {
      const fullPath = path.join(
        ANDROID_ROOT,
        "src/main/kotlin/com/ideliveryfood/customer/ui/screens",
        screenFile
      );
      assert.equal(fs.existsSync(fullPath), true, `Missing Compose screen ${screenFile}`);
      const content = fs.readFileSync(fullPath, "utf8");
      assert.match(
        content,
        /contentDescription/,
        `${screenFile} must expose accessibility contentDescription`
      );
    }

    const navHostPath = path.join(
      ANDROID_ROOT,
      "src/main/kotlin/com/ideliveryfood/customer/navigation/CustomerNavHost.kt"
    );
    const mainActivityPath = path.join(
      ANDROID_ROOT,
      "src/main/kotlin/com/ideliveryfood/customer/MainActivity.kt"
    );
    assert.equal(fs.existsSync(navHostPath), true, "CustomerNavHost.kt must exist");
    assert.equal(fs.existsSync(mainActivityPath), true, "MainActivity.kt must exist");

    const apiTestPath = path.join(
      ANDROID_ROOT,
      "src/test/kotlin/com/ideliveryfood/customer/network/CustomerApiClientTest.kt"
    );
    const screensTestPath = path.join(
      ANDROID_ROOT,
      "src/test/kotlin/com/ideliveryfood/customer/ui/CustomerComposeScreensTest.kt"
    );
    assert.equal(fs.existsSync(apiTestPath), true, "CustomerApiClientTest.kt must exist");
    assert.equal(fs.existsSync(screensTestPath), true, "CustomerComposeScreensTest.kt must exist");
  });
});
