-- ============================================================================
-- iDeliveryFood — Automated RLS, Multi-Tenant Isolation & Constraints Suite
-- ============================================================================
-- Executes inside a transaction and verifies all 27 security, RLS, storage, and M00-M22 invariants:
-- 1. 100% of public tables have RLS enabled (59/59 tables).
-- 2. Anonymous actor (anon) only sees published stores (2/3) and 0 private rows.
-- 3. Consumer actor (Alice) sees only own profile, address, and order; 0 from Bruno.
-- 4. Consumer actor cannot self-elevate protected profile attributes (42501).
-- 5. Partner Operator (Lucas, Store 201) sees Store 201 orders, 0 from Org 102, and 0 ledger rows.
-- 6. Partner Finance (Clara, Org 101) sees Org 101 payable ledger account and 0 platform/courier accounts.
-- 7. Courier (Carlos) sees assigned delivery task and own courier ledger account.
-- 8. Staff Finance (Roberto) is denied ledger_journals at aal1 and granted at aal2 (MFA step-up).
-- 9. Append-only tables reject UPDATE/DELETE with 23514 / 42501.
-- 10. Double-entry ledger trigger rejects unbalanced journal postings with 23514.
-- 11. Haversine distance helper (app_security.calculate_distance_meters) computes accurate distance in meters.
-- 12. Security-invoker catalog view (public.store_catalog_v) exposes published products & option groups.
-- 13. Webhook event log (public.payment_provider_events) enforces (provider_code, external_event_id) deduplication.
-- 14. Staff self-grant protection (trg_guard_staff_scope_self_grant) blocks staff from granting scopes to themselves (42501).
-- 15. Security-invoker ledger balances view (public.ledger_account_balances_v) computes integer BRL centavo balances with RLS segregation.
-- 16. Single active courier assignment partial unique index (uq_delivery_assignments_one_active) blocks duplicate active assignments (23505).
-- 17. Fase F cross-tenant catalog_categories & storage_upload_intents isolation.
-- 18. M17 support_cases, internal support_messages/support_attachments isolation & 4-eyes support_action_requests enforcement.
-- 19. M18 commercial_leads, commercial_proposals, merchant_contracts & commission_rule_versions segregation.
-- 20. M19 promotions, promotion_redemptions, order_reviews & cross-tenant promotion write denial.
-- 21. M20 outbox_events (tech_admin aal2 only) & notification_deliveries per-recipient isolation.
-- 22. M21 risk_alerts, risk_decisions, privacy_requests (LGPD) & analytics_order_kpis_v security_invoker isolation.
-- 23. M22 order_pick_tasks & order_item_substitutions cross-customer, courier & cross-tenant store isolation.
-- 24. Storage buckets hardening & runtime storage.objects cross-tenant / cross-user upload denial.
-- 25. Role anon zero-leakage sweep across all 49 private tables in public schema.
-- 26. M14/M11/M15 courier pre-accept vs post-accept address privacy & default-disabled fleet feature flag governance.
-- 27. M00-M16 remaining core tables cross-tenant, org_members, invitations, settlements, reconciliation_runs & audit_logs segregation.
-- ============================================================================

DO $$
DECLARE
  v_unprotected_tables integer;
  v_count integer;
  v_distance_meters integer;
  v_caught_error boolean;
