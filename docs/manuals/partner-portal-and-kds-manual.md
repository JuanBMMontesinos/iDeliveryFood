# iDeliveryFood — Manual do Parceiro Comercial, Gestão de Cardápio, KDS em Tempo Real, Multiunidades e Separação de Mercado (`M04`, `M07`, `M08`, `M09`, `M22`)

## 1. Perfis de Acesso no Portal do Parceiro (`apps/partner-web`)

O portal web do parceiro (`apps/partner-web`) isola rigorosamente os dados por organização (`organization_id`) e unidade (`store_id`) através de 7 papéis em `public.organization_members`:

| Papel (`partner_role`) | Permissões Principais | Restrições de Segregação |
| :--- | :--- | :--- |
| `partner_owner` | Acesso total à organização, aceite formal de contrato comercial (`M18`), gestão de equipe, financeiro e solicitação de alteração bancária (exige **MFA `aal2`**). | — |
| `partner_manager` | Gestão operacional da(s) loja(s), horários, áreas de cobertura, cardápio, KDS, picking e resposta a avaliações. | Não altera conta bancária nem aceita contrato societário. |
| `partner_operator` | Operação de cozinha no KDS (`/kitchen`), separação/pesagem de mercado (`/picking`) e pausa emergencial da loja. | **Bloqueado (`403`)** no painel financeiro (`/finance`) e em alterações contratuais. |
| `partner_catalog` | Gestão de categorias, produtos, preços em centavos `BRL`, complementos e propagação em lote (`M09`). | **Bloqueado (`403`)** no painel financeiro (`/finance`). |
| `partner_finance` | Acesso ao extrato financeiro da organização/loja (`/finance`), comissões, conciliação e lotes de repasse (`settlements`). | Não executa comandos operacionais de cozinha. |
| `partner_marketing` | Criação de cupons financiados pela loja (`STORE`/`MERCHANT`) e resposta a avaliações. | Bloqueado no financeiro. |
| `partner_support` | Visualização e resposta a chamados de suporte vinculados à loja (`/support`). | Bloqueado no financeiro. |

---

## 2. Operação Diária da Loja

### 2.1 Configurações Operacionais, Horários e Cobertura (`/store/settings`, `/store/hours`, `/store/coverage`)
1. **Pausa Operacional e Tempo de Preparo (`/store/settings`):**
   - Ative ou desative a pausa temporária (`isPaused`), defina o pedido mínimo em centavos `BRL` (`minOrderCents`) e os limites de preparo (`prepTimeMinMinutes`, `prepTimeMaxMinutes`).
   - Pausar a loja impede novos checkouts imediatamente, mas **preserva todos os pedidos já aceitos no KDS** até sua conclusão.
2. **Grade Semanal e Feriados (`/store/hours`):**
   - Configure horários por dia da semana (`0 = Domingo` a `6 = Sábado`) no fuso `America/Sao_Paulo`, incluindo turnos *overnight* (`isOvernight = true`), e cadastre exceções de feriados (`POST /v1/partner/stores/:storeId/hour-exceptions`).
3. **Áreas de Cobertura (`/store/coverage`):**
   - Cadastre raios de entrega em metros (`500m` a `50000m`), taxa base (`baseFeeCents`), adicional por km (`perKmFeeCents`) e piso de frete grátis (`freeDeliveryMinOrderCents`).

### 2.2 Gestão Visual de Cardápio e Mídia (`/catalog`)
1. Crie e ordene categorias bilíngues (`nameEn` e `namePtBr`).
2. Cadastre produtos com preço em centavos inteiros (`priceCents`), limite por pedido (`maxPerOrder`) e unidade (`UNIT`, `GRAM`, `KG`).
3. Adicione grupos de complementos (`minSelections <= maxSelections`) e opções individuais (`additionalPriceCents`).
4. Faça upload de fotos de produtos gerando URL assinada (`POST /v1/storage/signed-upload-url`) no bucket público `catalog-media` (`image/jpeg`, `image/png`, `image/webp` até 5 MB).

### 2.3 Console de Cozinha em Tempo Real — KDS (`/kitchen` — `M08`)
1. Os pedidos capturados entram automaticamente na coluna **`NEW`** com cronômetro regressivo de SLA.
2. Utilize os comandos transacionais com controle de versão (`expectedVersion`):
   - **`ACCEPT`** (`NEW` -> `PREPARING`) ou **`REJECT`** (com motivo estruturado).
   - **`START_PREPARING`** -> inicia o preparo na cozinha.
   - **`MARK_READY`** (`PREPARING` -> `READY_FOR_PICKUP`) -> aciona a coleta pelo entregador ou notifica o cliente para retirada (`PICKUP`).
3. Em caso de queda momentânea de internet, o KDS reconcilia e deduplica automaticamente os eventos perdidos ao reconectar.

### 2.4 Separação, Pesagem em Balança e Substituições para Mercados (`/picking` — `M22`)
1. Em lojas com `feature_grocery_picking_enabled = true`, inicie a separação do pedido (`POST /v1/partner/stores/:storeId/picking/tasks`).
2. **Pesagem em Balança:** Informe o peso real em gramas (`actualWeightGrams`) em `POST /v1/partner/pick-tasks/:pickTaskId/items/:orderItemId/weigh`. O sistema calcula o valor em centavos `BRL` com arredondamento `HALF_UP`.
3. **Item Indisponível / Substituição:**
   - Se a preferência do cliente for `REFUND_IF_UNAVAILABLE`, marque como indisponível para reembolso parcial automático.
   - Se permitir sugestão (`ALLOW_SUGGESTION`), proponha um item substituto e aguarde a aprovação do cliente antes de finalizar a tarefa (`POST /v1/partner/pick-tasks/:pickTaskId/complete`).

### 2.5 Portal Multiunidade / Franquias (`/chain` — `M09`) e Financeiro (`/finance`)
- **Multiunidades (`/chain`):** Compare pedidos ativos e GMV entre filiais (`GET /v1/organizations/:orgId/units-summary`) e execute atualizações de preço ou disponibilidade em lote por SKU (`POST /v1/organizations/:orgId/catalog/batch`), com modo de simulação (`dryRun: true`).
- **Financeiro e Conta Bancária (`/finance`):** Consulte o razão contábil da organização (`LIABILITY_MERCHANT_*`), repasses agendados e solicite alteração de conta bancária (`POST /v1/stores/:storeId/bank-account-change-request`), que exige papel `partner_owner` + **MFA `aal2`** e permanece em status `PENDING` até aprovação pela equipe financeira da plataforma.
