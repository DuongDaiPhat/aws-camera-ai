BEGIN;
-- Dedicated transport tables: existing outbox_messages only permits one
-- message per event/version/type, unsuitable for independently retried cloud jobs.
CREATE TABLE cloud_transport_mode (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 mode text NOT NULL CHECK(mode IN ('bullmq','sqs'))
);
INSERT INTO cloud_transport_mode VALUES(true,'bullmq');
CREATE TABLE cloud_face_collections (
 owner_user_id uuid PRIMARY KEY REFERENCES users(id),
 collection_id text UNIQUE NOT NULL,
 version integer NOT NULL CHECK(version > 0),
 CHECK(collection_id = 'camerai-s4-dev-owner-' || owner_user_id::text)
);
CREATE TABLE cloud_face_mappings (
 owner_user_id uuid NOT NULL REFERENCES cloud_face_collections(owner_user_id),
 face_id text NOT NULL,
 known_face_id uuid NOT NULL REFERENCES known_faces(id),
 PRIMARY KEY(owner_user_id,face_id)
);
CREATE TABLE cloud_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 result_id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('face.job','notification.job')),
 owner_user_id uuid NOT NULL REFERENCES users(id),
 camera_id uuid REFERENCES cameras(id),
 envelope jsonb,
 cached_result jsonb,
 status text NOT NULL DEFAULT 'PREPARING' CHECK(status IN ('PREPARING','PENDING','SENT','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 available_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 CHECK(envelope IS NULL OR jsonb_typeof(envelope)='object')
);
CREATE UNIQUE INDEX cloud_one_face_job ON cloud_jobs(event_id) WHERE kind='face.job';
CREATE INDEX cloud_jobs_pending ON cloud_jobs(available_at) WHERE status IN ('PREPARING','PENDING');
CREATE TABLE cloud_result_receipts (
 id uuid PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES cloud_jobs(id) ON DELETE CASCADE,
 envelope jsonb NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('ACCEPTED','DUPLICATE','STALE','PROCESSED')),
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cloud_notification_outcomes (
 outcome_id uuid PRIMARY KEY REFERENCES cloud_result_receipts(id) ON DELETE CASCADE,
 notification_id uuid NOT NULL REFERENCES cloud_jobs(id) ON DELETE CASCADE,
 attempt_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('DRY_RUN','PROVIDER_ACCEPTED','FAILED','UNCERTAIN')),
 provider_called boolean NOT NULL,
 provider_id text,
 reason text,
 CHECK(status <> 'DRY_RUN' OR (NOT provider_called AND provider_id IS NULL)),
 CHECK(status <> 'PROVIDER_ACCEPTED' OR (provider_called AND provider_id IS NOT NULL)),
 UNIQUE(notification_id,attempt_id)
);
-- Runs in the event INSERT transaction: crashes after ingestion cannot lose intent.
CREATE FUNCTION cloud_enqueue_face() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT mode FROM cloud_transport_mode WHERE singleton) = 'sqs'
 AND NEW.event_type IN ('PERSON_DETECTED','RESTRICTED_ZONE')
 AND NEW.camera_id IS NOT NULL AND NEW.track_id IS NOT NULL THEN
 INSERT INTO cloud_jobs(event_id,kind,owner_user_id,camera_id)
 SELECT NEW.id,'face.job',d.owner_user_id,c.id
 FROM cameras c JOIN devices d ON d.id=c.device_id WHERE c.id=NEW.camera_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cloud_face_intent AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION cloud_enqueue_face();
COMMIT;
