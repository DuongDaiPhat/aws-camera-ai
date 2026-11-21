import { beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';
import { createZone, deleteZone, fetchZones, retryZoneSync, updateZone } from './zones-client';
vi.mock('./api-client', () => ({ apiFetch: vi.fn() }));
beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

it('reads zones and tolerates an absent data array', async () => {
  vi.mocked(apiFetch)
    .mockResolvedValueOnce({ data: [{ id: 'zone' }] })
    .mockResolvedValueOnce({});
  expect(await fetchZones('cam/a')).toEqual([{ id: 'zone' }]);
  expect(apiFetch).toHaveBeenCalledWith('/cameras/cam%2Fa/zones');
  expect(await fetchZones('cam')).toEqual([]);
});

it('encodes identifiers and retains mutation payloads', async () => {
  const payload = {
    name: 'Kitchen',
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  };
  await createZone('cam/a', payload as never);
  expect(apiFetch).toHaveBeenLastCalledWith('/cameras/cam%2Fa/zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await updateZone('zone/a', { name: 'Door' });
  expect(apiFetch).toHaveBeenLastCalledWith('/zones/zone%2Fa', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{"name":"Door"}',
  });
  await deleteZone('zone/a');
  expect(apiFetch).toHaveBeenLastCalledWith('/zones/zone%2Fa', { method: 'DELETE' });
  await retryZoneSync('cam/a');
  expect(apiFetch).toHaveBeenLastCalledWith('/cameras/cam%2Fa/frigate-sync/retry', {
    method: 'POST',
  });
});

it('does not turn network errors into an empty successful list', async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error('offline'));
  await expect(fetchZones('cam')).rejects.toThrow('offline');
});
