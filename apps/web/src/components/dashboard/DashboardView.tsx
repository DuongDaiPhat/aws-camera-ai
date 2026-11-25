'use client';

import { useEffect, useState } from 'react';
import { CameraSignalsProvider } from '@/components/cameras/live/CameraSignals';
import { PlaybackView } from '@/components/playback/PlaybackView';
import { NotificationBell, isPendingNotification } from './NotificationBell';
import { DashboardOverview } from './DashboardOverview';
import { triggerSosHelp } from '@/lib/events-client';
import { FamilyView } from '@/components/household/FamilyView';
import { useAccountPreferences, useNewAlertSound } from '@/hooks/useAccountPreferences';
import { useLoginEntrance } from '@/hooks/useLoginEntrance';
import { useFireAttention } from '@/hooks/useFireAttention';
import { useNotificationClock } from '@/hooks/useNotificationClock';
import { useNotificationReadState } from '@/hooks/useNotificationReadState';
import { FireAttention } from '@/components/events/FireAttention';
import { NotificationInbox } from '@/components/events/NotificationInbox';
import { fireReviewKey } from '@/lib/fire-alerts';
import { KnownFacesView } from '@/components/known-faces/KnownFacesView';
import type { UIEventItem } from '@/types';
import { useAuth, useEvents, useEventStats } from '@/hooks';
import { Sidebar, TopHeader } from '@/components/layout';
import { MetricCards } from '@/components/dashboard/MetricCards';
import { EventCard, EventDetailModal, EventFilter } from '@/components/events';
import { CameraView } from '@/components/cameras';
import { EmptyState, ErrorState, Pagination } from '@/components/ui';
import {
  AdminAccountsView,
  AdminAuditLogsView,
  AdminOverviewView,
  AdminResourcesView,
  AdminServicesView,
  AdminSettingsView,
  AdminStatusStrip,
} from '@/components/admin';
import { SettingsView } from '@/components/settings';
import { ZonesView } from '@/components/zones';
import { WellnessView } from '@/components/wellness/WellnessView';
import styles from './dashboard-view.module.css';
import adminStyles from '@/components/admin/admin.module.css';

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Tổng quan',
  playback: 'Xem lại thời gian',
  cameras: 'Camera trực tiếp',
  events: 'Thông báo',
  'known-faces': 'Người quen',
  zones: 'Khu vực giám sát',
  wellness: 'Kiểm tra sức khỏe',
  settings: 'Cài đặt cảnh báo',
  users: 'Quản lý tài khoản',
  family: 'Thành viên gia đình',
};

const VIEWER_PAGE_TITLES: Record<string, string> = {
  dashboard: 'Trang của tôi',
  cameras: 'Camera trực tiếp',
  playback: 'Xem lại',
  events: 'Thông báo của tôi',
  settings: 'Cài đặt cá nhân',
};

const ADMIN_PAGE_TITLES: Record<string, string> = {
  dashboard: 'Tổng quan hệ thống',
  'admin-accounts': 'Tài khoản & Hộ gia đình',
  'admin-services': 'Tình trạng dịch vụ',
  'admin-resources': 'Tài nguyên & Hạn mức',
  'admin-audit': 'Nhật ký quản trị',
  'admin-settings': 'Cài đặt hệ thống',
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
              Danh sách thông báo
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
  readOnly = false,
  canManageEvents = true,
  onAction,
}: {
  event: UIEventItem | null;
  actions: ReturnType<typeof useEvents>;
  onClose: () => void;
  readOnly?: boolean;
  canManageEvents?: boolean;
  onAction: () => void;
}) {
  const after =
    (action: (id: string, note?: string) => Promise<void>) => async (id: string, note?: string) => {
      await action(id, note);
      onAction();
      onClose();
    };
  return (
    <EventDetailModal
      event={event}
      onClose={onClose}
      readOnly={readOnly}
      canCloseEmergency={canManageEvents}
      onConfirmOk={after(actions.confirmOk)}
      onConfirmHelp={after(actions.confirmHelp)}
      onCloseEmergency={canManageEvents ? after(actions.closeEmergency) : undefined}
      onToggleFalseAlarm={
        canManageEvents
          ? (id) => {
              actions.toggleFalseAlarm(id);
              onClose();
            }
          : undefined
      }
    />
  );
}

