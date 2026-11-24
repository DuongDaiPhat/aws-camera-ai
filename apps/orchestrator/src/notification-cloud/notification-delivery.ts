import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { NotificationConfig } from './notification-cloud.config';
import type { ClaimJobRow, Delivery } from './notification-cloud.types';

export async function readDelivery(
  client: PoolClient,
  job: ClaimJobRow,
  config: NotificationConfig,
): Promise<{ delivery: Delivery; recipientKey: string | null }> {
  const prefix = `[ArgusAI][${config.environment?.toUpperCase() ?? 'DEV'}]`;
  const email = job.channel === 'SNS_EMAIL';
  const missingContact = job.cloud_contact_required && !job.emergency_contact_id;
  const recipientRef = job.emergency_contact_id
    ? `contact:${job.emergency_contact_id}`
    : missingContact
      ? 'contact:unavailable'
      : `user:${job.recipient_user_id}`;
  const delivery: Delivery = {
    channel: job.channel,
    recipientRef,
    message: `${prefix} A new incident needs review. Open ArgusAI for details.`,
  };
  if (missingContact) return { delivery, recipientKey: null };
  const { rows } = await client.query<{ destination: string; topic_arn: string | null }>(
    `SELECT route.destination, route.topic_arn
     FROM cloud_notification_routes route
     LEFT JOIN users u ON u.id = $4 AND can_access_camera(u.id, $6) AND u.is_active
     LEFT JOIN emergency_contacts c ON c.id = $5 AND c.owner_user_id = $1
          AND c.is_enabled AND c.is_verified
     WHERE route.owner_user_id = $1 AND route.recipient_ref = $2 AND route.channel = $3
       AND route.enabled AND route.verified_at <= clock_timestamp()
       AND CASE WHEN $5::uuid IS NOT NULL
         THEN CASE WHEN $3 = 'SNS_EMAIL' THEN lower(c.email::text) ELSE c.phone_e164 END
         ELSE CASE WHEN $3 = 'SNS_EMAIL' THEN lower(u.email::text) ELSE u.phone_e164 END
       END = CASE WHEN $3 = 'SNS_EMAIL' THEN lower(route.destination) ELSE route.destination END
     FOR SHARE OF route`,
    [
      job.owner_user_id,
      recipientRef,
      job.channel,
      job.recipient_user_id,
      job.emergency_contact_id,
      job.camera_id,
    ],
  );
  const route = rows[0];
  if (!route) return { delivery, recipientKey: null };

  if (email && config.topicArn && route.topic_arn === config.topicArn) {
    delivery.topicArn = config.topicArn;
    delivery.subject = `${prefix} New incident`;
  } else if (job.channel === 'SNS_SMS' && config.smsEnabled) {
    delivery.destination = route.destination;
  } else if (
    job.channel === 'CONNECT_CALL' &&
    config.connectInstanceId &&
    config.connectContactFlowId &&
    config.connectSourcePhoneNumber
  ) {
    delivery.destination = route.destination;
    delivery.instanceId = config.connectInstanceId;
    delivery.contactFlowId = config.connectContactFlowId;
    delivery.sourcePhoneNumber = config.connectSourcePhoneNumber;
  } else {
    return { delivery, recipientKey: null };
  }
  const destination = email ? route.destination.toLowerCase() : route.destination;
  return { delivery, recipientKey: createHash('sha256').update(destination).digest('hex') };
}

export function dryRunDelivery(delivery: Delivery): Delivery {
  return {
    channel: delivery.channel,
    recipientRef: delivery.recipientRef,
    message: delivery.message,
  };
}
