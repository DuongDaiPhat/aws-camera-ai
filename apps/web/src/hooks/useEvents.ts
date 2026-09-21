'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchEvents, subscribeEventsStream } from '@/lib/events-client';
import { generateSimulatedLiveEvent } from '@/lib/mock-events';
import type { UIEventItem, FilterTabKey, FilterTabCounts } from '@/types';

const LIVE_NOTICE_DURATION_MS = 4000;

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

type EventsSetter = React.Dispatch<React.SetStateAction<UIEventItem[]>>;
type NoticeSetter = React.Dispatch<React.SetStateAction<string | null>>;

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

function useEventPagination(
  filteredEvents: UIEventItem[],
  activeFilterTab: string,
  selectedZone: string,
) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilterTab, selectedZone]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredEvents.length / pageSize)),
    [filteredEvents.length, pageSize],
  );

  const effectivePage = Math.min(currentPage, totalPages);

  const paginatedEvents = useMemo(() => {
    const start = (effectivePage - 1) * pageSize;
    return filteredEvents.slice(start, start + pageSize);
  }, [filteredEvents, effectivePage, pageSize]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  }, []);

  return {
    currentPage: effectivePage,
    setCurrentPage: handlePageChange,
    pageSize,
    setPageSize: handlePageSizeChange,
    totalPages,
    paginatedEvents,
    totalFilteredItems: filteredEvents.length,
  };
}

/** Sự kiện mới: chèn lên đầu danh sách và báo cho người dùng biết. */
function prependEvent(newEvent: UIEventItem, setEvents: EventsSetter, setNotice: NoticeSetter) {
  setEvents((prev) => [newEvent, ...prev.filter((e) => e.id !== newEvent.id)]);
  const cameraName = newEvent.camera?.name ?? 'Camera';
  setNotice(`⚡ ${newEvent.aiTag} · ${cameraName}`);
  setTimeout(() => setNotice(null), LIVE_NOTICE_DURATION_MS);
}

/**
 * Sự kiện được cập nhật (thường là ảnh snapshot vừa tải xong): thay tại chỗ,
 * không đẩy lên đầu để danh sách không nhảy dưới tay người đang đọc.
 */
function replaceEvent(updatedEvent: UIEventItem, setEvents: EventsSetter) {
  setEvents((prev) => {
    const exists = prev.some((e) => e.id === updatedEvent.id);
    return exists
      ? prev.map((e) => (e.id === updatedEvent.id ? { ...e, ...updatedEvent } : e))
      : [updatedEvent, ...prev];
  });
}

interface EventsSource {
  events: UIEventItem[];
  setEvents: EventsSetter;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
  liveNoticeText: string | null;
  setLiveNoticeText: NoticeSetter;
}

function useEventsSource(): EventsSource {
  const [events, setEvents] = useState<UIEventItem[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveNoticeText, setLiveNoticeText] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    fetchEvents()
      .then(({ events: loadedEvents }) => {
        if (!isMounted) return;
        setEvents(loadedEvents);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? `Không tải được danh sách sự kiện: ${err.message}`
            : 'Không tải được danh sách sự kiện.',
        );
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    const unsubscribe = subscribeEventsStream({
      onCreated: (event) => prependEvent(event, setEvents, setLiveNoticeText),
      onUpdated: (event) => replaceEvent(event, setEvents),
    });
    return unsubscribe;
  }, []);

  return { events, setEvents, isLoading, error, reload, liveNoticeText, setLiveNoticeText };
}

export function useEvents() {
  const { events, setEvents, isLoading, error, reload, liveNoticeText, setLiveNoticeText } =
    useEventsSource();
  const filterState = useEventFilters(events);
  const paginationState = useEventPagination(
    filterState.filteredEvents,
    filterState.activeFilterTab,
    filterState.selectedZone,
  );

  const simulateNewEvent = useCallback(() => {
    prependEvent(generateSimulatedLiveEvent(), setEvents, setLiveNoticeText);
  }, [setEvents, setLiveNoticeText]);

  const confirmOk = useCallback(
    (id: string) => {
      setEvents((prev) =>
        updateItem(prev, id, (e) => ({
          ...e,
          status: 'RESOLVED',
          aiTag: 'An toàn',
          aiTagColor: 'success',
        })),
      );
    },
    [setEvents],
  );

  const confirmHelp = useCallback(
    (id: string) => {
      setEvents((prev) =>
        updateItem(prev, id, (e) => ({ ...e, status: 'ESCALATED', priority: 'P0' })),
      );
    },
    [setEvents],
  );

  const toggleFalseAlarm = useCallback(
    (id: string) => {
      setEvents((prev) => updateItem(prev, id, (e) => ({ ...e, isFalseAlarm: !e.isFalseAlarm })));
    },
    [setEvents],
  );

  return {
    events,
    isLoading,
    error,
    reload,
    liveNoticeText,
    simulateNewEvent,
    confirmOk,
    confirmHelp,
    toggleFalseAlarm,
    ...filterState,
    ...paginationState,
  };
}
