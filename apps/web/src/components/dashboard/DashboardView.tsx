'use client';

import { useState } from 'react';
import type { UIEventItem } from '@/types';
import { useAuth, useEvents, useEventStats } from '@/hooks';
import { Sidebar, TopHeader } from '@/components/layout';
import { MetricCards } from '@/components/dashboard/MetricCards';
import { EventCard, EventDetailModal, EventFilter } from '@/components/events';
import { EmptyState, ErrorState, Pagination } from '@/components/ui';
import styles from './dashboard-view.module.css';

function EventsListSection({
  isLoading,
  error,
  events,
  onViewDetail,
  onResetFilter,
  onRetry,
}: {
  isLoading: boolean;
  error: string | null;
  events: UIEventItem[];
  onViewDetail: (e: UIEventItem) => void;
  onResetFilter: () => void;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div className={styles.loadingWrapper} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <span>Đang đồng bộ sự kiện camera…</span>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        message={`${error} Kiểm tra xem Orchestrator đã chạy chưa, sau đó bấm thử lại.`}
        onRetry={onRetry}
      />
    );
  }

  if (events.length === 0) {
    return <EmptyState onResetFilter={onResetFilter} />;
  }

  return (
    <div className={styles.eventsList}>
      {events.map((evt) => (
        <EventCard key={evt.id} event={evt} onViewDetail={onViewDetail} />
      ))}
    </div>
  );
}

export function DashboardView() {
  const { user, handleLogout } = useAuth();
  const {
    events,
    filteredEvents,
    paginatedEvents,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    totalFilteredItems,
    counts,
    isLoading,
    error,
    reload,
    activeFilterTab,
    setActiveFilterTab,
    selectedZone,
    setSelectedZone,
    liveNoticeText,
    simulateNewEvent,
    confirmOk,
    confirmHelp,
    toggleFalseAlarm,
    resetFilters,
  } = useEvents();

  // Sự kiện mới tới qua SSE làm số liệu cũ đi ngay, nên dùng số sự kiện đang giữ
  // làm mốc để tải lại các thẻ tổng hợp.
  const { stats, isLoading: isStatsLoading, error: statsError } = useEventStats(events.length);

  const [activeNav, setActiveNav] = useState('dashboard');
  const [selectedEventForModal, setSelectedEventForModal] = useState<UIEventItem | null>(null);

  return (
    <div className={styles.layoutWrapper}>
      <Sidebar
        user={user}
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        onLogout={handleLogout}
        unresolvedEventCount={stats?.pendingCount ?? counts.urgent}
        onlineCameraCount={stats?.cameraOnlineCount ?? 0}
      />

      <div className={styles.mainContent}>
        <TopHeader
          userName={user?.fullName || 'Đức Anh'}
          selectedZone={selectedZone}
          onSelectZone={setSelectedZone}
          onSimulateNewEvent={simulateNewEvent}
        />

        <main className={styles.workspace}>
          {liveNoticeText && (
            <div className={styles.newEventNotice} role="status">
              <span>{liveNoticeText}</span>
              <small>Vừa chèn lên đầu danh sách</small>
            </div>
          )}

          <MetricCards stats={stats} isLoading={isStatsLoading} error={statsError} />

          <section className={styles.eventsSection} aria-labelledby="events-title">
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitles}>
                <h2 id="events-title" className={styles.sectionTitle}>
                  Sự kiện gần đây
                </h2>
                <p className={styles.sectionSubtitle}>
                  Những hoạt động mới nhất được camera và cảm biến ghi nhận trong thời gian thực.
                </p>
              </div>

              <EventFilter
                activeTab={activeFilterTab}
                onSelectTab={setActiveFilterTab}
                counts={counts}
              />
            </div>

            <EventsListSection
              isLoading={isLoading}
              error={error}
              events={paginatedEvents}
              onViewDetail={setSelectedEventForModal}
              onResetFilter={resetFilters}
              onRetry={reload}
            />

            {!isLoading && !error && filteredEvents.length > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalFilteredItems}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                onPageSizeChange={setPageSize}
              />
            )}
          </section>
        </main>
      </div>

      {selectedEventForModal && (
        <EventDetailModal
          event={selectedEventForModal}
          onClose={() => setSelectedEventForModal(null)}
          onConfirmOk={(id) => {
            confirmOk(id);
            setSelectedEventForModal(null);
          }}
          onConfirmHelp={(id) => {
            confirmHelp(id);
            setSelectedEventForModal(null);
          }}
          onToggleFalseAlarm={(id) => {
            toggleFalseAlarm(id);
            setSelectedEventForModal(null);
          }}
        />
      )}
    </div>
  );
}
