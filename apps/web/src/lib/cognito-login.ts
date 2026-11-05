import { getCognitoManager } from './cognito-session';

export async function startCognitoLogin(): Promise<void> {
  const manager = await getCognitoManager();
  await manager.signinRedirect({ nonce: window.crypto.randomUUID() });
}
