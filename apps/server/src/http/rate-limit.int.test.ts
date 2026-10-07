import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
  await resetDatabase(t.prisma);
});
afterEach(() => t.close());

const IP = '203.0.113.1';

function send(method: 'GET' | 'POST', path: string, ip = IP, headers: Record<string, string> = {}) {
  const req = method === 'GET' ? t.http().get(path) : t.http().post(path).send({});
  return req.set({ 'X-Forwarded-For': ip, ...headers });
}

async function repeat(times: number, call: () => PromiseLike<{ status: number }>) {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await call()).status);
  return statuses;
}

describe('속도 제한', () => {
  it('디바이스 로그인 시작은 IP당 1분에 10번까지, 넘으면 429와 Retry-After를 준다', async () => {
    expect(await repeat(10, () => send('POST', '/api/v1/auth/device'))).toEqual(
      Array(10).fill(200),
    );

    const blocked = await send('POST', '/api/v1/auth/device');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      code: 'too_many_requests',
      message: expect.stringMatching(/\d+초 뒤에 다시 시도하세요/),
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('IP는 프록시(Traefik)가 붙인 X-Forwarded-For로 구분한다', async () => {
    await repeat(10, () => send('POST', '/api/v1/auth/device', '203.0.113.1'));
    expect((await send('POST', '/api/v1/auth/device', '203.0.113.1')).status).toBe(429);
    expect((await send('POST', '/api/v1/auth/device', '203.0.113.2')).status).toBe(200);
  });

  it('경로마다 따로 센다', async () => {
    await repeat(11, () => send('POST', '/api/v1/auth/device'));
    expect((await send('POST', '/api/v1/auth/token/refresh')).status).toBe(400);
  });

  it.each([
    ['GET', '/auth/github', 20],
    ['GET', '/auth/github/callback', 20],
    ['POST', '/api/v1/auth/device/token', 60],
    ['POST', '/api/v1/auth/token/refresh', 60],
  ] as const)('%s %s 는 1분에 %i번까지', async (method, path, limit) => {
    const statuses = await repeat(limit + 1, () => send(method, path));
    expect(statuses.slice(0, limit)).not.toContain(429);
    expect(statuses.at(-1)).toBe(429);
  });

  it('CLI 로그인 승인은 1분에 10번까지 (사용자 코드 추측 방지)', async () => {
    const { auth } = await signIn(t);
    const statuses = await repeat(11, () => send('POST', '/api/v1/auth/device/approve', IP, auth));
    expect(statuses.slice(0, 10)).not.toContain(429);
    expect(statuses.at(-1)).toBe(429);
  });

  it('그 밖의 경로는 제한하지 않는다', async () => {
    const statuses = await repeat(70, () => send('GET', '/healthz'));
    expect(statuses).toEqual(Array(70).fill(200));
  });
});
