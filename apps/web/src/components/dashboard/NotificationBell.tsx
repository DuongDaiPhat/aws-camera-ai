'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import type { UIEventItem } from '@/types';
import { Icon } from '@/components/ui/Icon';
import { getEventTypeLabel } from '@/lib/format';
import { notificationState } from '@/lib/notification-state';
import { alertEmphasis, alertEmphasisRank } from '@/lib/fire-alerts';
import criticalStyles from '@/components/events/alert-emphasis.module.css';
import styles from './notification-bell.module.css';

export interface NotificationBellProps {
  events: UIEventItem[];
  now?: number;
  readIds?: ReadonlySet<string>;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onViewDetail: (e: UIEventItem) => void;
  onViewAll: () => void;
  disabled?: boolean;
}

export function isPendingNotification(item: UIEventItem, now = Date.now()) {
  return item.priority !== 'P3' && notificationState(item, now) === 'pending';
}

const EVENT_ICON_MAP: Record<
  UIEventItem['eventType'],
  'face' | 'flame' | 'fall' | 'zone' | 'users' | 'heart'
> = {
  UNKNOWN_PERSON: 'face',
  FIRE_SMOKE_DETECTED: 'flame',
  FALL_DETECTED: 'fall',
  RESTRICTED_ZONE: 'zone',
  PERSON_DETECTED: 'users',
  WELLNESS_TIMEOUT: 'heart',
};

const EVENT_TYPE_LABEL_MAP: Record<UIEventItem['eventType'], string> = {
  UNKNOWN_PERSON: 'Người lạ xuất hiện',
  FIRE_SMOKE_DETECTED: getEventTypeLabel('FIRE_SMOKE_DETECTED'),
  FALL_DETECTED: 'Phát hiện ngã',
  RESTRICTED_ZONE: 'Xâm nhập khu vực cấm',
  PERSON_DETECTED: 'Phát hiện người',
  WELLNESS_TIMEOUT: 'Cảnh báo bất động/chăm sóc',
};

