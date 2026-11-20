import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import loginCamera from './login-camera.jpg';
import { Icon } from '@/components/ui/Icon';
import { LoginForm } from './LoginForm';
import styles from './login.module.css';

export const metadata: Metadata = {
  title: 'Đăng nhập | Argus AI',
  description: 'Đăng nhập vào hệ thống giám sát tại nhà Argus AI.',
};

export default function LoginPage() {
  return (
    <main
      className={styles.page}
      style={{ '--login-backdrop': `url("${loginCamera.src}")` } as CSSProperties}
    >
      <header className={styles.brand}>
        <span className={styles.brandMark}>
          <Icon name="aperture" size={22} />
        </span>
        Argus AI
      </header>

      <section className={styles.authContent} aria-labelledby="login-title">
        <div className={styles.authHeading}>
          <h1 id="login-title">Đăng nhập</h1>
          <p>Truy cập không gian giám sát của bạn.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
