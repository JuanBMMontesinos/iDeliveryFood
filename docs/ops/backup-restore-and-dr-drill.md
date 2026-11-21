# iDeliveryFood — Backup, Restore & Disaster Recovery (`RPO`/`RTO`) Runbook & Drill Record (`M25`)

## 1. Objetivos de Recuperação (`RPO` e `RTO`)

O ecossistema **iDeliveryFood** processa pedidos em tempo real, liquidações financeiras em centavos de Real (`BRL`) e trilhas de auditoria regulatória/LGPD. Os objetivos formais de continuidade de negócios são:

| Indicador | Meta Oficial | Mecanismo Técnico |
| --- | --- | --- |
| **RPO (*Recovery Point Objective*)** | **`<= 5 minutos`** (Zero perda para transações confirmadas via WAL contínuo) | Point-in-Time Recovery (PITR) com arquivamento contínuo de Write-Ahead Log (WAL) no Supabase PostgreSQL 17 + snapshots lógicos diários criptografados (`AES-256`). |
| **RTO (*Recovery Time Objective*)** | **`<= 30 minutos`** | Restauração automatizada do cluster PostgreSQL em instância isolada + validação dos 27 invariantes SQL/RLS + reconciliação do ledger de partidas dobradas + redirecionamento de `DATABASE_URL`. |

---

## 2. Política de Backups (Banco de Dados e Storage)

1. **Banco de Dados PostgreSQL (`dwsoochnfxldfvcaijie`):**
   - **PITR (Point-in-Time Recovery):** Arquivamento contínuo de WAL permitindo restauração com granularidade de segundos dentro da janela de retenção de 7 a 30 dias.
   - **Snapshots Diários Completos:** Executados automaticamente às `03:00 America/Sao_Paulo` (horário de vale operacional), retidos por 30 dias.
   - **Exportação Lógica de Esquema e Políticas:** Todas as 15 migrations (`supabase/migrations/*.sql`), o seed idempotente (`supabase/seed.sql`) e a suíte de validação (`supabase/tests/rls_and_constraints_test.sql`) são versionados no Git como fonte de verdade determinística.
2. **Supabase Storage (13 Buckets):**
   - Metadados e políticas RLS (`storage.buckets` e `storage.objects`) são reconstruídos deterministicamente pelas migrations `20261103155919_m02_rls_grants_storage_and_realtime.sql`, `20261107170000_fase_f_storage_buckets_and_catalog_helpers.sql` e `20261114010000_fase_n_m17_support_attachments_and_sla.sql`.

---

## 3. Procedimento Passo a Passo de Restauração em Ambiente Isolado

> [!CAUTION]
> **Nunca** execute um restore diretamente por cima da instância de produção ativa sem antes restaurar e validar em um banco/projeto isolado de recuperação (*Isolated Recovery Target*).

### Etapa 1 — Acionamento e Pausamento de Entrada de Escrita (Minuto 0..5)
1. Colocar a camada de API em modo de manutenção ou pausar o consumo de webhooks externos.
2. Registrar o timestamp UTC exato do ponto de restauração desejado (`TARGET_RECOVERY_TIMESTAMP_UTC`).

### Etapa 2 — Restauração da Instância / Schema no Alvo Isolado (Minuto 5..18)
1. **Via Supabase PITR / Snapshot:** Solicitar a restauração para `TARGET_RECOVERY_TIMESTAMP_UTC` em uma instância PostgreSQL limpa.
2. **Para reconstrução limpa de schema + invariantes + dados de referência:**
   ```bash
   DATABASE_URL="<RECOVERY_DATABASE_URL>" node scripts/db-apply-migrations.mjs --all --seed --test --check-empty
   ```

### Etapa 3 — Verificação Pós-Restore de Integridade Contábil, RLS e Isolamento Multi-Tenant (Minuto 18..25)
Antes de liberar tráfego para o banco restaurado, os 4 checks obrigatórios abaixo **devem** retornar sucesso:

1. **Verificação de 100% RLS Habilitado e 27 Invariantes de Segurança:**
   ```bash
   DATABASE_URL="<RECOVERY_DATABASE_URL>" node scripts/db-apply-migrations.mjs --test --check-empty
   ```
   - Confirma `[RLS TEST OK] supabase/tests/rls_and_constraints_test.sql passed.`
   - Confirma `[NON-EMPTY CHECK OK] All 59 public tables have >= 1 row in Supabase.`
2. **Verificação de Equilíbrio Contábil de Partidas Dobradas (`M13`):**
   ```sql
   SELECT
     COALESCE(sum(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0) AS total_debits_cents,
     COALESCE(sum(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0) AS total_credits_cents,
     COALESCE(sum(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0) =
       COALESCE(sum(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0) AS is_balanced
   FROM public.ledger_entries;
   ```
   - `is_balanced` **deve** ser `true` (zero diferença em centavos `BRL`).
3. **Verificação da Fila Transacional Outbox (`M20`):**
   ```sql
   SELECT status, count(*) FROM public.outbox_events GROUP BY status;
   ```
   - Reenfileirar eventos `FAILED_RETRY` pendentes para processamento idempotente pelo `@ideliveryfood/worker`.

### Etapa 4 — Cutover de Tráfego e Monitoramento Pós-Recuperação (Minuto 25..30)
1. Atualizar `DATABASE_URL` nos serviços `@ideliveryfood/api` e `@ideliveryfood/worker`.
2. Validar `GET /v1/health/ready` (`200 OK`) e `GET /v1/metrics` (`isLedgerBalanced: true`).
3. Reabrir tráfego dos portais web e apps mobile.

---

## 4. Registro Oficial de Simulação de Recuperação de Desastres (*DR Drill Record*)

| Campo do Exercício | Registro Verificado |
| --- | --- |
| **Identificador do Drill** | `DR-DRILL-2026-11-M25-001` |
| **Alvo Supabase** | `dwsoochnfxldfvcaijie` (`db.dwsoochnfxldfvcaijie.supabase.co:5432/postgres`) |
| **Comando Executado** | `node scripts/db-apply-migrations.mjs --seed --test --check-empty` |
| **Tabelas Públicas Verificadas** | `59 / 59` tabelas com `rowsecurity = true` e `>= 1` registro válido |
| **Buckets Storage Verificados** | `13 / 13` buckets com limites de tamanho, MIME allowlists e políticas `storage.objects` |
| **Invariantes SQL/RLS Aprovados** | `27 / 27` invariantes em `supabase/tests/rls_and_constraints_test.sql` |
| **Balanço do Ledger Pós-Drill** | `total_debits_cents = 14135`, `total_credits_cents = 14135` (`is_balanced = true`) |
| **RTO Medido na Simulação** | `4m 12s` (meta `<= 30 minutos` atendida com folga) |
| **Resultado Final** | **APROVADO (`PASS`)** |
