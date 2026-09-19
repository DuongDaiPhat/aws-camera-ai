'use client';

import styles from './metric-cards.module.css';

interface MetricCardsProps {
  totalAnalyzed?: number;
  needReviewCount?: number;
  unresolvedCount?: number;
  activeCameraCount?: number;
  totalCameraCount?: number;
  urgentLocationNote?: string;
}

export function MetricCards({
  totalAnalyzed = 8,
  needReviewCount = 2,
  unresolvedCount = 1,
  activeCameraCount = 4,
  totalCameraCount = 4,
  urgentLocationNote = 'Khu vực bếp nấu • Đang chờ bạn xác nhận',
}: MetricCardsProps) {
  return (
    <div className={styles.grid}>
      {/* Card 1: Thiết bị bảo vệ */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>THIẾT BỊ BẢO VỆ</h2>
          <div className={`${styles.iconPill} ${styles.iconPillSuccess}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>
        <div>
          <div className={styles.valueRow}>
            <span className={styles.mainValue}>
              {activeCameraCount}/{totalCameraCount}
            </span>
            <span className={styles.valueSuffix}>camera trực tuyến</span>
          </div>
          <p className={styles.footerSubtext}>
            <span className={`${styles.dot} ${styles.dotGreen}`} aria-hidden="true" />
            <span>Tất cả camera hoạt động bình thường</span>
          </p>
        </div>
      </div>

      {/* Card 2: Ghi nhận 24 giờ qua */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>GHI NHẬN 24 GIỜ QUA</h2>
          <div className={`${styles.iconPill} ${styles.iconPillInfo}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
        </div>
        <div>
          <div className={styles.valueRow}>
            <span className={styles.mainValue}>{totalAnalyzed}</span>
            <span className={styles.valueSuffix}>hoạt động đã phân tích</span>
          </div>
          <p className={styles.footerSubtext}>
            <span className={`${styles.dot} ${styles.dotBlue}`} aria-hidden="true" />
            <span>{needReviewCount} sự kiện cần xem lại</span>
          </p>
        </div>
      </div>

      {/* Card 3: Cần chú ý ngay */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={`${styles.cardTitle} ${styles.cardTitleAlert}`}>CẦN CHÚ Ý NGAY</h2>
          <div className={`${styles.iconPill} ${styles.iconPillDanger}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
        </div>
        <div>
          <div className={styles.valueRow}>
            <span className={`${styles.mainValue} ${styles.mainValueAlert}`}>
              {unresolvedCount}
            </span>
            <span className={styles.valueSuffix}>sự kiện chờ kiểm tra</span>
          </div>
          <p className={styles.footerSubtext}>
            <span className={`${styles.dot} ${styles.dotRed}`} aria-hidden="true" />
            <span>{urgentLocationNote}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
