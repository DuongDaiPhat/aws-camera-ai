'use client';
import { useState } from 'react';
import { Cctv, Search, ChevronDown, ChevronUp } from 'lucide-react';
import type { PlaybackCamera } from '@/types';
import { TimeField } from '@/components/ui/TimeField';
import styles from './archive-workspace.module.css';

interface Props {
  cameras: PlaybackCamera[];
  selected: string[];
  activeId: string;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onApply: () => void;
  onReset: () => void;
  timeZone: string;
}
export function ArchiveChannels(props: Props) {
  const [search, setSearch] = useState(''),
    [open, setOpen] = useState(false);
  const cameras = props.cameras.filter((camera) =>
    camera.name.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')),
  );
  return (
    <aside className={styles.channels} data-open={open} aria-label="Kênh camera xem lại">
      <button
        className={styles.channelToggle}
        type="button"
        aria-expanded={open}
        aria-controls="archive-channel-list"
        onClick={() => setOpen((value) => !value)}
      >
        <Cctv size={17} />
        Kênh camera <span>{props.selected.length}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      <div className={styles.channelContents} id="archive-channel-list">
        <div className={styles.panelHeading}>
          <Cctv size={17} />
          <strong>Kênh camera</strong>
          <span>{props.selected.length}</span>
        </div>
        <label className={styles.channelSearch}>
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Tìm camera xem lại"
            placeholder="Tìm camera…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <p className={styles.panelHint}>Chọn kênh để ghép vào màn hình.</p>
        <div className={styles.cameraList}>
          {cameras.map((camera, index) => (
            <div
              className={styles.cameraRow}
              key={camera.id}
              data-active={camera.id === props.activeId}
            >
              <input
                type="checkbox"
                aria-label={`Hiển thị ${camera.name}`}
                checked={props.selected.includes(camera.id)}
                onChange={() => props.onToggle(camera.id)}
              />
              <button
                type="button"
                aria-pressed={camera.id === props.activeId}
                onClick={() => props.onFocus(camera.id)}
              >
                <span className={styles.channelNumber}>{String(index + 1).padStart(2, '0')}</span>
                <span>
                  {camera.name}
                  <small>
                    {!camera.recordingEnabled
                      ? 'Chưa bật ghi hình'
                      : camera.id === props.activeId
                        ? 'Đang điều khiển'
                        : 'Kênh camera'}
                  </small>
                </span>
              </button>
            </div>
          ))}
          {!cameras.length && <p className={styles.panelHint}>Không tìm thấy camera.</p>}
        </div>
        <div className={styles.timeWindow}>
          <strong>Khoảng thời gian</strong>
          <div className={styles.timeFields}>
            <TimeField compact label="Từ" value={props.from} onChange={props.onFrom} />
            <TimeField compact label="Đến" value={props.to} onChange={props.onTo} />
          </div>
          <div className={styles.windowButtons}>
            <button type="button" onClick={props.onApply}>
              Áp dụng
            </button>
            <button type="button" onClick={props.onReset}>
              Cả ngày
            </button>
          </div>
        </div>
        <p className={styles.timeZone}>Giờ camera · {props.timeZone.replaceAll('_', ' ')}</p>
      </div>
    </aside>
  );
}
