# iDeliveryFood — Deploy, Zero-Downtime Expand/Contract Migrations & Rollback Runbook (`M25`)

## 1. Visão Geral e Princípios Operacionais

Este runbook define o procedimento oficial de implantação (*deployment*), evolução de esquema PostgreSQL/Supabase sem indisponibilidade (*Zero-Downtime Expand/Contract*) e reversão segura (*rollback*) para todos os serviços e superfícies do ecossistema **iDeliveryFood**:

- **Serviços Backend:** `@ideliveryfood/api` (`apps/api`) e `@ideliveryfood/worker` (`apps/worker`).
- **Portais Web Next.js:** `apps/customer-web`, `apps/partner-web` e `apps/admin-web`.
- **Apps Nativos Mobile:** `apps/customer-android`, `apps/courier-android` (Kotlin + Jetpack Compose) e `apps/customer-ios`, `apps/courier-ios` (Swift + SwiftUI).
- **Banco de Dados e Storage:** Supabase (`dwsoochnfxldfvcaijie`, PostgreSQL 17, 59 tabelas com RLS 100% ativo e 13 buckets Storage).

---

## 2. Pré-Requisitos e Gates Obrigatórios de Pré-Deploy (CI/CD `M25`)

Nenhum deploy para `staging` ou `production` é autorizado sem que todos os 6 jobs do pipeline `.github/workflows/ci.yml` estejam verdes (`exit code 0`):

1. **`security-and-secret-scan`:**
   - `node scripts/secret-scan.mjs` (zero chaves privadas, zero `.env` versionado, zero `service_role` exposto).
   - `node scripts/security-and-hardcode-scan.mjs` (zero `Map` de persistência mockada em memória, zero fallback silencioso de UUID/endereço).
2. **`lint-and-typecheck`:**
   - `pnpm lint && pnpm typecheck && pnpm build` nos 14 projetos TypeScript do monorepo.
3. **`unit-and-integration-tests`:**
   - `pnpm test:unit:coverage` (cobertura de linhas, branches e funções `>= 80%`).
   - `pnpm --filter @ideliveryfood/api test` (`41+` testes de contrato e integração contra o Supabase real).
   - `pnpm test:e2e` (`11/11` jornadas E2E, concorrência, idempotência e acessibilidade WCAG 2.1 AA).
4. **`sql-migrations-and-rls`:**
   - `node scripts/db-apply-migrations.mjs --seed --test --check-empty` (`27/27` invariantes SQL/RLS aprovados e `59/59` tabelas populadas).
5. **`android-native-check` & `ios-native-check`:**
   - Verificação de recursos bilíngues (`en` e `pt-BR`) e execução de `swift test` nos pacotes nativos iOS.

---

## 3. Padrão *Expand / Contract* para Migrações de Banco de Dados Zero-Downtime

Para garantir que instâncias da versão anterior (`vN`) e da nova versão (`vN+1`) da API e do Worker coexistam durante o rollout sem erro de SQL:

