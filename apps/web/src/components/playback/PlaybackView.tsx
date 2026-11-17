'use client';
import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePlaybackCameras } from '@/hooks/usePlaybackArchive';
import { useRecordingDays } from '@/hooks/useRecordingDays';
import { useCameraLayout } from '@/hooks/useCameraLayout';
import { cameraGrid } from '@/lib/camera-grid';
import { localDateKey } from '@/lib/playback-client';
import { PlaybackFilters } from './PlaybackFilters';
import { RecordingList } from './RecordingList';
import { ReplayTile, type ReplayCommand } from './ReplayTile';
import styles from './playback.module.css';
interface Props {
  selectedDate: Date | null;
  userId?: string;
}
export function PlaybackView({ selectedDate, userId }: Props) {
  const [today, setToday] = useState(() => new Date()),
    [revision, setRevision] = useState(0),
    [pinned, setPinned] = useState<string | null>(null),
    [page, setPage] = useState(0),
    [command, setCommand] = useState<ReplayCommand | null>(null),
    [playing, setPlaying] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setPlaying({});
    setCommand(null);
  }, [selectedDate]);
  const reportActive = useCallback(
    (id: string, start: string) =>
      setPlaying((old) => (old[id] === start ? old : { ...old, [id]: start })),
    [],
  );
  const catalog = usePlaybackCameras(revision),
    layout = useCameraLayout(userId, 'playback');
  const dateKey = localDateKey(selectedDate ?? today);
  const requested = layout.layout === 'custom' ? layout.custom : Number(layout.layout),
    grid = cameraGrid(catalog.cameras, pinned, requested, page);
  const recordings = useRecordingDays(
      grid.visible.map((camera) => camera.id),
      dateKey,
    ),
    camera = catalog.cameras.find((item) => item.id === catalog.cameraId);
  useEffect(() => {
    if (grid.visible.length && !grid.visible.some((item) => item.id === catalog.cameraId))
      catalog.setCameraId(grid.visible[0].id);
  }, [grid.currentPage, catalog.cameraId, grid.visible.map((item) => item.id).join('|')]);
  const focusedDay = recordings.days[catalog.cameraId];
  const chooseCamera = (id: string) => {
    catalog.setCameraId(id);
    setPinned(id);
    setPage(0);
    setCommand(null);
  };
  const chooseSession = (startAt: string) =>
    setCommand((old) => ({ cameraId: catalog.cameraId, startAt, nonce: (old?.nonce ?? 0) + 1 }));
  return (
    <div className={styles.page}>
      <PlaybackFilters
        cameras={catalog.cameras}
        cameraId={catalog.cameraId}
        onCamera={chooseCamera}
        layout={layout.layout}
        custom={layout.custom}
        onLayout={(value) => {
          layout.setLayout(value);
          setPage(0);
        }}
        onCustom={layout.setCustom}
      />
      {grid.shortage && catalog.cameras.length > 0 && (
        <p role="status" className={styles.notice}>
          Bạn chỉ có {catalog.cameras.length} camera được cấp quyền xem lại; đang hiển thị{' '}
          {catalog.cameras.length} thay vì {requested} khung.
        </p>
      )}
      {catalog.cameraError && (
        <p role="alert" className={styles.notice}>
          {catalog.cameraError}
          <button onClick={() => setRevision((n) => n + 1)}>Thử lại</button>
        </p>
      )}
      {layout.saveError && (
        <p role="status" className={styles.notice}>
          {layout.saveError}
        </p>
      )}
      {!catalog.camerasLoading && !catalog.cameras.length ? (
        <p className={styles.empty}>Chưa có camera được cấp quyền xem lại.</p>
      ) : (
        <div className={styles.content}>
          <div className={styles.gridColumn}>
            <div
              className={styles.replayGrid}
              aria-label="Lưới camera xem lại"
              data-count={grid.visible.length}
              style={{
                gridTemplateColumns: 'repeat(' + grid.columns + ',minmax(0,1fr))',
                gridTemplateRows:
                  'repeat(' + Math.ceil(grid.visible.length / grid.columns) + ',minmax(0,1fr))',
              }}
            >
              {grid.visible.map((item) => (
                <ReplayTile
                  key={dateKey + item.id}
                  camera={item}
                  day={recordings.days[item.id]}
                  primary={item.id === catalog.cameraId}
                  command={command}
                  onActive={reportActive}
                  error={recordings.errors[item.id]}
                />
              ))}
            </div>
            <ReplayPager current={grid.currentPage} pages={grid.pages} onPage={setPage} />
          </div>
          <RecordingList
            key={dateKey + catalog.cameraId}
            cameraName={camera?.name ?? ''}
            day={focusedDay}
            loading={!focusedDay && !recordings.errors[catalog.cameraId]}
            error={recordings.errors[catalog.cameraId]}
            selectedAt={playing[catalog.cameraId]}
            onChoose={chooseSession}
            onRetry={recordings.retry}
          />
        </div>
      )}
    </div>
  );
}

function ReplayPager({
  current,
  pages,
  onPage,
}: {
  current: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  return pages > 1 ? (
    <div className={styles.pager}>
      <button
        aria-label="Camera xem lại trước"
        disabled={current === 0}
        onClick={() => onPage(current - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <span>
        {current + 1}/{pages}
      </span>
      <button
        aria-label="Camera xem lại sau"
        disabled={current === pages - 1}
        onClick={() => onPage(current + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  ) : null;
}
