import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  SNSClient,
  SubscribeCommand,
} from '@aws-sdk/client-sns';

@Injectable()
export class NotificationRegistrationProvider {
  private readonly sns: SNSClient;

  constructor(config: ConfigService) {
    this.sns = new SNSClient({ region: config.get<string>('AWS_REGION'), maxAttempts: 1 });
  }

  async register(topic: string, email: string): Promise<void> {
    const request = { abortSignal: AbortSignal.timeout(6000) };
    const created = await this.sns.send(
      new CreateTopicCommand({ Name: topic.split(':')[5] }),
      request,
    );
    if (created.TopicArn !== topic) throw new Error('Unexpected notification topic');
    await this.sns.send(
      new SubscribeCommand({ TopicArn: topic, Protocol: 'email', Endpoint: email }),
      request,
    );
  }

  async confirmed(topic: string, email: string): Promise<boolean> {
    const result = await this.sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topic }), {
      abortSignal: AbortSignal.timeout(5000),
    });
    const [subscription] = result.Subscriptions ?? [];
    return (
      !result.NextToken &&
      result.Subscriptions?.length === 1 &&
      subscription?.TopicArn === topic &&
      subscription.Protocol === 'email' &&
      subscription.Endpoint?.toLowerCase() === email &&
      !!subscription.SubscriptionArn?.startsWith(topic + ':')
    );
  }
}