### Fase 1 — *Expand* (Compatível com `vN` e `vN+1`)
- Novas tabelas e colunas devem ser adicionadas de forma aditiva (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- Novas colunas em tabelas existentes devem possuir `DEFAULT` explícito ou aceitar `NULL` inicialmente.
- Novos valores de `ENUM` devem usar `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.
- **Nunca** renomear ou remover (`DROP COLUMN` / `DROP TABLE`) uma coluna ou view lida pela versão `vN` em produção durante o deploy da versão `vN+1`.
- Toda nova tabela deve habilitar RLS na própria migration (`ALTER TABLE public.<tabela> ENABLE ROW LEVEL SECURITY;`) e declarar suas políticas baseadas em `app_security.*`.

### Fase 2 — *Deploy Application (`vN+1`)*
1. Aplicar as migrations aditivas:
   ```bash
   node scripts/db-apply-migrations.mjs --test
   ```
2. Implantar `@ideliveryfood/worker` (`vN+1`) e `@ideliveryfood/api` (`vN+1`) em estratégia *rolling update* ou *blue/green*.
3. Verificar probes de saúde e prontidão:
   - `GET /v1/health/live` -> HTTP `200` (`{"status":"ALIVE"}`)
   - `GET /v1/health/ready` -> HTTP `200` (`{"status":"READY","databaseProjectRef":"dwsoochnfxldfvcaijie"}`)
   - `GET /v1/system/providers` -> HTTP `200` (status honesto de provedores externos: `ACTIVE`, `SANDBOX_READY` ou `BLOCKED_MISSING_CREDENTIALS`).
   - `GET /v1/metrics` (autenticado com `tech_admin` + `aal2`) -> HTTP `200` (`isLedgerBalanced: true`, `outboxDeadLetterCount: 0`, `http5xxCount: 0`).
4. Implantar os portais Next.js (`customer-web`, `partner-web`, `admin-web`).

### Fase 3 — *Contract* (Limpeza em Release Subsequente `vN+2`)
- Somente após confirmar que 100% do tráfego roda em `vN+1` e nenhuma query referencia colunas legadas, agendar migration de limpeza em janela controlada.

---

## 4. Governança de Feature Flags (`public.platform_policies`)

Recursos modulares de expansão (`M15`, `M22`, anúncios e assinaturas) são governados por flags persistidas em `public.platform_policies` (`policy_key = 'DEFAULT_BR_MARKETPLACE'`):

| Coluna em `public.platform_policies` | Módulo | Valor Padrão | Efeito quando `false` |
| --- | --- | --- | --- |
| `feature_fleet_operators_enabled` | `M15` — Operadores de Frota Terceirizada | `false` | Bloqueia mutações de frota com `403 FLEET_FEATURE_DISABLED` |
| `feature_grocery_picking_enabled` | `M22` — Separação, Pesagem e Substituições | `false` | Bloqueia rotas de picking com `403 FEATURE_DISABLED_BY_POLICY` |
| `feature_sponsored_ads_enabled` | `M19` — Patrocínios e Destaques | `false` | Desativa leilão patrocinado na descoberta |
| `feature_subscriptions_enabled` | `M19` — Clube de Assinaturas | `false` | Desativa cobrança recorrente de assinatura |

Para desativar imediatamente um módulo em produção sem redeploy de código (*kill-switch* operacional):
```sql
UPDATE public.platform_policies
SET feature_grocery_picking_enabled = false,
    updated_at = timezone('utc', now())
WHERE policy_key = 'DEFAULT_BR_MARKETPLACE';
```

---

## 5. Procedimento de Rollback Seguro

### 5.1 Critérios de Gatilho Imediato de Rollback
Execute rollback imediato se qualquer uma das condições abaixo persistir por mais de **3 minutos** após o deploy:
- Taxa de erro HTTP `5xx` `> 1%` em `/v1/metrics`.
- Latência `p95` HTTP `> 1500ms` (`ALERT_HTTP_P95_LATENCY_SLO_BREACH`).
- Alerta crítico `ALERT_LEDGER_IMBALANCE_DETECTED` (`totalDebitsCents !== totalCreditsCents`).
- Falha nas probes `/v1/health/live` ou `/v1/health/ready`.

### 5.2 Passo a Passo de Rollback da Aplicação (`API`, `Worker` e Portais Web)
1. **Congelar flags novas (se aplicável):** Reverter flags recém-ativadas em `public.platform_policies` para `false`.
2. **Reverter containers/builds da aplicação para o SHA estável anterior (`vN`):**
   ```bash
   git checkout <SHA_ANTERIOR_ESTAVEL>
   pnpm install --frozen-lockfile
   pnpm build
   ```
3. **Reiniciar `@ideliveryfood/api` e `@ideliveryfood/worker` na versão `vN`:**
   - Como as migrations seguem o padrão aditivo *Expand/Contract*, o código `vN` opera normalmente sobre o schema expandido sem perda de dados.
4. **Validar recuperação pós-rollback:**
   - Confirmar `GET /v1/health/live` (`200`), `GET /v1/health/ready` (`200`) e `GET /v1/metrics` (`http5xxCount` estabilizado e `isLedgerBalanced: true`).
   - Executar `node scripts/db-apply-migrations.mjs --test` para atestar que os 27 invariantes de RLS e constraints permanecem íntegros.

### 5.3 Proibição de Rollback Destrutivo em Tabelas Append-Only
- **Nunca** executar `DELETE` ou `TRUNCATE` em `public.order_events`, `public.ledger_journals`, `public.ledger_entries` ou `public.audit_logs` durante um rollback.
- Correções financeiras pós-incidente devem ser registradas exclusivamente via lançamentos compensatórios de partidas dobradas (`ORDER_REFUND` / ajuste contábil auditado).
