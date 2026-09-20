-- US-03 / FR-ING-07: mot Frigate track chi anh xa vao mot event.
-- Migration moi duoc dung thay vi sua 0001_init.sql da co the da chay o cac moi truong khac.

BEGIN;

COMMENT ON COLUMN events.dedup_key IS
    'Frigate: frigate:{camera_slug}:{track_id}. Unique index dam bao mot track chi co mot event.';

COMMIT;
