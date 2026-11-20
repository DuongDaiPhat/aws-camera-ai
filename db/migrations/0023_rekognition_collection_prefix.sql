BEGIN;

-- US-24: Allow environment-scoped Rekognition collection prefixes while preserving
-- strict per-owner isolation (<prefix><owner_user_id>).
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.cloud_face_collections'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%collection_id%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.cloud_face_collections DROP CONSTRAINT IF EXISTS %I',
      constraint_name
    );
  END LOOP;
END
$$;

ALTER TABLE public.cloud_face_collections
  ADD CONSTRAINT cloud_face_collections_collection_id_prefix_check
  CHECK (
    collection_id IN (
      'camerai-s4-dev-owner-' || owner_user_id::text,
      'argusai-staging-owner-' || owner_user_id::text,
      'argusai-production-owner-' || owner_user_id::text
    )
  );

COMMIT;
