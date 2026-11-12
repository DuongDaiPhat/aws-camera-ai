'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { OverviewPanel, SystemOverview } from './OverviewPanel';
import { useFireAttention } from '@/hooks/useFireAttention';
import { FireAttention } from '@/components/events/FireAttention';
import { fireReviewKey } from '@/lib/fire-alerts';
import { KnownFacesView } from '@/components/known-faces/KnownFacesView';
import type { UIEventItem } from '@/types';
import { useAuth, useEvents, useEventStats } from '@/hooks';
import { Sidebar, TopHeader } from '@/components/layout';
import { MetricCards } from '@/components/dashboard/MetricCards';
import { EventCard, EventDetailModal, EventFilter } from '@/components/events';
import { CameraView } from '@/components/cameras';
import { EmptyState, ErrorState, Pagination } from '@/components/ui';
import { SettingsView } from '@/components/settings';
import { ZonesView } from '@/components/zones';
import { WellnessView } from '@/components/wellness/WellnessView';
import styles from './dashboard-view.module.css';

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Tổng quan',
  cameras: 'Camera trực tiếp',
  events: 'Lịch sử sự kiện',
  'known-faces': 'Người quen',
  zones: 'Khu vực giám sát',
  wellness: 'Kiểm tra sức khỏe',
  settings: 'Cài đặt cảnh báo',
};

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
      <ErrorState message={`${error} Vui lòng kiểm tra kết nối và thử lại.`} onRetry={onRetry} />
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

