import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';

let t: TestApp;
let admin: { Authorization: string };
let member: { Authorization: string };

beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  admin = (await signIn(t, { login: 'admin', role: 'admin' })).auth;
  member = (await signIn(t, { login: 'bob' })).auth;
});
afterAll(() => t.close());

const createConnection = (config: Record<string, unknown> = { token: 'test-token' }) =>
  t
    .http()
    .post('/api/v1/targets/connections')
    .set(admin)
    .send({ name: 'main', type: 'memory', config });

describe('배포 대상 연결 API', () => {
  it('제공자 목록은 연결·매핑 폼 필드와 지원 기능을 준다 (멤버도 볼 수 있다)', async () => {
    const response = await t.http().get('/api/v1/targets/providers').set(member);
    expect(response.status).toBe(200);
    expect(response.body.providers).toEqual([
      {
        type: 'memory',
        displayName: '메모리 (테스트용)',
        capabilities: {
          readValues: true,
          deleteKeys: true,
          actions: ['restart', 'redeploy'],
          buildTimeFlag: true,
        },
        connectionFields: [{ name: 'token', label: '토큰', kind: 'secret', required: true }],
        mappingOptionFields: [],
      },
    ]);
  });

  it('관리자는 연결을 만들고(확인 후 저장) 목록·리소스를 보고 지운다', async () => {
    const created = await createConnection();
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'main',
      type: 'memory',
      config: {},
      mappingCount: 0,
    });

    expect(
      (await t.http().get('/api/v1/targets/connections').set(admin)).body.connections,
    ).toHaveLength(1);
    const resources = await t
      .http()
      .get(`/api/v1/targets/connections/${created.body.id}/resources`)
      .set(admin);
    expect(resources.body.resources.map((r: { id: string }) => r.id)).toEqual([
      'app-api',
      'app-web',
    ]);
    expect(
      (await t.http().post(`/api/v1/targets/connections/${created.body.id}/test`).set(admin))
        .status,
    ).toBe(204);

    const renamed = await t
      .http()
      .patch(`/api/v1/targets/connections/${created.body.id}`)
      .set(admin)
      .send({ name: 'coolify-main', config: { token: '' } });
    expect(renamed.body.name).toBe('coolify-main');

    expect(
      (await t.http().delete(`/api/v1/targets/connections/${created.body.id}`).set(admin)).status,
    ).toBe(204);
  });

  it('자격 증명이 거부되면 422 target_auth_failed, 설정이 틀리면 422 invalid_target_config다', async () => {
    const denied = await createConnection({ token: 'wrong' });
    expect(denied.status).toBe(422);
    expect(denied.body).toMatchObject({ code: 'target_auth_failed' });
    expect((await createConnection({})).body).toMatchObject({ code: 'invalid_target_config' });
    const unknown = await t
      .http()
      .post('/api/v1/targets/connections')
      .set(admin)
      .send({ name: 'x', type: 'aws', config: {} });
    expect(unknown.body).toMatchObject({ code: 'unknown_provider' });
  });

  it('멤버는 연결을 다루지 못한다 (403)', async () => {
    expect((await t.http().get('/api/v1/targets/connections').set(member)).status).toBe(403);
    expect(
      (
        await t
          .http()
          .post('/api/v1/targets/connections')
          .set(member)
          .send({ name: 'm', type: 'memory', config: { token: 'test-token' } })
      ).status,
    ).toBe(403);
  });
});
