-- Fase F: Storage Buckets, Upload Intents Audit Table & Partner Catalog/Schedule CRUD Policies (M02, M04, M07, M09)

-- 1. Register all canonical and alias Storage Buckets with strict MIME types and file size limits
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('store-assets', 'store-assets', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('catalog-media', 'catalog-media', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('partner-kyc-docs', 'partner-kyc-docs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
  ('courier-kyc-docs', 'courier-kyc-docs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
  ('support-attachments', 'support-attachments', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('public-store-assets', 'public-store-assets', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('private-kyc-docs', 'private-kyc-docs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
  ('private-pod-evidence', 'private-pod-evidence', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('private-support-attachments', 'private-support-attachments', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('private-financial-exports', 'private-financial-exports', false, 20971520, ARRAY['text/csv', 'application/pdf', 'application/json'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage Upload Intents (Server-Issued Signed Upload URL Audit & Tracking)
CREATE TABLE IF NOT EXISTS public.storage_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  object_path text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 20971520),
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  signed_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_storage_upload_intents_uploaded_by ON public.storage_upload_intents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_storage_upload_intents_store_id ON public.storage_upload_intents(store_id);

ALTER TABLE public.storage_upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_upload_intents FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'storage_upload_intents' AND policyname = 'storage_upload_intents_select_own_or_staff'
  ) THEN
    CREATE POLICY storage_upload_intents_select_own_or_staff ON public.storage_upload_intents
      FOR SELECT TO authenticated
      USING (
        uploaded_by = (SELECT auth.uid())
        OR (store_id IS NOT NULL AND app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[]))
        OR app_security.has_staff_role(ARRAY['operations', 'risk_compliance', 'tech_admin']::public.staff_role[])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'storage_upload_intents' AND policyname = 'storage_upload_intents_insert_own'
  ) THEN
    CREATE POLICY storage_upload_intents_insert_own ON public.storage_upload_intents
      FOR INSERT TO authenticated
      WITH CHECK (
        uploaded_by = (SELECT auth.uid())
        AND (
          store_id IS NULL
          OR app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[])
        )
      );
  END IF;

  -- Ensure store_hours has partner write policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'store_hours' AND policyname = 'store_hours_manage_partner'
  ) THEN
    CREATE POLICY store_hours_manage_partner ON public.store_hours
      FOR ALL TO authenticated
      USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[]))
      WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager']::public.partner_role[]));
  END IF;

  -- Ensure catalog_option_groups and catalog_options have partner write policies
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalog_option_groups' AND policyname = 'catalog_option_groups_manage_partner'
  ) THEN
    CREATE POLICY catalog_option_groups_manage_partner ON public.catalog_option_groups
      FOR ALL TO authenticated
      USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[]))
      WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[]));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalog_options' AND policyname = 'catalog_options_manage_partner'
  ) THEN
    CREATE POLICY catalog_options_manage_partner ON public.catalog_options
      FOR ALL TO authenticated
      USING (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[]))
      WITH CHECK (app_security.has_store_role(store_id, ARRAY['partner_owner', 'partner_manager', 'partner_catalog']::public.partner_role[]));
  END IF;
END $$;

GRANT SELECT, INSERT ON public.storage_upload_intents TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.store_hours TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.catalog_categories TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.catalog_products TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.catalog_option_groups TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.catalog_options TO authenticated;
