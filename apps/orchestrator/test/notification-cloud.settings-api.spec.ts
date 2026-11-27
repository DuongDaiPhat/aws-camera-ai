import { type INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmailNotificationSettingsService } from '../src/notification-cloud/email-notification-settings.service';
import { NotificationSettingsController } from '../src/notification-cloud/notification-settings.controller';
import { PhoneNotificationSettingsService } from '../src/notification-cloud/phone-notification-settings.service';

describe('personal notification settings HTTP contract', () => {
  let app: INestApplication;
  let base: string;
  const email = {
    get: jest.fn().mockResolvedValue({ status: 'OFF' }),
    set: jest.fn().mockResolvedValue({ status: 'PENDING' }),
  };
  const phone = {
    get: jest.fn().mockResolvedValue({ status: 'OFF' }),
    set: jest.fn().mockResolvedValue({ status: 'PENDING' }),
    verify: jest.fn().mockResolvedValue({ status: 'VERIFIED' }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [NotificationSettingsController],
      providers: [
        { provide: EmailNotificationSettingsService, useValue: email },
        { provide: PhoneNotificationSettingsService, useValue: phone },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards({
      canActivate(context) {
        const req = context.switchToHttp().getRequest();
        if (req.headers.authorization !== 'Bearer settings-fixture') {
          throw new UnauthorizedException();
        }
        req.auth = { sub: 'fixture-account' };
        return true;
      },
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/account/alert-delivery';
  });

  afterAll(async () => app?.close());

  function request(path: string, method = 'GET', input?: object) {
    return fetch(base + path, {
      method,
      headers: { Authorization: 'Bearer settings-fixture', 'Content-Type': 'application/json' },
      body: input && JSON.stringify(input),
    });
  }

  it('uses the authenticated account and keeps the settings response private', async () => {
    expect((await fetch(base + '/email')).status).toBe(401);
    const emailResponse = await request('/email');
    expect(emailResponse.status).toBe(200);
    expect(emailResponse.headers.get('cache-control')).toBe('no-store');
    expect(email.get).toHaveBeenCalledWith('fixture-account');
    expect((await request('/phone')).status).toBe(200);
    expect(phone.get).toHaveBeenCalledWith('fixture-account');

    expect((await request('/email', 'PUT', { enabled: true, userId: 'other' })).status).toBe(400);
    expect(email.set).not.toHaveBeenCalled();
    // Non-string email to test transform branch
    expect((await request('/email', 'PUT', { enabled: true, email: 12345 })).status).toBe(400);
    // Empty email to test transform branch (trims to undefined)
    expect((await request('/email', 'PUT', { enabled: true, email: '   ' })).status).toBe(200);
    expect(
      (await request('/email', 'PUT', { enabled: true, email: ' alt@example.test ' })).status,
    ).toBe(200);
    expect(email.set).toHaveBeenCalledWith('fixture-account', {
      enabled: true,
      email: 'alt@example.test',
    });
  });

  it('validates a phone number and OTP while allowing call-only settings', async () => {
    const input = { callEnabled: true, smsEnabled: false };
    expect((await request('/phone', 'PUT', { ...input, phone: 12345 })).status).toBe(400);
    const badPhoneRes = await request('/phone', 'PUT', { ...input, phone: '0901234567' });
    expect(badPhoneRes.status).toBe(400);
    await expect(badPhoneRes.json()).resolves.toMatchObject({
      message: ['Nhập số điện thoại có mã quốc gia, ví dụ +84901234567.'],
    });
    expect((await request('/phone', 'PUT', { ...input, phone: '  ' })).status).toBe(200);
    expect((await request('/phone', 'PUT', { ...input, phone: ' +84901234567 ' })).status).toBe(
      200,
    );
    expect(phone.set).toHaveBeenLastCalledWith('fixture-account', {
      ...input,
      phone: '+84901234567',
    });
    expect((await request('/phone/verify', 'POST', { code: '12345' })).status).toBe(400);
    expect((await request('/phone/verify', 'POST', { code: '012345' })).status).toBe(200);
    expect(phone.verify).toHaveBeenCalledWith('fixture-account', '012345');
  });
});
