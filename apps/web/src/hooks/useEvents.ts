'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchEvents, subscribeEventsStream } from '@/lib/events-client';
import { generateSimulatedLiveEvent } from '@/lib/mock-events';
import type { UIEventItem, FilterTabKey, FilterTabCounts } from '@/types';

const ZONE_KEYWORDS: Record<string, string[]> = {
  bep: ['bếp'],
  'phong-khach': ['sofa', 'khách'],
  'cua-chinh': ['sảnh', 'cửa'],
  'tang-1': ['tầng 1'],
  'phong-ngu': ['phòng ngủ'],
};

function calculateCounts(events: UIEventItem[]): FilterTabCounts {
  let urgent = 0;
  let safe = 0;
  let info = 0;
  for (const e of events) {
    if (e.status === 'RESOLVED') {
      safe++;
    } else if (e.priority === 'P0' || e.priority === 'P1' || e.priority === 'P2') {
      urgent++;
    } else {
      info++;
    }
  }
  return { all: events.length, urgent, safe, info };
}

function matchZone(event: UIEventItem, zone: string): boolean {
  if (zone === 'ALL') return true;
  const keywords = ZONE_KEYWORDS[zone];
  if (!keywords) return true;
  const target = `${event.zone?.name ?? ''} ${event.camera?.name ?? ''}`.toLowerCase();
  return keywords.some((kw) => target.includes(kw));
}

function filterEvents(events: UIEventItem[], tab: FilterTabKey, zone: string): UIEventItem[] {
  return events.filter((e) => {
    if (
      tab === 'URGENT' &&
      (e.status === 'RESOLVED' ||
        (e.priority !== 'P0' && e.priority !== 'P1' && e.priority !== 'P2'))
    ) {
      return false;
    }
    if (tab === 'SAFE' && e.status !== 'RESOLVED') return false;
    if (tab === 'INFO' && e.priority !== 'P3' && e.status !== 'LOGGED_ONLY') return false;

    return matchZone(e, zone);
  });
}

function updateItem(
  items: UIEventItem[],
  id: string,
  transform: (item: UIEventItem) => UIEventItem,
): UIEventItem[] {
  return items.map((item) => (item.id === id ? transform(item) : item));
}

function handleIncomingStreamEvent(
  newEvent: UIEventItem,
  setEvents: React.Dispatch<React.SetStateAction<UIEventItem[]>>,
  setLiveNoticeText: React.Dispatch<React.SetStateAction<string | null>>,
) {
  setEvents((prev) => [newEvent, ...prev.filter((e) => e.id !== newEvent.id)]);
  const camName = newEvent.camera?.name ?? 'Camera';
  setLiveNoticeText(`⚡ Nhận sự kiện mới: ${camName} (${newEvent.aiTag})`);
  setTimeout(() => setLiveNoticeText(null), 4000);
}

function useEventFilters(events: UIEventItem[]) {
  const [activeFilterTab, setActiveFilterTab] = useState<FilterTabKey>('ALL');
  const [selectedZone, setSelectedZone] = useState('ALL');

  const resetFilters = useCallback(() => {
    setActiveFilterTab('ALL');
    setSelectedZone('ALL');
  }, []);

  const counts = useMemo(() => calculateCounts(events), [events]);
  const filteredEvents = useMemo(
    () => filterEvents(events, activeFilterTab, selectedZone),
    [events, activeFilterTab, selectedZone],
  );

  return {
    activeFilterTab,
    setActiveFilterTab,
    selectedZone,
    setSelectedZone,
    resetFilters,
    counts,
    filteredEvents,
  };
}

function useEventsSubscription(
  setEvents: React.Dispatch<React.SetStateAction<UIEventItem[]>>,
  setLiveNoticeText: React.Dispatch<React.SetStateAction<string | null>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
) {
  useEffect(() => {
    let isMounted = true;
    fetchEvents()
      .then((data) => {
        if (isMounted) setEvents(data);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    const unsubscribe = subscribeEventsStream((event) => {
      if (isMounted) handleIncomingStreamEvent(event, setEvents, setLiveNoticeText);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [setEvents, setLiveNoticeText, setLoading]);
}

export function useEvents() {
  const [events, setEvents] = useState<UIEventItem[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [liveNoticeText, setLiveNoticeText] = useState<string | null>(null);
  const filterState = useEventFilters(events);

  useEventsSubscription(setEvents, setLiveNoticeText, setLoading);

  const simulateNewEvent = useCallback(() => {
    const newEvent = generateSimulatedLiveEvent();
    handleIncomingStreamEvent(newEvent, setEvents, setLiveNoticeText);
  }, []);

  const confirmOk = useCallback((id: string) => {
    setEvents((prev) =>
      updateItem(prev, id, (e) => ({
        ...e,
        status: 'RESOLVED',
        aiTag: 'An toàn',
        aiTagColor: 'success',
      })),
    );
  }, []);

  const confirmHelp = useCallback((id: string) => {
    setEvents((prev) =>
      updateItem(prev, id, (e) => ({ ...e, status: 'ESCALATED', priority: 'P0' })),
    );
  }, []);

  const toggleFalseAlarm = useCallback((id: string) => {
    setEvents((prev) => updateItem(prev, id, (e) => ({ ...e, isFalseAlarm: !e.isFalseAlarm })));
  }, []);

  return {
    events,
    isLoading,
    liveNoticeText,
    simulateNewEvent,
    confirmOk,
    confirmHelp,
    toggleFalseAlarm,
    ...filterState,
  };
}
