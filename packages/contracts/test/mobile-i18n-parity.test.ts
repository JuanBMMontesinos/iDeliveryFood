import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(process.cwd(), "../..");

function extractAndroidStringKeys(xmlPath: string): string[] {
  const xml = fs.readFileSync(xmlPath, "utf8");
  const matches = [...xml.matchAll(/<string\s+name="([^"]+)">([^<]+)<\/string>/g)];
  for (const m of matches) {
    assert.ok((m[2] ?? "").trim().length > 0, `Empty string value for key '${m[1]}' in ${xmlPath}`);
  }
  return matches.map((m) => m[1] ?? "").sort();
}

describe("Native Mobile i18n Key Parity (Android XML & iOS .xcstrings)", () => {
  it("verifies 100% key parity between values/strings.xml (en) and values-pt-rBR/strings.xml (pt-BR) in Android apps", () => {
    for (const appDir of ["apps/customer-android", "apps/courier-android"]) {
      const enPath = path.join(REPO_ROOT, appDir, "src/main/res/values/strings.xml");
      const ptPath = path.join(REPO_ROOT, appDir, "src/main/res/values-pt-rBR/strings.xml");

      assert.equal(fs.existsSync(enPath), true, `Missing ${enPath}`);
      assert.equal(fs.existsSync(ptPath), true, `Missing ${ptPath}`);

      const enKeys = extractAndroidStringKeys(enPath);
      const ptKeys = extractAndroidStringKeys(ptPath);
      assert.ok(enKeys.length >= 8, `Expected at least 8 localized strings in ${appDir}`);
      assert.deepEqual(enKeys, ptKeys, `Key parity mismatch in ${appDir}`);
    }
  });

  it("verifies sourceLanguage='en' and 100% en + pt-BR translations in iOS Localizable.xcstrings", () => {
    const iosCatalogPaths = [
      "apps/customer-ios/Sources/CustomerApp/Resources/Localizable.xcstrings",
      "apps/courier-ios/Sources/CourierApp/Resources/Localizable.xcstrings",
    ];

    for (const relPath of iosCatalogPaths) {
      const fullPath = path.join(REPO_ROOT, relPath);
      assert.equal(fs.existsSync(fullPath), true, `Missing ${fullPath}`);

      const catalog = JSON.parse(fs.readFileSync(fullPath, "utf8")) as {
        sourceLanguage: string;
        strings: Record<
          string,
          {
            localizations: Record<
              string,
              { stringUnit?: { state?: string; value?: string } }
            >;
          }
        >;
      };

      assert.equal(catalog.sourceLanguage, "en", `sourceLanguage must be 'en' in ${relPath}`);
      const keys = Object.keys(catalog.strings);
      assert.ok(keys.length >= 8, `Expected at least 8 keys in ${relPath}`);

      for (const key of keys) {
        const entry = catalog.strings[key];
        const enValue = entry?.localizations?.en?.stringUnit?.value ?? "";
        const ptValue = entry?.localizations?.["pt-BR"]?.stringUnit?.value ?? "";
        assert.ok(enValue.trim().length > 0, `Missing 'en' translation for '${key}' in ${relPath}`);
        assert.ok(ptValue.trim().length > 0, `Missing 'pt-BR' translation for '${key}' in ${relPath}`);
      }
    }
  });
});
