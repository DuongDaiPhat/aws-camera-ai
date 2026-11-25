import type { components, operations } from '@cam/contracts';
import { apiFetch } from './api-client';
export type Household = components['schemas']['HouseholdSnapshot'];
export type HouseholdMember = components['schemas']['HouseholdMember'];
export type CameraGrant = components['schemas']['HouseholdCameraGrant'];
export type HouseholdContact = components['schemas']['HouseholdContact'];
export type HouseholdSettings = components['schemas']['HouseholdSettings'];
export type HouseholdAiModulesSettings = components['schemas']['HouseholdAiModulesSettings'];
export type HouseholdAiModulesInput = components['schemas']['HouseholdAiModulesInput'];
export type AccountSettings = components['schemas']['AccountSettings'];
export type NotificationPreferences = components['schemas']['NotificationPreferences'];
export const getHousehold = (signal?: AbortSignal) => apiFetch<Household>('/household', { signal });
export const createMember = (input: components['schemas']['CreateHouseholdMemberRequest']) =>
  apiFetch('/household/members', { method: 'POST', body: JSON.stringify(input) });
export const setCameraGrants = (id: string, grants: CameraGrant[]) =>
  apiFetch(`/household/members/${id}/cameras`, { method: 'PUT', body: JSON.stringify({ grants }) });
export const removeMember = (id: string) =>
  apiFetch(`/household/members/${id}`, { method: 'DELETE' });
export const saveContact = (input: components['schemas']['HouseholdContactRequest'], id?: string) =>
  apiFetch('/household/contacts' + (id ? '/' + id : ''), {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
export const removeContact = (id: string) =>
  apiFetch('/household/contacts/' + id, { method: 'DELETE' });
export const saveHouseholdSettings = (input: HouseholdSettings) =>
  apiFetch<operations['updateHouseholdSettings']['responses'][200]['content']['application/json']>(
    '/household/settings',
    { method: 'PUT', body: JSON.stringify(input) },
  );
export const getAccountSettings = (signal?: AbortSignal) =>
  apiFetch<AccountSettings>('/account', { signal });
export const saveProfile = (input: components['schemas']['AccountProfileRequest']) =>
  apiFetch<AccountSettings>('/account/profile', { method: 'PATCH', body: JSON.stringify(input) });
export const saveNotificationPreferences = (input: NotificationPreferences) =>
  apiFetch<NotificationPreferences>('/account/preferences', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
export const changePassword = (input: components['schemas']['ChangeAccountPasswordRequest']) =>
  apiFetch('/account/password', { method: 'POST', body: JSON.stringify(input) });
export const createHouseholdCamera = (name: string) =>
  apiFetch<{ id: string }>('/household/cameras', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
export const getHouseholdAiModules = (signal?: AbortSignal) =>
  apiFetch<HouseholdAiModulesSettings>('/household/ai-modules', { signal });
export const saveHouseholdAiModules = (input: HouseholdAiModulesInput) =>
  apiFetch<HouseholdAiModulesSettings>('/household/ai-modules', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
