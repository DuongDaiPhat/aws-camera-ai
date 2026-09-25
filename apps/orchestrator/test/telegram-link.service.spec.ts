import { Test } from '@nestjs/testing';
import {
  TelegramLinkService,
  hashTelegramLinkToken,
} from '../src/notifications/telegram/telegram-link.service';
import { TelegramLinkRepository } from '../src/notifications/telegram/telegram-link.repository';

describe('TelegramLinkService', () => {
  const repository = { create: jest.fn(), consume: jest.fn() };
  let service: TelegramLinkService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [TelegramLinkService, { provide: TelegramLinkRepository, useValue: repository }],
    }).compile();
    service = module.get(TelegramLinkService);
  });

  it('chỉ lưu hash của token liên kết và trả token thô một lần cho user đã đăng nhập', async () => {
    repository.create.mockResolvedValue(new Date('2026-09-24T10:10:00Z'));

    const result = await service.create('11111111-1111-1111-1111-111111111111');

    expect(result.linkToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repository.create).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      hashTelegramLinkToken(result.linkToken),
    );
    expect(repository.create.mock.calls[0][1]).not.toBe(result.linkToken);
  });

  it('không đưa token sai định dạng vào truy vấn DB', async () => {
    await expect(service.consume('bad', '12345', '12345')).resolves.toBe(false);
    expect(repository.consume).not.toHaveBeenCalled();
  });
});
