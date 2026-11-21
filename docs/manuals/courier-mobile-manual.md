# iDeliveryFood — Manual do Entregador (Apps Nativos Android e iOS) (`M11`, `M14`, `M17`)

## 1. Aplicativos Nativos do Entregador

O entregador parceiro opera exclusivamente através dos aplicativos mobile **100% nativos** do **iDeliveryFood**:
1. **Android Nativo (`apps/courier-android`):** Kotlin + Jetpack Compose + Material 3 (`EncryptedSharedPreferences` / Keystore).
2. **iOS Nativo (`apps/courier-ios`):** Swift + SwiftUI (`iOS Keychain`).

Ambos os aplicativos iniciam em **Inglês (`en`)** por padrão e permitem alternar a qualquer momento para **Português do Brasil (`pt-BR`)**, mantendo todos os valores de ganhos e repasses em centavos de **Real (`BRL`)**.

---

## 2. Jornada Operacional do Entregador

### 2.1 Credenciamento (KYC), Veículo e Turno Online
1. Realize login no aplicativo e envie seus documentos de habilitação/veículo para o bucket privado `courier-documents` via URL assinada (`POST /v1/storage/signed-upload-url`).
2. Após aprovação do cadastro (`approval_status = 'APPROVED'`), ative o status **Online** na tela principal para receber ofertas na sua região operacional (ex.: `SP-CAPITAL`).

### 2.2 Recebimento e Aceite de Oferta (Privacidade Pré-Aceite)
1. Ao receber uma oferta (`OFFERED`), o cartão de oferta exibe:
   - Nome e endereço da **loja de coleta** (`pickupStoreName`).
   - Distância estimada em metros (`distanceMeters`).
   - Valor do ganho da entrega em centavos `BRL` (`offeredFeeCents`).
   - **Apenas o bairro de entrega (`dropoffNeighborhoodOnly`)** — por segurança e privacidade do consumidor, a rua e o número do cliente não são exibidos antes do aceite.
2. Toque em **Aceitar Oferta** (`POST /v1/logistics/offers/:offerId/accept` com `X-Idempotency-Key`):
   - O servidor garante por trava transacional (`FOR UPDATE` + índice único `uq_delivery_assignments_one_active`) que apenas 1 entregador receba a corrida.
   - Imediatamente após o aceite (`200 OK`), o endereço completo do cliente (`dropoffFullAddress`) é revelado no aplicativo.

### 2.3 Coleta na Loja e Telemetria GPS em Rota
1. Dirija-se à loja indicada e confirme a coleta quando o pedido estiver pronto (`READY_FOR_PICKUP` -> `PICKED_UP`).
2. Durante o deslocamento, o aplicativo transmite amostras periódicas de localização (`POST /v1/logistics/location-samples`) contendo `latitude`, `longitude`, `accuracyMeters` e `recordedAtIso`.
3. O servidor valida automaticamente amostras atrasadas (`> 120s`) ou de baixa precisão (`> 80m`) sem interromper sua navegação.

### 2.4 Conclusão da Entrega com Código OTP de 4 Dígitos
1. Ao chegar ao endereço do cliente, solicite o **código de confirmação de 4 dígitos (OTP)** exibido no aplicativo/portal do consumidor.
2. Digite os 4 dígitos no aplicativo e envie (`POST /v1/logistics/tasks/:taskId/complete` com `X-Idempotency-Key`):
   - Se o código estiver incorreto, a API retorna `409 DELIVERY_OTP_MISMATCH` e mantém a tarefa aberta.
   - Se o código estiver correto (`200 OK`), a tarefa e o pedido transitam para `DELIVERED` e seu ganho (`courierEarningsCents`) é creditado na sua conta contábil `LIABILITY_COURIER_*`.

### 2.5 Extrato de Ganhos e Suporte Crítico em Rota (`M17`)
- **Ganhos e Repasses:** Consulte na aba de Ganhos o saldo acumulado em centavos `BRL` e os lotes de liquidação (`settlements`).
- **Incidente em Rota (`ROUTE_INCIDENT`):** Em caso de acidente, avaria do pedido ou cliente ausente durante uma entrega ativa, abra um chamado de suporte informando `category: "ROUTE_INCIDENT"` (`POST /v1/support/cases`). O sistema classifica automaticamente o chamado como **`CRITICAL_IN_ROUTE`** com SLA prioritário de **15 minutos**.
