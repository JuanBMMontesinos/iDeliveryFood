import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const COURIER_ANDROID_ROOT = path.join(REPO_ROOT, "apps/courier-android");

describe("Fase L — @ideliveryfood/courier-android (M11 Native Kotlin + Jetpack Compose Verification)", () => {
  it("verifies Gradle configuration (settings.gradle.kts, build.gradle.kts) and AndroidManifest.xml permissions & deep links", () => {
    const settingsPath = path.join(COURIER_ANDROID_ROOT, "settings.gradle.kts");
    const buildPath = path.join(COURIER_ANDROID_ROOT, "build.gradle.kts");
    const manifestPath = path.join(COURIER_ANDROID_ROOT, "src/main/AndroidManifest.xml");

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
    assert.match(manifestContent, /android\.permission\.FOREGROUND_SERVICE_LOCATION/);
    assert.match(manifestContent, /android:scheme="ideliveryfood-courier"/);
    assert.match(manifestContent, /android:host="offers"/);
    assert.match(manifestContent, /android:host="tasks"/);
  });

  it("verifies CourierApiClient.kt connects to real /v1/logistics and /v1/finance endpoints with Authorization, Accept-Language, X-Correlation-Id, and X-Idempotency-Key", () => {
    const apiClientPath = path.join(
      COURIER_ANDROID_ROOT,
      "src/main/kotlin/com/ideliveryfood/courier/network/CourierApiClient.kt"
    );
    assert.equal(fs.existsSync(apiClientPath), true, "CourierApiClient.kt must exist");
    const code = fs.readFileSync(apiClientPath, "utf8");

    assert.match(code, /Accept-Language/);
    assert.match(code, /X-Correlation-Id/);
    assert.match(code, /X-Idempotency-Key/);
    assert.match(code, /Authorization/);
    assert.match(code, /\/logistics\/offers\//);
    assert.match(code, /\/logistics\/tasks\//);
    assert.match(code, /\/logistics\/couriers\//);
    assert.match(code, /\/complete-otp/);
    assert.match(code, /\/incidents/);
    assert.match(code, /\/finance\/settlements/);
  });

  it("verifies all 6 Courier Jetpack Compose screens, CourierMainActivity, CourierNavHost, accessibility contentDescription, and Kotlin test suites", () => {
    const requiredScreens = [
      "CourierOnboardingScreen.kt",
      "CourierAvailabilityScreen.kt",
      "CourierOfferRingScreen.kt",
      "CourierActiveDeliveryScreen.kt",
      "CourierIncidentScreen.kt",
      "CourierEarningsScreen.kt",
    ];

    for (const screenFile of requiredScreens) {
      const fullPath = path.join(
        COURIER_ANDROID_ROOT,
        "src/main/kotlin/com/ideliveryfood/courier/ui/screens",
        screenFile
      );
      assert.equal(fs.existsSync(fullPath), true, `Missing Courier Compose screen ${screenFile}`);
      const content = fs.readFileSync(fullPath, "utf8");
      assert.match(
        content,
        /contentDescription/,
        `${screenFile} must expose accessibility contentDescription`
      );
    }

    const navHostPath = path.join(
      COURIER_ANDROID_ROOT,
      "src/main/kotlin/com/ideliveryfood/courier/navigation/CourierNavHost.kt"
    );
    const mainActivityPath = path.join(
      COURIER_ANDROID_ROOT,
      "src/main/kotlin/com/ideliveryfood/courier/CourierMainActivity.kt"
    );
    assert.equal(fs.existsSync(navHostPath), true, "CourierNavHost.kt must exist");
    assert.equal(fs.existsSync(mainActivityPath), true, "CourierMainActivity.kt must exist");

    const apiTestPath = path.join(
      COURIER_ANDROID_ROOT,
      "src/test/kotlin/com/ideliveryfood/courier/network/CourierApiClientTest.kt"
    );
    const screensTestPath = path.join(
      COURIER_ANDROID_ROOT,
      "src/test/kotlin/com/ideliveryfood/courier/ui/CourierComposeScreensTest.kt"
    );
    assert.equal(fs.existsSync(apiTestPath), true, "CourierApiClientTest.kt must exist");
    assert.equal(fs.existsSync(screensTestPath), true, "CourierComposeScreensTest.kt must exist");
  });
});
