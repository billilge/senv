import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';

let t: TestApp;

beforeAll(async () => {
  // 앞선 테스트 파일이 남긴 상태와 상관없이, 빈 DB에서 앱을 띄운다
  const cleaner = await createTestApp();
  await resetDatabase(cleaner.prisma);
  await cleaner.close();
  t = await createTestApp();
});
afterAll(() => t.close());

describe('HTTP 앱', () => {
  it('GET /healthz는 DB가 응답하면 200 ok다', async () => {
    const response = await t.http().get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('없는 경로는 404이고 { code, message } 형식이다', async () => {
    const response = await t.http().get('/api/v1/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'not_found', message: expect.any(String) });
  });

  it('앱이 뜨면 공유 그룹 프로젝트가 준비되어 있다', async () => {
    expect(await t.prisma.project.count({ where: { name: 'shared', kind: 'shared' } })).toBe(1);
  });

  it('X-Powered-By 헤더로 서버 종류를 알리지 않는다', async () => {
    const response = await t.http().get('/healthz');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
