import { ConfigService } from '@nestjs/config';
import { FireAiClient } from '../src/fire/fire-ai.client';
import { fireConfig, fireFrame, fireResponse } from './fire-fixtures';

describe('US-18 AI HTTP boundary', () => {
  const config = new ConfigService({
    AI_SERVICE_URL: 'http://ai.test',
    AI_INTERNAL_TOKEN: 'internal-test-token',
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends the full JPEG identity and validates the returned evidence', async () => {
    const frame = fireFrame(Date.now());
    const expected = fireResponse(frame);
    const request = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(expected)));
    const result = await new FireAiClient(config, fireConfig()).detect(frame);
    expect(result).toMatchObject(expected);
    expect(request).toHaveBeenCalledWith(
      'http://ai.test/fire/detect',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-Internal-Token': 'internal-test-token' },
      }),
    );
    const form = request.mock.calls[0][1]?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) throw new Error('Missing multipart frame');
    expect(form.get('sourceSessionId')).toBe(frame.header.sourceSessionId);
    expect(form.get('frameId')).toBe(frame.header.frameId);
    expect(form.get('frameTimestamp')).toBe(frame.header.frameTimestamp);
    expect(form.get('image')).toBeInstanceOf(Blob);
  });

  it.each([
    new Response('x'.repeat(128 * 1024 + 1)),
    new Response('{}'),
    new Response('unavailable', { status: 503 }),
  ])('rejects excessive, malformed or failed responses', async (response) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    await expect(
      new FireAiClient(config, fireConfig()).detect(fireFrame(Date.now())),
    ).rejects.toThrow();
  });
});
