import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';
import styles from './login.module.css';

export const metadata: Metadata = {
  title: 'Đăng nhập | CameraAI',
  description: 'Đăng nhập vào hệ thống giám sát tại nhà CameraAI.',
};

// Nội dung dựa trên tính năng thật của sản phẩm (FR-DET, FR-NOT trong roadmap),
// không dùng câu marketing chung chung.
const PRODUCT_FEATURES = [
  { icon: 'activity', label: 'Phát hiện té ngã và tư thế bất thường' },
  { icon: 'user-check', label: 'Nhận diện người quen, cảnh báo người lạ' },
  { icon: 'bell', label: 'Cảnh báo Telegram kèm ảnh, xác nhận bằng một chạm' },
] as const;

type FeatureIconName = (typeof PRODUCT_FEATURES)[number]['icon'];

function FeatureIcon({ name }: { name: FeatureIconName }) {
  if (name === 'activity') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 12h4l3-7 4 14 3-7h4" />
      </svg>
    );
  }

  if (name === 'user-check') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="m16 11 2 2 4-4" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <aside className={styles.productRail} aria-labelledby="product-title">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <span />
          </span>
          <span>CameraAI</span>
        </div>

        <div className={styles.productMessage}>
          <p className={styles.context}>Hệ thống giám sát tại nhà</p>
          <h1 id="product-title">Giữ an toàn cho người thân, kể cả khi bạn vắng nhà</h1>
          <p className={styles.lead}>
            CameraAI quan sát luồng camera trong nhà liên tục, phát hiện rủi ro sớm và gửi cảnh báo
            kèm ảnh để bạn phản ứng kịp thời.
          </p>

          <ul className={styles.features}>
            {PRODUCT_FEATURES.map((feature) => (
              <li key={feature.icon}>
                <span className={styles.featureIcon}>
                  <FeatureIcon name={feature.icon} />
                </span>
                {feature.label}
              </li>
            ))}
          </ul>
        </div>

        <p className={styles.railFooter}>CameraAI · Giám sát hành vi ứng dụng AI và AWS</p>
      </aside>

      <section className={styles.authArea} aria-labelledby="login-title">
        <header className={styles.mobileHeader}>
          <span className={styles.brandMark} aria-hidden="true">
            <span />
          </span>
          <span>CameraAI</span>
        </header>

        <div className={styles.authContent}>
          <div className={styles.authHeading}>
            <h2 id="login-title">Đăng nhập</h2>
            <p>Dùng tài khoản đã được cấp để truy cập camera và nhận cảnh báo.</p>
          </div>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
