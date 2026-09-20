'use client';

import styles from './pagination.module.css';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

function generatePageNumbers(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (currentPage <= 3) {
    return [1, 2, 3, 4, 5];
  }
  if (currentPage >= totalPages - 2) {
    return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2];
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [5, 10, 20],
}: PaginationProps) {
  if (totalItems === 0) return null;

  const startIdx = (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, totalItems);
  const pages = generatePageNumbers(currentPage, totalPages);

  return (
    <div className={styles.paginationContainer} role="navigation" aria-label="Phân trang sự kiện">
      <div className={styles.infoText}>
        Hiển thị <span className={styles.boldNumber}>{startIdx}</span> -{' '}
        <span className={styles.boldNumber}>{endIdx}</span> trong{' '}
        <span className={styles.boldNumber}>{totalItems}</span> sự kiện
      </div>

      <div className={styles.controlsGroup}>
        {onPageSizeChange && (
          <div className={styles.pageSizeSelector}>
            <span className={styles.pageSizeLabel}>Số lượng:</span>
            {pageSizeOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`${styles.sizeButton} ${pageSize === opt ? styles.sizeButtonActive : ''}`}
                onClick={() => onPageSizeChange(opt)}
                aria-label={`Hiển thị ${opt} sự kiện mỗi trang`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        <div className={styles.navButtons}>
          <button
            type="button"
            className={styles.prevNextButton}
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Trang trước"
          >
            &larr; Trước
          </button>

          <div className={styles.pageNumbers}>
            {pages.map((p) => (
              <button
                key={p}
                type="button"
                className={`${styles.pageButton} ${p === currentPage ? styles.pageButtonActive : ''}`}
                onClick={() => onPageChange(p)}
                aria-current={p === currentPage ? 'page' : undefined}
              >
                {p}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={styles.prevNextButton}
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Trang sau"
          >
            Tiếp &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
