'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CurrentUser, Zone } from '@/types';
import { useCameraSnapshot, useCameras, useZones } from '@/hooks';
import { retryFrigateSync } from '@/lib/cameras-client';
import { getPolygonError, suggestZoneSlug, type ZonePoint } from '@/lib/zone-geometry';
import { CameraZonePreview } from './CameraZonePreview';
import { DeleteZoneDialog } from './DeleteZoneDialog';
import { ZoneForm } from './ZoneForm';
import { ZoneList } from './ZoneList';
import { ZonePolygonEditor } from './ZonePolygonEditor';
import type { ZoneDraft } from './zone-editor.types';
import styles from './zones.module.css';

function polygonFromZone(zone: Zone): ZonePoint[] {
  return zone.polygon.filter((point) => point.length === 2).map((point) => [point[0], point[1]]);
}

function draftFromZone(zone: Zone): ZoneDraft {
  return {
    id: zone.id,
    name: zone.name,
    slug: zone.slug,
    zoneType: zone.zoneType,
    polygon: polygonFromZone(zone),
    minDwellSeconds: zone.minDwellSeconds,
    activeFrom: zone.activeFrom,
    activeTo: zone.activeTo,
    isEnabled: zone.isEnabled,
  };
}

const NEW_DRAFT: ZoneDraft = {
  id: null,
  name: '',
  slug: 'zone_moi',
  zoneType: 'RESTRICTED',
  polygon: [],
  minDwellSeconds: 2,
  activeFrom: null,
  activeTo: null,
  isEnabled: true,
};

const SYNC_LABEL = {
  PENDING: 'Đang đồng bộ',
  SYNCED: 'Đã đồng bộ',
  FAILED: 'Đồng bộ thất bại',
} as const;

