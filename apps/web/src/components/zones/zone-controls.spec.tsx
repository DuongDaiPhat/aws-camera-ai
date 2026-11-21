// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZoneForm } from './ZoneForm';
import { ZoneList } from './ZoneList';
import { ZonePolygonEditor } from './ZonePolygonEditor';
import { DeleteZoneDialog } from './DeleteZoneDialog';
import type { ZoneDraft } from './zone-editor.types';
import type { Zone } from '@/types';

let host: HTMLDivElement;
let root: Root;
const draft: ZoneDraft = {
  id: null,
  name: 'Kitchen',
  slug: 'kitchen',
  zoneType: 'NORMAL',
  polygon: [],
  minDwellSeconds: 0,
  activeFrom: null,
  activeTo: null,
  isEnabled: true,
};
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render(element: React.ReactElement) {
  act(() => root.render(element));
}
function button(text: string) {
  const b = [...host.querySelectorAll('button')].find((node) => node.textContent === text);
  if (!b) throw new Error(text);
  return b;
}
function click(node: HTMLElement) {
  act(() => node.click());
}
function input(node: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('edits new zone fields, changes schedule and submits valid data', () => {
  const change = vi.fn(),
    save = vi.fn();
  const props = { draft, isSaving: false, polygonError: null, onChange: change, onSave: save };
  render(<ZoneForm {...props} />);
  const fields = host.querySelectorAll('input');
  input(fields[0], 'Door');
  expect(change).toHaveBeenLastCalledWith({ name: 'Door' });
  input(fields[1], 'door_zone');
  expect(change).toHaveBeenLastCalledWith({ slug: 'door_zone' });
  input(fields[2], '12');
  expect(change).toHaveBeenLastCalledWith({ minDwellSeconds: 12 });
  const select = host.querySelector('select')!;
  act(() => {
    select.value = 'RESTRICTED';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(change).toHaveBeenLastCalledWith({ zoneType: 'RESTRICTED' });
  click(fields[3]);
  expect(change).toHaveBeenLastCalledWith({ activeFrom: '06:00', activeTo: '22:00' });
  act(() =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(save).toHaveBeenCalledOnce();
  render(
    <ZoneForm
      {...props}
      draft={{ ...draft, id: 'z', activeFrom: '08:00', activeTo: '18:00' }}
      onDelete={save}
    />,
  );
  expect(host.querySelectorAll('input')[1].readOnly).toBe(true);
  const times = host.querySelectorAll<HTMLInputElement>('input[type="time"]');
  input(times[0], '09:00');
  expect(change).toHaveBeenLastCalledWith({ activeFrom: '09:00' });
  input(times[1], '19:00');
  expect(change).toHaveBeenLastCalledWith({ activeTo: '19:00' });
  const checks = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  click(checks[0]);
  expect(change).toHaveBeenLastCalledWith({ activeFrom: null, activeTo: null });
  click(checks[1]);
  expect(change).toHaveBeenLastCalledWith({ isEnabled: false });
  click(button('Xóa vùng'));
  expect(save).toHaveBeenCalledTimes(2);
});

it('blocks saving empty names, invalid polygons and in-flight changes', () => {
  const props = { draft, isSaving: false, polygonError: null, onChange: vi.fn(), onSave: vi.fn() };
  render(<ZoneForm {...props} draft={{ ...draft, name: '   ' }} />);
  expect(button('Lưu vùng').disabled).toBe(true);
  render(<ZoneForm {...props} polygonError="Polygon bị giao nhau" />);
  expect(host.textContent).toContain('Polygon bị giao nhau');
  expect(button('Lưu vùng').disabled).toBe(true);
  render(<ZoneForm {...props} isSaving />);
  expect(button('Đang lưu…').disabled).toBe(true);
  render(<ZoneForm {...props} draft={{ ...draft, activeFrom: null, activeTo: '18:00' }} />);
  expect(host.querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe('');
  render(<ZoneForm {...props} draft={{ ...draft, activeFrom: '08:00', activeTo: null }} />);
  expect(host.querySelectorAll<HTMLInputElement>('input[type="time"]')[1].value).toBe('');
});

it('lists enabled and disabled zones and selects the original zone', () => {
  const select = vi.fn();
  render(<ZoneList zones={[]} selectedId={null} onSelect={select} />);
  expect(host.textContent).toContain('chưa có vùng');
  const zones = ['RESTRICTED', 'REST_AREA', 'NORMAL'].map((zoneType, i) => ({
    id: String(i),
    name: `Zone ${i}`,
    zoneType,
    isEnabled: i !== 1,
  })) as Zone[];
  render(<ZoneList zones={zones} selectedId="0" onSelect={select} />);
  expect(host.textContent).toContain('Vùng cấm');
  expect(host.textContent).toContain('Khu nghỉ');
  expect(host.textContent).toContain('Vùng thường');
  expect(host.textContent).toContain('Đã tắt');
  click(host.querySelectorAll('button')[1]);
  expect(select).toHaveBeenCalledWith(zones[1]);
});

it('undoes vertices, completes valid polygons and cancels drawing', () => {
  const change = vi.fn(),
    complete = vi.fn(),
    cancel = vi.fn();
  const props = {
    points: [],
    error: null,
    onChange: change,
    onComplete: complete,
    onCancel: cancel,
  };
  render(<ZonePolygonEditor {...props} />);
  expect(host.textContent).toContain('đỉnh đầu tiên');
  expect(button('Hoàn tác điểm').disabled).toBe(true);
  const points: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  render(<ZonePolygonEditor {...props} points={points} />);
  expect(host.textContent).toContain('4 đỉnh');
  click(button('Hoàn tác điểm'));
  expect(change).toHaveBeenLastCalledWith(points.slice(0, 3));
  click(button('Xóa đỉnh cuối'));
  expect(change).toHaveBeenLastCalledWith(points.slice(0, 3));
  click(button('Hoàn tất polygon'));
  expect(complete).toHaveBeenCalledOnce();
  click(button('Hủy'));
  expect(cancel).toHaveBeenCalledOnce();
  render(<ZonePolygonEditor {...props} points={points.slice(0, 3)} error="Lỗi polygon" />);
  expect(button('Xóa đỉnh cuối').disabled).toBe(true);
  expect(button('Hoàn tất polygon').disabled).toBe(true);
  expect(host.textContent).toContain('Lỗi polygon');
});

it('focuses cancel and requires explicit delete confirmation', () => {
  const cancel = vi.fn(),
    confirm = vi.fn();
  const props = {
    zoneName: 'Kitchen',
    cameraName: 'Cam 1',
    isBusy: false,
    onCancel: cancel,
    onConfirm: confirm,
  };
  render(<DeleteZoneDialog {...props} />);
  expect(document.activeElement).toBe(button('Giữ lại'));
  expect(host.textContent).toContain('Kitchen');
  expect(host.textContent).toContain('Cam 1');
  act(() =>
    host
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
  );
  expect(cancel).not.toHaveBeenCalled();
  click(button('Xóa vùng'));
  expect(confirm).toHaveBeenCalledOnce();
  click(button('Giữ lại'));
  expect(cancel).toHaveBeenCalledOnce();
  act(() =>
    host
      .querySelector('[role="presentation"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
  );
  expect(cancel).toHaveBeenCalledTimes(2);
  render(<DeleteZoneDialog {...props} isBusy />);
  expect(button('Đang xóa…').disabled).toBe(true);
});
