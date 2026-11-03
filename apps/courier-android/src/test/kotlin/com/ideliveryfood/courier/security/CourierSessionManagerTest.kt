package com.ideliveryfood.courier.security

class CourierSessionManagerTest {
    fun verifyCourierApprovalGuardAndLocale() {
        val manager = CourierSessionManager()
        check(manager.getPreferredLocale() == "en")
        check(!manager.canGoOnlineForDispatch("PENDING_APPROVAL"))
        check(manager.canGoOnlineForDispatch("APPROVED"))
        check(manager.setPreferredLocale("pt-BR") == "pt-BR")
        check(manager.isAllowedDeepLink("ideliveryfood-courier://auth-callback?code=xyz"))
    }
}
