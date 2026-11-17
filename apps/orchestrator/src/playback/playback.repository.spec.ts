import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { PlaybackRepository } from './playback.repository';
describe('Playback household authorization', () => {
  it('requires admin, device owner or active linked household membership and parameterizes IDs', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repo = new PlaybackRepository(
      { query } as unknown as DatabaseService,
      new ConfigService(),
    );
    await repo.cameras({ sub: 'viewer-id', role: 'VIEWER' }, 'camera-id');
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("$1='ADMIN'");
    expect(sql).toContain('d.owner_user_id=$2::uuid');
    expect(sql).toContain('k.linked_user_id=$2::uuid AND k.is_active=true');
    expect(sql).toContain('LIMIT $4');
    expect(values).toEqual(['VIEWER', 'viewer-id', 'camera-id', 1000]);
  });
});
