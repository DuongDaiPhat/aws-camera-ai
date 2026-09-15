import { HealthService } from '../src/health/health.service';

describe('HealthService', () => {
  it('tra ve trang thai ok cho service orchestrator', () => {
    const result = new HealthService().check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('orchestrator');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(() => new Date(result.timestamp)).not.toThrow();
  });
});
