import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertExternalProviderReady,
  calculateServerQuoteAndSplit,
  canTransitionDeliveryStatus,
  canTransitionOrderStatus,
  canTransitionPaymentStatus,
  evaluateAccountDeletionRequest,
} from "../src/index.js";

describe("@ideliveryfood/domain — State Machines, Quote/Split Math, Retention & Provider Guard Tests", () => {
  it("calculates server quote and balanced double-entry split in integer BRL cents", () => {
    const result = calculateServerQuoteAndSplit({
      items: [
        {
          productId: "00000000-0000-4000-8000-000000000601",
          quantity: 1,
          unitPriceCents: 3890,
          addonsUnitPriceCents: 650,
        },
        {
          productId: "00000000-0000-4000-8000-000000000602",
          quantity: 1,
          unitPriceCents: 1690,
          addonsUnitPriceCents: 0,
        },
      ],
      fulfillmentModality: "PLATFORM_DELIVERY",
      deliveryFeeCents: 690,
      discountCents: 1000,
      discountFundedBy: "PLATFORM",
      minOrderCents: 2500,
    });

    assert.equal(result.subtotalCents, 5580);
    assert.equal(result.addonsCents, 650);
    assert.equal(result.grossMerchandiseCents, 6230);
    assert.equal(result.serviceFeeCents, 312);
    assert.equal(result.deliveryFeeCents, 690);
    assert.equal(result.discountCents, 1000);
    assert.equal(result.totalCents, 6232);
    assert.equal(result.platformCommissionCents, 1433);
    assert.equal(result.merchantNetCents, 4797);
    assert.equal(result.courierEarningsCents, 690);
    assert.equal(result.ledgerDebitsCents, 7232);
    assert.equal(result.ledgerCreditsCents, 7232);
  });

  it("supports MERCHANT_DELIVERY and PICKUP modalities and rejects baskets below minimum order", () => {
    const pickupQuote = calculateServerQuoteAndSplit({
      items: [
        {
          productId: "00000000-0000-4000-8000-000000000603",
          quantity: 1,
          unitPriceCents: 8990,
          addonsUnitPriceCents: 0,
        },
      ],
      fulfillmentModality: "PICKUP",
      deliveryFeeCents: 890,
      discountCents: 500,
      discountFundedBy: "MERCHANT",
      minOrderCents: 4000,
    });

    assert.equal(pickupQuote.deliveryFeeCents, 0);
    assert.equal(pickupQuote.courierEarningsCents, 0);
    assert.equal(pickupQuote.ledgerDebitsCents, pickupQuote.ledgerCreditsCents);

    assert.throws(
      () =>
        calculateServerQuoteAndSplit({
          items: [
            {
              productId: "00000000-0000-4000-8000-000000000602",
              quantity: 1,
              unitPriceCents: 1690,
              addonsUnitPriceCents: 0,
            },
          ],
          fulfillmentModality: "PLATFORM_DELIVERY",
          deliveryFeeCents: 690,
          discountCents: 0,
          discountFundedBy: "NONE",
          minOrderCents: 2500,
        }),
      /QUOTE_BELOW_MIN_ORDER/
    );
  });

  it("enforces valid and invalid transitions across Order, Payment, and Delivery state machines", () => {
    assert.equal(canTransitionOrderStatus("CREATED", "AWAITING_PAYMENT"), true);
    assert.equal(canTransitionOrderStatus("ACCEPTED", "PREPARING"), true);
    assert.equal(canTransitionOrderStatus("DELIVERED", "PREPARING"), false);
    assert.equal(canTransitionOrderStatus("REFUNDED", "ACCEPTED"), false);

    assert.equal(canTransitionPaymentStatus("PENDING", "CAPTURED"), true);
    assert.equal(canTransitionPaymentStatus("CAPTURED", "REFUNDED"), true);
    assert.equal(canTransitionPaymentStatus("CANCELLED", "CAPTURED"), false);

    assert.equal(canTransitionDeliveryStatus("PENDING_DISPATCH", "ASSIGNED"), true);
    assert.equal(canTransitionDeliveryStatus("PICKED_UP", "IN_TRANSIT"), true);
    assert.equal(canTransitionDeliveryStatus("DELIVERED", "OFFERING"), false);
  });

  it("evaluates LGPD account deletion requests and enforces legal retention holds", () => {
    const now = new Date("2026-11-03T12:00:00Z");

    const activeOrderHold = evaluateAccountDeletionRequest({
      userId: "00000000-0000-4000-8000-000000000001",
      hasActiveOrders: true,
      hasOpenFinancialDisputes: false,
      hasCompletedFiscalTransactions: true,
      requestedAt: now,
    });
    assert.equal(activeOrderHold.outcome, "RETENTION_HOLD");
    assert.equal(activeOrderHold.revokeAllSessionsImmediately, true);
    assert.equal(activeOrderHold.reasonCode, "ACTIVE_ORDER_IN_PROGRESS");

    const cleanDelete = evaluateAccountDeletionRequest({
      userId: "00000000-0000-4000-8000-000000000002",
      hasActiveOrders: false,
      hasOpenFinancialDisputes: false,
      hasCompletedFiscalTransactions: false,
      requestedAt: now,
    });
    assert.equal(cleanDelete.outcome, "IMMEDIATE_ANONYMIZATION");
    assert.equal(cleanDelete.holdUntilIso, null);
  });

  it("throws honest PROVIDER_BLOCKED error when external credentials are missing", () => {
    assert.throws(
      () =>
        assertExternalProviderReady({
          providerCode: "stripe",
          status: "BLOCKED_MISSING_CREDENTIALS",
          missingEnvVars: ["STRIPE_SECRET_KEY"],
        }),
      /PROVIDER_BLOCKED \[stripe\]/
    );

    assert.doesNotThrow(() =>
      assertExternalProviderReady({
        providerCode: "stripe",
        status: "SANDBOX_READY",
        missingEnvVars: [],
      })
    );
  });
});
