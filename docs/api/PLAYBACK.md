# Camera playback

The dashboard calendar is the single date selector. The archive main area contains only the camera selector, persisted 1/2/4/6/8/custom grid preference, player grid and chronological daily recording list. The selected camera is pinned first. A requested grid larger than available sources shows an explicit notice.

The daily list groups touching recording chunks and adds hourly navigation bookmarks, so a full-day recording remains navigable without a separate time-search form. Playback automatically advances through contiguous chunks; real gaps stop automatic advancement and show the next available time. Metadata is polled every 10 seconds with two concurrent requests. Existing playback and data survive a transient metadata refresh error. MP4 downloads are also limited to two concurrent requests.

## Recording

Frigate recording no longer depends on enabling the fire module. PLAYBACK_CONTINUOUS_RECORDING_DAYS defaults to 1; explicitly disabled recording stays disabled. Internal MediaMTX reads use the configured internal credentials. Only retained, finalized recording segments can be replayed; a camera must actually send frames. The first finalized segment may take several seconds to appear.

## Historical detections

Apply db/migrations/0017_playback_frames.sql to existing installations. It adds playback_frames and its expiry index. The MQTT frame consumer offers valid person telemetry to a bounded background writer; no database work blocks live frame handling. Geometry is normalized using the camera detection dimensions, sampled every PLAYBACK_METADATA_SAMPLE_MS (default 500), and expires after PLAYBACK_METADATA_RETENTION_DAYS (default 7). Empty stored frame arrays are distinct from missing archived analysis.

GET /api/v1/playback/cameras/{id}/metadata?startAt=...&endAt=... requires the same JWT household authorization as footage. It returns only stored person samples and confirmed fall/fire result geometry, using the original observation/confirmation timestamp. The player draws boxes with a bounded timestamp tolerance and the same contain/letterbox geometry as the video. It never subscribes to live detections for archived video. Older recordings without stored geometry explicitly show that historical analysis is unavailable.

The current AI fire pipeline is fire-only: it discards smoke output. M2A_ENABLED and M3_ENABLED are off in the current local deployment. Tests of recording geometry and incident logic do not constitute acceptance of those models on a real camera. Do not manufacture boxes or enable alerts to mask missing model/data coverage.

## Validation

Run playback Jest tests plus Frigate config/MQTT tests, camera-grid/recording-session/component Vitest tests, TypeScript checks and OpenAPI lint. When running fixture-based AI tests inside a deployment container, omit AI_SERVICE_URL, AI_INTERNAL_TOKEN, M2A_ENABLED, M3_ENABLED and FALL_IMMOBILITY_SECONDS from that test process so deployment environment values cannot override fixture settings. This does not change the running deployment.
