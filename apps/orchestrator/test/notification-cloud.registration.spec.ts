import { ConfigService } from '@nestjs/config';
import {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import { NotificationRegistrationProvider } from '../src/notification-cloud/notification-registration.provider';

const topic =
  'arn:aws:sns:ap-southeast-1:123456789012:argusai-dev-incident-email-user-96af2868-7871-4101-98ec-6596d102fed4';
const email = 'caregiver@example.test';
const subscription = {
  TopicArn: topic,
  Protocol: 'email',
  Endpoint: email,
  SubscriptionArn: topic + ':verified',
};

function setup() {
  const provider = new NotificationRegistrationProvider(
    new ConfigService({ AWS_REGION: 'ap-southeast-1' }),
  );
  const send = jest.fn();
  Object.assign(provider, { sns: { send } });
  return { provider, send };
}

it('creates the exact topic and subscribes an address only if AWS returns that topic', async () => {
  const { provider, send } = setup();
  send.mockResolvedValueOnce({ TopicArn: 'unexpected' });
  await expect(provider.register(topic, email)).rejects.toThrow('Unexpected');
  expect(send).toHaveBeenCalledTimes(1);
  send.mockResolvedValueOnce({ TopicArn: topic }).mockResolvedValueOnce({});
  await provider.register(topic, email);
  expect(send.mock.calls[1][0]).toBeInstanceOf(CreateTopicCommand);
  expect(send.mock.calls[2][0]).toBeInstanceOf(SubscribeCommand);
  expect(send.mock.calls[2][0].input).toEqual({
    TopicArn: topic,
    Protocol: 'email',
    Endpoint: email,
  });
});

it.each([
  [{ Subscriptions: [subscription] }, true],
  [{ Subscriptions: [{ ...subscription, Endpoint: 'CAREGIVER@example.test' }] }, true],
  [{ Subscriptions: [{ ...subscription, SubscriptionArn: 'PendingConfirmation' }] }, false],
  [{ Subscriptions: [subscription, subscription] }, false],
  [{ Subscriptions: [subscription], NextToken: 'second-page' }, false],
  [{ Subscriptions: [{ ...subscription, Endpoint: 'other@example.test' }] }, false],
  [{ Subscriptions: [{ ...subscription, Protocol: 'sms' }] }, false],
  [{ Subscriptions: [{ ...subscription, TopicArn: 'wrong' }] }, false],
  [{ Subscriptions: [{ ...subscription, SubscriptionArn: undefined }] }, false],
  [{ Subscriptions: [{ ...subscription, Endpoint: undefined }] }, false],
  [{}, false],
])(
  'verifies only an exact single confirmed mailbox on a dedicated topic',
  async (page, expected) => {
    const { provider, send } = setup();
    send.mockResolvedValue(page);
    expect(await provider.confirmed(topic, email)).toBe(expected);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ListSubscriptionsByTopicCommand);
  },
);
