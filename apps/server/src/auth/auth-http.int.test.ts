import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TEST_APP_URL, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import { ApiTokenService } from './api-token-service.js';
import { SessionService } from './session-service.js';

const T0 = new Date('2026-10-07T09:00:00.000Z');
let now = T0;
let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ now: () => now });
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  now = T0;
});
afterAll(() => t.close());

const advance = (seconds: number) => {
  now = new Date(now.getTime() + seconds * 1000);
};

async function sessionCookieFor(status: 'pending' | 'active' = 'active', login = 'alice') {
  const user = await createTestUser(t.prisma, { login, status });
  const { token } = await t.app.get(SessionService).create(user.id);
  return `senv_session=${token}`;
}

describe('인증 가드', () => {
  it('인증 없이 보호된 API를 부르면 401 unauthorized다', async () => {
    const response = await t.http().get('/api/v1/me');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('unauthorized');
  });

  it('세션 쿠키로 /me를 부르면 사용자 정보를 준다 (승인 대기 사용자도)', async () => {
    const cookie = await sessionCookieFor('pending', 'bob');
    const response = await t.http().get('/api/v1/me').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ login: 'bob', status: 'pending', role: 'member' });
  });

  it('형식만 맞고 발급하지 않은 Bearer 토큰은 401이다', async () => {
    const response = await t
      .http()
      .get('/api/v1/me')
      .set('Authorization', `Bearer senv_at_${'a'.repeat(43)}`);
    expect(response.status).toBe(401);
  });
});

describe('CLI 디바이스 로그인 전 과정', () => {
  it('시작 → 대기 → 브라우저 승인 → 토큰 → API 호출 → refresh → 폐기', async () => {
    const started = await t.http().post('/api/v1/auth/device');
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({
      userCode: expect.stringMatching(/^[A-Z]{4}-[A-Z]{4}$/),
      verificationUri: `${TEST_APP_URL}/device`,
      interval: 5,
      expiresIn: 600,
    });
    const { deviceCode, userCode } = started.body;

    const pending = await t.http().post('/api/v1/auth/device/token').send({ deviceCode });
    expect(pending.status).toBe(400);
    expect(pending.body.code).toBe('authorization_pending');

    const cookie = await sessionCookieFor('active', 'alice');
    const approved = await t
      .http()
      .post('/api/v1/auth/device/approve')
      .set('Cookie', cookie)
      .set('Origin', TEST_APP_URL)
      .send({ userCode, decision: 'approve' });
    expect(approved.status).toBe(204);

    advance(5);
    const issued = await t.http().post('/api/v1/auth/device/token').send({ deviceCode });
    expect(issued.status).toBe(200);
    const { accessToken, refreshToken } = issued.body;
    expect(accessToken).toMatch(/^senv_at_/);

    const me = await t.http().get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.body.login).toBe('alice');

    const refreshed = await t.http().post('/api/v1/auth/token/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);

    const revoked = await t
      .http()
      .post('/api/v1/auth/token/revoke')
      .send({ token: refreshed.body.accessToken });
    expect(revoked.status).toBe(204);
    const afterRevoke = await t
      .http()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(afterRevoke.status).toBe(401);
  });

  it('너무 빨리 폴링하면 400 slow_down이고 새 간격을 알려준다', async () => {
    const { body } = await t.http().post('/api/v1/auth/device');
    await t.http().post('/api/v1/auth/device/token').send({ deviceCode: body.deviceCode });
    advance(1);
    const response = await t
      .http()
      .post('/api/v1/auth/device/token')
      .send({ deviceCode: body.deviceCode });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'slow_down', details: { interval: 10 } });
  });

  it('거절하면 400 access_denied다', async () => {
    const { body } = await t.http().post('/api/v1/auth/device');
    const cookie = await sessionCookieFor();
    await t
      .http()
      .post('/api/v1/auth/device/approve')
      .set('Cookie', cookie)
      .set('Origin', TEST_APP_URL)
      .send({ userCode: body.userCode, decision: 'deny' });
    const response = await t
      .http()
      .post('/api/v1/auth/device/token')
      .send({ deviceCode: body.deviceCode });
    expect(response.body.code).toBe('access_denied');
  });

  it('승인 대기 사용자는 CLI 로그인을 승인할 수 없다 (403 approval_pending)', async () => {
    const { body } = await t.http().post('/api/v1/auth/device');
    const cookie = await sessionCookieFor('pending');
    const response = await t
      .http()
      .post('/api/v1/auth/device/approve')
      .set('Cookie', cookie)
      .set('Origin', TEST_APP_URL)
      .send({ userCode: body.userCode, decision: 'approve' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('approval_pending');
  });

  it('이미 쓴 refresh 토큰을 다시 쓰면 401 refresh_token_reused다', async () => {
    const user = await createTestUser(t.prisma, { login: 'carol' });
    const pair = await t.app.get(ApiTokenService).issuePair(user.id);
    await t.http().post('/api/v1/auth/token/refresh').send({ refreshToken: pair.refreshToken });
    const reused = await t
      .http()
      .post('/api/v1/auth/token/refresh')
      .send({ refreshToken: pair.refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('refresh_token_reused');
  });

  it('요청 본문이 형식에 맞지 않으면 400 invalid_request이고 어느 필드인지 알려준다', async () => {
    const response = await t.http().post('/api/v1/auth/token/refresh').send({});
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('invalid_request');
    expect(response.body.details.issues[0].path).toBe('refreshToken');
  });
});

describe('CSRF (쿠키 인증 쓰기 요청의 Origin 검사)', () => {
  it.each([
    ['Origin이 없음', undefined],
    ['다른 사이트의 Origin', 'https://evil.example.com'],
  ])('%s 이면 403 csrf_rejected다', async (_label, origin) => {
    const { body } = await t.http().post('/api/v1/auth/device');
    const cookie = await sessionCookieFor();
    const request = t.http().post('/api/v1/auth/device/approve').set('Cookie', cookie);
    if (origin) request.set('Origin', origin);
    const response = await request.send({ userCode: body.userCode, decision: 'approve' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('csrf_rejected');
  });

  it('쿠키로 하는 읽기 요청은 Origin을 검사하지 않는다', async () => {
    const cookie = await sessionCookieFor();
    expect((await t.http().get('/api/v1/me').set('Cookie', cookie)).status).toBe(200);
  });
});
