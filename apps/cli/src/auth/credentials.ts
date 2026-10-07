import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';

/** 서버 주소별로 저장하는 CLI 토큰 */
export interface StoredCredentials {
  apiUrl: string;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export interface CredentialStore {
  readonly kind: 'keyring' | 'file';
  load(apiUrl: string): Promise<StoredCredentials | undefined>;
  save(credentials: StoredCredentials): Promise<void>;
  clear(apiUrl: string): Promise<void>;
}

/** OS 키체인. 운영은 @napi-rs/keyring, 테스트는 가짜를 쓴다 */
export interface KeyringBackend {
  get(service: string, account: string): string | null;
  set(service: string, account: string, secret: string): void;
  delete(service: string, account: string): void;
}

export const KEYRING_SERVICE = 'senv';
const CREDENTIALS_FILE = 'credentials.json';
const PROBE_ACCOUNT = '__senv_probe__';

/** 키체인을 쓸 수 없을 때의 대체 저장소. 서버 주소를 키로 하는 JSON 파일 하나다 */
export class FileCredentialStore implements CredentialStore {
  readonly kind = 'file' as const;
  readonly path: string;

  constructor(private readonly configDir: string) {
    this.path = join(configDir, CREDENTIALS_FILE);
  }

  async load(apiUrl: string): Promise<StoredCredentials | undefined> {
    return (await this.readAll())[apiUrl];
  }

  async save(credentials: StoredCredentials): Promise<void> {
    const all = await this.readAll();
    all[credentials.apiUrl] = credentials;
    await this.writeAll(all);
  }

  async clear(apiUrl: string): Promise<void> {
    const all = await this.readAll();
    delete all[apiUrl];
    await this.writeAll(all);
  }

  /** 파일이 없거나 깨져 있으면 빈 목록으로 본다 (다시 로그인하면 된다) */
  private async readAll(): Promise<Record<string, StoredCredentials>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, StoredCredentials>)
        : {};
    } catch {
      return {};
    }
  }

  private async writeAll(all: Record<string, StoredCredentials>): Promise<void> {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    await chmod(this.configDir, 0o700);
    await writeFile(this.path, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    // 이미 있던 파일은 mode 옵션이 적용되지 않으므로 다시 맞춘다
    await chmod(this.path, 0o600);
  }
}

export class KeyringCredentialStore implements CredentialStore {
  readonly kind = 'keyring' as const;
  constructor(private readonly keyring: KeyringBackend) {}

  async load(apiUrl: string): Promise<StoredCredentials | undefined> {
    const secret = this.keyring.get(KEYRING_SERVICE, apiUrl);
    if (!secret) return undefined;
    try {
      return JSON.parse(secret) as StoredCredentials;
    } catch {
      return undefined;
    }
  }

  async save(credentials: StoredCredentials): Promise<void> {
    this.keyring.set(KEYRING_SERVICE, credentials.apiUrl, JSON.stringify(credentials));
  }

  async clear(apiUrl: string): Promise<void> {
    try {
      this.keyring.delete(KEYRING_SERVICE, apiUrl);
    } catch {
      // 지울 항목이 없으면 키체인이 오류를 내기도 한다. 결과는 같으므로 무시한다
    }
  }
}

/** 키체인이 동작하면 키체인을, 아니면 권한 600 파일을 쓰고 경고한다 (PRD 결정 기록 29) */
export async function openCredentialStore(options: {
  configDir: string;
  keyring: KeyringBackend;
  warn: (message: string) => void;
}): Promise<CredentialStore> {
  const { keyring } = options;
  try {
    keyring.set(KEYRING_SERVICE, PROBE_ACCOUNT, 'ok');
    const value = keyring.get(KEYRING_SERVICE, PROBE_ACCOUNT);
    keyring.delete(KEYRING_SERVICE, PROBE_ACCOUNT);
    if (value === 'ok') return new KeyringCredentialStore(keyring);
  } catch {
    // 아래에서 파일 저장소로 대체한다
  }
  const store = new FileCredentialStore(options.configDir);
  options.warn(`OS 키체인을 쓸 수 없어 토큰을 ${store.path}에 저장합니다 (권한 600)`);
  return store;
}

/** XDG_CONFIG_HOME을 따르고, Windows는 APPDATA 아래에 둔다 */
export function defaultConfigDir(env: NodeJS.ProcessEnv, platform: string, home: string): string {
  if (platform === 'win32') {
    return win32.join(env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'), 'senv');
  }
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'senv');
}
