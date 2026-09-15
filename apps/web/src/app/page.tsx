/**
 * Trang chu — skeleton Sprint 0.
 * Sprint 1 thay bang danh sach su kien (US-06).
 */
export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1>CameraAI Dashboard</h1>
      <p>Skeleton Sprint 0. Danh sach su kien se duoc gan vao o US-06 (Sprint 1).</p>
      <p>
        API base URL: <code>{process.env.NEXT_PUBLIC_API_BASE_URL ?? 'chua cau hinh'}</code>
      </p>
    </main>
  );
}
