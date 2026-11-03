package com.ideliveryfood.customer.security

class InMemoryEncryptedBackend : EncryptedKeyValueBackend {
    private val map = mutableMapOf<String, String>()
    override fun putString(key: String, value: String) { map[key] = value }
    override fun getString(key: String): String? = map[key]
    override fun remove(key: String) { map.remove(key) }
    override fun clear() { map.clear() }
}

class SecureSessionStoreTest {
    fun verifySessionLifecycleAndLocale() {
        val store = SecureSessionStore(InMemoryEncryptedBackend())
        check(store.getPreferredLocale() == "en")
        check(store.setPreferredLocale("pt-BR") == "pt-BR")
        store.saveSessionTokens("access_123", "refresh_456")
        check(store.getAccessToken() == "access_123")
        store.revokeLocalSession()
        check(store.getAccessToken() == null)
        check(store.isAllowedDeepLink("ideliveryfood-customer://auth-callback?code=abc"))
        check(!store.isAllowedDeepLink("https://evil.example.com/callback"))
    }
}
