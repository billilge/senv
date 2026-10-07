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

describe('배포 대상 매핑·동기화 API', () => {
  let mappingId: string;

  beforeEach(async () => {
    await t.http().post('/api/v1/projects').set(admin).send({ name: 'server' });
    await t
      .http()
      .post('/api/v1/projects/server/envs/production/versions')
      .set(member)
      .send({ baseVersion: 0, changes: { set: { A: '1', B: '2' } } });
    const connection = await createConnection();
    const body = {
      connectionId: connection.body.id,
      env: 'production',
      resourceId: 'app-api',
      afterSync: 'restart',
    };
    const mapping = await t.http().post('/api/v1/projects/server/targets').set(admin).send(body);
    expect(mapping.status).toBe(201);
    mappingId = mapping.body.id;
  });

  it('멤버는 프로젝트의 매핑을 보고, 계획을 본 뒤 지금 동기화하고 기록을 본다', async () => {
    const list = await t.http().get('/api/v1/projects/server/targets').set(member);
    expect(list.body.mappings).toEqual([
      expect.objectContaining({
        id: mappingId,
        env: 'production',
        resourceName: 'stream-api-prod',
        lastSync: null,
      }),
    ]);

    const plan = await t.http().get(`/api/v1/targets/mappings/${mappingId}/plan`).set(member);
    expect(plan.body).toEqual({
      version: 1,
      sharedVersion: 0,
      add: ['A', 'B'],
      change: [],
      remove: [],
      unchanged: 0,
      action: 'restart',
    });

    const run = await t.http().post(`/api/v1/targets/mappings/${mappingId}/sync`).set(member);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      status: 'succeeded',
      changedKeys: ['A', 'B'],
      action: 'restart',
      trigger: 'manual',
    });
    expect(t.targets.variablesOf('app-api')).toMatchObject({ A: '1', B: '2' });

    const runs = await t.http().get(`/api/v1/targets/mappings/${mappingId}/runs`).set(member);
    expect(runs.body.runs).toHaveLength(1);
  });

  it('원격 값을 가져오고, 드리프트를 지금 확인한다', async () => {
    await t.http().post(`/api/v1/targets/mappings/${mappingId}/sync`).set(member);
    t.targets.seed('app-api', { A: 'edited-in-coolify', C: '3' });

    const drift = await t.http().post(`/api/v1/targets/mappings/${mappingId}/drift`).set(member);
    expect(drift.body).toEqual({ driftKeys: ['A'] });

    const imported = await t
      .http()
      .post(`/api/v1/targets/mappings/${mappingId}/import`)
      .set(member);
    expect(imported.status).toBe(201);
    expect(imported.body).toEqual({ version: 2, keys: ['A', 'C'] });
  });

  it('관리자만 매핑을 만들고 고치고 지운다', async () => {
    const forbidden = await t
      .http()
      .patch(`/api/v1/targets/mappings/${mappingId}`)
      .set(member)
      .send({ syncMode: 'manual' });
    expect(forbidden.status).toBe(403);

    const updated = await t
      .http()
      .patch(`/api/v1/targets/mappings/${mappingId}`)
      .set(admin)
      .send({ syncMode: 'manual', exclude: ['SENTRY_*'] });
    expect(updated.body).toMatchObject({ syncMode: 'manual', exclude: ['SENTRY_*'] });

    expect((await t.http().delete(`/api/v1/targets/mappings/${mappingId}`).set(admin)).status).toBe(
      204,
    );
    const missing = await t.http().get(`/api/v1/targets/mappings/${mappingId}/plan`).set(member);
    expect(missing.body).toMatchObject({ code: 'mapping_not_found' });
  });

  it('공유 그룹은 매핑할 수 없다 (422), 같은 리소스를 또 매핑하면 409다', async () => {
    const connections = (await t.http().get('/api/v1/targets/connections').set(admin)).body
      .connections;
    const shared = await t
      .http()
      .post('/api/v1/projects/shared/targets')
      .set(admin)
      .send({ connectionId: connections[0].id, env: 'production', resourceId: 'app-web' });
    expect(shared.body).toMatchObject({ code: 'shared_not_deployable' });

    const again = await t
      .http()
      .post('/api/v1/projects/server/targets')
      .set(admin)
      .send({ connectionId: connections[0].id, env: 'local', resourceId: 'app-api' });
    expect(again.status).toBe(409);
  });
});