function EventHistory({
  state,
  metrics,
  onViewDetail,
  showMetrics = true,
}: {
  showMetrics?: boolean;
  state: ReturnType<typeof useEvents>;
  metrics: ReturnType<typeof useEventStats>;
  onViewDetail: (event: UIEventItem) => void;
}) {
  const {
    activeFilterTab,
    setActiveFilterTab,
    counts,
    isLoading,
    error,
    paginatedEvents,
    resetFilters,
    reload,
    filteredEvents,
    currentPage,
    totalPages,
    totalFilteredItems,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = state;
  const { stats, isLoading: isStatsLoading, error: statsError } = metrics;
  return (
    <>
      {showMetrics && <MetricCards stats={stats} isLoading={isStatsLoading} error={statsError} />}

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
          onViewDetail={onViewDetail}
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
    </>
  );
}

function DashboardEventDetails({
  event,
  actions,
  onClose,
}: {
  event: UIEventItem | null;
  actions: ReturnType<typeof useEvents>;
  onClose: () => void;
}) {
  const after =
    (action: (id: string, note?: string) => Promise<void>) => async (id: string, note?: string) => {
      await action(id, note);
      onClose();
    };
  return (
    <EventDetailModal
      event={event}
      onClose={onClose}
      onConfirmOk={after(actions.confirmOk)}
      onConfirmHelp={after(actions.confirmHelp)}
      onCloseEmergency={after(actions.closeEmergency)}
      onToggleFalseAlarm={(id) => {
        actions.toggleFalseAlarm(id);
        onClose();
      }}
    />
  );
}

function eventZoneOptions(events: UIEventItem[]) {
  return Array.from(
    new Map(
      events.flatMap((event) =>
        event.zone
          ? [
              [
                event.zone.id,
                {
                  id: `zone:${event.zone.id}`,
                  name: [event.camera?.name, event.zone.name].filter(Boolean).join(' · '),
                },
              ] as const,
            ]
          : [],
      ),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

function HistoryContent({
  overview,
  state,
  metrics,
  onNavigate,
  onViewDetail,
}: {
  overview: boolean;
  state: ReturnType<typeof useEvents>;
  metrics: ReturnType<typeof useEventStats>;
  onNavigate: (page: string) => void;
  onViewDetail: (event: UIEventItem) => void;
}) {
  if (!overview)
    return <EventHistory state={state} metrics={metrics} onViewDetail={onViewDetail} />;
  return (
    <>
      <OverviewPanel metrics={metrics} onNavigate={onNavigate} />
      <div className={styles.lowerGrid}>
        <EventHistory
          state={state}
          metrics={metrics}
          onViewDetail={onViewDetail}
          showMetrics={false}
        />
        <SystemOverview events={state.events} onNavigate={onNavigate} />
      </div>
    </>
  );
}

export function DashboardView() {
  const { user, handleLogout } = useAuth();
  const eventState = useEvents();
  const {
    events,
    counts,
    selectedZone,
    setSelectedZone,
    liveNoticeText,
    confirmOk,
    confirmHelp,
    closeEmergency,
  } = eventState;
  const attention = useFireAttention(events, user?.id);

  // Telegram confirmations update an existing event without changing the list length.
  const statsRefreshToken = events.map((event) => `${event.id}:${event.status}`).join('|');
  const metrics = useEventStats(statsRefreshToken);

  const [activeNav, setActiveNav] = useState('dashboard');
  const [selectedEventForModal, setSelectedEventForModal] = useState<UIEventItem | null>(null);
  const attentionId = attention.event?.id;
  useEffect(() => {
    if (attentionId) setSelectedEventForModal(null);
  }, [attentionId]);
  const selectedEvent = selectedEventForModal
    ? (events.find((event) => event.id === selectedEventForModal.id) ?? selectedEventForModal)
    : null;

  return (
    <>
      <div
        className={styles.layoutWrapper}
        ref={(node) => {
          if (node) node.inert = Boolean(attention.event);
        }}
        aria-hidden={attention.event ? true : undefined}
      >
        <Sidebar
          user={user}
          activeNav={activeNav}
          onSelectNav={setActiveNav}
          onLogout={handleLogout}
          unresolvedEventCount={metrics.stats?.pendingCount ?? counts.urgent}
          onlineCameraCount={metrics.stats?.cameraOnlineCount}
        />

        <div className={styles.mainContent}>
          <TopHeader
            userName={user?.fullName || 'bạn'}
            zones={eventZoneOptions(events)}
            selectedZone={selectedZone}
            onSelectZone={setSelectedZone}
            pendingCount={
              metrics.isLoading || metrics.error ? null : (metrics.stats?.pendingCount ?? null)
            }
            pageTitle={PAGE_TITLES[activeNav] ?? PAGE_TITLES.dashboard}
            showZoneFilter={activeNav === 'dashboard' || activeNav === 'events'}
            onViewEvents={() => setActiveNav('events')}
          />

          <motion.main
            key={activeNav}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.75, 0.25, 1] }}
            className={styles.workspace}
          >
            {activeNav === 'wellness' ? (
              <WellnessView user={user} />
            ) : activeNav === 'cameras' ? (
              <CameraView user={user} />
            ) : activeNav === 'settings' ? (
              <SettingsView user={user} />
            ) : activeNav === 'known-faces' ? (
              <KnownFacesView isAdmin={user?.role === 'ADMIN'} />
            ) : activeNav === 'zones' ? (
              <ZonesView user={user} />
            ) : (
              <>
                {liveNoticeText && (
                  <div className={styles.newEventNotice} role="status">
                    <span>{liveNoticeText}</span>
                    <small>Vừa chèn lên đầu danh sách</small>
                  </div>
                )}
                {attention.error && (
                  <div className={styles.newEventNotice} role="alert">
                    {attention.error}{' '}
                    <button type="button" onClick={attention.retry}>
                      Thử lại
                    </button>
                  </div>
                )}

                <HistoryContent
                  overview={activeNav === 'dashboard'}
                  state={eventState}
                  metrics={metrics}
                  onNavigate={setActiveNav}
                  onViewDetail={setSelectedEventForModal}
                />
              </>
            )}
          </motion.main>
        </div>

        <DashboardEventDetails
          event={attention.event ? null : selectedEvent}
          actions={eventState}
          onClose={() => setSelectedEventForModal(null)}
        />
      </div>
      {attention.event && (
        <FireAttention
          key={fireReviewKey(attention.event)}
          event={attention.event}
          onReviewed={() => {
            if (attention.event) attention.review(attention.event.id);
          }}
          onConfirmOk={confirmOk}
          onConfirmHelp={confirmHelp}
          onCloseEmergency={closeEmergency}
        />
      )}
    </>
  );
}