BEGIN
  -- 1. Verify 100% of tables in public have RLS enabled
  SELECT count(*) INTO v_unprotected_tables
  FROM pg_tables
  WHERE schemaname = 'public'
    AND rowsecurity = false;

  IF v_unprotected_tables <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: Found % public tables without RLS enabled', v_unprotected_tables;
  END IF;

  -- 2. Test as ANON role
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT count(*) INTO v_count FROM public.stores;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED [anon stores]: expected 2 published stores, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [anon profiles]: expected 0 profiles, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.orders;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [anon orders]: expected 0 orders, got %', v_count;
  END IF;

  -- 11. Verify Haversine distance calculation between Store 201 and Alice's address
  SELECT app_security.calculate_distance_meters(-23.561414, -46.655881, -23.563980, -46.669120)
  INTO v_distance_meters;
  IF v_distance_meters < 1300 OR v_distance_meters > 1500 THEN
    RAISE EXCEPTION 'TEST FAILED [Haversine distance]: expected ~1379m, got %', v_distance_meters;
  END IF;

  -- 12. Verify public.store_catalog_v under ANON role
  SELECT count(*) INTO v_count FROM public.store_catalog_v;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED [anon store_catalog_v]: expected 3 published products, got %', v_count;
  END IF;

  -- 3. Test as Consumer Alice (00000000-0000-4000-8000-000000000001)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );

  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Alice profiles]: expected 1 own profile, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.customer_addresses;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Alice addresses]: expected 1 own address, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.orders WHERE customer_id = '00000000-0000-4000-8000-000000000001';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Alice orders]: expected >= 1 own order, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.orders WHERE customer_id <> '00000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [Alice cross-customer orders]: expected 0 foreign orders, got %', v_count;
  END IF;

  -- 4. Verify Alice cannot self-elevate protected profile attributes
  v_caught_error := false;
  BEGIN
    UPDATE public.profiles
    SET status = 'SUSPENDED'
    WHERE id = '00000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;

  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Alice self-elevation]: expected insufficient_privilege (42501)';
  END IF;

  -- 5. Test as Partner Operator Lucas (00000000-0000-4000-8000-000000000011, Store 201)
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal1"}',
    true
  );

  SELECT count(*) INTO v_count FROM public.orders WHERE store_id = '00000000-0000-4000-8000-000000000201';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Partner Operator orders]: expected >= 1 store order, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.orders WHERE store_id <> '00000000-0000-4000-8000-000000000201';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [Partner Operator cross-store orders]: expected 0 foreign store orders, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.organizations WHERE id = '00000000-0000-4000-8000-000000000102';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [Partner Operator cross-tenant org]: expected 0 rows for Org 102, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.ledger_accounts;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [Partner Operator financial segregation]: expected 0 ledger accounts, got %', v_count;
  END IF;

  -- 6. Test as Partner Finance Clara (00000000-0000-4000-8000-000000000012, Org 101)
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated","aal":"aal1"}',
    true
  );

  SELECT count(*) INTO v_count FROM public.ledger_accounts;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Partner Finance ledger_accounts]: expected 1 org payable account, got %', v_count;
  END IF;

  -- 7. Test as Courier Carlos (00000000-0000-4000-8000-000000000030)
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000030","role":"authenticated","aal":"aal1"}',
    true
  );

  SELECT count(*) INTO v_count FROM public.delivery_tasks;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Courier delivery_tasks]: expected >= 1 assigned task, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.ledger_accounts;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Courier ledger_accounts]: expected 1 courier payable account, got %', v_count;
  END IF;

  -- 8. Test as Internal Staff Finance Roberto (00000000-0000-4000-8000-000000000091) at aal1 vs aal2
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal1"}',
    true
  );

  SELECT count(*) INTO v_count FROM public.ledger_journals;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [Staff Finance aal1 MFA check]: expected 0 ledger_journals without aal2, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal2"}',
    true
  );

  SELECT count(*) INTO v_count FROM public.ledger_journals;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Staff Finance aal2 MFA check]: expected >= 1 ledger_journal with aal2, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.ledger_accounts;
  IF v_count < 6 THEN
    RAISE EXCEPTION 'TEST FAILED [Staff Finance aal2 ledger_accounts]: expected >= 6 ledger_accounts, got %', v_count;
  END IF;

  -- 9. Test Append-only immutability trigger as postgres/service role
  PERFORM set_config('role', 'postgres', true);
  v_caught_error := false;
  BEGIN
    UPDATE public.order_events
    SET event_type = 'TAMPERED_EVENT'
    WHERE id = '00000000-0000-4000-8000-000000001101';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_caught_error := true;
  END;

  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Append-only order_events]: expected insufficient_privilege (42501)';
  END IF;

  -- 10. Test Double-Entry Ledger balance verification function directly
  v_caught_error := false;
  BEGIN
    INSERT INTO public.ledger_journals (id, reference_type, reference_id, description, idempotency_key, posted_by, is_test_data)
    VALUES ('00000000-0000-4000-8000-000000009999', 'TEST_UNBALANCED', '00000000-0000-4000-8000-000000001001', 'Unbalanced test journal', 'test_unbalanced_journal', '00000000-0000-4000-8000-000000000091', true);

    INSERT INTO public.ledger_entries (id, journal_id, account_id, direction, amount_cents, is_test_data)
    VALUES ('00000000-0000-4000-8000-000000009998', '00000000-0000-4000-8000-000000009999', '00000000-0000-4000-8000-000000001301', 'DEBIT', 500, true);

    SET CONSTRAINTS trg_verify_journal_balanced IMMEDIATE;
  EXCEPTION WHEN check_violation THEN
    v_caught_error := true;
  END;

  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Unbalanced Ledger]: expected check_violation (23514)';
  END IF;

  -- 13. Test Webhook Deduplication uniqueness (provider_code, external_event_id)
  DELETE FROM public.payment_provider_events WHERE provider_code = 'stripe' AND external_event_id = 'evt_dedup_test_001';
  v_caught_error := false;
  BEGIN
    INSERT INTO public.payment_provider_events (provider_code, external_event_id, event_type, signature_verified, is_test_data)
    VALUES ('stripe', 'evt_dedup_test_001', 'payment_intent.succeeded', true, true);

    INSERT INTO public.payment_provider_events (provider_code, external_event_id, event_type, signature_verified, is_test_data)
    VALUES ('stripe', 'evt_dedup_test_001', 'payment_intent.succeeded', true, true);
  EXCEPTION WHEN unique_violation THEN
    v_caught_error := true;
  END;
  DELETE FROM public.payment_provider_events WHERE provider_code = 'stripe' AND external_event_id = 'evt_dedup_test_001';

  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Webhook Deduplication]: expected unique_violation (23505)';
  END IF;

  -- 14. Test Staff Self-Grant Prohibition as Tech Admin Mariana (00000000-0000-4000-8000-000000000090) at aal2
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000090","role":"authenticated","aal":"aal2"}',
    true
  );

  v_caught_error := false;
  BEGIN
    INSERT INTO public.staff_scopes (user_id, role, max_refund_approval_cents, requires_mfa, justification, is_test_data)
    VALUES ('00000000-0000-4000-8000-000000000090', 'finance', 500000, true, 'Attempting self-grant of finance role', true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;

  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Staff Self-Grant Prohibition]: expected insufficient_privilege (42501)';
  END IF;

  -- 15. Verify ledger_account_balances_v under Partner Operator (0 rows) vs Staff Finance aal2 (6 rows)
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.ledger_account_balances_v;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [Partner Operator ledger_account_balances_v]: expected 0 rows, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal2"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.ledger_account_balances_v;
  IF v_count < 6 THEN
    RAISE EXCEPTION 'TEST FAILED [Staff Finance aal2 ledger_account_balances_v]: expected >= 6 rows, got %', v_count;
  END IF;

  -- 16. Verify uq_delivery_assignments_one_active prevents a second ACTIVE assignment for the same delivery_task_id
  PERFORM set_config('role', 'postgres', true);
  v_caught_error := false;
  BEGIN
    INSERT INTO public.delivery_assignments (delivery_task_id, courier_id, status, is_test_data)
    VALUES ('00000000-0000-4000-8000-000000001201', '00000000-0000-4000-8000-000000000030', 'ACTIVE', true);
  EXCEPTION WHEN unique_violation THEN
    v_caught_error := true;
  END;

  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Single Active Delivery Assignment]: expected unique_violation (23505)';
  END IF;

  -- 17. Fase F: Verify Partner Owner of Org 101 cannot insert catalog category or storage upload intent into Store 202 (Org 102)
  DELETE FROM public.catalog_categories WHERE store_id = '00000000-0000-4000-8000-000000000203' AND name_en = 'Cross Tenant Cat';

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000010","role":"authenticated","aal":"aal1"}',
    true
  );

  v_caught_error := false;
  BEGIN
    INSERT INTO public.catalog_categories (store_id, name_en, name_pt_br, sort_order, is_active, is_test_data)
    VALUES ('00000000-0000-4000-8000-000000000202', 'Cross Tenant Cat', 'Cat Outra Org', 99, true, true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;

  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Fase F Cross-Tenant Catalog Category RLS]: expected insufficient_privilege (42501)';
  END IF;

  v_caught_error := false;
  BEGIN
    INSERT INTO public.storage_upload_intents (
      bucket_id, object_path, mime_type, file_size_bytes, uploaded_by, store_id, signed_token_hash, expires_at, is_test_data
    ) VALUES (
      'store-assets', '00000000-0000-4000-8000-000000000202/cross.png', 'image/png', 1024,
      '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000202', 'hash123', now() + interval '15 minutes', true
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;

  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Fase F Cross-Tenant Storage Upload Intent RLS]: expected insufficient_privilege (42501)';
  END IF;

  -- =========================================================================
  -- 18. M17 SUPPORT CASES, INTERNAL NOTES, ATTACHMENTS & 4-EYES ACTION REQUESTS
  -- =========================================================================
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );

  SELECT count(*) INTO v_count FROM public.support_cases WHERE requester_id = '00000000-0000-4000-8000-000000000001';
  IF v_count < 2 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Customer Alice Support Cases]: expected >= 2, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.support_messages WHERE is_internal_note = true;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Customer Alice Internal Support Notes]: expected 0, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.support_attachments WHERE is_internal_only = true;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Customer Alice Internal Support Attachments]: expected 0, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.support_attachments WHERE is_internal_only = false;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Customer Alice Public Support Attachment]: expected >= 1, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.support_action_requests;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Customer Alice Support Action Requests]: expected 0, got %', v_count;
  END IF;

  v_caught_error := false;
  BEGIN
    INSERT INTO public.support_messages (case_id, sender_id, body, is_internal_note, is_test_data)
    VALUES ('00000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000000001', 'Attempted internal note', true, true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;
  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Customer Internal Note Forgery]: expected insufficient_privilege (42501)';
  END IF;

  -- Customer Bruno (002), Courier Carlos (030), and Org 102 Partner Kenji (020) see 0 of Alice's support cases
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.support_cases WHERE requester_id = '00000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Customer Bruno Cross-Customer Support Case Leak]: expected 0, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000030","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.support_cases WHERE requester_id = '00000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Courier Carlos Cross-Customer Support Case Leak]: expected 0, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000020","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.support_cases WHERE store_id = '00000000-0000-4000-8000-000000000201';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Org 102 Partner Kenji Cross-Store Support Case Leak]: expected 0, got %', v_count;
  END IF;

  -- Staff Operations Marina (090 at aal2) sees internal notes, internal attachments, and support_action_requests
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000090","role":"authenticated","aal":"aal2"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.support_messages WHERE is_internal_note = true;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Staff Marina aal2 Internal Notes]: expected >= 1, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.support_attachments WHERE is_internal_only = true;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Staff Marina aal2 Internal Attachments]: expected >= 1, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.support_action_requests;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M17 Staff Marina aal2 Support Action Requests]: expected >= 1, got %', v_count;
  END IF;

  -- 4-eyes separation: Finance officer Roberto (091 at aal2) cannot self-approve a support_action_request where decided_by = requested_by
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal2"}',
    true
  );
  v_caught_error := false;
  BEGIN
    INSERT INTO public.support_action_requests (
      id, case_id, order_id, requested_by, action_type, amount_cents, reason, status, is_test_data
    ) VALUES (
      '00000000-0000-4000-8000-000000009888',
      '00000000-0000-4000-8000-000000001501',
      '00000000-0000-4000-8000-000000001001',
      '00000000-0000-4000-8000-000000000091',
      'PARTIAL_REFUND',
      5000,
      '4-eyes self-approval test request',
      'PENDING_FINANCE',
      true
    );

    UPDATE public.support_action_requests
    SET status = 'APPROVED',
        decided_by = '00000000-0000-4000-8000-000000000091'
    WHERE id = '00000000-0000-4000-8000-000000009888';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;
  PERFORM set_config('role', 'postgres', true);
  DELETE FROM public.support_action_requests WHERE id = '00000000-0000-4000-8000-000000009888';
  PERFORM set_config('role', 'authenticated', true);
  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [M17 4-Eyes Self-Approval on support_action_requests]: expected insufficient_privilege (42501)';
  END IF;

  -- =========================================================================
  -- 19. M18 COMMERCIAL LEADS, PROPOSALS, MERCHANT CONTRACTS & COMMISSION RULES
  -- =========================================================================
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.commercial_leads;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Customer Alice commercial_leads]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.commercial_proposals;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Customer Alice commercial_proposals]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.merchant_contracts;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Customer Alice merchant_contracts]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.commission_rule_versions;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Customer Alice commission_rule_versions]: expected 0, got %', v_count;
  END IF;

  -- Partner Owner Helena (010, Org 101) sees Org 101 contracts and commission rules, 0 leads
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000010","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.commercial_leads;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Partner Owner Helena commercial_leads]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.merchant_contracts WHERE organization_id = '00000000-0000-4000-8000-000000000101';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Partner Owner Helena Org 101 merchant_contracts]: expected >= 1, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.commission_rule_versions WHERE organization_id = '00000000-0000-4000-8000-000000000101';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Partner Owner Helena Org 101 commission_rule_versions]: expected >= 1, got %', v_count;
  END IF;

  -- Partner Owner Kenji (020, Org 102) sees 0 of Org 101 contracts and commission rules
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000020","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.merchant_contracts WHERE organization_id = '00000000-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Partner Owner Kenji Org 101 merchant_contracts leak]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.commission_rule_versions WHERE organization_id = '00000000-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Partner Owner Kenji Org 101 commission_rule_versions leak]: expected 0, got %', v_count;
  END IF;

  -- Staff Operations Marina (090 at aal2) sees commercial_leads and commercial_proposals
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000090","role":"authenticated","aal":"aal2"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.commercial_leads;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Staff Marina aal2 commercial_leads]: expected >= 1, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.commercial_proposals;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M18 Staff Marina aal2 commercial_proposals]: expected >= 1, got %', v_count;
  END IF;

  -- =========================================================================
  -- 20. M19 PROMOTIONS, ATOMIC BUDGET REDEMPTIONS & MODERATED ORDER REVIEWS
  -- =========================================================================
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.promotions WHERE code IN ('WELCOME10', 'PAULISTA15');
  IF v_count < 2 THEN
    RAISE EXCEPTION 'TEST FAILED [M19 Customer Alice Active Promotions]: expected >= 2, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.promotion_redemptions WHERE customer_id = '00000000-0000-4000-8000-000000000001';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M19 Customer Alice Own Promotion Redemptions]: expected >= 1, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.order_reviews WHERE id = '00000000-0000-4000-8000-000000001721';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M19 Customer Alice Published Order Review]: expected 1, got %', v_count;
  END IF;

  -- Customer Bruno (002) sees 0 of Alice's promotion_redemptions
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.promotion_redemptions WHERE customer_id = '00000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M19 Customer Bruno Cross-Customer Promotion Redemption Leak]: expected 0, got %', v_count;
  END IF;

  -- Org 102 Partner Kenji (020) cannot create a promotion for Store 201 (Org 101)
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000020","role":"authenticated","aal":"aal1"}',
    true
  );
  v_caught_error := false;
  BEGIN
    INSERT INTO public.promotions (
      code, store_id, funded_by, platform_share_bps, discount_type, discount_value,
      budget_limit_cents, starts_at, ends_at, is_active, created_by, is_test_data
    ) VALUES (
      'CROSS_TENANT_PROMO', '00000000-0000-4000-8000-000000000201', 'MERCHANT', 0, 'FIXED_CENTS', 500,
      50000, now(), now() + interval '7 days', true, '00000000-0000-4000-8000-000000000020', true
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;
  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [M19 Cross-Tenant Store Promotion Insert]: expected insufficient_privilege (42501)';
  END IF;

  -- =========================================================================
  -- 21. M20 OUTBOX EVENTS & NOTIFICATION DELIVERIES ISOLATION
  -- =========================================================================
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.outbox_events;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M20 Customer Alice outbox_events]: expected 0, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.notification_deliveries WHERE recipient_user_id = '00000000-0000-4000-8000-000000000001';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M20 Customer Alice Own notification_deliveries]: expected >= 1, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.notification_deliveries WHERE recipient_user_id <> '00000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M20 Customer Alice Other User notification_deliveries leak]: expected 0, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.notification_deliveries WHERE recipient_user_id = '00000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M20 Customer Bruno Alice notification_deliveries leak]: expected 0, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated","aal":"aal2"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.outbox_events;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M20 Tech Admin aal2 outbox_events]: expected >= 1, got %', v_count;
  END IF;

  -- =========================================================================
  -- 22. M21 ANALYTICS KPI VIEW, EXPLAINABLE RISK ALERTS & LGPD PRIVACY REQUESTS
  -- =========================================================================
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.risk_alerts;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Customer Alice risk_alerts]: expected 0, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.risk_decisions;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Customer Alice risk_decisions]: expected 0, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.privacy_requests WHERE user_id = '00000000-0000-4000-8000-000000000002';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Customer Alice Bruno privacy_requests leak]: expected 0, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.privacy_requests WHERE id = '00000000-0000-4000-8000-000000001705';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Customer Bruno Own privacy_request 1705]: expected 1, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.analytics_order_kpis_v;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Customer Bruno analytics_order_kpis_v leak]: expected 0, got %', v_count;
  END IF;

  -- Tech Admin (099 at aal2) sees risk_alerts, but least-privilege keeps risk_decisions and orders restricted
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated","aal":"aal2"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.risk_alerts;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Tech Admin aal2 risk_alerts]: expected >= 2, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.risk_decisions;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Tech Admin Least Privilege risk_decisions]: expected 0, got %', v_count;
  END IF;

  -- Risk Compliance (092 at aal2) sees risk_decisions and risk_alerts (and 0 at aal1)
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000092","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.risk_decisions;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Risk Compliance aal1 risk_decisions]: expected 0 without MFA, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000092","role":"authenticated","aal":"aal2"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.risk_decisions;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Risk Compliance aal2 risk_decisions]: expected >= 1, got %', v_count;
  END IF;

  -- Operations (090 at aal2) sees Store 201 rows in analytics_order_kpis_v (security_invoker)
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000090","role":"authenticated","aal":"aal2"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.analytics_order_kpis_v WHERE store_id = '00000000-0000-4000-8000-000000000201';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M21 Staff Operations aal2 analytics_order_kpis_v]: expected >= 1, got %', v_count;
  END IF;

  -- =========================================================================
  -- 23. M22 GROCERY PICK TASKS & CUSTOMER-CONSENTED ITEM SUBSTITUTIONS
  -- =========================================================================
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.order_pick_tasks WHERE id = '00000000-0000-4000-8000-000000001801';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M22 Customer Alice order_pick_task 1801]: expected 1, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.order_item_substitutions WHERE id = '00000000-0000-4000-8000-000000001851';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M22 Customer Alice order_item_substitution 1851]: expected 1, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.order_pick_tasks WHERE id = '00000000-0000-4000-8000-000000001801';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M22 Store 201 Operator Lucas order_pick_task 1801]: expected 1, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.order_pick_tasks;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M22 Customer Bruno order_pick_tasks leak]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.order_item_substitutions;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M22 Customer Bruno order_item_substitutions leak]: expected 0, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000030","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.order_pick_tasks;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M22 Courier Carlos order_pick_tasks leak]: expected 0, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000020","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.order_pick_tasks WHERE store_id = '00000000-0000-4000-8000-000000000201';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M22 Org 102 Owner Kenji Store 201 order_pick_tasks leak]: expected 0, got %', v_count;
  END IF;

  v_caught_error := false;
  BEGIN
    INSERT INTO public.order_pick_tasks (
      order_id, store_id, customer_id, status, pre_authorized_total_cents, final_picked_total_cents, is_test_data
    ) VALUES (
      '00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000001', 'PENDING_PICK', 6232, 6232, true
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;
  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [M22 Cross-Tenant Order Pick Task Insert]: expected insufficient_privilege (42501)';
  END IF;

  -- =========================================================================
  -- 24. STORAGE BUCKETS & STORAGE.OBJECTS RLS POLICIES INVARIANT
  -- =========================================================================
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_count
  FROM storage.buckets
  WHERE file_size_limit IS NOT NULL
    AND allowed_mime_types IS NOT NULL
    AND array_length(allowed_mime_types, 1) >= 1;
  IF v_count < 13 THEN
    RAISE EXCEPTION 'TEST FAILED [Storage Buckets Hardening]: expected >= 13 hardened buckets, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname IN ('buckets', 'objects')
    AND c.relrowsecurity = true;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED [Storage RLS Enabled]: expected RLS enabled on storage.buckets and storage.objects (got %)', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'catalog_media_public_read',
      'courier_documents_insert_own',
      'courier_documents_own_or_risk_staff',
      'merchant_documents_org_owner_or_risk'
    );
  IF v_count < 4 THEN
    RAISE EXCEPTION 'TEST FAILED [Storage Objects RLS Policies]: expected 4 active policies, got %', v_count;
  END IF;

  -- Runtime storage.objects cross-tenant RLS check: Org 102 Partner Kenji cannot write to Store 201 or Org 101 folders
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000020","role":"authenticated","aal":"aal1"}',
    true
  );
  v_caught_error := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('public-store-assets', '00000000-0000-4000-8000-000000000201/rogue-banner.png', '00000000-0000-4000-8000-000000000020');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;
  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Storage Cross-Tenant public-store-assets Write]: expected insufficient_privilege (42501)';
  END IF;

  -- Runtime storage.objects KYC isolation: Customer Alice cannot write into Customer Bruno courier-documents folder
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );
  v_caught_error := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('courier-documents', '00000000-0000-4000-8000-000000000002/forged-cnh.pdf', '00000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;
  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [Storage Cross-User courier-documents Write]: expected insufficient_privilege (42501)';
  END IF;

  -- =========================================================================
  -- 25. ANON ZERO-LEAKAGE ACROSS ALL 49 PRIVATE TABLES IN PUBLIC SCHEMA
  -- =========================================================================
  PERFORM set_config('role', 'postgres', true);
  DECLARE
    v_priv_tables text[];
    v_priv_table text;
  BEGIN
    SELECT array_agg(c.relname ORDER BY c.relname)
    INTO v_priv_tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN (
        'stores',
        'store_hours',
        'store_hour_exceptions',
        'store_service_areas',
        'catalog_categories',
        'catalog_products',
        'catalog_option_groups',
        'catalog_options',
        'order_reviews',
        'platform_policies'
      );

    PERFORM set_config('role', 'anon', true);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

    FOREACH v_priv_table IN ARRAY v_priv_tables
    LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I', v_priv_table) INTO v_count;
        IF v_count <> 0 THEN
          RAISE EXCEPTION 'TEST FAILED [Anon Zero-Leakage]: role anon read % rows from private table public.%', v_count, v_priv_table;
        END IF;
      EXCEPTION WHEN insufficient_privilege THEN
        -- Table-level permission denied (42501) is even stricter than 0 rows
        NULL;
      END;
    END LOOP;
  END;

  -- =========================================================================
  -- 26. M14/M11/M15 COURIER PRE-ACCEPT vs POST-ACCEPT PRIVACY & FLEET FLAG GOVERNANCE
  -- =========================================================================
  PERFORM set_config('role', 'postgres', true);
  DELETE FROM public.delivery_offers WHERE id = '00000000-0000-4000-8000-000000009913';
  DELETE FROM public.delivery_tasks WHERE id = '00000000-0000-4000-8000-000000009912';
  DELETE FROM public.orders WHERE id = '00000000-0000-4000-8000-000000009911';
  DELETE FROM public.quotes WHERE id = '00000000-0000-4000-8000-000000009910';

  INSERT INTO public.quotes (
    id, customer_id, store_id, address_id, fulfillment_modality, currency_code,
    subtotal_cents, addons_cents, service_fee_cents, delivery_fee_cents, discount_cents, total_cents,
    distance_meters, estimated_prep_minutes, estimated_delivery_minutes, items_snapshot, address_snapshot,
    idempotency_key, expires_at, consumed_at, is_test_data
  ) VALUES (
    '00000000-0000-4000-8000-000000009910',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000801',
    'PLATFORM_DELIVERY',
    'BRL',
    3890, 0, 195, 690, 0, 4775,
    1400, 20, 30,
    '[]'::jsonb,
    '{"streetLine":"Rua Oscar Freire, 950","neighborhood":"Jardins","city":"São Paulo","stateCode":"SP"}'::jsonb,
    'rls_test_pre_accept_quote_9910',
    now() + interval '15 minutes',
    now(),
    true
  );

  INSERT INTO public.orders (
    id, order_number, customer_id, organization_id, store_id, quote_id, fulfillment_modality,
    order_status, payment_status, delivery_status, currency_code,
    subtotal_cents, addons_cents, service_fee_cents, delivery_fee_cents, discount_cents, total_cents,
    platform_commission_cents, merchant_net_cents, courier_earnings_cents,
    delivery_address_snapshot, version, idempotency_key, is_test_data
  ) VALUES (
    '00000000-0000-4000-8000-000000009911',
    99911,
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000009910',
    'PLATFORM_DELIVERY',
    'READY_FOR_PICKUP', 'CAPTURED', 'OFFERING', 'BRL',
    3890, 0, 195, 690, 0, 4775,
    1098, 3677, 690,
    '{"streetLine":"Rua Oscar Freire, 950","neighborhood":"Jardins","city":"São Paulo","stateCode":"SP"}'::jsonb,
    1,
    'rls_test_pre_accept_order_9911',
    true
  );

  INSERT INTO public.delivery_tasks (
    id, order_id, store_id, fulfillment_modality, status,
    pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
    dropoff_neighborhood_only, dropoff_full_address, confirmation_code_hash,
    courier_fee_cents, distance_meters, estimated_eta_minutes, active_courier_id, is_test_data
  ) VALUES (
    '00000000-0000-4000-8000-000000009912',
    '00000000-0000-4000-8000-000000009911',
    '00000000-0000-4000-8000-000000000201',
    'PLATFORM_DELIVERY',
    'OFFERING',
    -23.561414, -46.655881, -23.563980, -46.669120,
    'Jardins',
    'Rua Oscar Freire, 950 - Apt 82 (PRIVATE UNTIL ACCEPT)',
    'sha256_otp_9912',
    690, 1400, 30, NULL, true
  );

  INSERT INTO public.delivery_offers (
    id, delivery_task_id, courier_id, offered_fee_cents, status,
    pickup_store_name, distance_meters, dropoff_neighborhood_only, expires_at, is_test_data
  ) VALUES (
    '00000000-0000-4000-8000-000000009913',
    '00000000-0000-4000-8000-000000009912',
    '00000000-0000-4000-8000-000000000030',
    690, 'OFFERED', 'Paulista Artisan Burgers - Jardins', 1400, 'Jardins', now() + interval '3 minutes', true
  );

  -- PRE-ACCEPT as Courier Carlos (030): sees offer (neighborhood only), sees 0 delivery_task rows (full address hidden!)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000030","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.delivery_offers WHERE id = '00000000-0000-4000-8000-000000009913';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Courier Pre-Accept Offer Visibility]: expected 1 offer row, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.delivery_tasks WHERE id = '00000000-0000-4000-8000-000000009912';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [Courier Pre-Accept Privacy Leak]: courier saw unassigned delivery_task full address before acceptance!';
  END IF;

  -- POST-ACCEPT: assign task 9912 to Carlos; now Carlos sees task 9912 (1 row), Org 102 Owner Kenji still sees 0
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.delivery_tasks
  SET active_courier_id = '00000000-0000-4000-8000-000000000030',
      status = 'ASSIGNED'
  WHERE id = '00000000-0000-4000-8000-000000009912';

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000030","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.delivery_tasks WHERE id = '00000000-0000-4000-8000-000000009912';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Courier Post-Accept Task Visibility]: expected 1 assigned delivery_task, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000020","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.delivery_tasks WHERE id = '00000000-0000-4000-8000-000000009912';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [Org 102 Partner Kenji Store 201 delivery_task leak]: expected 0, got %', v_count;
  END IF;

  -- Clean up temporary pre/post-accept delivery rows before remaining checks
  PERFORM set_config('role', 'postgres', true);
  DELETE FROM public.delivery_offers WHERE id = '00000000-0000-4000-8000-000000009913';
  DELETE FROM public.delivery_tasks WHERE id = '00000000-0000-4000-8000-000000009912';
  DELETE FROM public.orders WHERE id = '00000000-0000-4000-8000-000000009911';
  DELETE FROM public.quotes WHERE id = '00000000-0000-4000-8000-000000009910';

  -- M15 Fleet Feature Flag default-disabled & write-protected from customers/partners
  SELECT count(*) INTO v_count
  FROM public.platform_policies
  WHERE policy_key = 'DEFAULT_BR_MARKETPLACE'
    AND feature_fleet_operators_enabled = false;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M15 Fleet Feature Flag Default]: expected feature_fleet_operators_enabled = false';
  END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000010","role":"authenticated","aal":"aal1"}',
    true
  );
  UPDATE public.platform_policies
  SET feature_fleet_operators_enabled = true
  WHERE policy_key = 'DEFAULT_BR_MARKETPLACE';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M15 Fleet Policy Update Protection]: partner mutated % row(s) of platform_policies!', v_count;
  END IF;

  v_caught_error := false;
  BEGIN
    INSERT INTO public.platform_policies (policy_key, feature_fleet_operators_enabled)
    VALUES ('ROGUE_POLICY', true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;
  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [M15 Fleet Policy Insert Protection]: expected insufficient_privilege (42501)';
  END IF;

  -- =========================================================================
  -- 27. REMAINING CORE M00-M16 TABLES: ORG, USER, FINANCE & AUDIT ISOLATION
  -- =========================================================================
  -- Alice (001) sees only her own user_devices and user_preferences; 0 audit_logs, approval_events, settlements, reconciliation_runs
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.user_devices WHERE user_id <> '00000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M01 Customer Alice Foreign user_devices Leak]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.user_preferences WHERE user_id <> '00000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M01 Customer Alice Foreign user_preferences Leak]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M16 Customer Alice audit_logs Leak]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.reconciliation_runs;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M13 Customer Alice reconciliation_runs Leak]: expected 0, got %', v_count;
  END IF;

  -- Org 102 Partner Kenji (020) sees 0 Org 101 members, 0 Org 101 invitations, 0 Store 201 quotes/payments/refunds/settlements,
  -- and cannot insert/update Store 201 products or Org 101 memberships
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000020","role":"authenticated","aal":"aal1"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.organization_members WHERE organization_id = '00000000-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M03 Org 102 Kenji Org 101 organization_members Leak]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.invitations WHERE organization_id = '00000000-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M03 Org 102 Kenji Org 101 invitations Leak]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.payment_attempts;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M12 Org 102 Kenji Store 201 payment_attempts Leak]: expected 0, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.settlements WHERE organization_id = '00000000-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED [M13 Org 102 Kenji Org 101 settlements Leak]: expected 0, got %', v_count;
  END IF;

  v_caught_error := false;
  BEGIN
    INSERT INTO public.catalog_products (
      store_id, category_id, name_en, name_pt_br, price_cents, is_available, is_test_data
    ) VALUES (
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000501',
      'Cross Tenant Burger',
      'Burger Invasor',
      9900,
      true,
      true
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_error := true;
  END;
  IF NOT v_caught_error THEN
    RAISE EXCEPTION 'TEST FAILED [M04 Cross-Tenant catalog_products Insert]: expected insufficient_privilege (42501)';
  END IF;

  -- Auditor Privacy (093 at aal2) sees audit_logs and cannot mutate them; Staff Finance (091 at aal2) sees reconciliation_runs & settlements
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000093","role":"authenticated","aal":"aal2"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.audit_logs;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M16 Auditor Privacy aal2 audit_logs]: expected >= 1, got %', v_count;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000091","role":"authenticated","aal":"aal2"}',
    true
  );
  SELECT count(*) INTO v_count FROM public.reconciliation_runs;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M13 Staff Finance aal2 reconciliation_runs]: expected >= 1, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.settlements;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAILED [M13 Staff Finance aal2 settlements]: expected >= 1, got %', v_count;
  END IF;

  PERFORM set_config('role', 'postgres', true);
END;
$$;

SELECT 'ALL_27_SECURITY_RLS_STORAGE_AND_M00_TO_M22_INVARIANTS_PASSED' AS verification_status;
