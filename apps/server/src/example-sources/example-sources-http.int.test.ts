import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProjectsService } from '../projects/projects-service.js';
import { createTestApp, signIn, TEST_WEBHOOK_SECRET, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';

let t: TestApp;
let admin: { Authorization: string };
let member: { Authorization: string };

const REPO = { id: 2_200_000_001, fullName: 'billilge/stream-web', installationId: 77 };
const SOURCE = '/api/v1/projects/web/example-source';

beforeAll(async () => {
  t = await createTestApp();
  t.githubApp.addRepository(REPO);
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  const projects = t.app.get(ProjectsService);
  await projects.create({ name: 'web' });
  await projects.ensureSharedProject();
  admin = (await signIn(t, { login: 'admin1', role: 'admin' })).auth;
  member = (await signIn(t, { login: 'bob' })).auth;
  t.githubApp.setFile(REPO.fullName, '.env.example', '# 캐시\nREDIS_URL=\n');
});
afterAll(() => t.close());

const linkWeb = () =>
  t.http().put(SOURCE).set(admin).send({ repoId: REPO.id, path: '.env.example' });
const schemaKeys = async () =>
  (await t.http().get('/api/v1/projects/web/schema').set(member)).body.keys.map(
    (entry: { key: string }) => entry.key,
  );

/** GitHub처럼 본문 바이트에 서명해 웹훅을 보낸다 */
function deliver(event: string, payload: unknown, secret: string | null = TEST_WEBHOOK_SECRET) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const request = t
    .http()
    .post('/api/v1/github/webhook')
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', event);
  if (secret !== null) {
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    request.set('X-Hub-Signature-256', `sha256=${signature}`);
  }
  return request.send(body);
}

const push = (ref = 'refs/heads/main') => ({
  ref,
  repository: { id: REPO.id, full_name: REPO.fullName, default_branch: 'main' },
  installation: { id: REPO.installationId },
  sender: { login: 'alice' },
});

describe('.env.example 연결 API (결정 73~76)', () => {
  it('관리자가 저장소를 연결하면 바로 키를 등록하고, 멤버는 상태를 보고 지금 확인한다', async () => {
    expect((await t.http().get('/api/v1/github/repositories').set(member)).status).toBe(403);
    const repositories = await t.http().get('/api/v1/github/repositories').set(admin);
    expect(repositories.body).toEqual({
      repositories: [{ id: REPO.id, fullName: REPO.fullName }],
    });

    expect((await t.http().get(SOURCE).set(member)).body).toEqual({
      enabled: true,
      installUrl: 'https://github.com/apps/senv-test/installations/new',
      source: null,
    });

    const forbidden = await t
      .http()
      .put(SOURCE)
      .set(member)
      .send({ repoId: REPO.id, path: '.env.example' });
    expect(forbidden.status).toBe(403);
    const linked = await linkWeb();
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({
      repoId: REPO.id,
      repoFullName: REPO.fullName,
      path: '.env.example',
      lastResult: 'ok',
      lastAdded: ['REDIS_URL'],
      lastCheckedAt: expect.any(String),
    });
    expect(await schemaKeys()).toEqual(['REDIS_URL']);

    t.githubApp.setFile(REPO.fullName, '.env.example', 'REDIS_URL=\nNEW_KEY=\n');
    const checked = await t.http().post(`${SOURCE}/check`).set(member);
    expect(checked.status).toBe(200);
    expect(checked.body).toMatchObject({ lastAdded: ['NEW_KEY'] });
    expect((await t.http().get(SOURCE).set(member)).body.source).toMatchObject({
      keys: ['NEW_KEY', 'REDIS_URL'],
    });

    expect((await t.http().delete(SOURCE).set(member)).status).toBe(403);
    expect((await t.http().delete(SOURCE).set(admin)).status).toBe(204);
    expect((await t.http().get(SOURCE).set(member)).body.source).toBeNull();
  });

  it('연결할 수 없으면 이유를 알린다', async () => {
    const put = (body: object, project = 'web') =>
      t.http().put(`/api/v1/projects/${project}/example-source`).set(admin).send(body);

    expect((await put({ repoId: REPO.id, path: '../x' })).body.code).toBe('invalid_example_path');
    expect((await put({ repoId: 1, path: '.env.example' })).body.code).toBe(
      'repository_not_installed',
    );
    expect((await put({ repoId: REPO.id, path: 'nope/.env.example' })).body).toMatchObject({
      code: 'example_not_found',
    });
    expect((await put({ repoId: REPO.id, path: '.env.example' }, 'shared')).body.code).toBe(
      'shared_group_no_example',
    );
    expect((await put({ repoId: 'x', path: '.env.example' })).status).toBe(400);
    const check = await t.http().post(`${SOURCE}/check`).set(member);
    expect(check.status).toBe(404);
    expect(check.body.code).toBe('example_source_not_found');
  });
});

