import { describe, expect, it } from 'vitest';
import { getSnapshotTransition } from './useCameraSnapshot';

describe('getSnapshotTransition', () => {
  it('giữ snapshot hiện tại khi bắt đầu vẽ trên cùng camera', () => {
    expect(getSnapshotTransition('camera-1', 'camera-1', true)).toEqual({
      shouldClear: false,
      shouldReload: false,
    });
  });

  it('tải lại snapshot khi kết thúc chỉnh sửa', () => {
    expect(getSnapshotTransition('camera-1', 'camera-1', false)).toEqual({
      shouldClear: false,
      shouldReload: true,
    });
  });

  it('xóa snapshot cũ khi chuyển camera', () => {
    expect(getSnapshotTransition('camera-1', 'camera-2', true)).toEqual({
      shouldClear: true,
      shouldReload: false,
    });
  });
});
