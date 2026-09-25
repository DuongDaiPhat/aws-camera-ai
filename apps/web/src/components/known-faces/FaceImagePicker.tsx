'use client';

import { useEffect, useState } from 'react';
import type { SelectionDetails } from '@/lib/known-faces-client';
import styles from './known-faces.module.css';

export function FaceImagePreview({
  file,
  selected,
  details,
  onSelect,
  onRemove,
  disabled,
}: {
  file: File;
  selected: number | null;
  details?: SelectionDetails['images'][number];
  onSelect: (index: number) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <article className={styles.previewCard}>
      <div className={styles.previewFrame}>
        <div className={styles.preview}>
          {/* Preview local: ảnh được browser áp dụng EXIF trước khi vẽ box chuẩn hóa. */}
          {url && <img src={url} alt={`Ảnh đăng ký ${file.name}`} />}
          {details?.faces.map((face) => (
            <button
              key={face.faceIndex}
              type="button"
              disabled={disabled}
              className={styles.faceBox}
              aria-pressed={selected === face.faceIndex}
              aria-label={`Chọn khuôn mặt ${face.faceIndex + 1} trong ${file.name}`}
              style={{
                left: `${face.boundingBox.x * 100}%`,
                top: `${face.boundingBox.y * 100}%`,
                width: `${face.boundingBox.width * 100}%`,
                height: `${face.boundingBox.height * 100}%`,
              }}
              onClick={() => onSelect(face.faceIndex)}
            >
              {selected === face.faceIndex ? '✓ ' : ''}
              {face.faceIndex + 1}
            </button>
          ))}
        </div>
      </div>
      <span>{file.name}</span>
      {details?.code === 'NO_FACE_DETECTED' && (
        <p role="alert">Không tìm thấy khuôn mặt. Hãy thay ảnh.</p>
      )}
      {details?.faces.length ? (
        <p>{selected === null ? 'Hãy chọn đúng khuôn mặt.' : `Đã chọn mặt ${selected + 1}.`}</p>
      ) : null}
      <button type="button" disabled={disabled} onClick={onRemove}>
        Bỏ ảnh
      </button>
    </article>
  );
}
