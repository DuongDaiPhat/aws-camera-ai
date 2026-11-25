'use client';

import type { ZoneDraft } from './zone-editor.types';
import styles from './zones.module.css';

export function ZoneForm({
  draft,
  isSaving,
  polygonError,
  onChange,
  onSave,
  onDelete,
}: {
  draft: ZoneDraft;
  isSaving: boolean;
  polygonError: string | null;
  onChange: (patch: Partial<ZoneDraft>) => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const isAllDay = draft.activeFrom === null && draft.activeTo === null;
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label>
        Tên vùng
        <input
          value={draft.name}
          maxLength={60}
          required
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <label>
        Slug kỹ thuật
        <input
          value={draft.slug}
          readOnly={draft.id !== null}
          required
          pattern="[a-z][a-z0-9_]{2,63}"
          onChange={(e) => onChange({ slug: e.target.value })}
        />
      </label>
      <label>
        Loại vùng
        <select
          value={draft.zoneType}
          onChange={(e) => onChange({ zoneType: e.target.value as ZoneDraft['zoneType'] })}
        >
          <option value="RESTRICTED">Vùng cấm</option>
          <option value="REST_AREA">Khu nghỉ</option>
          <option value="NORMAL">Vùng thường</option>
        </select>
      </label>
      <label>
        Thời gian lưu lại tối thiểu (giây)
        <input
          type="number"
          min={0}
          max={300}
          value={draft.minDwellSeconds}
          onChange={(e) => onChange({ minDwellSeconds: Number(e.target.value) })}
        />
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={isAllDay}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { activeFrom: null, activeTo: null }
                : { activeFrom: '06:00', activeTo: '22:00' },
            )
          }
        />{' '}
        Hoạt động cả ngày
      </label>
      {!isAllDay && (
        <div className={styles.timeRow}>
          <label>
            Từ
            <input
              type="time"
              value={draft.activeFrom ?? ''}
              onChange={(e) => onChange({ activeFrom: e.target.value })}
            />
          </label>
          <label>
            Đến
            <input
              type="time"
              value={draft.activeTo ?? ''}
              onChange={(e) => onChange({ activeTo: e.target.value })}
            />
          </label>
        </div>
      )}
      {draft.id && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.isEnabled}
            onChange={(e) => onChange({ isEnabled: e.target.checked })}
          />{' '}
          Cho phép vùng tạo cảnh báo
        </label>
      )}
      {polygonError && <p className={styles.formError}>{polygonError}</p>}
      <div className={styles.formActions}>
        {onDelete && (
          <button type="button" className={styles.dangerButton} onClick={onDelete}>
            Xóa vùng
          </button>
        )}
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={isSaving || Boolean(polygonError) || !draft.name.trim()}
        >
          {isSaving ? 'Đang lưu…' : 'Lưu vùng'}
        </button>
      </div>
    </form>
  );
}
