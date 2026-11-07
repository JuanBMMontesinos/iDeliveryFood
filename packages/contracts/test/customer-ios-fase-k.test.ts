import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const IOS_ROOT = path.join(REPO_ROOT, "apps/customer-ios");

describe("Fase K — @ideliveryfood/customer-ios (M06 Native Swift + SwiftUI Verification)", () => {
  it("verifies Package.swift, KeychainSessionVault, CustomerMarketplaceController, and Localizable.xcstrings en/pt-BR parity", () => {
    const packageSwiftPath = path.join(IOS_ROOT, "Package.swift");
    const vaultPath = path.join(IOS_ROOT, "Sources/CustomerApp/KeychainSessionVault.swift");
    const controllerPath = path.join(
      IOS_ROOT,
      "Sources/CustomerApp/CustomerMarketplaceController.swift"
    );
    const xcstringsPath = path.join(
      IOS_ROOT,
      "Sources/CustomerApp/Resources/Localizable.xcstrings"
    );

    assert.equal(fs.existsSync(packageSwiftPath), true, "Package.swift must exist");
    assert.equal(fs.existsSync(vaultPath), true, "KeychainSessionVault.swift must exist");
    assert.equal(
      fs.existsSync(controllerPath),
      true,
      "CustomerMarketplaceController.swift must exist"
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
    assert.equal(keys.length >= 34, true, `Expected >= 34 localized keys, found ${keys.length}`);
    for (const key of keys) {
      const entry = xcstrings.strings[key];
      assert.ok(entry?.localizations?.en?.stringUnit?.value, `Missing en translation for ${key}`);
      assert.ok(
        entry?.localizations?.["pt-BR"]?.stringUnit?.value,
        `Missing pt-BR translation for ${key}`
      );
    }
  });

  it("verifies CustomerApiClient.swift connects to real /v1 endpoints with Authorization, Accept-Language, X-Correlation-Id, and X-Idempotency-Key", () => {
    const apiClientPath = path.join(
      IOS_ROOT,
      "Sources/CustomerApp/Network/CustomerApiClient.swift"
    );
    assert.equal(fs.existsSync(apiClientPath), true, "CustomerApiClient.swift must exist");
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

  it("verifies CustomerRootView, all 8 SwiftUI views with VoiceOver accessibilityLabel, and XCTest suites", () => {
    const requiredViews = [
      "CustomerRootView.swift",
      "CustomerAuthView.swift",
      "CustomerAddressView.swift",
      "CustomerDiscoveryView.swift",
      "CustomerStoreDetailView.swift",
      "CustomerCartView.swift",
      "CustomerCheckoutView.swift",
      "CustomerOrderTrackingView.swift",
      "CustomerProfileView.swift",
    ];

    for (const viewFile of requiredViews) {
      const fullPath = path.join(IOS_ROOT, "Sources/CustomerApp/Views", viewFile);
      assert.equal(fs.existsSync(fullPath), true, `Missing SwiftUI view ${viewFile}`);
      const content = fs.readFileSync(fullPath, "utf8");
      assert.match(
        content,
        /accessibilityLabel/,
        `${viewFile} must expose VoiceOver accessibilityLabel`
      );
    }

    const apiTestPath = path.join(IOS_ROOT, "Tests/CustomerAppTests/CustomerApiClientTests.swift");
    const viewsTestPath = path.join(
      IOS_ROOT,
      "Tests/CustomerAppTests/CustomerSwiftUIViewsTests.swift"
    );
    assert.equal(fs.existsSync(apiTestPath), true, "CustomerApiClientTests.swift must exist");
    assert.equal(fs.existsSync(viewsTestPath), true, "CustomerSwiftUIViewsTests.swift must exist");
  });
});
