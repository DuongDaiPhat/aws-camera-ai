import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination } from './Pagination';

describe('Pagination component', () => {
  it('render đúng thông tin hiển thị dải sự kiện và tổng số mục', () => {
    const onPageChange = vi.fn();
    const html = renderToStaticMarkup(
      <Pagination
        currentPage={1}
        totalPages={3}
        totalItems={15}
        pageSize={5}
        onPageChange={onPageChange}
      />,
    );

    expect(html).toContain('Hiển thị');
    expect(html).toContain('1');
    expect(html).toContain('5');
    expect(html).toContain('15');
    expect(html).toContain('sự kiện');
  });

  it('vô hiệu hóa nút Trước khi đang ở trang đầu tiên (trang 1)', () => {
    const onPageChange = vi.fn();
    const html = renderToStaticMarkup(
      <Pagination
        currentPage={1}
        totalPages={4}
        totalItems={20}
        pageSize={5}
        onPageChange={onPageChange}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Trang trước"/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*aria-label="Trang sau"/);
  });

  it('vô hiệu hóa nút Tiếp khi đang ở trang cuối cùng', () => {
    const onPageChange = vi.fn();
    const html = renderToStaticMarkup(
      <Pagination
        currentPage={4}
        totalPages={4}
        totalItems={20}
        pageSize={5}
        onPageChange={onPageChange}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Trang sau"/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*aria-label="Trang trước"/);
  });

  it('render tùy chọn số dòng/trang khi có onPageSizeChange', () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const html = renderToStaticMarkup(
      <Pagination
        currentPage={2}
        totalPages={4}
        totalItems={20}
        pageSize={5}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        pageSizeOptions={[5, 10, 20]}
      />,
    );

    expect(html).toContain('Số lượng:');
    expect(html).toContain('5');
    expect(html).toContain('10');
    expect(html).toContain('20');
  });

  it('không render gì khi totalItems bằng 0', () => {
    const onPageChange = vi.fn();
    const html = renderToStaticMarkup(
      <Pagination
        currentPage={1}
        totalPages={1}
        totalItems={0}
        pageSize={5}
        onPageChange={onPageChange}
      />,
    );

    expect(html).toBe('');
  });
});
