import { Entry } from '@napi-rs/keyring';
import type { KeyringBackend } from './credentials.js';

/**
 * 실제 OS 키체인 (macOS Keychain, Windows Credential Manager, Linux Secret Service).
 * OS에 묶인 어댑터라 테스트하지 않는다. 동작하지 않으면 openCredentialStore가 파일로 대체한다.
 */
export const osKeyring: KeyringBackend = {
  get: (service, account) => new Entry(service, account).getPassword(),
  set: (service, account, secret) => new Entry(service, account).setPassword(secret),
  delete: (service, account) => {
    new Entry(service, account).deletePassword();
  },
};
