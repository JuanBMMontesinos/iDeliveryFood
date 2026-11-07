package com.ideliveryfood.customer.ui

import com.ideliveryfood.customer.MainActivity
import com.ideliveryfood.customer.marketplace.CustomerMarketplaceController
import com.ideliveryfood.customer.marketplace.MobileCartItem
import com.ideliveryfood.customer.marketplace.MobilePublishedStore
import com.ideliveryfood.customer.network.CustomerAddressDto
import com.ideliveryfood.customer.network.CustomerCatalogOptionDto
import com.ideliveryfood.customer.network.CustomerCatalogOptionGroupDto
import com.ideliveryfood.customer.network.CustomerCatalogProductDto
import com.ideliveryfood.customer.network.CustomerOrderDto
import com.ideliveryfood.customer.network.CustomerStoreDetailDto
import com.ideliveryfood.customer.network.ServerQuoteDto
import com.ideliveryfood.customer.security.InMemoryEncryptedBackend
import com.ideliveryfood.customer.security.SecureSessionStore
import com.ideliveryfood.customer.ui.screens.AddressListScreen
import com.ideliveryfood.customer.ui.screens.AuthMode
import com.ideliveryfood.customer.ui.screens.AuthScreen
import com.ideliveryfood.customer.ui.screens.CartScreen
import com.ideliveryfood.customer.ui.screens.CheckoutScreen
import com.ideliveryfood.customer.ui.screens.CustomerDeviceSessionItem
import com.ideliveryfood.customer.ui.screens.DiscoveryScreen
import com.ideliveryfood.customer.ui.screens.DiscoveryViewStatus
import com.ideliveryfood.customer.ui.screens.OrderTrackingScreen
import com.ideliveryfood.customer.ui.screens.ProfileScreen
import com.ideliveryfood.customer.ui.screens.StoreDetailScreen

class CustomerComposeScreensTest {
    fun verifyAllEightComposeScreensAndDeepLinks() {
        val sessionStore = SecureSessionStore(InMemoryEncryptedBackend())
        val controller = CustomerMarketplaceController(currentLocale = "en")

        // 1. AuthScreen
        val authEn = AuthScreen.buildUiState(sessionStore, mode = AuthMode.SIGN_IN)
        check(authEn.titleText == "Sign in to your account")
        check(authEn.contentDescription.isNotBlank())

        // 2. AddressListScreen with GPS permission denied fallback
        val addrState = AddressListScreen.buildUiState(
            addresses = listOf(
                CustomerAddressDto(
                    id = "00000000-0000-4000-8000-000000000801",
                    label = "Home",
                    recipientName = "Alice Test Consumer",
                    streetLine = "Rua Oscar Freire",
                    number = "950",
                    complement = "Apt 82",
                    neighborhood = "Jardins",
                    city = "São Paulo",
                    stateCode = "SP",
                    postalCode = "01426-001",
                    latitude = -23.56398,
                    longitude = -46.66912,
                    isDefault = true
                )
            ),
            gpsPermissionGranted = false,
            locale = "en"
        )
        check(addrState.gpsFallbackBannerText != null)
        check(addrState.selectedAddressId == "00000000-0000-4000-8000-000000000801")

        // 3. DiscoveryScreen
        val store201 = MobilePublishedStore(
            id = "00000000-0000-4000-8000-000000000201",
            slug = "paulista-burgers-jardins",
            name = "Paulista Artisan Burgers - Jardins",
            descriptionEn = "Dry-aged smash burgers",
            descriptionPtBr = "Smash burgers maturados",
            cuisineCategory = "BURGERS",
            isPaused = false,
            minOrderCents = 2500,
            prepTimeMinMinutes = 20,
            prepTimeMaxMinutes = 35
        )
        val discReady = DiscoveryScreen.buildUiState(controller, listOf(store201))
        check(discReady.status == DiscoveryViewStatus.READY)
        check(discReady.stores.size == 1)

        // 4. StoreDetailScreen + Option validation
        val detailDto = CustomerStoreDetailDto(
            store = store201,
            products = listOf(
                CustomerCatalogProductDto(
                    id = "00000000-0000-4000-8000-000000000601",
                    storeId = store201.id,
                    categoryId = "cat_501",
                    localizedName = "Double Paulista Truffle Smash",
                    localizedDescription = "Two 90g dry-aged beef patties",
                    priceCents = 3890,
                    isAvailable = true,
                    optionGroups = listOf(
                        CustomerCatalogOptionGroupDto(
                            id = "grp_701",
                            localizedName = "Extra Toppings",
                            minSelections = 1,
                            maxSelections = 2,
                            options = listOf(
                                CustomerCatalogOptionDto("opt_751", "Bacon", 650, true)
                            )
                        )
                    )
                )
            )
        )
        val detailState = StoreDetailScreen.buildUiState(controller, detailDto)
        check(detailState.products.size == 1)
        val invalidOpts = StoreDetailScreen.validateOptionSelections(
            detailDto.products[0].optionGroups,
            emptyMap(),
            "en"
        )
        check(!invalidOpts.valid)

        // 5. CartScreen with store switch confirmation
        controller.addItemToBasket(store201.id, MobileCartItem("prod_601", 1))
        val crossStoreDecision = controller.addItemToBasket("store_202", MobileCartItem("prod_603", 1), confirmStoreSwitch = false)
        val cartState = CartScreen.buildUiState(crossStoreDecision, locale = "pt-BR")
        check(cartState.showStoreSwitchDialog)

        // 6. CheckoutScreen with honest PSP blocked notice
        val quoteDto = ServerQuoteDto(
            id = "00000000-0000-4000-8000-000000000951",
            storeId = store201.id,
            subtotalCents = 5580,
            addonsCents = 650,
            serviceFeeCents = 312,
            deliveryFeeCents = 690,
            discountCents = 1000,
            totalCents = 6232,
            expiresAtIso = "2026-11-03T15:00:00Z"
        )
        val checkoutState = CheckoutScreen.buildUiState(controller, quoteDto)
        check(!checkoutState.readiness.canSubmitOrder)
        check(checkoutState.honestPspBlockedBannerText != null)

        // 7. OrderTrackingScreen with OTP notice
        val orderDto = CustomerOrderDto(
            id = "00000000-0000-4000-8000-000000001001",
            orderNumber = 10001,
            storeId = store201.id,
            orderStatus = "PREPARING",
            paymentStatus = "CAPTURED",
            deliveryStatus = "ASSIGNED",
            totalCents = 6232,
            createdAtIso = "2026-11-03T12:05:00Z"
        )
        val trackingState = OrderTrackingScreen.buildUiState(controller, orderDto, withinCancelWindow = false)
        check(!trackingState.canSelfCancel)
        check(trackingState.otpNoticeText.contains("4-digit"))

        // 8. ProfileScreen + MainActivity Deep Link
        val profileState = ProfileScreen.buildUiState(
            sessionStore = sessionStore,
            fullName = "Alice Test Consumer",
            email = "customer.alice@test.ideliveryfood.invalid",
            devices = listOf(CustomerDeviceSessionItem("dev_1", "ANDROID", "pixel-8", false)),
            retentionHoldUntilIso = "2027-11-03T00:00:00Z"
        )
        check(profileState.lgpdRetentionHoldNoticeText != null)

        val mainActivity = MainActivity(sessionStore, controller)
        val dl = mainActivity.handleIncomingDeepLink("ideliveryfood://orders/00000000-0000-4000-8000-000000001001")
        check(dl.allowed)
        check(mainActivity.navState.currentRoute == "orders/00000000-0000-4000-8000-000000001001")
    }
}
