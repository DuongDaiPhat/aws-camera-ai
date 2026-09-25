import type { components } from '@cam/contracts';
import { apiFetch } from './api-client';

export type EscalationRule = components['schemas']['EscalationRule'];
export type UpdateEscalationThresholdsRequest =
  components['schemas']['UpdateEscalationThresholdsRequest'];

export interface ListEscalationRulesResponse {
  data: EscalationRule[];
}

export async function fetchEscalationRules(): Promise<EscalationRule[]> {
  const response = await apiFetch<ListEscalationRulesResponse>('/escalation-rules');
  return response.data;
}

export async function updateEscalationThresholds(
  eventType: string,
  request: UpdateEscalationThresholdsRequest,
): Promise<EscalationRule> {
  return apiFetch<EscalationRule>(`/escalation-rules/${eventType}`, {
    method: 'PATCH',
    body: JSON.stringify(request),
  });
}
