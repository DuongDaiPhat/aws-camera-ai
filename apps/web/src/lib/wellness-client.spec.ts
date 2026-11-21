import { beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';
import * as client from './wellness-client';
vi.mock('./api-client', () => ({ apiFetch: vi.fn() }));
beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

it('requests schedules and paginates wellness checks', async () => {
  await client.listWellnessSchedules();
  expect(apiFetch).toHaveBeenLastCalledWith('/wellness-schedules');
  await client.listWellnessChecks();
  expect(apiFetch).toHaveBeenLastCalledWith('/wellness-checks?page=1&pageSize=20');
  await client.listWellnessChecks(3);
  expect(apiFetch).toHaveBeenLastCalledWith('/wellness-checks?page=3&pageSize=20');
});

it('creates, updates, deletes and confirms with escaped identifiers', async () => {
  const input = { name: 'Morning' } as never;
  await client.createWellnessSchedule(input);
  expect(apiFetch).toHaveBeenLastCalledWith('/wellness-schedules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  await client.updateWellnessSchedule('a/b', input);
  expect(apiFetch).toHaveBeenLastCalledWith('/wellness-schedules/a%2Fb', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  await client.deleteWellnessSchedule('a/b');
  expect(apiFetch).toHaveBeenLastCalledWith('/wellness-schedules/a%2Fb', { method: 'DELETE' });
  const confirmation = { result: 'SAFE' } as never;
  await client.confirmWellnessCheck('a/b', confirmation);
  expect(apiFetch).toHaveBeenLastCalledWith('/wellness-checks/a%2Fb/confirm', {
    method: 'POST',
    body: JSON.stringify(confirmation),
  });
});
