import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../auth/session-service.js';
import { ProjectsService } from '../projects/projects-service.js';
import { createTestApp, signIn, TEST_APP_URL, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';

let t: TestApp;
let token: { Authorization: string };
let other: { Authorization: string };
let session: { Cookie: string; Origin: string };

beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  const projects = t.app.get(ProjectsService);
  await projects.create({ name: 'web' });
  await projects.ensureSharedProject();
  const alice = await signIn(t, { login: 'alice' });
  token = alice.auth;
  const { token: cookie } = await t.app.get(SessionService).create(alice.userId);
  session = { Cookie: `senv_session=${cookie}`, Origin: TEST_APP_URL };
  other = (await signIn(t, { login: 'bob' })).auth;
});
afterAll(() => t.close());

const registerDevice = async (name = 'alice-mbp') =>
  (await t.http().post('/api/v1/agent/devices').set(token).send({ name })).body.id as string;

const createLink = (deviceId: string, path = '/Users/alice/work/web') =>
  t.http().post('/api/v1/me/local-links').set(session).send({ deviceId, project: 'web', path });

describe('에이전트 API는 CLI 토큰으로만 부른다 (결정 61)', () => {
  it('기기 등록·연결 조회·승인을 대시보드 세션으로 부르면 403', async () => {
    const deviceId = await registerDevice();
    const linkId = (await createLink(deviceId)).body.id;

    for (const request of [
      () => t.http().post('/api/v1/agent/devices').set(session).send({ name: 'x' }),
      () => t.http().get(`/api/v1/agent/devices/${deviceId}/links`).set(session),
      () => t.http().post(`/api/v1/agent/links/${linkId}/approve`).set(session),
      () =>
        t.http().post(`/api/v1/agent/links/${linkId}/report`).set(session).send({ state: 'ok' }),
    ]) {
      const response = await request();
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('cli_token_required');
    }
  });

  it('토큰으로 기기를 등록하고, 대시보드에서 만든 연결을 승인하고, 결과를 보고한다', async () => {
    const deviceId = await registerDevice();
    const created = await createLink(deviceId);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'pending', project: 'web' });

    const links = await t.http().get(`/api/v1/agent/devices/${deviceId}/links`).set(token);
    expect(links.status).toBe(200);
    expect(links.body.links).toHaveLength(1);

    const approved = await t
      .http()
      .post(`/api/v1/agent/links/${created.body.id}/approve`)
      .set(token);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('active');

    const reported = await t
      .http()
      .post(`/api/v1/agent/links/${created.body.id}/report`)
      .set(token)
      .send({ state: 'ok', written: { version: 1, sharedVersion: 0 } });
    expect(reported.status).toBe(200);
    expect(reported.body.lastWritten).toMatchObject({ version: 1, sharedVersion: 0 });
  });

  it('PC에서 만든 연결은 바로 활성이고, 거절하면 지운다', async () => {
    const deviceId = await registerDevice();
    const added = await t
      .http()
      .post(`/api/v1/agent/devices/${deviceId}/links`)
      .set(token)
      .send({ project: 'web', path: '/Users/alice/work/web' });
    expect(added.status).toBe(201);
    expect(added.body.status).toBe('active');

    const pending = await createLink(deviceId, '/Users/alice/other');
    expect(
      (await t.http().post(`/api/v1/agent/links/${pending.body.id}/reject`).set(token)).status,
    ).toBe(204);
    const list = await t.http().get('/api/v1/me/local-links').set(session);
    expect(list.body.links.map((l: { id: string }) => l.id)).toEqual([added.body.id]);
  });

  it('보고 상태는 정해진 이름만 받고, 활성이 아닌 연결의 보고는 409', async () => {
    const deviceId = await registerDevice();
    const created = await createLink(deviceId);
    const report = (body: object) =>
      t.http().post(`/api/v1/agent/links/${created.body.id}/report`).set(token).send(body);

    expect((await report({ state: 'rm -rf' })).status).toBe(400);
    const notActive = await report({ state: 'ok' });
    expect(notActive.status).toBe(409);
    expect(notActive.body.code).toBe('local_link_not_active');
  });
});

describe('대시보드 API', () => {
  it('내 기기와 연결을 보고, 일시정지·덮어쓰기 요청·삭제를 한다', async () => {
    const deviceId = await registerDevice();
    const { id } = (await createLink(deviceId)).body;

    const devices = await t.http().get('/api/v1/me/devices').set(session);
    expect(devices.body.devices).toEqual([
      expect.objectContaining({ id: deviceId, name: 'alice-mbp', lastSeenAt: null }),
    ]);

    const paused = await t
      .http()
      .patch(`/api/v1/me/local-links/${id}`)
      .set(session)
      .send({ paused: true });
    expect(paused.body.status).toBe('paused');
    const overwrite = await t.http().post(`/api/v1/me/local-links/${id}/overwrite`).set(session);
    expect(overwrite.body.overwriteRequested).toBe(true);

    expect((await t.http().delete(`/api/v1/me/local-links/${id}`).set(session)).status).toBe(204);
    expect((await t.http().delete(`/api/v1/me/devices/${deviceId}`).set(session)).status).toBe(204);
    expect((await t.http().get('/api/v1/me/devices').set(session)).body.devices).toEqual([]);
  });

  it('남의 기기·연결은 404, 잘못된 경로와 공유 그룹은 422, 같은 경로는 409', async () => {
    const deviceId = await registerDevice();
    const { id } = (await createLink(deviceId)).body;

    const othersDevice = await t
      .http()
      .post('/api/v1/me/local-links')
      .set(other)
      .send({ deviceId, project: 'web', path: '/x' });
    expect(othersDevice.status).toBe(404);
    expect(othersDevice.body.code).toBe('device_not_found');
    const othersLink = await t.http().delete(`/api/v1/me/local-links/${id}`).set(other);
    expect(othersLink.body.code).toBe('local_link_not_found');

    const relative = await createLink(deviceId, 'work/web');
    expect(relative.status).toBe(422);
    expect(relative.body.code).toBe('invalid_local_path');
    const shared = await t
      .http()
      .post('/api/v1/me/local-links')
      .set(session)
      .send({ deviceId, project: 'shared', path: '/s' });
    expect(shared.body.code).toBe('shared_group_not_linkable');
    const duplicate = await createLink(deviceId);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('local_link_exists');
  });
});
