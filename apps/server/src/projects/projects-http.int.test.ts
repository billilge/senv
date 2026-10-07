// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotService } from '../snapshots/snapshot-service.js';
import { createTestApp, signIn, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';
import { forceCurrentVersion } from '../testing/versions.js';
import { ProjectsService } from './projects-service.js';

let t: TestApp;
let admin: { Authorization: string };
let member: { Authorization: string };

beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  await t.app.get(ProjectsService).ensureSharedProject();
  admin = (await signIn(t, { login: 'admin', role: 'admin' })).auth;
  member = (await signIn(t, { login: 'bob' })).auth;
});
afterAll(() => t.close());

const createProject = (name: string, auth = admin) =>
  t
    .http()
    .post('/api/v1/projects')
    .set(auth)
    .send({ name, displayName: `${name} 앱` });

const publish = (project: string, env: string, body: Record<string, unknown>, auth = member) =>
  t.http().post(`/api/v1/projects/${project}/envs/${env}/versions`).set(auth).send(body);

describe('프로젝트 API', () => {
  it('관리자는 프로젝트를 만들고(201), 목록과 상세에서 볼 수 있다', async () => {
    const created = await createProject('web');
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      name: 'web',
      displayName: 'web 앱',
      kind: 'app',
      environments: ['local', 'development', 'production'],
    });

    const list = await t.http().get('/api/v1/projects').set(member);
    expect(list.body).toEqual({ projects: [created.body] });
    expect((await t.http().get('/api/v1/projects/web').set(member)).body.name).toBe('web');
    expect((await t.http().get('/api/v1/projects/shared').set(member)).body.kind).toBe('shared');
  });

  it('멤버는 프로젝트를 만들 수 없다 (403 admin_required)', async () => {
    const response = await createProject('web', member);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('admin_required');
  });

  it('이름이 틀리면 422, 이미 있으면 409다', async () => {
    expect((await createProject('Web')).body.code).toBe('invalid_project_name');
    await createProject('web');
    const taken = await createProject('web');
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('project_name_taken');
  });

  it('없는 프로젝트는 404 project_not_found다', async () => {
    const response = await t.http().get('/api/v1/projects/ghost').set(member);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('project_not_found');
  });

  it('승인 대기 사용자는 프로젝트를 볼 수 없다 (403 approval_pending)', async () => {
    const pending = await signIn(t, { login: 'newbie', status: 'pending' });
    const response = await t.http().get('/api/v1/projects').set(pending.auth);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('approval_pending');
  });
});

describe('게시와 값 조회 API', () => {
  beforeEach(async () => {
    await createProject('web');
  });

  it('게시하면 201과 새 버전·diff를 주고, 편집용 값과 pull용 값을 각각 조회할 수 있다', async () => {
    await publish('shared', 'production', {
      baseVersion: 0,
      changes: { set: { API_HOST: 'api.stream.dev' } },
    });
    const published = await publish('web', 'production', {
      baseVersion: 0,
      changes: { set: { VITE_API_URL: 'https://${shared.API_HOST}', VITE_MODE: 'prod' } },
      message: '첫 게시',
    });
    expect(published.status).toBe(201);
    expect(published.body).toEqual({
      version: 1,
      diff: { added: ['VITE_API_URL', 'VITE_MODE'], removed: [], changed: [], unchanged: [] },
    });

    const editing = await t.http().get('/api/v1/projects/web/envs/production').set(member);
    expect(editing.body).toEqual({
      project: 'web',
      env: 'production',
      version: 1,
      variables: { VITE_API_URL: 'https://${shared.API_HOST}', VITE_MODE: 'prod' },
    });

    const pulled = await t.http().get('/api/v1/projects/web/envs/production/variables').set(member);
    expect(pulled.body).toEqual({
      project: 'web',
      env: 'production',
      version: 1,
      sharedVersion: 1,
      variables: { VITE_API_URL: 'https://api.stream.dev', VITE_MODE: 'prod' },
    });
  });

  it('기준 버전이 다르면 409 version_conflict이고 현재 버전을 알려준다', async () => {
    await publish('web', 'local', { baseVersion: 0, changes: { set: { A: '1' } } });
    const response = await publish('web', 'local', {
      baseVersion: 0,
      changes: { set: { A: '2' } },
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'version_conflict',
      details: { baseVersion: 0, currentVersion: 1 },
    });
  });

  it('검증에 실패하면 422 publish_validation이고 문제 목록을 준다', async () => {
    const response = await publish('web', 'local', {
      baseVersion: 0,
      changes: { set: { bad_key: '1' } },
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'publish_validation',
      details: { issues: [{ code: 'invalid_key_name', key: 'bad_key' }] },
    });
  });

  it('바뀐 값이 없으면 422 no_changes다', async () => {
    const response = await publish('web', 'local', { baseVersion: 0, changes: {} });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('no_changes');
  });

  it.each([
    ['값이 문자열이 아님', { baseVersion: 0, changes: { set: { A: 1 } } }, 'changes.set.A'],
    ['기준 버전이 음수', { baseVersion: -1, changes: {} }, 'baseVersion'],
    ['remove가 배열이 아님', { baseVersion: 0, changes: { remove: 'A' } }, 'changes.remove'],
  ])(
    '요청 형식이 틀리면(%s) 400 invalid_request이고 위치(%s)를 알려준다',
    async (_label, body, path) => {
      const response = await publish('web', 'local', body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('invalid_request');
      expect(response.body.details.issues.map((issue: { path: string }) => issue.path)).toContain(
        path,
      );
    },
  );

  it('고정 환경이 아니면 400 invalid_environment다', async () => {
    const response = await t.http().get('/api/v1/projects/web/envs/staging/variables').set(member);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('invalid_environment');
  });

  it('공유 참조가 깨져 있으면 pull용 조회는 409 broken_reference다', async () => {
    await forceCurrentVersion(
      t.prisma,
      t.app.get(SnapshotService),
      { project: 'web', env: 'local', version: 1 },
      { URL: '${shared.GONE}' },
    );
    const response = await t.http().get('/api/v1/projects/web/envs/local/variables').set(member);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('broken_reference');
  });

  it('인증 없이는 값을 볼 수 없다', async () => {
    const response = await t.http().get('/api/v1/projects/web/envs/local/variables');
    expect(response.status).toBe(401);
  });
});
