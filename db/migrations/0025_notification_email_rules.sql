BEGIN;
-- Incident email channels confirmed for the four risk event types.
-- Preserve existing channels and thresholds; do not reopen past notifications.

UPDATE escalation_rules
SET notify_channels = notify_channels || '["SNS_EMAIL"]'::jsonb,
    version = version + 1,
    updated_at = clock_timestamp()
WHERE event_type IN (
    'FIRE_SMOKE_DETECTED',
    'FALL_DETECTED',
    'RESTRICTED_ZONE',
    'UNKNOWN_PERSON'
)
AND NOT (notify_channels ? 'SNS_EMAIL');

COMMIT;
