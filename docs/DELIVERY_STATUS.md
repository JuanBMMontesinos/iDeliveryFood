# iDeliveryFood — Relatório Consolidado de Entrega (Fase A + Fase B + Fase C)

## 1. Status Geral da Execução
- **Fase A (`M00 -> M01 -> M02 -> M03`):** **CONCLUÍDA E VALIDADA**
- **Fase B (`M04 -> M05 -> M09 -> M10 -> M12`):** **CONCLUÍDA E VALIDADA**
- **Fase C (`M06 -> M07 -> M08 -> M16`):** **CONCLUÍDA E VALIDADA**
- **Projeto Supabase Vinculado (`project_ref`):** `dwsoochnfxldfvcaijie` (`us-east-1`, PostgreSQL 17.11)
- **Repositório GitHub:** `https://github.com/JuanBMMontesinos/iDeliveryFood.git` (`main`)

---

## 2. Módulos Entregues até o Momento

| Módulo | Título | Status | Evidência Técnica |
|---|---|---|---|
| **M00** | Bootstrap, Governança, Segurança Base e Padrões Globais | **DELIVERED** | Monorepo `pnpm` + Turborepo, CI/CD (`.github/workflows/ci.yml`), scanner anti-segredos e anti-hardcode (`scripts/security-and-hardcode-scan.mjs`), `i18n` (`en` default + `pt-BR`), moeda `BRL` em centavos inteiros e timezone `America/Sao_Paulo`. |
| **M01** | Arquitetura, Contratos `/v1`, Eventos e Matriz RBAC/ABAC/RLS | **DELIVERED** | `packages/contracts/openapi/v1.yaml` (OpenAPI 3.1), envelopes padronizados com `correlationId`, ADRs 001 a 004. |
| **M02** | Banco de Dados Supabase, Migrations, RLS, Storage, Realtime e Seeds | **DELIVERED** | 6 migrations aplicadas em `dwsoochnfxldfvcaijie`, 46 tabelas `public` com 100% RLS ativo, views `published_stores_v` e `store_catalog_v` (`security_invoker = true`), função `app_security.calculate_distance_meters`, trigger `trg_guard_staff_scope_self_grant`, seed idempotente (`supabase/seed.sql`) e suíte SQL de 14 invariantes (`ALL_14_SECURITY_AND_FASE_ABC_INVARIANTS_PASSED`). |
| **M03** | Identidade, Autenticação, Sessões, Convites, Onboarding, MFA e LGPD | **DELIVERED** | `@ideliveryfood/authz` + endpoints `/v1/me`, `/v1/me/preferences`, `/v1/me/devices/revoke`, `/v1/me/privacy-requests`, `/v1/invitations`, `/v1/onboarding/approvals` (exigindo `aal2`). |
| **M04** | Catálogo, Lojas, Cobertura e Preços | **DELIVERED** | `evaluateStoreAvailability` (horários semanais, virada de meia-noite `is_overnight`, pausas e exceções de feriado em `America/Sao_Paulo`), `evaluateServiceAreaEligibility` (Haversine em metros, raio e frete), `validateAndBuildQuoteItems` (min/max de grupos de opções e preços do servidor), `/v1/stores`, `/v1/stores/{storeId}/catalog`, `/v1/stores/{storeId}/availability`. |
| **M05** | App Web do Cliente — Portal de Compra / PWA | **DELIVERED** | `loadCustomerMarketplaceScreen`, `CustomerCartController` (carrinho de loja única com confirmação explícita localizada antes de trocar de restaurante), `buildCustomerCheckoutScreenModel` (cotação real e bloqueio honesto quando PSP está sem credenciais) e `/v1/me/addresses`. |
| **M06** | App Mobile do Cliente — Android (`Kotlin/Compose`) e iOS (`Swift/SwiftUI`) | **DELIVERED** | `CustomerMarketplaceController.kt` + `SecureSessionStore.kt` (`apps/customer-android`) e `CustomerMarketplaceController.swift` + `KeychainSessionVault.swift` (`apps/customer-ios`), carrinho de loja única, bloqueio de checkout em modo offline com aviso de cache obsoleto, bloqueio honesto de PSP (`BLOCKED_MISSING_CREDENTIALS`), allowlist de deep links e 100% de paridade `i18n` (`strings.xml` + `Localizable.xcstrings`). |
| **M07** | Portal Web do Parceiro — Gestão do Estabelecimento | **DELIVERED** | `validateStoreSettingsPatch`, `createBankAccountChangeRequest`, `submitPartnerBankAccountChangeRequest` (`apps/partner-web`), `/v1/stores/{storeId}/settings` e `/v1/stores/{storeId}/bank-account-change-request` (exigindo `partner_owner` + MFA `aal2`, status `PENDING` e zero repasse imediato). |
| **M08** | Gestor Operacional de Pedidos do Restaurante | **DELIVERED** | `KitchenOrderConsoleController` (`apps/partner-web`), `buildKitchenOrderQueue`, `reconcileKitchenOrderEventsOnReconnect` e `/v1/stores/{storeId}/orders-queue` com SLA em tempo real, conflito otimista `409 ORDER_VERSION_CONFLICT`, motivo obrigatório de rejeição, consentimento explícito de som e preservação de pedidos ativos com loja pausada. |
| **M09** | Portal de Redes, Franquias e Multiunidades | **DELIVERED** | `evaluateMultiUnitCatalogBatch`, `/v1/organizations/{orgId}/units-summary` e `/v1/organizations/{orgId}/catalog-batch` com validação de escopo por unidade (`APPLIED` vs `DENIED_SCOPE`). |
| **M10** | Pedidos, Carrinho, Cotação e Máquina de Estados | **DELIVERED** | `createOrderFromServerQuote`, `executeOrderCommand` (concorrência otimista `expectedVersion`, janela de cancelamento gratuito de 120s, eventos append-only em `order_events` e `outbox_events`), `/v1/quotes`, `/v1/orders`, `/v1/orders/{orderId}/commands`, `/v1/orders/{orderId}/events`. |
| **M12** | Pagamentos, PSP, Webhooks e Estornos | **DELIVERED** | `computePspWebhookSignature`, `verifyAndProcessPspWebhook` (HMAC-SHA256 constante, janela de replay de 300s, deduplicação `(providerCode, externalEventId)` e tratamento de captura tardia como `DISPUTED`), `evaluateRefundRequest` (MFA `aal2` + teto ABAC `maxRefundApprovalCents`), `/v1/payments/attempts`, `/v1/webhooks/psp/{providerCode}` e `/v1/refunds`. |
| **M16** | Administração Central, Acessos e Cadastros | **DELIVERED** | `buildAdminRoleNavigationModules`, `executeAdminStaffScopeGrant` (bloqueio de autoconcessão `DENIED_SELF_GRANT_FORBIDDEN` + trigger SQL `trg_guard_staff_scope_self_grant`), `executeAdminCadastreGovernanceAction` (MFA `aal2` + justificativa obrigatória), `buildAdminAuditTrailExplorerModel` (`isReadOnly: true`), `/v1/admin/staff-scopes`, `/v1/admin/governance-actions` e `/v1/admin/audit-logs`. |

---

## 3. Estado Honesto de Provedores Externos (`BLOCKED_MISSING_CREDENTIALS`)
- Adaptadores pré-configurados (`stripe`, `mercadopago`, `pagarme`, `google_maps`, `mapbox`, `resend`, `fcm`, `apns`) permanecem honestamente reportados como `BLOCKED_MISSING_CREDENTIALS` até que as respectivas variáveis de ambiente sejam fornecidas em `.env`. Nenhuma cobrança externa é simulada como paga em runtime sem webhook assinado.
