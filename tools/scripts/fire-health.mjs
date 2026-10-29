/** Read authenticated M3 diagnostics without logging credentials or modifying runtime state. */
import { setTimeout } from 'node:timers/promises';

const token = process.env.INTERNAL_SERVICE_TOKEN;
if (!token) throw new Error('INTERNAL_SERVICE_TOKEN is required');
const url =
  process.env.FIRE_HEALTH_URL ??
  `http://localhost:${process.env.PORT_ORCHESTRATOR ?? 3001}/api/v1/internal/fire/health`;
const timeoutMs = Number(process.env.FIRE_HEALTH_CLIENT_TIMEOUT_MS ?? 10000);
const pollMs = Number(process.env.FIRE_HEALTH_POLL_MS ?? 5000);
if (![timeoutMs, pollMs].every((value) => Number.isInteger(value) && value > 0))
  throw new Error('Fire health timeout and polling interval must be positive milliseconds');
const watch = process.argv.includes('--watch');
do {
  try {
    const response = await fetch(url, {
      headers: { 'X-Internal-Token': token },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Fire health HTTP ${response.status}`);
    const health = await response.json();
    console.log(JSON.stringify(health, null, 2));
    process.exitCode = !watch && health.status !== 'READY' ? 2 : 0;
  } catch {
    console.error('M3 health request failed; check the service, URL and internal token.');
    process.exitCode = 1;
  }
  if (watch) await setTimeout(pollMs);
} while (watch);
