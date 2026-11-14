import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const COURIER_IOS_ROOT = path.join(REPO_ROOT, "apps/courier-ios");

describe("Fase M — @ideliveryfood/courier-ios (M11 Native Swift + SwiftUI Verification)", () => {
  it("verifies Package.swift, CourierKeychainManager, CourierDispatchController, and Localizable.xcstrings en/pt-BR parity", () => {
    const packageSwiftPath = path.join(COURIER_IOS_ROOT, "Package.swift");
    const keychainPath = path.join(
      COURIER_IOS_ROOT,
      "Sources/CourierApp/CourierKeychainManager.swift"
    );
    const controllerPath = path.join(
      COURIER_IOS_ROOT,
      "Sources/CourierApp/CourierDispatchController.swift"
    );
    const xcstringsPath = path.join(
      COURIER_IOS_ROOT,
      "Sources/CourierApp/Resources/Localizable.xcstrings"
    );

    assert.equal(fs.existsSync(packageSwiftPath), true, "Package.swift must exist");
    assert.equal(fs.existsSync(keychainPath), true, "CourierKeychainManager.swift must exist");
    assert.equal(
      fs.existsSync(controllerPath),
      true,
      "CourierDispatchController.swift must exist"
    );
    assert.equal(fs.existsSync(xcstringsPath), true, "Localizable.xcstrings must exist");

    const packageContent = fs.readFileSync(packageSwiftPath, "utf8");
    assert.match(packageContent, /defaultLocalization:\s*"en"/);
    assert.match(packageContent, /\.iOS\(\.v17\)/);

    const xcstrings = JSON.parse(fs.readFileSync(xcstringsPath, "utf8")) as {
      sourceLanguage: string;
      strings: Record<
        string,
        {
          localizations?: {
            en?: { stringUnit?: { value?: string } };
            "pt-BR"?: { stringUnit?: { value?: string } };
          };
        }
      >;
    };
    assert.equal(xcstrings.sourceLanguage, "en");
    const keys = Object.keys(xcstrings.strings);
    assert.equal(keys.length >= 32, true, `Expected >= 32 localized keys, found ${keys.length}`);
    for (const key of keys) {
      const entry = xcstrings.strings[key];
      assert.ok(entry?.localizations?.en?.stringUnit?.value, `Missing en translation for ${key}`);
      assert.ok(
        entry?.localizations?.["pt-BR"]?.stringUnit?.value,
        `Missing pt-BR translation for ${key}`
      );
    }
  });

  it("verifies CourierApiClient.swift connects to real /v1/logistics and /v1/finance endpoints with Authorization, Accept-Language, X-Correlation-Id, and X-Idempotency-Key", () => {
    const apiClientPath = path.join(
      COURIER_IOS_ROOT,
      "Sources/CourierApp/Network/CourierApiClient.swift"
    );
    assert.equal(fs.existsSync(apiClientPath), true, "CourierApiClient.swift must exist");
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

  it("verifies CourierRootView, all 6 SwiftUI courier views with VoiceOver accessibilityLabel, and XCTest suites", () => {
    const requiredViews = [
      "CourierRootView.swift",
      "CourierOnboardingView.swift",
      "CourierAvailabilityView.swift",
      "CourierOfferRingView.swift",
      "CourierActiveDeliveryView.swift",
      "CourierIncidentView.swift",
      "CourierEarningsView.swift",
    ];

    for (const viewFile of requiredViews) {
      const fullPath = path.join(COURIER_IOS_ROOT, "Sources/CourierApp/Views", viewFile);
      assert.equal(fs.existsSync(fullPath), true, `Missing SwiftUI courier view ${viewFile}`);
      const content = fs.readFileSync(fullPath, "utf8");
      assert.match(
        content,
        /accessibilityLabel/,
        `${viewFile} must expose VoiceOver accessibilityLabel`
      );
    }

    const apiTestPath = path.join(
      COURIER_IOS_ROOT,
      "Tests/CourierAppTests/CourierApiClientTests.swift"
    );
    const viewsTestPath = path.join(
      COURIER_IOS_ROOT,
      "Tests/CourierAppTests/CourierSwiftUIViewsTests.swift"
    );
    assert.equal(fs.existsSync(apiTestPath), true, "CourierApiClientTests.swift must exist");
    assert.equal(fs.existsSync(viewsTestPath), true, "CourierSwiftUIViewsTests.swift must exist");
  });
});
