import { describe, expect, it } from 'vitest';
import { NotLoggedInError } from '../auth/session.js';
import { createTestContext, FakeApi, signedIn, TEST_API_URL } from '../testing/fake-api.js';
import { LoginFailedError, login, logout, whoami } from './auth.js';

const started = {
  deviceCode: 'device-secret',
  userCode: 'BCDF-GHJK',
  verificationUri: `${TEST_API_URL}/device`,
  verificationUriComplete: `${TEST_API_URL}/device?code=BCDF-GHJK`,
  expiresIn: 600,
  interval: 5,
};
const pair = {
  accessToken: 'senv_at_new',
  accessExpiresAt: '2026-10-07T10:00:00.000Z',
  refreshToken: 'senv_rt_new',
  refreshExpiresAt: '2026-11-06T09:00:00.000Z',
};
const alice = {
  id: 'u1',
  githubId: '1',
  login: 'alice',
  name: 'Alice',
  avatarUrl: null,
  role: 'member',
  status: 'active',
};
const pending = { status: 400, body: { code: 'authorization_pending', message: '대기' } };

function deviceServer(...tokenResponses: { status: number; body?: unknown }[]) {
  return new FakeApi()
    .reply('POST', '/api/v1/auth/device', { status: 200, body: started })
    .reply('POST', '/api/v1/auth/device/token', ...tokenResponses)
    .reply('GET', '/api/v1/me', { status: 200, body: alice });
}

describe('senv login', () => {
  it('코드와 주소를 보여주고 브라우저를 연 뒤, 승인되면 토큰을 저장하고 누구인지 알려준다', async () => {
    const api = deviceServer(pending, { status: 200, body: pair });
    const { context, logs, opened, sleeps, credentials } = await createTestContext(api);

    await login(context);

    expect(logs.info.join('\n')).toContain('BCDF-GHJK');
    expect(opened).toEqual([started.verificationUriComplete]);
    expect(sleeps).toEqual([5000, 5000]);
    expect(await credentials.load(TEST_API_URL)).toEqual({ apiUrl: TEST_API_URL, ...pair });
    expect(logs.info.at(-1)).toContain('alice');
    expect(api.requests.find((r) => r.path === '/api/v1/me')?.auth).toBe('Bearer senv_at_new');
  });

  it('slow_down이면 서버가 알려준 간격으로 늘린다', async () => {
    const api = deviceServer(
      { status: 400, body: { code: 'slow_down', message: '느리게', details: { interval: 10 } } },
      { status: 200, body: pair },
    );
    const { context, sleeps } = await createTestContext(api);
    await login(context);
    expect(sleeps).toEqual([5000, 10000]);
  });

  it.each([
    ['거절', 'access_denied'],
    ['만료', 'expired_token'],
  ])('%s되면 LoginFailedError이고 토큰을 저장하지 않는다', async (_label, code) => {
    const api = deviceServer({ status: 400, body: { code, message: code } });
    const { context, credentials } = await createTestContext(api);
    await expect(login(context)).rejects.toThrow(LoginFailedError);
    expect(await credentials.load(TEST_API_URL)).toBeUndefined();
  });

  it('키체인 대신 파일에 토큰을 저장했으면 그 사실과 위치를 알려준다', async () => {
    const { context, logs } = await createTestContext(deviceServer({ status: 200, body: pair }));
    await login(context);
    expect(logs.warn.join('\n')).toContain('credentials.json');
  });

  it('browser: false면 브라우저를 열지 않는다', async () => {
    const { context, opened } = await createTestContext(deviceServer({ status: 200, body: pair }));
    await login(context, { browser: false });
    expect(opened).toEqual([]);
  });

  it('브라우저를 열지 못해도 주소를 안내하고 계속 기다린다', async () => {
    const { context, logs } = await createTestContext(deviceServer({ status: 200, body: pair }));
    context.openBrowser = async () => {
      throw new Error('no display');
    };
    await login(context);
    expect(logs.warn.join('\n')).toContain(started.verificationUriComplete);
    expect(logs.info.at(-1)).toContain('alice');
  });
});

describe('senv logout', () => {
  it('서버에 두 토큰 폐기를 요청하고 저장된 토큰을 지운다', async () => {
    const api = new FakeApi().reply('POST', '/api/v1/auth/token/revoke', { status: 204 });
    const { context, credentials } = await createTestContext(api);
    await signedIn(credentials, 'senv_at_mine');

    await logout(context);

    expect(api.requests.map((r) => r.body)).toEqual([
      { token: 'senv_rt_test' },
      { token: 'senv_at_mine' },
    ]);
    expect(await credentials.load(TEST_API_URL)).toBeUndefined();
  });

  it('서버에 닿지 못해도 저장된 토큰은 지우고 경고한다', async () => {
    const api = new FakeApi();
    const { context, credentials, logs } = await createTestContext(api);
    context.anonymousApi = (await import('@senv/api-client')).createSenvClient({
      baseUrl: TEST_API_URL,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await signedIn(credentials);

    await logout(context);

    expect(await credentials.load(TEST_API_URL)).toBeUndefined();
    expect(logs.warn).toHaveLength(1);
  });

  it('로그인하지 않았으면 그렇다고 알려준다', async () => {
    const { context, logs } = await createTestContext(new FakeApi());
    await logout(context);
    expect(logs.info.join('\n')).toContain('로그인되어 있지 않습니다');
  });
});

describe('senv whoami', () => {
  it('로그인한 사용자를 보여준다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/me', { status: 200, body: alice });
    const { context, credentials, logs } = await createTestContext(api);
    await signedIn(credentials);
    await whoami(context);
    expect(logs.result.join('\n')).toContain('alice');
  });

  it('승인 대기 사용자에게는 관리자 승인이 필요하다고 알려준다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/me', {
      status: 200,
      body: { ...alice, status: 'pending' },
    });
    const { context, credentials, logs } = await createTestContext(api);
    await signedIn(credentials);
    await whoami(context);
    expect(logs.warn.join('\n')).toContain('승인');
  });

  it('로그인하지 않았으면 NotLoggedInError다', async () => {
    const { context } = await createTestContext(new FakeApi());
    await expect(whoami(context)).rejects.toThrow(NotLoggedInError);
  });
});
