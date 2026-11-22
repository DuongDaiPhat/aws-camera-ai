BEGIN;
ALTER TABLE cloud_transport_mode ADD COLUMN notification_driver text NOT NULL DEFAULT 'local'
  CHECK (notification_driver IN ('local', 'sqs'));
ALTER TABLE notifications ADD COLUMN delivery_driver text NOT NULL DEFAULT 'local'
  CHECK (delivery_driver IN ('local', 'sqs'));

-- A topic is provisioned for exactly one verified recipient. Provisioning must
-- verify the topic's subscriptions before enabling the route.
CREATE TABLE cloud_notification_routes (
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_ref text NOT NULL CHECK (recipient_ref ~ '^(user|contact):[0-9a-f-]{36}$'),
  channel notification_channel NOT NULL CHECK (channel IN ('SNS_EMAIL', 'SNS_SMS', 'CONNECT_CALL')),
  destination text NOT NULL CHECK (length(destination) > 0),
  topic_arn text UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  PRIMARY KEY (owner_user_id, recipient_ref, channel),
  CHECK ((channel = 'SNS_EMAIL') = (topic_arn IS NOT NULL))
);

CREATE TABLE cloud_notification_attempts (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid UNIQUE NOT NULL,
  notification_id uuid UNIQUE NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  recipient_ref text NOT NULL,
  channel notification_channel NOT NULL,
  mode text NOT NULL CHECK (mode IN ('DRY_RUN', 'REAL')),
  blocked_provider boolean NOT NULL,
  recipient_key text CHECK (recipient_key ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz NOT NULL,
  lease_until timestamptz NOT NULL CHECK (lease_until > claimed_at),
  uncertain_at timestamptz,
  CHECK ((mode = 'REAL') = (recipient_key IS NOT NULL))
);
CREATE INDEX cloud_notification_attempts_limit_idx
  ON cloud_notification_attempts (recipient_key, channel, claimed_at)
  WHERE mode = 'REAL';

CREATE TABLE cloud_notification_claim_decisions (
  notification_id uuid PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN (
    'ALREADY_SENT', 'RESOLVED', 'STALE_VERSION', 'EXPIRED', 'CAP_EXCEEDED', 'CANCELLED', 'UNCERTAIN'
  )),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX cloud_notification_cached_outcome_id_idx
  ON cloud_jobs ((cached_result->>'messageId'))
  WHERE kind = 'notification.job' AND cached_result IS NOT NULL;
ALTER TABLE cloud_notification_outcomes
  ADD CONSTRAINT cloud_notification_outcomes_attempt_fk FOREIGN KEY (attempt_id)
  REFERENCES cloud_notification_attempts(attempt_id) ON DELETE CASCADE NOT VALID;
COMMIT;
