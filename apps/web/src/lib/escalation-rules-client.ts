import type { components } from '@cam/contracts';
import { apiFetch } from './api-client';

export type EscalationRule = components['schemas']['EscalationRule'];
export type UpdateEscalationThresholdsRequest =
  components['schemas']['UpdateEscalationThresholdsRequest'];

export interface ListEscalationRulesResponse {
  data: EscalationRule[];
}

export async function fetchEscalationRules(household = false): Promise<EscalationRule[]> {
  const response = await apiFetch<ListEscalationRulesResponse>(
    household ? '/household/escalation-rules' : '/escalation-rules',
  );
  return response.data;
}

export async function updateEscalationThresholds(
  eventType: string,
  request: UpdateEscalationThresholdsRequest,
  household = false,
): Promise<EscalationRule> {
  return apiFetch<EscalationRule>(
    `${household ? '/household' : ''}/escalation-rules/${eventType}`,
    {
      method: household ? 'PUT' : 'PATCH',
      body: JSON.stringify(request),
    },
  );
}
