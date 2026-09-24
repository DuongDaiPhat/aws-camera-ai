import { ConfigService } from '@nestjs/config';
import { FrigateClientService } from '../src/frigate/frigate-client.service';

describe('FrigateClientService', () => {
  const configService = {
    get: jest.fn().mockReturnValue('http://frigate:5000'),
  } as unknown as ConfigService;
  let service: FrigateClientService;

  beforeEach(() => {
    service = new FrigateClientService(configService);
    jest.restoreAllMocks();
  });

  it('decodes the JSON string returned by Frigate config/raw before merging YAML', async () => {
    const rawYaml = 'mqtt:\n  host: mosquitto\n';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(rawYaml),
    } as Response);

    await expect(service.getRawConfig()).resolves.toBe(rawYaml);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://frigate:5000/api/config/raw',
      expect.any(Object),
    );
  });

  it('sends YAML to the Frigate 0.18 save endpoint with its required restart option', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await expect(service.saveConfig('mqtt: { host: mosquitto }')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://frigate:5000/api/config/save?save_option=restart',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'mqtt: { host: mosquitto }',
      }),
    );
  });
});