export function ZonesView({ user }: { user: CurrentUser | null }) {
  const camerasState = useCameras();
  const camera = camerasState.selectedCamera;
  const cameraId = camera?.id ?? null;
  const zonesState = useZones(cameraId);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ZoneDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Zone | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const snapshot = useCameraSnapshot(cameraId, draft !== null);
  const isAdmin = user?.role === 'ADMIN';

  const selectedZone = useMemo(
    () => zonesState.zones.find((zone) => zone.id === selectedZoneId) ?? null,
    [selectedZoneId, zonesState.zones],
  );
  const polygonError = draft ? getPolygonError(draft.polygon) : null;

  useEffect(() => {
    setSelectedZoneId(null);
    setDraft(null);
  }, [cameraId]);

  useEffect(() => {
    if (!draft) return;
    const preventLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', preventLeave);
    return () => window.removeEventListener('beforeunload', preventLeave);
  }, [draft]);

  const selectCamera = (nextCameraId: string) => {
    if (draft && !window.confirm('Bỏ các thay đổi vùng chưa lưu?')) return;
    camerasState.selectCamera(nextCameraId);
  };

  const startEdit = (zone: Zone) => {
    setSelectedZoneId(zone.id);
    setDraft(draftFromZone(zone));
    setActionError(null);
  };

  const changeDraft = (patch: Partial<ZoneDraft>) => {
    setDraft((current) => {
      if (!current) return current;
      const shouldSuggestSlug =
        current.id === null &&
        patch.name !== undefined &&
        (current.slug === 'zone_moi' || current.slug === suggestZoneSlug(current.name));
      return {
        ...current,
        ...patch,
        ...(shouldSuggestSlug ? { slug: suggestZoneSlug(patch.name ?? '') } : {}),
      };
    });
  };

  const saveDraft = async () => {
    if (!draft || polygonError) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        zoneType: draft.zoneType,
        polygon: draft.polygon,
        minDwellSeconds: draft.minDwellSeconds,
        activeFrom: draft.activeFrom,
        activeTo: draft.activeTo,
      };
      const saved = draft.id
        ? await zonesState.save(draft.id, { ...payload, isEnabled: draft.isEnabled })
        : await zonesState.add({ ...payload, slug: draft.slug });
      setSelectedZoneId(saved.id);
      setDraft(null);
      await camerasState.loadCameras();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Không thể lưu vùng.');
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setActionError(null);
    try {
      await zonesState.remove(deleteTarget.id);
      setDeleteTarget(null);
      setDraft(null);
      setSelectedZoneId(null);
      await camerasState.loadCameras();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Không thể xóa vùng.');
    } finally {
      setIsDeleting(false);
    }
  };

  const retrySync = async () => {
    if (!cameraId) return;
    setActionError(null);
    try {
      await retryFrigateSync(cameraId);
      await camerasState.loadCameras();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Không thể thử đồng bộ lại.');
    }
  };

  return (
    <section className={styles.container} aria-labelledby="zones-title">
      <header className={styles.header}>
        <div>
          <h1 id="zones-title">Cấu hình khu vực</h1>
          <p>Vẽ polygon trực tiếp trên ảnh camera và đặt điều kiện cảnh báo.</p>
        </div>
        {isAdmin && camera && (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!snapshot.preview || draft !== null}
            onClick={() => {
              setDraft({ ...NEW_DRAFT, polygon: [] });
              setSelectedZoneId(null);
            }}
          >
            + Thêm vùng
          </button>
        )}
      </header>

      {camerasState.error && (
        <div className={styles.error} role="alert">
          {camerasState.error}
        </div>
      )}
      <div className={styles.cameraTabs} aria-label="Chọn camera">
        {camerasState.cameras.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.id === cameraId ? styles.cameraTabActive : ''}
            onClick={() => selectCamera(item.id)}
          >
            <span>{item.name}</span>
            <small>{item.runtimeStatus === 'ONLINE' ? 'Trực tuyến' : item.runtimeStatus}</small>
          </button>
        ))}
      </div>

      {!camera && !camerasState.isLoading ? (
        <p className={styles.empty}>Chưa có camera để cấu hình.</p>
      ) : (
        camera && (
          <div className={styles.workspace}>
            <div className={styles.previewColumn}>
              <div className={styles.previewHeader}>
                <div>
                  <strong>{camera.name}</strong>
                  <span
                    className={`${styles.syncBadge} ${styles[`sync${camera.frigateSync.status}`]}`}
                  >
                    {SYNC_LABEL[camera.frigateSync.status]}
                  </span>
                </div>
                {camera.frigateSync.status === 'FAILED' && isAdmin && (
                  <button type="button" onClick={() => void retrySync()}>
                    Thử lại
                  </button>
                )}
              </div>
              {snapshot.isLoading && !snapshot.preview ? (
                <div className={styles.previewState}>Đang tải ảnh xem trước…</div>
              ) : snapshot.error || !snapshot.preview ? (
                <div className={styles.previewState}>
                  <strong>Không thể hiển thị ảnh camera</strong>
                  <span>
                    {snapshot.error ?? 'Camera chưa có ảnh phù hợp. Không thể vẽ vùng mới.'}
                  </span>
                  <button type="button" onClick={() => void snapshot.reload()}>
                    Tải lại
                  </button>
                </div>
              ) : (
                <CameraZonePreview
                  preview={snapshot.preview}
                  zones={zonesState.zones}
                  selectedZoneId={selectedZoneId}
                  draft={draft?.polygon ?? null}
                  canDraw={draft !== null && isAdmin}
                  onSelectZone={(id) => {
                    if (!draft) setSelectedZoneId(id);
                  }}
                  onAddPoint={(point) =>
                    changeDraft({ polygon: [...(draft?.polygon ?? []), point] })
                  }
                  onMovePoint={(index, point) =>
                    changeDraft({
                      polygon: (draft?.polygon ?? []).map((item, itemIndex) =>
                        itemIndex === index ? point : item,
                      ),
                    })
                  }
                />
              )}
              {draft && (
                <ZonePolygonEditor
                  points={draft.polygon}
                  error={polygonError}
                  onChange={(polygon) => changeDraft({ polygon })}
                  onComplete={() => setActionError(null)}
                  onCancel={() => setDraft(null)}
                />
              )}
            </div>

            <aside className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Vùng đã cấu hình</h2>
                  <span>{zonesState.zones.length} vùng</span>
                </div>
                {selectedZone && isAdmin && !draft && (
                  <button type="button" onClick={() => startEdit(selectedZone)}>
                    Sửa
                  </button>
                )}
              </div>
              {zonesState.isLoading ? (
                <p className={styles.empty}>Đang tải vùng…</p>
              ) : zonesState.error ? (
                <div className={styles.error} role="alert">
                  {zonesState.error}
                  <button type="button" onClick={() => void zonesState.reload()}>
                    Thử lại
                  </button>
                </div>
              ) : (
                <ZoneList
                  zones={zonesState.zones}
                  selectedId={selectedZoneId}
                  onSelect={(zone) => {
                    if (!draft || window.confirm('Bỏ thay đổi chưa lưu?')) {
                      setDraft(null);
                      setSelectedZoneId(zone.id);
                    }
                  }}
                />
              )}
              {draft && isAdmin && (
                <ZoneForm
                  draft={draft}
                  isSaving={isSaving}
                  polygonError={polygonError}
                  onChange={changeDraft}
                  onSave={() => void saveDraft()}
                  onDelete={
                    draft.id
                      ? () => {
                          const zone = zonesState.zones.find((item) => item.id === draft.id);
                          if (zone) setDeleteTarget(zone);
                        }
                      : undefined
                  }
                />
              )}
              {!draft && selectedZone && (
                <div className={styles.zoneDetails}>
                  <h3>{selectedZone.name}</h3>
                  <dl>
                    <div>
                      <dt>Loại</dt>
                      <dd>{selectedZone.zoneType}</dd>
                    </div>
                    <div>
                      <dt>Ngưỡng</dt>
                      <dd>{selectedZone.minDwellSeconds} giây</dd>
                    </div>
                    <div>
                      <dt>Lịch</dt>
                      <dd>
                        {selectedZone.activeFrom && selectedZone.activeTo
                          ? `${selectedZone.activeFrom}–${selectedZone.activeTo}`
                          : 'Cả ngày'}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
              {!isAdmin && (
                <p className={styles.notice}>
                  Bạn có quyền xem. Chỉ Quản trị viên mới được thay đổi vùng.
                </p>
              )}
              {actionError && (
                <div className={styles.error} role="alert">
                  {actionError}
                </div>
              )}
            </aside>
          </div>
        )
      )}

      {deleteTarget && camera && (
        <DeleteZoneDialog
          zoneName={deleteTarget.name}
          cameraName={camera.name}
          isBusy={isDeleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </section>
  );
}
