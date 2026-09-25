BEGIN;

-- US-09: trạng thái bền vững, không lưu bản sao embedding trong hàng đợi retry.
CREATE TABLE face_collection_sync (
    owner_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    model_version TEXT NOT NULL,
    embedding_dim SMALLINT NOT NULL CHECK (embedding_dim > 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    synced_version INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMPTZ,
    PRIMARY KEY (owner_user_id, model_version)
);

INSERT INTO face_collection_sync (owner_user_id, model_version, embedding_dim)
SELECT owner_user_id, model_version, MAX(embedding_dim)
FROM known_faces WHERE provider = 'LOCAL'
GROUP BY owner_user_id, model_version;

COMMIT;
