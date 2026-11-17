BEGIN;
CREATE TABLE IF NOT EXISTS playback_frames (
 camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
 observed_at TIMESTAMPTZ NOT NULL,
 boxes JSONB NOT NULL CHECK (jsonb_typeof(boxes)='array'),
 PRIMARY KEY(camera_id,observed_at)
);
CREATE INDEX IF NOT EXISTS idx_playback_frames_expiry ON playback_frames(observed_at);
COMMENT ON TABLE playback_frames IS 'Sampled historical person geometry; empty boxes mean analyzed frame, missing rows mean unknown. Retained independently by PLAYBACK_METADATA_RETENTION_DAYS.';
COMMIT;
