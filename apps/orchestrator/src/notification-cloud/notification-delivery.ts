import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { usesPersonalAlertSettings, type NotificationConfig } from './notification-cloud.config';
import type { ClaimJobRow, Delivery } from './notification-cloud.types';

type Route = { destination: string; topic_arn: string | null };

async function readPersonalRoute(client: PoolClient, job: ClaimJobRow): Promise<Route | undefined> {
  const scope = `WHERE user_id=$1 AND can_access_camera(user_id,$2)
    AND registration_id::text=$3 AND verified_at <= clock_timestamp()`;
  const params = [job.recipient_user_id, job.camera_id, job.recipient_registration_id];
  const result = await client.query<Route>(
    `SELECT email AS destination,topic_arn FROM user_email_alert_settings
     ${scope} AND enabled FOR SHARE`,
    params,
  );
  return result.rows[0];
}

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
  const personal = !!job.recipient_registration_id;
  if (personal !== usesPersonalAlertSettings(config, job.channel))
    return { delivery, recipientKey: null };
  const route = personal
    ? await readPersonalRoute(client, job)
    : (
        await client.query<Route>(
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
        )
      ).rows[0];
  if (!route) return { delivery, recipientKey: null };

  const emailTopic = personal
    ? config.emailTopicPrefix + job.recipient_registration_id!
    : config.topicArn;
  if (email && emailTopic && route.topic_arn === emailTopic) {
    delivery.topicArn = emailTopic;
    if (personal) delivery.destination = route.destination;
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
