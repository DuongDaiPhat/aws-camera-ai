import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { PlaybackRepository } from './playback.repository';
describe('Playback access after household integration', () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const repo = new PlaybackRepository({ query } as unknown as DatabaseService, new ConfigService());
  beforeEach(() => query.mockClear());
  it('uses the same household policy as the camera API for viewers', async () => {
    await repo.cameras({ sub: 'viewer', role: 'VIEWER', email: 'viewer@example.test' }, 'camera');
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('can_access_camera($2::uuid,c.id,TRUE)');
    expect(values).toEqual([false, 'viewer', 'camera', 1000]);
  });
  it('does not grant a household administrator cross-household access', async () => {
    await repo.cameras({ sub: 'admin', role: 'ADMIN', email: 'home@example.test' });
    expect(query.mock.calls[0]?.[1][0]).toBe(false);
  });
  it('preserves the explicit system administrator exemption', async () => {
    await repo.cameras({ sub: 'root', role: 'ADMIN', email: 'admin@camerai.local' });
    expect(query.mock.calls[0]?.[1][0]).toBe(true);
  });
  it('does not elevate a non-administrator based on email', async () => {
    await repo.cameras({
      sub: 'viewer',
      role: 'VIEWER',
      email: 'admin@camerai.local',
    });
    expect(query.mock.calls[0]?.[1][0]).toBe(false);
  });
});