describe('GitHub 웹훅', () => {
  it('서명이 맞는 기본 브랜치 push면 연결된 프로젝트를 확인하고, 등록한 사람은 푸시한 사람이다', async () => {
    await linkWeb();
    t.githubApp.setFile(REPO.fullName, '.env.example', 'REDIS_URL=\nNEW_KEY=\n');

    const response = await deliver('push', push());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ checked: 1 });
    expect(await schemaKeys()).toEqual(['NEW_KEY', 'REDIS_URL']);
    const row = await t.prisma.keySchema.findFirstOrThrow({ where: { key: 'NEW_KEY' } });
    expect(row.updatedBy).toBe('github:alice');
  });

  it('서명이 없거나 틀리면 401이고 아무것도 하지 않는다', async () => {
    await linkWeb();
    t.githubApp.setFile(REPO.fullName, '.env.example', 'REDIS_URL=\nNEW_KEY=\n');

    for (const secret of [null, 'wrong-secret']) {
      const response = await deliver('push', push(), secret);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('invalid_signature');
    }
    expect(await schemaKeys()).toEqual(['REDIS_URL']);
  });

  it('push가 아닌 이벤트와 기본 브랜치가 아닌 push는 받기만 한다', async () => {
    await linkWeb();
    expect((await deliver('ping', { zen: 'hi' })).body).toEqual({ checked: 0 });
    expect((await deliver('push', push('refs/heads/feature'))).body).toEqual({ checked: 0 });
  });

  it('웹훅 본문은 다른 API보다 큰 5MB까지 받는다', async () => {
    await linkWeb();
    const commits = 'x'.repeat(1024 * 1024);
    expect((await deliver('push', { ...push(), commits })).body).toEqual({ checked: 1 });

    const tooLarge = await deliver('push', { ...push(), commits: 'x'.repeat(6 * 1024 * 1024) });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.code).toBe('payload_too_large');
  });
});

describe('GitHub App 설정이 없을 때', () => {
  let off: TestApp;
  beforeAll(async () => {
    off = await createTestApp({ githubApp: false });
  });
  afterAll(() => off.close());

  it('상태 조회는 enabled: false이고, 저장소 목록·연결·확인·웹훅은 404 github_app_disabled다', async () => {
    const auth = (await signIn(off, { role: 'admin' })).auth;
    expect((await off.http().get(SOURCE).set(auth)).body).toEqual({
      enabled: false,
      installUrl: null,
      source: null,
    });
    for (const request of [
      () => off.http().get('/api/v1/github/repositories').set(auth),
      () => off.http().put(SOURCE).set(auth).send({ repoId: REPO.id, path: '.env.example' }),
      () => off.http().post(`${SOURCE}/check`).set(auth),
      () =>
        off
          .http()
          .post('/api/v1/github/webhook')
          .set('X-GitHub-Event', 'push')
          .set('Content-Type', 'application/json')
          .send('{}'),
    ]) {
      const response = await request();
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('github_app_disabled');
    }
  });
});
