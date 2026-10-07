import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TEST_APP_URL, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ bootstrapAdmins: ['admin'] });
  t.github.addUser('code-bob', { id: 2001, login: 'bob', name: 'Bob', avatarUrl: null });
  t.github.addUser('code-admin', { id: 2002, login: 'admin', name: null, avatarUrl: null });
  t.github.addUser(
    'code-outsider',
    { id: 2003, login: 'eve', name: null, avatarUrl: null },
    'none',
  );
});
beforeEach(() => resetDatabase(t.prisma));
afterAll(() => t.close());

/** set-cookie 헤더에서 이름=값과 속성을 꺼낸다 */
function cookie(response: { headers: Record<string, unknown> }, name: string) {
  const raw = ([] as string[])
    .concat((response.headers['set-cookie'] as string[] | undefined) ?? [])
    .find((line) => line.startsWith(`${name}=`));
  if (!raw) return undefined;
  const [pair = '', ...attributes] = raw.split(';').map((part) => part.trim());
  return {
    pair,
    value: pair.slice(name.length + 1),
    attributes: attributes.map((a) => a.toLowerCase()),
  };
}

async function startLogin(next?: string) {
  const response = await t
    .http()
    .get('/auth/github')
    .query(next ? { next } : {});
  const state = new URL(response.headers.location as string).searchParams.get('state') ?? '';
  const cookies = (response.headers['set-cookie'] as unknown as string[]).map(
    (c) => c.split(';')[0],
  );
  return { response, state, cookieHeader: cookies.join('; ') };
}

async function finishLogin(code: string, next?: string) {
  const { state, cookieHeader } = await startLogin(next);
  return t.http().get('/auth/github/callback').query({ code, state }).set('Cookie', cookieHeader);
}

describe('GitHub 웹 로그인', () => {
  it('/auth/github는 state를 HttpOnly 쿠키에 넣고 GitHub 인증 화면으로 보낸다', async () => {
    const { response, state } = await startLogin();

    expect(response.status).toBe(302);
    const location = new URL(response.headers.location as string);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: 'test-client-id',
      redirect_uri: `${TEST_APP_URL}/auth/github/callback`,
      scope: 'read:user read:org',
    });
    expect(state).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const stateCookie = cookie(response, 'senv_oauth_state');
    expect(stateCookie?.value).toBe(state);
    expect(stateCookie?.attributes).toContain('httponly');
  });

  it('콜백이 성공하면 세션 쿠키를 주고 첫 화면으로 보낸다', async () => {
    const response = await finishLogin('code-bob');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    const session = cookie(response, 'senv_session');
    expect(session?.value).toMatch(/^senv_ss_/);
    expect(session?.attributes).toEqual(
      expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']),
    );

    const me = await t
      .http()
      .get('/api/v1/me')
      .set('Cookie', session?.pair ?? '');
    expect(me.body).toMatchObject({ login: 'bob', status: 'pending' });
  });

  it('첫 관리자 목록의 사용자는 로그인하자마자 활성 관리자다', async () => {
    const response = await finishLogin('code-admin');
    const me = await t
      .http()
      .get('/api/v1/me')
      .set('Cookie', cookie(response, 'senv_session')?.pair ?? '');
    expect(me.body).toMatchObject({ role: 'admin', status: 'active' });
  });

  it('로그인 전에 보던 같은 사이트 경로(next)로 돌려보낸다', async () => {
    const response = await finishLogin('code-bob', '/device?code=BCDF-GHJK');
    expect(response.headers.location).toBe('/device?code=BCDF-GHJK');
  });

  it.each(['https://evil.example.com', '//evil.example.com/x', '/\\evil.example.com', 'device'])(
    '외부 주소나 잘못된 next(%s)는 무시하고 첫 화면으로 보낸다',
    async (next) => {
      const response = await finishLogin('code-bob', next);
      expect(response.headers.location).toBe('/');
    },
  );

  it('state가 없거나 다르면 로그인하지 않고 /login?error=invalid_state로 보낸다', async () => {
    const { cookieHeader } = await startLogin();
    const response = await t
      .http()
      .get('/auth/github/callback')
      .query({ code: 'code-bob', state: 'forged' })
      .set('Cookie', cookieHeader);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login?error=invalid_state');
    expect(cookie(response, 'senv_session')).toBeUndefined();
    expect(await t.prisma.user.count()).toBe(0);
  });

  it('org 멤버가 아니면 /login?error=not_org_member로 보내고 세션을 주지 않는다', async () => {
    const response = await finishLogin('code-outsider');
    expect(response.headers.location).toBe('/login?error=not_org_member');
    expect(cookie(response, 'senv_session')).toBeUndefined();
  });

  it('로그아웃하면 세션을 폐기하고 쿠키를 지운다', async () => {
    const login = await finishLogin('code-bob');
    const session = cookie(login, 'senv_session')?.pair ?? '';

    const logout = await t
      .http()
      .post('/api/v1/auth/logout')
      .set('Cookie', session)
      .set('Origin', TEST_APP_URL);
    expect(logout.status).toBe(204);
    expect(cookie(logout, 'senv_session')?.value).toBe('');

    expect((await t.http().get('/api/v1/me').set('Cookie', session)).status).toBe(401);
  });
});
