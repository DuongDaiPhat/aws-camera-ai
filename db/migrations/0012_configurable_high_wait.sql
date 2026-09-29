-- Thời gian nhánh tin cậy cao được nhập tay; không đổi deadline/snapshot event cũ.
ALTER TABLE escalation_rules ADD COLUMN high_wait_seconds INTEGER;

-- Chỉ backfill một lần để giữ hành vi cũ khi nâng cấp. Sau đó không tự chia đôi.
UPDATE escalation_rules
SET high_wait_seconds = GREATEST(0, LEAST(t_wait_seconds - 1, CEIL(t_wait_seconds / 2.0)::INTEGER))
WHERE NOT skip_logged_only AND t_low IS NOT NULL AND t_high IS NOT NULL
  AND event_type <> 'PERSON_DETECTED';

ALTER TABLE escalation_rules ADD CONSTRAINT escalation_high_wait_nho_hon_t_wait
CHECK (high_wait_seconds IS NULL OR (high_wait_seconds >= 0 AND high_wait_seconds < t_wait_seconds));

COMMENT ON COLUMN escalation_rules.high_wait_seconds IS
'Thời gian nhánh confidence cao nhập tay, nhỏ hơn t_wait_seconds; NULL nếu không áp dụng.';
