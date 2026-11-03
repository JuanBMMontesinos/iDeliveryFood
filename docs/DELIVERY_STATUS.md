# iDeliveryFood — Relatório Executivo de Status de Entrega (`DELIVERY_STATUS.md`)

**Fase Executada:** Fase A (`M00 -> M01 -> M02 -> M03`)  
**Data de Atualização:** `2026-11-03`  
**Projeto Supabase Conectado:** `dwsoochnfxldfvcaijie` (`us-east-1`, PostgreSQL 17.11)  
**Repositório GitHub:** `https://github.com/JuanBMMontesinos/iDeliveryFood.git`

---

## 1. Status Consolidado por Módulo (Fase A)

| Módulo | Nome | Status | Evidências Técnicas |
| :--- | :--- | :--- | :--- |
| **M00** | Alinhamento Executivo, PRD, ADRs e Convenções | **CONCLUÍDO** | [PRD.md](file:///d:/IAProjects/iDeliveryFood/docs/PRD.md), [ADR-001](file:///d:/IAProjects/iDeliveryFood/docs/architecture/ADR-001-stack-and-monorepo.md), [ADR-002](file:///d:/IAProjects/iDeliveryFood/docs/architecture/ADR-002-multi-tenant-authz-rls.md), [ADR-003](file:///d:/IAProjects/iDeliveryFood/docs/architecture/ADR-003-external-providers-and-policies.md), [conventions.md](file:///d:/IAProjects/iDeliveryFood/docs/architecture/conventions.md), [M00.md](file:///d:/IAProjects/iDeliveryFood/docs/modules/M00.md) |
| **M01** | Fundação do Monorepo, Ambientes, CI/CD, Observabilidade e Base `i18n` | **CONCLUÍDO** | Monorepo `pnpm` (11 pacotes/apps), OpenAPI 3.1 (`/v1`), `i18n` (`en` padrão + `pt-BR` com 100% de paridade), validação de `.env`, redator de logs, scripts de segurança e workflow CI |
| **M02** | Plataforma de Dados, Schema, RLS, Storage, Realtime e Seeds | **CONCLUÍDO** | 4 migrations aplicadas em `dwsoochnfxldfvcaijie` (46 tabelas `public` com 100% RLS + 41 índices de FK + 5 buckets Storage), `0` avisos no Supabase Security Advisor, `seed.sql` executado 2x sem duplicação e suíte SQL de 10 invariantes aprovada |
| **M03** | Identidade, Autenticação, Sessões, MFA, RBAC/ABAC e Onboarding | **CONCLUÍDO** | Motor RBAC/ABAC multi-tenant, segregação `partner_operator` vs `partner_finance`, step-up MFA `aal2` para staff, convites single-use SHA-256, revogação de dispositivos, retenção legal LGPD e cofres nativos Android/iOS |

---

## 2. Itens e Integrações Externas Marcados Honestamente como `BLOQUEADO`

Seguindo a diretriz de **Proibição de Declaração Falsa de Prontidão** e **Zero Simulação de Integrações Externas**:

| Componente / Integração | Status Atual | Motivo Exato do Bloqueio | O Que Já Está Pronto |
| :--- | :--- | :--- | :--- |
| **Provedores de Pagamento (PSP: `stripe`, `mercadopago`, `pagarme`)** | **BLOQUEADO** (`BLOCKED_MISSING_CREDENTIALS`) | Credenciais externas de sandbox/produção (`STRIPE_SECRET_KEY`, `MERCADOPAGO_ACCESS_TOKEN`, `PAGARME_SECRET_KEY`) ainda não fornecidas pelo Owner. | Registro em `public.provider_configurations`, contrato de adaptador, inspetor de prontidão (`/v1/system/providers`) e guarda que bloqueia chamadas sem simular sucesso. |
| **Provedores de Mapas e Geocodificação (`google_maps`, `mapbox`)** | **BLOQUEADO** (`BLOCKED_MISSING_CREDENTIALS`) | Chaves `GOOGLE_MAPS_SERVER_API_KEY` / `MAPBOX_SECRET_TOKEN` ainda não fornecidas pelo Owner. | Registro no banco, variáveis documentadas em `.env.example` e cálculo determinístico de raio/frete por loja em `store_service_areas`. |
| **Provedores de Push e E-mail Transacional (`fcm`, `apns`, `resend`)** | **BLOQUEADO** (`BLOCKED_MISSING_CREDENTIALS`) | Credenciais `FCM_*`, `APNS_*` e `RESEND_API_KEY` ainda não fornecidas pelo Owner. | Tabela `notification_deliveries`, processador de outbox (`apps/worker`) com dead-letter e registro em `provider_configurations`. |
| **Compilação Binária Local iOS (`Xcode`) e Android SDK** | **BLOQUEADO** (Ambiente Windows sem Xcode / Android SDK) | Host local de execução é Windows (`win32`), sem macOS/Xcode instalado e sem `ANDROID_HOME` configurado. | Código-fonte nativo `Swift/SwiftUI` e `Kotlin/Compose`, manifestos de deep-link e catálogos `i18n` (`en` e `pt-BR`) entregues e validados por teste automatizado de paridade. |
| **Templates Jurídicos Finais (Termos de Uso, Política de Privacidade, Contratos B2B)** | **DEPENDÊNCIA EXTERNA** (`PENDING_LEGAL_REVIEW`) | Requerem validação jurídica formal antes de go-live comercial. | Coluna `legal_template_status = 'PENDING_LEGAL_REVIEW'` em `public.merchant_contracts` e fluxo de retenção legal em `public.privacy_requests`. |
| **Módulos das Fases B a H (`M04` a `M23`)** | **NÃO INICIADO** (Fora do escopo da Fase A) | Escopo autorizado para esta execução foi a Fase A (`M00 -> M01 -> M02 -> M03`). | Schema de banco de dados (`M02`), políticas RLS e contratos base já provisionados para suportar as próximas fases. |
