BEGIN;

-- Phase 2: Move face.job intent creation from raw event INSERT trigger to
-- orchestrator coordinator (after local quality gate + best-shot selection)
-- and allow bounded retry revisions per event.
DROP TRIGGER IF EXISTS cloud_face_intent ON events;
DROP FUNCTION IF EXISTS cloud_enqueue_face();

ALTER TABLE cloud_jobs
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1);

DROP INDEX IF EXISTS cloud_one_face_job;
CREATE UNIQUE INDEX cloud_one_face_job_revision
  ON cloud_jobs(event_id, revision) WHERE kind = 'face.job';

COMMIT;
