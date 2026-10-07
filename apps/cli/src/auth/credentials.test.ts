import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../testing/temp-dir.js';
import {
  defaultConfigDir,
  FileCredentialStore,
  type KeyringBackend,
  KeyringCredentialStore,
  openCredentialStore,
  type StoredCredentials,
} from './credentials.js';

const PROD = 'https://senv.stream.billilge.site';
const LOCAL = 'http://localhost:3000';

const creds = (apiUrl: string, suffix = 'a'): StoredCredentials => ({
  apiUrl,
  accessToken: `senv_at_${suffix}`,
  accessExpiresAt: '2026-10-07T10:00:00.000Z',
  refreshToken: `senv_rt_${suffix}`,
  refreshExpiresAt: '2026-11-06T09:00:00.000Z',
});

class FakeKeyring implements KeyringBackend {
  readonly entries = new Map<string, string>();
  get(service: string, account: string) {
    return this.entries.get(`${service}/${account}`) ?? null;
  }
  set(service: string, account: string, secret: string) {
    this.entries.set(`${service}/${account}`, secret);
  }
  delete(service: string, account: string) {
    this.entries.delete(`${service}/${account}`);
  }
}

class BrokenKeyring implements KeyringBackend {
  get(): string | null {
    throw new Error('Secret Service를 찾을 수 없음');
  }
  set(): void {
    throw new Error('Secret Service를 찾을 수 없음');
  }
  delete(): void {
    throw new Error('Secret Service를 찾을 수 없음');
  }
}

describe('FileCredentialStore', () => {
  it('저장한 토큰을 같은 서버 주소로 다시 읽고, 서버마다 따로 둔다', async () => {
    const store = new FileCredentialStore(await makeTempDir());
    await store.save(creds(PROD, 'prod'));
    await store.save(creds(LOCAL, 'local'));

    expect(await store.load(PROD)).toEqual(creds(PROD, 'prod'));
    expect(await store.load(LOCAL)).toEqual(creds(LOCAL, 'local'));
  });

  it('파일은 권한 600, 폴더는 700으로 만든다', async () => {
    const configDir = join(await makeTempDir(), 'senv');
    await new FileCredentialStore(configDir).save(creds(PROD));

    expect((await stat(configDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(configDir, 'credentials.json'))).mode & 0o777).toBe(0o600);
  });

  it('clear하면 그 서버의 토큰만 지운다', async () => {
    const store = new FileCredentialStore(await makeTempDir());
    await store.save(creds(PROD));
    await store.save(creds(LOCAL));
    await store.clear(PROD);

    expect(await store.load(PROD)).toBeUndefined();
    expect(await store.load(LOCAL)).toEqual(creds(LOCAL));
  });

  it('파일이 없거나 깨져 있으면 undefined다 (다시 로그인하면 된다)', async () => {
    const dir = await makeTempDir();
    const store = new FileCredentialStore(dir);
    expect(await store.load(PROD)).toBeUndefined();

    await writeFile(join(dir, 'credentials.json'), '{ broken');
    expect(await store.load(PROD)).toBeUndefined();
  });
});

describe('KeyringCredentialStore', () => {
  it('키체인의 senv 서비스, 서버 주소 계정에 JSON으로 저장·읽기·삭제한다', async () => {
    const keyring = new FakeKeyring();
    const store = new KeyringCredentialStore(keyring);

    await store.save(creds(PROD));
    expect(JSON.parse(keyring.entries.get(`senv/${PROD}`) ?? '')).toEqual(creds(PROD));
    expect(await store.load(PROD)).toEqual(creds(PROD));

    await store.clear(PROD);
    expect(await store.load(PROD)).toBeUndefined();
  });
});

describe('openCredentialStore', () => {
  it('키체인이 동작하면 키체인을 쓰고 경고하지 않는다', async () => {
    const warnings: string[] = [];
    const store = await openCredentialStore({
      configDir: await makeTempDir(),
      keyring: new FakeKeyring(),
      warn: (message) => warnings.push(message),
    });
    expect(store.kind).toBe('keyring');
    expect(warnings).toEqual([]);
  });

  it('키체인을 쓸 수 없으면 파일로 대체하고 그 사실을 경고한다', async () => {
    const warnings: string[] = [];
    const store = await openCredentialStore({
      configDir: await makeTempDir(),
      keyring: new BrokenKeyring(),
      warn: (message) => warnings.push(message),
    });
    expect(store.kind).toBe('file');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('credentials.json');
  });
});

describe('defaultConfigDir', () => {
  it('XDG_CONFIG_HOME이 있으면 그 아래 senv를 쓴다', () => {
    expect(defaultConfigDir({ XDG_CONFIG_HOME: '/x/config' }, 'linux', '/home/bob')).toBe(
      '/x/config/senv',
    );
  });

  it('없으면 ~/.config/senv를 쓴다', () => {
    expect(defaultConfigDir({}, 'darwin', '/Users/bob')).toBe('/Users/bob/.config/senv');
  });

  it('Windows는 APPDATA 아래 senv를 쓴다', () => {
    expect(
      defaultConfigDir({ APPDATA: 'C:\\Users\\bob\\AppData\\Roaming' }, 'win32', 'C:\\Users\\bob'),
    ).toContain('senv');
  });
});
