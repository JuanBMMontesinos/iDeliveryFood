package com.ideliveryfood.customer.marketplace

class CustomerMarketplaceControllerTest {
    fun verifySingleStoreCartOfflineLockAndHonestPspStatus() {
        val controller = CustomerMarketplaceController()
        check(controller.getLocale() == "en")

        val addFirst = controller.addItemToBasket(
            targetStoreId = "00000000-0000-4000-8000-000000000201",
            item = MobileCartItem(productId = "prod_601", quantity = 1)
        )
        check(addFirst.allowed)
        check(!addFirst.requiresStoreSwitchConfirmation)

        val addCrossStore = controller.addItemToBasket(
            targetStoreId = "00000000-0000-4000-8000-000000000202",
            item = MobileCartItem(productId = "prod_603", quantity = 1),
            confirmStoreSwitch = false
        )
        check(!addCrossStore.allowed)
        check(addCrossStore.requiresStoreSwitchConfirmation)

        val blockedCheckout = controller.evaluateCheckoutReadiness(
            pspStatus = "BLOCKED_MISSING_CREDENTIALS",
            missingEnvVars = listOf("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET")
        )
        check(!blockedCheckout.canSubmitOrder)
        check(blockedCheckout.bannerMessageKey == "checkout_psp_blocked_notice")

        controller.setOfflineMode(true)
        val offlineState = controller.evaluateCheckoutReadiness(
            pspStatus = "SANDBOX_READY",
            missingEnvVars = emptyList()
        )
        check(offlineState.isOffline && offlineState.isCachedDataStale && !offlineState.canSubmitOrder)
        check(offlineState.bannerMessageKey == "offline_stale_cache_banner")

        check(controller.isAllowedCustomerDeepLink("ideliveryfood-customer://orders/ord_1001"))
        check(!controller.isAllowedCustomerDeepLink("javascript://alert(1)"))
    }
}
