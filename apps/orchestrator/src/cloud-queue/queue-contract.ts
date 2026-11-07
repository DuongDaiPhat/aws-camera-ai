import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';
import { queueSchema } from './queue-schema';

export interface FaceJob {
  jobId: string;
  eventId: string;
  cameraId: string;
  ownerScopeId: string;
  trackId: string;
  sourceSessionId: string;
  observationId: string;
  revision: number;
  collectionVersion: number;
  collectionId: string;
  image: { bucket: string; key: string };
  resultId: string;
}
export interface FaceResult {
  jobId: string;
  cameraId: string;
  ownerScopeId: string;
  body: SubmitAiResultDto;
}
export interface NotificationJob {
  notificationId: string;
  eventId: string;
  ownerScopeId: string;
  expectedEventVersion: number;
  channel: 'SNS_EMAIL' | 'SNS_SMS' | 'CONNECT_CALL';
}
export interface NotificationOutcome {
  outcomeId: string;
  notificationId: string;
  eventId: string;
  ownerScopeId: string;
  attemptId: string;
  status: 'DRY_RUN' | 'PROVIDER_ACCEPTED' | 'FAILED' | 'UNCERTAIN';
  providerCalled: boolean;
  providerId: string | null;
  reason: string | null;
}
type Message<T, P> = {
  schemaVersion: 1;
  type: T;
  messageId: string;
  correlationId: string;
  occurredAt: string;
  payload: P;
};
export type FaceJobEnvelope = Message<'face.job', FaceJob>;
export type Envelope =
  | FaceJobEnvelope
  | Message<'face.result', FaceResult>
  | Message<'notification.job', NotificationJob>
  | Message<'notification.outcome', NotificationOutcome>;
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(queueSchema);
export function parseEnvelope(value: unknown): Envelope {
  if (!validate(value))
    throw new Error('Invalid queue envelope: ' + ajv.errorsText(validate.errors));
  const message = value as Envelope;
  const id =
    message.type === 'face.job'
      ? message.payload.jobId
      : message.type === 'face.result'
        ? message.payload.body.resultId
        : message.type === 'notification.job'
          ? message.payload.notificationId
          : message.payload.outcomeId;
  const eventId =
    message.type === 'face.result' ? message.payload.body.eventId : message.payload.eventId;
  if (message.messageId !== id || message.correlationId !== eventId)
    throw new Error('Envelope identity mismatch');
  return message;
}