export const NotificationBell: React.FC<NotificationBellProps> = ({
  events,
  now = Date.now(),
  readIds,
  isLoading = false,
  error = null,
  onRetry,
  onViewDetail,
  onViewAll,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const popoverId = useId();

  const pendingCount = useMemo(() => {
    return events.reduce((count, item) => {
      if (isPendingNotification(item, now)) {
        return count + 1;
      }
      return count;
    }, 0);
  }, [events, now]);

  const hasCritical = events.some((item) => alertEmphasis(item, now) === 'urgent');
  const recentEvents = useMemo(() => {
    return [...events]
      .sort(
        (a, b) =>
          alertEmphasisRank(b, now) - alertEmphasisRank(a, now) ||
          Date.parse(b.detectedAt) - Date.parse(a.detectedAt),
      )
      .slice(0, 5);
  }, [events, now]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const popoverWidth = Math.min(320, window.innerWidth - 24);

    let left = rect.right - popoverWidth;
    if (left < 12) left = 12;
    if (left + popoverWidth > window.innerWidth - 12) {
      left = window.innerWidth - popoverWidth - 12;
    }

    let top = rect.bottom + margin;
    const estimatedHeight = 360;
    if (
      top + estimatedHeight > window.innerHeight - 12 &&
      rect.top - estimatedHeight - margin > 12
    ) {
      top = rect.top - estimatedHeight - margin;
    }

    top = Math.max(
      12,
      Math.min(top, window.innerHeight - Math.min(360, window.innerHeight - 24) - 12),
    );
    setCoords({ top, left });
  }, []);

  const closePopover = useCallback((shouldRestoreFocus = false) => {
    setIsOpen(false);
    if (shouldRestoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (disabled && isOpen) {
      closePopover(false);
    }
  }, [disabled, isOpen, closePopover]);

  useEffect(() => {
    if (!isOpen) return;

    popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    updatePosition();
    const handleScrollOrResize = () => updatePosition();

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        closePopover(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePopover(true);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closePopover]);

  const handleToggle = () => {
    if (disabled) return;
    if (isOpen) {
      closePopover(true);
    } else {
      updatePosition();
      setIsOpen(true);
    }
  };

  const handleItemClick = (eventItem: UIEventItem) => {
    setIsOpen(false);
    onViewDetail(eventItem);
  };

  const handleViewAllClick = () => {
    setIsOpen(false);
    onViewAll();
  };

  return (
    <div className={styles.wrapper}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerActive : ''}`}
        onClick={handleToggle}
        disabled={disabled}
        aria-label="Thông báo mới nhất"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={isOpen ? popoverId : undefined}
      >
        <Icon name="bell" className={styles.bellIcon} />
        {pendingCount > 0 && (
          <span
            className={styles.badge}
            data-critical={hasCritical || undefined}
            aria-hidden="true"
          >
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
      </button>

      {isOpen &&
        !disabled &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={popoverId}
            ref={popoverRef}
            role="dialog"
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !triggerRef.current?.contains(event.relatedTarget)
              )
                closePopover(false);
            }}
            aria-modal="false"
            aria-label="Thông báo mới nhất"
            className={styles.popover}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              maxHeight: `calc(100dvh - ${coords.top + 12}px)`,
            }}
          >
            <div className={styles.header}>
              <div className={styles.titleContainer}>
                <span className={styles.title}>Thông báo mới nhất</span>
                {pendingCount > 0 && (
                  <span className={styles.headerCountBadge}>
                    {pendingCount > 99 ? '99+' : pendingCount} cần xử lý
                  </span>
                )}
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => closePopover(true)}
                aria-label="Đóng thông báo"
              >
                <Icon name="close" className={styles.closeIcon} />
              </button>
            </div>

            <div className={styles.body}>
              {isLoading ? (
                <div className={styles.stateContainer}>
                  <div className={styles.spinner} role="status" aria-label="Đang tải..." />
                  <p className={styles.stateText}>Đang tải thông báo...</p>
                </div>
              ) : error ? (
                <div className={styles.stateContainer} role="alert">
                  <p className={styles.errorText}>{error}</p>
                  {onRetry && (
                    <button type="button" className={styles.retryButton} onClick={onRetry}>
                      Thử lại
                    </button>
                  )}
                </div>
              ) : recentEvents.length === 0 ? (
                <div className={styles.stateContainer}>
                  <Icon name="bell" className={styles.emptyIcon} />
                  <p className={styles.emptyText}>Không có thông báo mới</p>
                </div>
              ) : (
                <ul className={styles.eventList}>
                  {recentEvents.map((item) => {
                    const iconName = EVENT_ICON_MAP[item.eventType] || 'bell';
                    const typeLabel = EVENT_TYPE_LABEL_MAP[item.eventType] || item.eventType;
                    const emphasis = alertEmphasis(item, now);
                    const status = notificationState(item, now);
                    const unread = !readIds?.has(item.id);

                    return (
                      <li key={item.id} className={styles.eventItem}>
                        <button
                          type="button"
                          className={`${styles.eventButton} ${criticalStyles.emphasis}`}
                          data-alert={emphasis}
                          data-unread={unread || undefined}
                          onClick={() => handleItemClick(item)}
                        >
                          <div className={styles.iconAvatar}>
                            <Icon name={iconName} className={styles.itemIcon} />
                          </div>
                          <div className={styles.itemContent}>
                            <div className={styles.itemHeader}>
                              <span className={styles.itemTitle} title={typeLabel}>
                                {typeLabel}
                              </span>
                              <span
                                className={`${styles.priorityTag} ${emphasis ? styles[`priority_${item.priority}`] : ''}`}
                              >
                                {item.priority}
                              </span>
                            </div>
                            <div className={styles.itemMeta}>
                              {item.camera?.name && (
                                <span className={styles.cameraName}>{item.camera.name}</span>
                              )}
                              <span className={styles.timeText}>{item.relativeTimeText}</span>
                              {status === 'done' ? (
                                <span>Đã xử lý</span>
                              ) : (
                                item.status === 'ESCALATED' && <span>Đã chuyển cấp</span>
                              )}
                            </div>
                            {emphasis && (
                              <span className={criticalStyles.urgencyTag}>
                                {emphasis === 'urgent' ? 'Khẩn cấp' : 'Ưu tiên'}
                              </span>
                            )}
                          </div>
                          {unread && <span className={criticalStyles.unreadLabel}>Chưa đọc</span>}
                          {item.thumbnailUrl && (
                            <img
                              src={item.thumbnailUrl}
                              alt="Ảnh sự kiện"
                              className={styles.thumbnail}
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
                              }}
                              loading="lazy"
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className={styles.footer}>
              <button type="button" className={styles.viewAllButton} onClick={handleViewAllClick}>
                <span>Xem tất cả</span>
                <Icon name="chevron" className={styles.chevronIcon} />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
