BEGIN;

UPDATE escalation_rules
SET t_low = 0.400, t_high = 1.000
WHERE event_type = 'UNKNOWN_PERSON';

COMMIT;
