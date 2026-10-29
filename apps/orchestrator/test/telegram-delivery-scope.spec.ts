import { ConfigService } from '@nestjs/config';
import { telegramDeliveryScope } from '../src/notifications/telegram-delivery-scope';

const scope = {
  cameraId: '22222222-2222-2222-2222-222222222223',
  recipientUserId: '11111111-1111-1111-1111-111111111111',
  createdAfter: '2026-10-27T13:00:00Z',
  until: '2026-10-27T13:15:00Z',
  maxAttempts: 3,
};
describe('bounded Telegram delivery configuration', () => {
  it('leaves normal delivery unchanged unless an explicit scope is supplied', () => {
    expect(telegramDeliveryScope(new ConfigService())).toBeNull();
  });
  it('accepts one camera, recipient, time window and a finite attempt budget', () => {
    expect(
      telegramDeliveryScope(new ConfigService({ TELEGRAM_DELIVERY_SCOPE: JSON.stringify(scope) })),
    ).toEqual(scope);
  });
  it.each([
    '{',
    '{}',
    'null',
    JSON.stringify({ ...scope, until: scope.createdAfter }),
    JSON.stringify({ ...scope, maxAttempts: 0 }),
    JSON.stringify({ ...scope, maxAttempts: 1.5 }),
    JSON.stringify({ ...scope, cameraId: 'not-a-uuid' }),
    JSON.stringify({ ...scope, recipientUserId: null }),
  ])('rejects invalid scope without falling back to unrestricted delivery: %s', (raw) => {
    expect(() =>
      telegramDeliveryScope(new ConfigService({ TELEGRAM_DELIVERY_SCOPE: raw })),
    ).toThrow('Invalid TELEGRAM_DELIVERY_SCOPE');
  });
});
