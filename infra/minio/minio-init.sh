#!/bin/sh
# Tao bucket media va lifecycle rule xoa sau N ngay (FR-DAT-01)
set -e

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

if ! mc ls "local/$STORAGE_BUCKET" >/dev/null 2>&1; then
  mc mb "local/$STORAGE_BUCKET"
  echo "[minio-init] Da tao bucket $STORAGE_BUCKET"
fi

# Object co tag retain=true duoc giu lai (FR-DAT-02) -> rule chi ap dung phan con lai
cat > /tmp/lifecycle.json <<JSON
{
  "Rules": [
    {
      "ID": "expire-event-media",
      "Status": "Enabled",
      "Filter": { "Prefix": "events/" },
      "Expiration": { "Days": ${MEDIA_RETENTION_DAYS:-7} }
    }
  ]
}
JSON

mc ilm import "local/$STORAGE_BUCKET" < /tmp/lifecycle.json || true
echo "[minio-init] Lifecycle ${MEDIA_RETENTION_DAYS:-7} ngay da duoc ap dung"
