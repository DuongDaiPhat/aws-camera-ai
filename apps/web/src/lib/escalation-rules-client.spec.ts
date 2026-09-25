import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchEscalationRules,
  updateEscalationThresholds,
} from './escalation-rules-client';
import * as apiClient from './api-client';

describe('escalation-rules-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchEscalationRules gọi GET /escalation-rules và trả về mảng rules', async () => {
    const mockRules = [
      {
        eventType: 'FIRE_SMOKE_DETECTED' as const,
        priority: 'P0' as const,
        tLow: 0.5,
        tHigh: 0.7,
        tWaitSeconds: 30,
        version: 1,
        isEnabled: true,
      },
    ];

    const spy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValueOnce({ data: mockRules });

    const result = await fetchEscalationRules();
    expect(spy).toHaveBeenCalledWith('/escalation-rules');
    expect(result).toEqual(mockRules);
  });

  it('updateEscalationThresholds gọi PATCH /escalation-rules/:eventType với payload chuẩn', async () => {
    const payload = {
      tLow: 0.6,
      tHigh: 0.8,
      tWaitSeconds: 45,
      expectedVersion: 1,
    };

    const mockResponse = {
      eventType: 'FALL_DETECTED' as const,
      priority: 'P1' as const,
      ...payload,
      version: 2,
      isEnabled: true,
    };

    const spy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValueOnce(mockResponse);

    const result = await updateEscalationThresholds('FALL_DETECTED', payload);
    expect(spy).toHaveBeenCalledWith('/escalation-rules/FALL_DETECTED', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    expect(result).toEqual(mockResponse);
  });
});
