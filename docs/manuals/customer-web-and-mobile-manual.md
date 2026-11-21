# iDeliveryFood — Manual do Cliente (Portal Web/PWA, Android Nativo e iOS Nativo) (`M05`, `M06`, `M10`, `M17`, `M19`, `M20`, `M21`, `M22`)

## 1. Visão Geral das Superfícies do Cliente

O consumidor do **iDeliveryFood** conta com três superfícies sincronizadas em tempo real com a API `/v1` e o banco Supabase (`dwsoochnfxldfvcaijie`):
1. **Portal Web & PWA (`apps/customer-web`):** Next.js App Router com instalação PWA (`manifest.webmanifest` + `sw.js`).
2. **App Android Nativo (`apps/customer-android`):** Kotlin + Jetpack Compose + Material 3, com armazenamento criptografado no `Android Keystore / EncryptedSharedPreferences`.
3. **App iOS Nativo (`apps/customer-ios`):** Swift + SwiftUI, com armazenamento seguro no `iOS Keychain`.

### Idioma Padrão e Moeda
- **Idioma Padrão:** Inglês (`en`), alternável a qualquer momento no seletor de idioma para Português do Brasil (`pt-BR`). A escolha é salva automaticamente no banco (`PATCH /v1/me/preferences`).
- **Moeda Invariável:** Real Brasileiro (`BRL`), calculado em centavos inteiros. Alternar entre `en` e `pt-BR` altera apenas a formatação (`R$ 62.32` vs. `R$ 62,32`).

---

## 2. Jornada Passo a Passo do Consumidor

### 2.1 Autenticação e Cadastro de Endereço (`/auth` e `/account/addresses`)
1. Acesse `/auth` para entrar com suas credenciais Supabase Auth.
2. Em `/account/addresses` (`GET` / `POST /v1/me/addresses`), cadastre seu endereço completo com rua, número, complemento, bairro, CEP e coordenadas (`latitude`, `longitude`).

### 2.2 Descoberta de Lojas e Elegibilidade de Cobertura (`/` e `/stores/[storeSlug]`)
1. Na tela inicial (`/`), busque restaurantes ou mercados por nome ou filtre por categoria culinária (`GET /v1/stores`). Apenas lojas com `status = 'ACTIVE'` e `is_published = true` são exibidas.
2. Ao abrir uma loja (`/stores/[storeSlug]`), o sistema consulta `GET /v1/stores/:storeId/availability` no fuso `America/Sao_Paulo` e calcula a distância geodésica Haversine até seu endereço, informando se o endereço está coberto, o frete em centavos `BRL` e o tempo estimado.

### 2.3 Sacola de Loja Única e Complementos (`/stores/[storeSlug]`)
1. Selecione um produto e escolha seus complementos respeitando os limites `minSelections` e `maxSelections` de cada grupo (`CatalogOptionGroupContract`).
2. **Regra de Loja Única:** Caso sua sacola já contenha itens de outra loja, o sistema solicita confirmação explícita antes de limpar a sacola anterior e iniciar uma nova loja.

### 2.4 Cupom, Cotação no Servidor e Checkout (`/checkout`)
1. Escolha a modalidade de entrega suportada pela loja:
   - `PLATFORM_DELIVERY` (Entrega por entregador parceiro da plataforma)
   - `MERCHANT_DELIVERY` (Entrega própria da loja)
   - `PICKUP` (Retirada no balcão da loja — isenta de taxa de entrega)
2. Se desejar, aplique um cupom promocional (`POST /v1/promotions/redeem`), que valida e reserva atomicamente o saldo de orçamento da campanha.
3. O checkout solicita uma **Cotação Autoritativa no Servidor** (`POST /v1/quotes` com `X-Idempotency-Key`), que congela preços, taxas e descontos em centavos `BRL` por 15 minutos (`TTL = 900s`).
4. Confirme o pedido (`POST /v1/orders` com `X-Idempotency-Key`). Mesmo em caso de duplo clique ou instabilidade de rede, a chave de idempotência garante que apenas 1 pedido seja criado.

### 2.5 Acompanhamento em Tempo Real, Substituições de Mercado (`M22`) e Código OTP (`/orders/[orderId]`)
1. Acompanhe o progresso do pedido (`CREATED` -> `PENDING_MERCHANT_ACCEPTANCE` -> `ACCEPTED` -> `PREPARING` -> `READY_FOR_PICKUP` -> `PICKED_UP` -> `DELIVERED`).
2. **Cancelamento na Janela Gratuita:** Enquanto o pedido estiver antes do aceite da loja e dentro da janela configurada (`120s`), você pode cancelá-lo diretamente (`POST /v1/orders/:orderId/commands` com `command: "CANCEL"`).
3. **Aprovação de Substituições de Mercado (`M22`):** Em pedidos de supermercado/mercearia com itens pesáveis ou em falta, caso o separador proponha um substituto, aprove (`APPROVE`) ou recuse (`REJECT`) diretamente na tela do pedido (`POST /v1/orders/:orderId/substitutions/:subId/respond`). Qualquer diferença a menor no peso da balança ou item indisponível gera reembolso parcial automático.
4. **Recebimento com Código OTP de 4 Dígitos:** Quando o entregador chegar ao endereço, informe o código OTP de 4 dígitos exibido no seu pedido para comprovar a entrega.

### 2.6 Avaliação Verificada, Suporte e Privacidade LGPD
- **Avaliação Verificada (`/orders/[orderId]/review`):** Após o pedido atingir `DELIVERED` ou `COMPLETED`, envie sua nota (`1..5`) e comentário (`POST /v1/orders/:orderId/reviews`).
- **Suporte e Reembolsos (`/orders/[orderId]/support`):** Abra um chamado vinculado ao pedido (`POST /v1/support/cases`), envie mensagens e anexe fotos/comprovantes.
- **Dispositivos e Privacidade LGPD (`/account/settings` e `/account/privacy`):**
  - Revogue sessões/dispositivos antigos (`POST /v1/me/devices/revoke`), removendo imediatamente o token de push.
  - Baixe seu pacote completo de portabilidade de dados em JSON (`GET /v1/me/lgpd-export`, LGPD Art. 18, V) ou solicite anonimização de conta (`POST /v1/me/privacy-requests`).
