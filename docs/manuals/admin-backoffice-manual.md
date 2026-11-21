# iDeliveryFood — Manual do Backoffice Administrativo, Financeiro/Ledger, Logística, Suporte, Comercial, Marketing e Governança/Risco/LGPD (`apps/admin-web`) (`M13`–`M21`, `M25`)

## 1. Visão Geral e Requisitos de Segurança (`MFA aal2` & Segregação de Funções)

O portal **`apps/admin-web`** é a superfície de comando interno da plataforma **iDeliveryFood**. Todas as rotas administrativas e financeiras críticas exigem:
1. **Papel Interno Autorizado (`public.staff_scopes`):** `support_l1`, `support_l2`, `operations`, `logistics`, `finance`, `commercial`, `growth_marketing`, `risk_compliance`, `auditor_privacy` ou `tech_admin`.
2. **Autenticação Multifator Verificada (`aal = 'aal2'`):** Sessões em `aal1` recebem `403 DENIED_MFA_STEP_UP_REQUIRED` / `DENIED_MFA_AAL2_REQUIRED`.
3. **Segregação 4-Olhos:** Nenhum administrador pode conceder escopos a si mesmo (`DENIED_SELF_GRANT_FORBIDDEN`), aprovar um reembolso acima da alçada que ele próprio solicitou ou executar um repasse para conta bancária que ele mesmo aprovou.

---

## 2. Operação por Módulo do `admin-web`

### 2.1 Administração Central e Auditoria (`/admin` — `M16`)
- **Aprovações e Governança (`POST /v1/admin/governance-actions`):** Aprove, rejeite, suspenda ou reative organizações, lojas e entregadores informando justificativa obrigatória (`>= 5` caracteres).
- **Outorga de Escopos de Staff (`POST /v1/admin/staff-scopes`):** Exclusivo para `tech_admin` (`aal2`). Permite atribuir papéis internos e tetos de aprovação de reembolso (`maxRefundApprovalCents`) a outros membros da equipe.
- **Trilha de Auditoria (`GET /v1/admin/audit-logs`):** Consulta imutável de todas as ações críticas com `correlationId` e payloads redigidos (`redactSensitiveData`).

### 2.2 Backoffice Financeiro e Ledger de Partidas Dobradas (`/finance` — `M13`)
- **Painel Contábil (`GET /v1/finance/overview`):** Exibe GMV, Receita Líquida da Plataforma, Passivo de Lojas (`merchantPayablesCents`), Passivo de Entregadores (`courierPayablesCents`) e o indicador `isLedgerBalanced` (`totalDebitsCents === totalCreditsCents`).
- **Conciliação PSP (`POST /v1/finance/reconciliation-runs`):** Executa o batimento diário entre valores capturados no PSP e pedidos internos em centavos `BRL`, apontando discrepâncias (`discrepancyCount`, `discrepancyTotalCents`).
- **Execução de Repasses (`POST /v1/finance/settlements/:settlementId/execute`):** Liquida lotes de pagamento para lojas e entregadores (ou reporta `BLOCKED_NO_PSP` caso as credenciais bancárias externas não estejam injetadas no ambiente).

### 2.3 Operação Logística (`/logistics` — `M14`) e Governança de Frotas (`/fleets` — `M15`)
- **Despacho Logístico (`/logistics`):** Monitore tarefas de entrega (`OFFERING`, `ASSIGNED`, `PICKED_UP`, `DELIVERED`), ofertas enviadas, entregadores online e alertas de telemetria GPS (`isStaleOrLowAccuracy`).
- **Governança de Frotas (`/fleets`):** Verifique o status da política `feature_fleet_operators_enabled` (`false` por padrão) e os operadores cadastrados.

### 2.4 Suporte, Disputas, SLAs e Alçada Financeira (`/support` — `M17`)
- **Fila de Chamados (`GET /v1/support/overview`):** Prioriza automaticamente chamados `CRITICAL_IN_ROUTE` (SLA 15 min) e `HIGH` (SLA 30 min).
- **Notas e Anexos Internos:** Ao registrar uma mensagem com `isInternalNote: true` ou anexo com `isInternalOnly: true`, o conteúdo fica visível exclusivamente para a equipe interna, sendo filtrado nas respostas ao cliente e à loja.
- **Reembolsos e Escalonamento 4-Olhos:**
  - Solicitações `<= R$ 15,00` (`1500` centavos) são aprovadas e estornadas automaticamente.
  - Solicitações `> R$ 15,00` entram como `PENDING_FINANCE` e devem ser decididas por um analista `finance` (`aal2`) distinto do solicitante em `POST /v1/support/action-requests/:requestId/decide`.

### 2.5 Comercial B2B (`/commercial` — `M18`) e Marketing / Moderação (`/marketing` — `M19`)
- **Funil Comercial B2B (`/commercial`):** Cadastre leads (`POST /v1/commercial/leads`), emita propostas com taxas em `bps` (`POST /v1/commercial/leads/:id/proposals`) e converta propostas aceitas em organizações, lojas draft, contratos versionados e regras de comissão (`POST /v1/commercial/proposals/:id/convert`).
- **Campanhas e Moderação (`/marketing`):** Crie cupons (`PLATFORM`, `STORE`, `SHARED`) com teto de orçamento atômico em centavos `BRL` (`POST /v1/promotions`) e modere avaliações de pedidos (`POST /v1/marketing/reviews/:id/moderate`).

### 2.6 Governança Analítica, Risco Explicável, LGPD (`/governance` — `M21`) e Métricas (`/v1/metrics` — `M25`)
- **Analytics (`/governance/analytics`):** Consulte KPIs reconciliados com o ledger (`GET /v1/governance/analytics/kpis?excludeTestData=true`) e gere exportações CSV/JSON auditadas (`POST /v1/governance/analytics/export`).
- **Risco Explicável (`/governance/risk`):** Revise alertas `OPEN_AWAITING_HUMAN_REVIEW` inspecionando a explicação determinística (`observedValue` vs. `thresholdValue`) e registre a decisão humana obrigatória (`POST /v1/governance/risk/alerts/:id/review`).
- **Privacidade LGPD (`/governance/privacy`):** Processe pedidos de portabilidade JSON e exclusão/anonimização (`POST /v1/governance/privacy/requests/:id/process`), respeitando o bloqueio automático de retenção fiscal de 5 anos (`RETENTION_HOLD`).
- **Telemetria Operacional (`GET /v1/metrics`):** Inspecione latências HTTP (`p50`/`p95`/`p99`), falhas de webhook PSP, backlog do outbox, `DEAD_LETTER` e alertas ativos em JSON ou formato Prometheus (`?format=prometheus`).
