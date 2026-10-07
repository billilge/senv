import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { SenvApiError, SenvNetworkError } from '@senv/api-client';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../testing/temp-dir.js';
import { FileCredentialStore, type StoredCredentials } from './credentials.js';
import { CliSession, NotLoggedInError, type TokenPair } from './session.js';

const API = 'https://senv.example.com';
const NOW = new Date('2026-10-07T09:00:00.000Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

function stored(overrides: Partial<StoredCredentials> = {}): StoredCredentials {
  return {
    apiUrl: API,
    accessToken: 'senv_at_old',
    accessExpiresAt: minutes(30),
    refreshToken: 'senv_rt_old',
    refreshExpiresAt: minutes(60 * 24 * 30),
    ...overrides,
  };
}

const newPair: TokenPair = {
  accessToken: 'senv_at_new',
  accessExpiresAt: minutes(60),
  refreshToken: 'senv_rt_new',
  refreshExpiresAt: minutes(60 * 24 * 30),
};

async function setup(credentials?: StoredCredentials, refresh = async () => newPair) {
  const dir = await makeTempDir();
  const store = new FileCredentialStore(dir);
  if (credentials) await store.save(credentials);
  const calls: string[] = [];
  const session = (store2 = store) =>
    new CliSession({
      apiUrl: API,
      store: store2,
      lockPath: join(dir, 'refresh.lock'),
      now: () => NOW,
      refresh: async (token) => {
        calls.push(token);
        return refresh();
      },
    });
  return { dir, store, calls, session };
}

describe('CliSession.accessToken', () => {
  it('로그인하지 않았으면 NotLoggedInError다', async () => {
    const { session } = await setup();
    await expect(session().accessToken()).rejects.toThrow(NotLoggedInError);
  });

  it('access 토큰이 1분 넘게 남았으면 그대로 쓴다', async () => {
    const { session, calls } = await setup(stored({ accessExpiresAt: minutes(2) }));
    expect(await session().accessToken()).toBe('senv_at_old');
    expect(calls).toEqual([]);
  });

  it('1분 안에 만료되면 refresh하고 새 토큰을 저장한다', async () => {
    const { session, calls, store } = await setup(stored({ accessExpiresAt: minutes(0.5) }));
    expect(await session().accessToken()).toBe('senv_at_new');
    expect(calls).toEqual(['senv_rt_old']);
    expect(await store.load(API)).toEqual({ apiUrl: API, ...newPair });
  });

  it('두 프로세스가 동시에 갱신하려 해도 refresh는 한 번만 일어난다', async () => {
    const { session, calls, dir } = await setup(
      stored({ accessExpiresAt: minutes(-1) }),
      async () => {
        await sleep(50);
        return newPair;
      },
    );
    // 같은 파일을 쓰는 서로 다른 저장소 인스턴스 = 서로 다른 프로세스
    const [a, b] = await Promise.all([
      session().accessToken(),
      session(new FileCredentialStore(dir)).accessToken(),
    ]);
    expect([a, b]).toEqual(['senv_at_new', 'senv_at_new']);
    expect(calls).toHaveLength(1);
  });

  it('refresh 토큰도 만료됐으면 서버에 묻지 않고 저장된 토큰을 지운 뒤 NotLoggedInError다', async () => {
    const { session, calls, store } = await setup(
      stored({ accessExpiresAt: minutes(-60), refreshExpiresAt: minutes(-1) }),
    );
    await expect(session().accessToken()).rejects.toThrow(NotLoggedInError);
    expect(calls).toEqual([]);
    expect(await store.load(API)).toBeUndefined();
  });

  it('서버가 refresh를 거부하면(401) 저장된 토큰을 지우고 NotLoggedInError다', async () => {
    const { session, store } = await setup(stored({ accessExpiresAt: minutes(-1) }), async () => {
      throw new SenvApiError(401, 'refresh_token_reused', '재사용');
    });
    await expect(session().accessToken()).rejects.toThrow(NotLoggedInError);
    expect(await store.load(API)).toBeUndefined();
  });

  it('네트워크 오류면 토큰을 지우지 않고 그 오류를 그대로 던진다', async () => {
    const { session, store } = await setup(stored({ accessExpiresAt: minutes(-1) }), async () => {
      throw new SenvNetworkError(new Error('ECONNREFUSED'));
    });
    await expect(session().accessToken()).rejects.toThrow(SenvNetworkError);
    expect(await store.load(API)).toEqual(stored({ accessExpiresAt: minutes(-1) }));
  });
});
