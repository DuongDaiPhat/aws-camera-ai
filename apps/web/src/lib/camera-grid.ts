export function cameraGrid<T extends { id: string }>(
  ordered: T[],
  pinnedId: string | null,
  requested: number,
  page: number,
) {
  const pinned = ordered.find((camera) => camera.id === pinnedId);
  const cameras = pinned
    ? [pinned, ...ordered.filter((camera) => camera.id !== pinnedId)]
    : ordered;
  const size = Math.max(1, Math.min(cameras.length || 1, requested)),
    pages = Math.max(1, Math.ceil(cameras.length / size));
  const currentPage = Math.max(0, Math.min(page, pages - 1));
  const visible = cameras.slice(currentPage * size, (currentPage + 1) * size);
  return {
    visible,
    pages,
    currentPage,
    size,
    shortage: requested > cameras.length,
    columns: visible.length <= 2 ? Math.max(1, visible.length) : visible.length <= 4 ? 2 : 3,
  };
}
