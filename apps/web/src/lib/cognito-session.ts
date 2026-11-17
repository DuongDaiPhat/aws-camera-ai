import type { User, UserManager } from 'oidc-client-ts';
import { getAuthConfig, type AuthConfig } from './auth-config';

let current: { key: string; manager: UserManager } | undefined;
let callback: { url: string; promise: Promise<User> } | undefined;

export async function getCognitoManager(config?: AuthConfig): Promise<UserManager> {
  const settings = config ?? (await getAuthConfig());
  if (settings.provider !== 'cognito' || !settings.cognito) {
    throw new Error('Ứng dụng không dùng Cognito.');
  }
  const { authority, clientId, scope } = settings.cognito;
  const key = `${authority}:${clientId}`;
  if (current?.key === key) return current.manager;
  const { UserManager, WebStorageStateStore } = await import('oidc-client-ts');
  const manager = new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    response_type: 'code',
    scope,
    disablePKCE: false,
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
  current = { key, manager };
  return manager;
}

export function completeCognitoLogin(): Promise<User> {
  const url = window.location.href;
  if (!callback || callback.url !== url) {
    callback = {
      url,
      promise: getCognitoManager().then((manager) => manager.signinRedirectCallback(url)),
    };
  }
  return callback.promise;
}

export async function refreshCognitoToken(config: AuthConfig): Promise<string> {
  const manager = await getCognitoManager(config);
  if (!(await manager.getUser())?.refresh_token) throw new Error('Phiên Cognito đã hết hạn.');
  const user = await manager.signinSilent();
  if (!user?.access_token) throw new Error('Không làm mới được phiên Cognito.');
  return user.access_token;
}
