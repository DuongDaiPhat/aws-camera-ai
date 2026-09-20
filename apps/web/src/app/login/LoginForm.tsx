'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { login } from '@/lib/auth-client';
import styles from './login.module.css';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setPasswordVisible] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      await login({ email, password });
      router.replace('/');
      router.refresh();
    } catch (error: unknown) {
      setErrorMessage(toLoginErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="ten@domain.com"
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorMessage ? 'login-error' : undefined}
          required
          autoFocus
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="password">Mật khẩu</label>
        <div className={styles.passwordField}>
          <input
            id="password"
            name="password"
            type={isPasswordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Tối thiểu 8 ký tự"
            aria-invalid={errorMessage ? true : undefined}
            aria-describedby={errorMessage ? 'login-error' : undefined}
            required
          />
          <button
            className={styles.visibilityButton}
            type="button"
            onClick={() => setPasswordVisible((current) => !current)}
            aria-label={isPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          >
            {isPasswordVisible ? 'Ẩn' : 'Hiện'}
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div id="login-error" className={styles.error} role="alert">
          <span aria-hidden="true">!</span>
          <p>{errorMessage}</p>
        </div>
      ) : null}

      <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>

      <p className={styles.securityNote}>Sai mật khẩu 5 lần liên tiếp sẽ khóa tài khoản 15 phút.</p>
    </form>
  );
}

function toLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 423) {
    return 'Tài khoản tạm khóa trong 15 phút vì đăng nhập sai nhiều lần.';
  }
  if (error instanceof ApiError && error.status === 400) {
    return 'Thông tin chưa hợp lệ. Mật khẩu cần ít nhất 8 ký tự.';
  }
  if (error instanceof ApiError && error.status === 401) {
    return 'Email hoặc mật khẩu không đúng. Hãy kiểm tra và thử lại.';
  }
  return 'Không kết nối được hệ thống. Hãy thử lại sau ít phút.';
}
