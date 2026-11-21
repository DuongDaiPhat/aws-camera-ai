// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { generateCodeChallenge, generateCodeVerifier } from './pkce';

afterEach(() => vi.restoreAllMocks());
it('creates unpadded URL-safe verifiers from secure random bytes', () => {
  const random = vi.spyOn(window.crypto, 'getRandomValues').mockImplementation((array) => {
    (array as Uint8Array).fill(255);
    return array;
  });
  const verifier = generateCodeVerifier();
  expect(random).toHaveBeenCalledOnce();
  expect(random.mock.calls[0][0]).toHaveLength(64);
  expect(verifier).toHaveLength(86);
  expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(verifier).toContain('_');
  expect(generateCodeVerifier(32)).toHaveLength(43);
});
it('matches the RFC 7636 SHA-256 challenge test vector', async () => {
  Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  await expect(generateCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});
