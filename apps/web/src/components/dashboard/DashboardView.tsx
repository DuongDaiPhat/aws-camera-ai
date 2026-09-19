'use client';

import { useState } from 'react';
import type { UIEventItem } from '@/types';
import { useAuth, useEvents } from '@/hooks';
import { Sidebar, TopHeader } from '@/components/layout';
import { MetricCards } from '@/components/dashboard/MetricCards';
import { EventCard, EventDetailModal, EventFilter } from '@/components/events';
import { EmptyState } from '@/components/ui';
import styles from './dashboard-view.module.css';

function EventsListSection({
  isLoading,
  events,
  onViewDetail,
  onResetFilter,
}: {
  isLoading: boolean;
  events: UIEventItem[];
  onViewDetail: (e: UIEventItem) => void;
  onResetFilter: () => void;
}) {
  if (isLoading) {
    return (
      <div className={styles.loadingWrapper} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <span>Đang đồng bộ sự kiện camera…</span>
      </div>
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
    filteredEvents,
    counts,
    isLoading,
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

  const [activeNav, setActiveNav] = useState('dashboard');
  const [selectedEventForModal, setSelectedEventForModal] = useState<UIEventItem | null>(null);

  return (
    <div className={styles.layoutWrapper}>
      <Sidebar
        user={user}
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        onLogout={handleLogout}
        unresolvedEventCount={counts.urgent}
        onlineCameraCount={4}
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

          <MetricCards unresolvedCount={counts.urgent > 0 ? 1 : 0} />

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
              events={filteredEvents}
              onViewDetail={setSelectedEventForModal}
              onResetFilter={resetFilters}
            />
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
