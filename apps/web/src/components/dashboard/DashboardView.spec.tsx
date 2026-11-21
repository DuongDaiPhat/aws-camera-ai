// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardView } from './DashboardView';
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  events: vi.fn(),
  attention: vi.fn(),
  prefs: vi.fn(),
  sos: vi.fn(),
  finish: vi.fn(),
  markRead: vi.fn(),
  action: vi.fn(),
  review: vi.fn(),
}));
vi.mock('@/hooks', () => ({
  useAuth: m.auth,
  useEvents: m.events,
  useEventStats: () => ({ stats: { cameraOnlineCount: 2 }, isLoading: false, error: null }),
}));
vi.mock('@/hooks/useAccountPreferences', () => ({
  useAccountPreferences: m.prefs,
  useNewAlertSound: vi.fn(),
}));
vi.mock('@/hooks/useLoginEntrance', () => ({
  useLoginEntrance: () => ({ phase: 'ready', finish: m.finish, onReady: vi.fn() }),
}));
vi.mock('@/hooks/useFireAttention', () => ({ useFireAttention: m.attention }));
vi.mock('@/hooks/useNotificationClock', () => ({ useNotificationClock: () => Date.now() }));
vi.mock('@/hooks/useNotificationReadState', () => ({
  useNotificationReadState: () => ({ read: new Set(), markRead: m.markRead }),
}));
vi.mock('@/lib/events-client', () => ({ triggerSosHelp: m.sos }));
vi.mock('@/components/cameras/live/CameraSignals', () => ({
  CameraSignalsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout', () => ({
  Sidebar: ({
    onSelectNav,
    onToggle,
    onLogout,
  }: {
    onSelectNav: (nav: string) => void;
    onToggle: () => void;
    onLogout: () => void;
  }) => (
    <nav>
      <button onClick={onToggle}>Toggle menu</button>
      <button onClick={onLogout}>Logout</button>
      {[
        'dashboard',
        'playback',
        'cameras',
        'events',
        'settings',
        'wellness',
        'family',
        'known-faces',
        'zones',
        'admin-accounts',
        'admin-services',
        'admin-resources',
        'admin-audit',
        'admin-settings',
        'unknown',
      ].map((nav) => (
        <button key={nav} onClick={() => onSelectNav(nav)}>
          {nav}
        </button>
      ))}
    </nav>
  ),
  TopHeader: ({
    pageTitle,
    leadingAction,
    notificationControl,
    onViewEvents,
    onViewPlayback,
    onSelectDate,
  }: {
    pageTitle: string;
    leadingAction: React.ReactNode;
    notificationControl: React.ReactNode;
    onViewEvents: () => void;
    onViewPlayback?: () => void;
    onSelectDate: (date: Date) => void;
  }) => (
    <header>
      <h1>{pageTitle}</h1>
      {leadingAction}
      {notificationControl}
      <button onClick={onViewEvents}>Header events</button>
      <button onClick={onViewPlayback}>Header playback</button>
      <button onClick={() => onSelectDate(new Date('2026-01-01'))}>Calendar</button>
    </header>
  ),
}));
vi.mock('./NotificationBell', () => ({
  isPendingNotification: (event: { status: string }) => event.status === 'NOTIFIED',
  NotificationBell: ({
    events,
    onViewDetail,
    onViewAll,
    onRetry,
  }: {
    events: unknown[];
    onViewDetail: (e: unknown) => void;
    onViewAll: () => void;
    onRetry: () => void;
  }) => (
    <div>
      <button onClick={() => onViewDetail(events[0])}>Bell detail</button>
      <button onClick={onViewAll}>Bell all</button>
      <button onClick={onRetry}>Bell retry</button>
    </div>
  ),
}));
vi.mock('./DashboardOverview', () => ({
  DashboardOverview: ({
    onNavigate,
    onReady,
  }: {
    onNavigate: (s: string) => void;
    onReady: () => void;
  }) => (
    <div>
      Dashboard overview<button onClick={() => onNavigate('events')}>Overview events</button>
      <button onClick={onReady}>Ready</button>
    </div>
  ),
}));
vi.mock('./MetricCards', () => ({ MetricCards: () => <div>Metrics</div> }));
vi.mock('@/components/playback/PlaybackView', () => ({
  PlaybackView: () => <div>Playback content</div>,
}));
vi.mock('@/components/household/FamilyView', () => ({
  FamilyView: () => <div>Family content</div>,
}));
vi.mock('@/components/known-faces/KnownFacesView', () => ({
  KnownFacesView: () => <div>Known faces content</div>,
}));
vi.mock('@/components/cameras', () => ({ CameraView: () => <div>Camera content</div> }));
vi.mock('@/components/settings', () => ({ SettingsView: () => <div>Settings content</div> }));
vi.mock('@/components/zones', () => ({ ZonesView: () => <div>Zones content</div> }));
vi.mock('@/components/wellness/WellnessView', () => ({
  WellnessView: () => <div>Wellness content</div>,
}));
vi.mock('@/components/admin', () =>
  Object.fromEntries(
    [
      'AdminAccountsView',
      'AdminAuditLogsView',
      'AdminOverviewView',
      'AdminResourcesView',
      'AdminServicesView',
      'AdminSettingsView',
      'AdminStatusStrip',
    ].map((name) => [name, () => <div>{name}</div>]),
  ),
);
vi.mock('@/components/events/FireAttention', () => ({
  FireAttention: ({
    onReviewed,
    onInspect,
    event,
  }: {
    onReviewed: () => void;
    onInspect: (id: string) => void;
    event: { id: string };
  }) => (
    <div>
      Fire attention<button onClick={onReviewed}>Reviewed</button>
      <button onClick={() => onInspect(event.id)}>Inspect</button>
    </div>
  ),
}));
vi.mock('@/components/events/NotificationInbox', () => ({
  NotificationInbox: ({
    recentEvents,
    onViewDetail,
  }: {
    recentEvents: unknown[];
    onViewDetail: (e: unknown) => void;
  }) => (
    <div>
      Notification inbox<button onClick={() => onViewDetail(recentEvents[0])}>Inbox detail</button>
    </div>
  ),
}));
vi.mock('@/components/events', () => ({
  EventFilter: ({ onSelectTab }: { onSelectTab: (s: string) => void }) => (
    <button onClick={() => onSelectTab('all')}>Filter all</button>
  ),
  EventCard: ({
    event,
    onViewDetail,
  }: {
    event: { id: string };
    onViewDetail: (event: unknown) => void;
  }) => <button onClick={() => onViewDetail(event)}>Event {event.id}</button>,
  EventDetailModal: ({
    event,
    onClose,
    onConfirmOk,
    onConfirmHelp,
    onCloseEmergency,
    onToggleFalseAlarm,
  }: {
    event: { id: string } | null;
    onClose: () => void;
    onConfirmOk: (id: string) => Promise<void>;
    onConfirmHelp: (id: string) => Promise<void>;
    onCloseEmergency?: (id: string) => Promise<void>;
    onToggleFalseAlarm?: (id: string) => void;
  }) =>
    event ? (
      <div role="dialog">
        <button onClick={onClose}>Close detail</button>
        <button onClick={() => void onConfirmOk(event.id)}>Confirm ok</button>
        <button onClick={() => void onConfirmHelp(event.id)}>Confirm help</button>
        {onCloseEmergency && (
          <button onClick={() => void onCloseEmergency(event.id)}>Close emergency</button>
        )}
        {onToggleFalseAlarm && (
          <button onClick={() => onToggleFalseAlarm(event.id)}>False alarm</button>
        )}
      </div>
    ) : null,
}));
vi.mock('@/components/ui', () => ({
  EmptyState: ({ onResetFilter }: { onResetFilter: () => void }) => (
    <button onClick={onResetFilter}>Empty reset</button>
  ),
  ErrorState: ({ message, onRetry }: { message: string; onRetry: () => void }) => (
    <div>
      {message}
      <button onClick={onRetry}>Error retry</button>
    </div>
  ),
  Pagination: ({
    onPageChange,
    onPageSizeChange,
  }: {
    onPageChange: (n: number) => void;
    onPageSizeChange: (n: number) => void;
  }) => (
    <div>
      <button onClick={() => onPageChange(2)}>Next page</button>
      <button onClick={() => onPageSizeChange(20)}>Page size</button>
    </div>
  ),
}));
let host: HTMLDivElement, root: Root;
const event = {
  id: 'e1',
  status: 'NOTIFIED',
  priority: 'P0',
  eventType: 'FIRE_SMOKE_DETECTED',
  detectedAt: '2026-01-01',
};
let role = 'CAREGIVER',
  state: Record<string, unknown>;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.clearAllMocks();
  role = 'CAREGIVER';
  m.auth.mockImplementation(() => ({
    user: { id: 'u1', role, fullName: 'User' },
    handleLogout: m.action,
  }));
  state = {
    events: [event],
    liveNoticeText: 'New event',
    paginatedEvents: [event],
    filteredEvents: [event],
    isLoading: false,
    error: null,
    counts: {},
    activeFilterTab: 'all',
    setActiveFilterTab: m.action,
    resetFilters: m.action,
    reload: m.action,
    currentPage: 1,
    totalPages: 2,
    totalFilteredItems: 6,
    pageSize: 5,
    setCurrentPage: m.action,
    setPageSize: m.action,
    confirmOk: m.action,
    confirmHelp: m.action,
    closeEmergency: m.action,
    toggleFalseAlarm: m.action,
  };
  m.events.mockImplementation(() => state);
  m.attention.mockReturnValue({ event: null, error: null, retry: m.action, review: m.review });
  m.prefs.mockReturnValue({ inAppAlerts: true, soundAlerts: true });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<DashboardView />));
}
async function click(text: string) {
  const b = [...host.querySelectorAll('button')].find(
    (n) => n.textContent?.trim() === text || n.getAttribute('aria-label') === text,
  );
  if (!b) throw Error(`Missing ${text}: ${host.textContent}`);
  await act(async () => b.click());
}
it('routes caregiver navigation and keeps notifications distinct from overview', async () => {
  await render();
  expect(host.textContent).toContain('Dashboard overview');
  for (const [nav, text] of [
    ['playback', 'Playback content'],
    ['cameras', 'Camera content'],
    ['settings', 'Settings content'],
    ['wellness', 'Wellness content'],
    ['family', 'Family content'],
    ['known-faces', 'Known faces content'],
    ['zones', 'Zones content'],
    ['events', 'Notification inbox'],
  ] as const) {
    await click(nav);
    expect(host.textContent).toContain(text);
  }
  await click('Toggle menu');
  expect(host.querySelector('[data-sidebar-expanded="true"]')).not.toBeNull();
  await click('Đóng menu');
  expect(host.querySelector('[data-sidebar-expanded="true"]')).toBeNull();
});
it('routes every admin console section and closes the menu on mobile', async () => {
  role = 'ADMIN';
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  await render();
  expect(host.textContent).toContain('AdminOverviewView');
  await click('Toggle menu');
  await click('admin-accounts');
  expect(host.querySelector('[data-sidebar-expanded="true"]')).toBeNull();
  for (const [nav, name] of [
    ['admin-services', 'AdminServicesView'],
    ['admin-resources', 'AdminResourcesView'],
    ['admin-audit', 'AdminAuditLogsView'],
    ['admin-settings', 'AdminSettingsView'],
    ['unknown', 'AdminOverviewView'],
  ] as const) {
    await click(nav);
    expect(host.textContent).toContain(name);
  }
  await click('Toggle menu');
  await click('Đóng menu');
  await click('Logout');
  expect(m.action).toHaveBeenCalled();
});
it('defaults viewers to cameras and sends SOS requests including errors', async () => {
  role = 'VIEWER';
  await render();
  expect(host.textContent).toContain('Camera content');
  await click('Yêu cầu trợ giúp');
  expect(m.sos).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('Đã gửi yêu cầu');
  m.sos.mockRejectedValueOnce(new Error('SOS unavailable'));
  await click('Yêu cầu trợ giúp');
  expect(host.textContent).toContain('SOS unavailable');
  m.sos.mockRejectedValueOnce('bad');
  await click('Yêu cầu trợ giúp');
  expect(host.textContent).toContain('Không thể gửi yêu cầu');
  await click('Calendar');
  await click('Header playback');
  expect(host.textContent).toContain('Playback content');
});
it('allows viewer event confirmation but hides household management actions', async () => {
  role = 'VIEWER';
  await render();
  await click('Header events');
  expect(host.textContent).toContain('New event');
  await click('Event e1');
  expect(m.markRead).toHaveBeenCalledWith('e1');
  expect(host.textContent).not.toContain('Close emergency');
  await click('Confirm ok');
  expect(m.action).toHaveBeenCalledWith('e1', undefined);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click('Bell detail');
  await click('Confirm help');
  await click('Bell detail');
  await click('Close detail');
  await click('Next page');
  await click('Page size');
  await click('Filter all');
});
it('connects caregiver inbox event actions and false alarm changes', async () => {
  await render();
  await click('events');
  await click('Inbox detail');
  await click('Close emergency');
  expect(m.action).toHaveBeenCalledWith('e1', undefined);
  await click('Inbox detail');
  await click('False alarm');
  expect(m.action).toHaveBeenCalledWith('e1');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it('shows loading, error and empty event histories', async () => {
  role = 'VIEWER';
  state.isLoading = true;
  await render();
  await click('events');
  expect(host.textContent).toContain('Đang đồng bộ');
  state.isLoading = false;
  state.error = 'offline';
  await render();
  expect(host.textContent).toContain('offline');
  await click('Error retry');
  state.error = null;
  state.paginatedEvents = [];
  state.filteredEvents = [];
  await render();
  await click('Empty reset');
  expect(m.action).toHaveBeenCalled();
});
it('interrupts detail with fire attention and supports retry and review', async () => {
  await render();
  await click('Bell detail');
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  m.attention.mockReturnValue({ event, error: null, retry: m.action, review: m.review });
  await render();
  expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click('Reviewed');
  expect(m.review).toHaveBeenCalledWith('e1');
  await click('Inspect');
  expect(m.markRead).toHaveBeenCalledWith('e1');
  m.attention.mockReturnValue({
    event: null,
    error: 'Attention offline',
    retry: m.action,
    review: m.review,
  });
  await render();
  expect(host.textContent).toContain('Attention offline');
  await click('Thử lại');
});
it('renders a session without a user and suppresses disabled in-app notices', async () => {
  m.auth.mockReturnValue({ user: null, handleLogout: m.action });
  m.prefs.mockReturnValue({ inAppAlerts: false, soundAlerts: false });
  await render();
  expect(host.textContent).toContain('Dashboard overview');
  await click('unknown');
  expect(host.textContent).not.toContain('New event');
  await click('Bell all');
  await click('Bell retry');
});
