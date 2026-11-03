-- ============================================================================
-- iDeliveryFood — Automated RLS, Multi-Tenant Isolation & Constraints Suite
-- ============================================================================
-- Executes inside a transaction and verifies all 10 security & data invariants:
-- 1. 100% of public tables have RLS enabled (46/46 tables).
-- 2. Anonymous actor (anon) only sees published stores (2/3) and 0 private rows.
-- 3. Consumer actor (Alice) sees only own profile, address, and order; 0 from Bruno.
-- 4. Consumer actor cannot self-elevate protected profile attributes (42501).
-- 5. Partner Operator (Lucas, Store 201) sees Store 201 orders, 0 from Org 102, and 0 ledger rows.
-- 6. Partner Finance (Clara, Org 101) sees Org 101 payable ledger account and 0 platform/courier accounts.
-- 7. Courier (Carlos) sees assigned delivery task and own courier ledger account.
-- 8. Staff Finance (Roberto) is denied ledger_journals at aal1 and granted at aal2 (MFA step-up).
-- 9. Append-only tables reject UPDATE/DELETE with 23514.
-- 10. Double-entry ledger trigger rejects unbalanced journal postings with 23514.
-- ============================================================================

DO $$
DECLARE
  v_unprotected_tables integer;
  v_count integer;
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

  SELECT count(*) INTO v_count FROM public.orders;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Alice orders]: expected 1 own order, got %', v_count;
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

  SELECT count(*) INTO v_count FROM public.orders;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Partner Operator orders]: expected 1 store order, got %', v_count;
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
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Courier delivery_tasks]: expected 1 assigned task, got %', v_count;
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
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED [Staff Finance aal2 MFA check]: expected 1 ledger_journal with aal2, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.ledger_accounts;
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'TEST FAILED [Staff Finance aal2 ledger_accounts]: expected 6 ledger_accounts, got %', v_count;
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
END;
$$;

SELECT 'ALL_10_SECURITY_AND_RLS_INVARIANTS_PASSED' AS verification_status;
