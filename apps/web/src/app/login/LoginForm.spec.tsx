// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

describe('login before client hydration', () => {
  it('prevents submitting credentials through a native GET while JavaScript is still loading', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(<LoginForm />);
    const form = container.querySelector('form')!;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(form.method).toBe('post');
    expect(submit.disabled).toBe(true);
  });
});