function HistoryContent({
  userId,
  overview,
  isAdmin,
  blocked,
  state,
  metrics,
  onNavigate,
  onViewDetail,
  onReady,
}: {
  userId?: string;
  onReady: () => void;
  overview: boolean;
  isAdmin: boolean;
  blocked: boolean;
  state: ReturnType<typeof useEvents>;
  metrics: ReturnType<typeof useEventStats>;
  onNavigate: (page: string) => void;
  onViewDetail: (event: UIEventItem) => void;
}) {
  if (!overview)
    return <EventHistory state={state} metrics={metrics} onViewDetail={onViewDetail} />;
  return (
    <DashboardOverview
      userId={userId}
      onReady={onReady}
      isAdmin={isAdmin}
      blocked={blocked}
      onNavigate={onNavigate}
    />
  );
}

export function DashboardView() {
  const { user, handleLogout } = useAuth();
  const isViewer = user?.role === 'VIEWER';
  const canManageHousehold = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';
  const eventState = useEvents();
  const { events, liveNoticeText, confirmOk, confirmHelp, closeEmergency } = eventState;
  const preferences = useAccountPreferences(user?.id);
  useNewAlertSound(events, preferences.soundAlerts, user?.id);
  const attention = useFireAttention(events, user?.id);
  const notificationNow = useNotificationClock(events);
  const { read, markRead } = useNotificationReadState(user?.id);
  const notificationCount =
    eventState.isLoading || eventState.error
      ? null
      : events.filter((event) => isPendingNotification(event, notificationNow)).length;

  // Telegram confirmations update an existing event without changing the list length.
  const statsRefreshToken = events.map((event) => `${event.id}:${event.status}`).join('|');
  const metrics = useEventStats(statsRefreshToken);

  const [activeNav, setActiveNav] = useState('dashboard');
  const [eventActionVersion, setEventActionVersion] = useState(0);
  const showInbox = user?.role === 'CAREGIVER' && activeNav === 'events';
  const [calendarDate, setCalendarDate] = useState<Date | null>(null);
  const entrance = useLoginEntrance(user?.id);
  const navigate = (page: string) => {
    entrance.finish();
    setActiveNav(page);
  };
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [selectedEventForModal, setSelectedEventForModal] = useState<UIEventItem | null>(null);
  const [sosBusy, setSosBusy] = useState(false);
  const [sosNotice, setSosNotice] = useState<{ text: string; isError?: boolean } | null>(null);

  const handleHeaderSos = async () => {
    setSosBusy(true);
    setSosNotice(null);
    try {
      await triggerSosHelp();
      setSosNotice({ text: 'Đã gửi yêu cầu trợ giúp khẩn cấp tới người chăm sóc trong hộ.' });
    } catch (err) {
      setSosNotice({
        text: err instanceof Error ? err.message : 'Không thể gửi yêu cầu trợ giúp.',
        isError: true,
      });
    } finally {
      setSosBusy(false);
    }
  };

  const openEventDetails = (event: UIEventItem) => {
    markRead(event.id);
    setSelectedEventForModal(event);
  };
  const attentionId = attention.event?.id;
  useEffect(() => {
    if (attentionId) {
      setSelectedEventForModal(null);
      entrance.finish();
    }
  }, [attentionId, entrance.finish]);
  const selectedEvent = selectedEventForModal
    ? (events.find((event) => event.id === selectedEventForModal.id) ?? selectedEventForModal)
    : null;

  if (user?.role === 'ADMIN') {
    const adminTitle = ADMIN_PAGE_TITLES[activeNav] ?? ADMIN_PAGE_TITLES.dashboard;
    return (
      <div
        className={styles.layoutWrapper}
        data-admin="true"
        data-sidebar-expanded={sidebarExpanded}
        data-page={activeNav}
        data-login-entry={entrance.phase}
      >
        <Sidebar
          expanded={sidebarExpanded}
          onToggle={() => setSidebarExpanded((value) => !value)}
          user={user}
          activeNav={activeNav}
          onSelectNav={(nav) => {
            navigate(nav);
            if (window.matchMedia('(max-width: 700px)').matches) setSidebarExpanded(false);
          }}
          onLogout={handleLogout}
        />

        {sidebarExpanded && (
          <button
            className={styles.sidebarBackdrop}
            aria-label="Đóng menu"
            onClick={() => setSidebarExpanded(false)}
          />
        )}

        <div className={styles.mainContent}>
          <header className={adminStyles.adminTopBar}>
            <div className={adminStyles.adminTopBarMeta}>
              <span className={adminStyles.adminRoleTag}>System Admin Console</span>
              <h1 className={adminStyles.adminTopBarTitle}>{adminTitle}</h1>
              <p className={adminStyles.adminTopBarSub}>
                Khu vực vận hành &amp; quản trị hạ tầng Argus AI — tách biệt khỏi dữ liệu hộ gia
                đình.
              </p>
            </div>
            <div className={adminStyles.adminTopBarUser}>
              <span>{user.fullName || 'Quản trị viên'}</span>
              <span className={adminStyles.badgeOk}>ADMIN</span>
            </div>
          </header>

          <AdminStatusStrip />

          <main key={activeNav} className={styles.workspace}>
            {activeNav === 'admin-accounts' ? (
              <AdminAccountsView currentUserId={user.id} />
            ) : activeNav === 'admin-services' ? (
              <AdminServicesView />
            ) : activeNav === 'admin-resources' ? (
              <AdminResourcesView />
            ) : activeNav === 'admin-audit' ? (
              <AdminAuditLogsView />
            ) : activeNav === 'admin-settings' ? (
              <AdminSettingsView />
            ) : (
              <AdminOverviewView onNavigate={navigate} />
            )}
          </main>
        </div>
      </div>
    );
  }

  return (
    <CameraSignalsProvider events={events}>
      <div
        className={styles.layoutWrapper}
        data-sidebar-expanded={sidebarExpanded}
        data-page={isViewer && activeNav === 'dashboard' ? 'cameras' : activeNav}
        data-login-entry={entrance.phase}
        ref={(node) => {
          if (node) node.inert = Boolean(attention.event);
        }}
        aria-hidden={attention.event ? true : undefined}
      >
        <Sidebar
          expanded={sidebarExpanded}
          onToggle={() => setSidebarExpanded((value) => !value)}
          user={user}
          activeNav={activeNav}
          onSelectNav={(nav) => {
            navigate(nav);
            if (window.matchMedia('(max-width: 700px)').matches) setSidebarExpanded(false);
          }}
          onLogout={handleLogout}
          unresolvedEventCount={notificationCount ?? undefined}
          onlineCameraCount={metrics.stats?.cameraOnlineCount}
        />

        {sidebarExpanded && (
          <button
            className={styles.sidebarBackdrop}
            aria-label="Đóng menu"
            onClick={() => setSidebarExpanded(false)}
          />
        )}
        <div className={styles.mainContent}>
          {!showInbox && (
            <TopHeader
              selectedDate={calendarDate}
              onSelectDate={setCalendarDate}
              onViewPlayback={activeNav === 'playback' ? undefined : () => navigate('playback')}
              isDashboard={activeNav === 'dashboard'}
              compact={activeNav === 'playback' || activeNav === 'known-faces'}
              userName={user?.fullName || 'bạn'}
              pendingCount={notificationCount}
              pageTitle={
                isViewer
                  ? (VIEWER_PAGE_TITLES[activeNav] ?? VIEWER_PAGE_TITLES.dashboard)
                  : user?.role === 'CAREGIVER' && activeNav === 'wellness'
                    ? 'Kiểm tra an toàn'
                    : (PAGE_TITLES[activeNav] ?? PAGE_TITLES.dashboard)
              }
              onViewEvents={() => navigate('events')}
              leadingAction={
                isViewer ? (
                  <button
                    type="button"
                    className={styles.headerSosButton}
                    disabled={sosBusy || Boolean(attention.event)}
                    onClick={() => void handleHeaderSos()}
                  >
                    {sosBusy ? 'Đang gửi…' : 'Yêu cầu trợ giúp'}
                  </button>
                ) : undefined
              }
              notificationControl={
                <NotificationBell
                  now={notificationNow}
                  readIds={read}
                  events={events}
                  isLoading={eventState.isLoading}
                  error={eventState.error}
                  onRetry={eventState.reload}
                  onViewDetail={openEventDetails}
                  onViewAll={() => navigate('events')}
                  disabled={Boolean(attention.event)}
                />
              }
            />
          )}

          <main key={activeNav} className={styles.workspace}>
            {sosNotice && (
              <p
                className={`${styles.sosBanner} ${sosNotice.isError ? styles.sosBannerError : ''}`}
                role={sosNotice.isError ? 'alert' : 'status'}
              >
                {sosNotice.text}
              </p>
            )}
            {activeNav === 'playback' ? (
              <PlaybackView selectedDate={calendarDate} userId={user?.id} />
            ) : activeNav === 'cameras' ? (
              <CameraView user={user} />
            ) : activeNav === 'settings' ? (
              <SettingsView user={user} />
            ) : !isViewer && activeNav === 'wellness' ? (
              <WellnessView user={user} onOpenSettings={() => navigate('settings')} />
            ) : user?.role === 'CAREGIVER' && activeNav === 'family' ? (
              <FamilyView />
            ) : !isViewer && activeNav === 'known-faces' ? (
              <KnownFacesView
                isAdmin={canManageHousehold}
                canConfigureAi={user?.role === 'CAREGIVER'}
                onOpenSettings={() => navigate('settings')}
              />
            ) : !isViewer && activeNav === 'zones' ? (
              <ZonesView user={user} onOpenSettings={() => navigate('settings')} />
            ) : isViewer && activeNav !== 'events' ? (
              <CameraView user={user} />
            ) : (
              <>
                {!showInbox &&
                  preferences.inAppAlerts &&
                  activeNav !== 'dashboard' &&
                  liveNoticeText && (
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

                {showInbox ? (
                  <NotificationInbox
                    readIds={read}
                    recentEvents={events}
                    actionVersion={eventActionVersion}
                    onViewDetail={openEventDetails}
                  />
                ) : (
                  <HistoryContent
                    userId={user?.id}
                    isAdmin={canManageHousehold}
                    blocked={Boolean(attention.event)}
                    overview={!isViewer && activeNav === 'dashboard'}
                    state={eventState}
                    metrics={metrics}
                    onNavigate={navigate}
                    onReady={entrance.onReady}
                    onViewDetail={openEventDetails}
                  />
                )}
              </>
            )}
          </main>
        </div>

        <DashboardEventDetails
          event={attention.event ? null : selectedEvent}
          actions={eventState}
          onClose={() => setSelectedEventForModal(null)}
          canManageEvents={!isViewer}
          onAction={() => setEventActionVersion((version) => version + 1)}
        />
      </div>
      {attention.event && (
        <FireAttention
          key={fireReviewKey(attention.event)}
          event={attention.event}
          onInspect={markRead}
          canCloseEmergency={!isViewer}
          onReviewed={() => {
            if (attention.event) attention.review(attention.event.id);
          }}
          onConfirmOk={confirmOk}
          onConfirmHelp={confirmHelp}
          onCloseEmergency={closeEmergency}
        />
      )}
    </CameraSignalsProvider>
  );
}
