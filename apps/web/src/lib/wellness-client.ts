import type { components } from '@cam/contracts';
import { apiFetch } from './api-client';

export type WellnessSchedule = components['schemas']['WellnessSchedule'];
export type WellnessCheck = components['schemas']['WellnessCheck'];
export type ScheduleInput = components['schemas']['CreateWellnessScheduleRequest'];
export type ConfirmationInput = components['schemas']['WellnessConfirmationRequest'];
export const listWellnessSchedules = () =>
  apiFetch<{ data: WellnessSchedule[] }>('/wellness-schedules');
export const listWellnessChecks = (page = 1) =>
  apiFetch<{ data: WellnessCheck[]; total: number }>(`/wellness-checks?page=${page}&pageSize=20`);
export const createWellnessSchedule = (input: ScheduleInput) =>
  apiFetch<WellnessSchedule>('/wellness-schedules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const updateWellnessSchedule = (
  id: string,
  input: components['schemas']['UpdateWellnessScheduleRequest'],
) =>
  apiFetch<WellnessSchedule>(`/wellness-schedules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
export const deleteWellnessSchedule = (id: string) =>
  apiFetch<void>(`/wellness-schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const confirmWellnessCheck = (id: string, input: ConfirmationInput) =>
  apiFetch<components['schemas']['Confirmation']>(
    `/wellness-checks/${encodeURIComponent(id)}/confirm`,
    { method: 'POST', body: JSON.stringify(input) },
  );
