-- US-20: durable identity association and metadata provenance, without images.
BEGIN;
CREATE TABLE resident_wellness_track_links (
 camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
 source_session_id TEXT NOT NULL, track_id TEXT NOT NULL,
 owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resident_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 known_face_id UUID NOT NULL REFERENCES known_faces(id) ON DELETE CASCADE,
 identity_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 observed_at TIMESTAMPTZ NOT NULL, valid_until TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(camera_id,source_session_id,track_id), CHECK(valid_until>observed_at)
);
CREATE TABLE resident_wellness_source_evidence (
 observation_id UUID PRIMARY KEY, camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
 source_session_id TEXT NOT NULL, track_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('MOTION','ARRIVAL','DEPARTURE')),
 observed_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 evidence JSONB NOT NULL CHECK(jsonb_typeof(evidence)='object')
);
CREATE INDEX idx_wellness_source_track ON resident_wellness_source_evidence(camera_id,source_session_id,track_id,observed_at);
CREATE INDEX idx_wellness_links_expiry ON resident_wellness_track_links(valid_until);
COMMENT ON TABLE resident_wellness_source_evidence IS 'Trusted Frigate metadata provenance. Face matching alone is not motion; internal observation requests must match this evidence.';
COMMIT;
