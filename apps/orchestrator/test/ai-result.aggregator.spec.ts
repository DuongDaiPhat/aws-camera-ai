import type { EventType, PriorityLevel } from '@cam/contracts';
import { aggregateAiResult } from '../src/ai-results/ai-result.aggregator';
import type {
  AiEventAggregateState,
  AiResultProjectionItem,
  EscalationRulePriority,
} from '../src/ai-results/ai-result.types';

const RULES: EscalationRulePriority[] = [
  { eventType: 'PERSON_DETECTED', priority: 'P3' },
  { eventType: 'UNKNOWN_PERSON', priority: 'P2' },
  { eventType: 'RESTRICTED_ZONE', priority: 'P1' },
  { eventType: 'FALL_DETECTED', priority: 'P1' },
  { eventType: 'FIRE_SMOKE_DETECTED', priority: 'P0' },
  { eventType: 'WELLNESS_TIMEOUT', priority: 'P2' },
];

function state(overrides: Partial<AiEventAggregateState> = {}): AiEventAggregateState {
  return {
    eventType: 'PERSON_DETECTED',
    status: 'DETECTED',
    priority: 'P3',
    aiLabel: null,
    confidence: null,
    aiModelVersion: null,
    aiProcessedAt: null,
    aiResults: [],
    ...overrides,
  };
}

function result(
  module: AiResultProjectionItem['module'],
  label: string,
  confidence: number | null,
  observationId: string,
): AiResultProjectionItem {
  return {
    resultId: `${module}-${observationId}`,
    observationId,
    revision: 1,
    module,
    label,
    confidence,
    modelVersion: `${module.toLowerCase()}-v1`,
    processedAt: '2026-09-23T10:00:00.000Z',
    status: 'SUCCESS',
    error: null,
    boundingBox: null,
    metadata: {},
  };
}

function apply(
  currentState: AiEventAggregateState,
  item: AiResultProjectionItem,
): AiEventAggregateState {
  const projection = aggregateAiResult(currentState, [item], RULES);
  return { status: currentState.status, ...projection };
}

describe('aggregateAiResult (US-11)', () => {
  it('giữ cả M1 UNKNOWN và M4, nhưng dùng đúng confidence của nhãn P1 đại diện', () => {
    const withFace = apply(state(), result('M1_FACE', 'UNKNOWN', 0.85, 'face-1'));
    const projection = aggregateAiResult(
      withFace,
      [result('M4_ZONE', 'RESTRICTED_ZONE', 0.7, 'zone-1')],
      RULES,
    );

    expect(projection.eventType).toBe('RESTRICTED_ZONE');
    expect(projection.priority).toBe('P1');
    expect(projection.aiLabel).toBe('RESTRICTED_ZONE');
    expect(projection.confidence).toBe(0.7);
    expect(projection.aiResults.map((item) => item.label)).toEqual(['UNKNOWN', 'RESTRICTED_ZONE']);
    expect(projection.candidates).toHaveLength(2);
  });

  it('cho projection tương đương khi M1 và M4 đến theo thứ tự đảo ngược', () => {
    const face = result('M1_FACE', 'UNKNOWN', 0.85, 'face-1');
    const zone = result('M4_ZONE', 'RESTRICTED_ZONE', 0.7, 'zone-1');
    const faceThenZone = aggregateAiResult(apply(state(), face), [zone], RULES);
    const zoneThenFace = aggregateAiResult(apply(state(), zone), [face], RULES);

    expect(zoneThenFace).toEqual(faceThenZone);
  });

  it('không làm mất nguy cơ M4 khi M1 nhận ra người quen', () => {
    const withZone = apply(state(), result('M4_ZONE', 'RESTRICTED_ZONE', 0.72, 'zone-1'));
    const projection = aggregateAiResult(
      withZone,
      [result('M1_FACE', 'KNOWN', 0.91, 'face-1')],
      RULES,
    );

    expect(projection.eventType).toBe('RESTRICTED_ZONE');
    expect(projection.aiResults.map((item) => item.label)).toEqual(['KNOWN', 'RESTRICTED_ZONE']);
  });

  it('giữ confidence null cho UNDETERMINED và không tạo nguy cơ', () => {
    const projection = aggregateAiResult(
      state(),
      [result('M1_FACE', 'UNDETERMINED', null, 'face-1')],
      RULES,
    );

    expect(projection).toMatchObject({
      eventType: 'PERSON_DETECTED',
      priority: 'P3',
      aiLabel: 'UNDETERMINED',
      confidence: null,
      candidates: [],
    });
  });

  it.each<[EventType, PriorityLevel]>([
    ['FIRE_SMOKE_DETECTED', 'P0'],
    ['FALL_DETECTED', 'P1'],
    ['WELLNESS_TIMEOUT', 'P2'],
  ])('lấy priority từ escalation_rules cho %s', (eventType, priority) => {
    const module = eventType === 'FIRE_SMOKE_DETECTED' ? 'M3_FIRE' : 'M2A_FALL';
    const projection = aggregateAiResult(state(), [result(module, eventType, 0.8, 'obs-1')], RULES);
    expect(projection.priority).toBe(priority);
  });

  it('không hạ projection nguy cơ đã NOTIFIED khi result đến muộn không còn candidate', () => {
    const projection = aggregateAiResult(
      state({
        status: 'NOTIFIED',
        eventType: 'RESTRICTED_ZONE',
        priority: 'P1',
        aiLabel: 'RESTRICTED_ZONE',
        confidence: 0.7,
        aiModelVersion: 'zone-v1',
        aiProcessedAt: '2026-09-23T10:00:00.000Z',
      }),
      [result('M1_FACE', 'KNOWN', 0.95, 'face-1')],
      RULES,
    );

    expect(projection).toMatchObject({
      eventType: 'RESTRICTED_ZONE',
      priority: 'P1',
      aiLabel: 'RESTRICTED_ZONE',
      confidence: 0.7,
    });
  });

  it('không hạ priority đã NOTIFIED khi chỉ còn candidate mức thấp hơn', () => {
    const projection = aggregateAiResult(
      state({
        status: 'NOTIFIED',
        eventType: 'RESTRICTED_ZONE',
        priority: 'P1',
        aiLabel: 'RESTRICTED_ZONE',
        confidence: 0.7,
        aiModelVersion: 'zone-v1',
        aiProcessedAt: '2026-09-23T10:00:00.000Z',
      }),
      [result('M1_FACE', 'UNKNOWN', 0.85, 'face-1')],
      RULES,
    );

    expect(projection).toMatchObject({
      eventType: 'RESTRICTED_ZONE',
      priority: 'P1',
      aiLabel: 'RESTRICTED_ZONE',
      confidence: 0.7,
    });
    expect(projection.candidates.map((candidate) => candidate.eventType)).toEqual([
      'UNKNOWN_PERSON',
    ]);
  });
});
