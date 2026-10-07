// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { describe, expect, it } from 'vitest';
import { initialMockState, MockServer, type MockState } from './mock-server';

function setup(state: Partial<MockState> = {}) {
  const saved: MockState[] = [];
  const server = new MockServer({ ...initialMockState(), ...state }, (next) => saved.push(next));
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await server.fetch(
      new Request(`http://localhost:5173${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { server, call, saved };
}

describe('목업 서버', () => {
  it('고른 역할의 사용자로 로그인한 상태를 흉내 낸다', async () => {
    expect((await setup({ persona: 'admin' }).call('GET', '/api/v1/me')).body).toMatchObject({
      role: 'admin',
      status: 'active',
    });
    expect((await setup({ persona: 'member' }).call('GET', '/api/v1/me')).body).toMatchObject({
      role: 'member',
      status: 'active',
    });
    expect((await setup({ persona: 'pending' }).call('GET', '/api/v1/me')).body).toMatchObject({
      status: 'pending',
    });
    expect((await setup({ persona: 'signed-out' }).call('GET', '/api/v1/me')).status).toBe(401);
  });

  it('로그아웃하면 로그아웃 상태가 되고, 다시 로그인하면 전 역할로 돌아간다', async () => {
    const { server, call, saved } = setup({ persona: 'member' });
    expect((await call('POST', '/api/v1/auth/logout')).status).toBe(204);
    expect((await call('GET', '/api/v1/me')).status).toBe(401);
    expect(saved.at(-1)?.persona).toBe('signed-out');

    server.signIn();
    expect((await call('GET', '/api/v1/me')).body).toMatchObject({ role: 'member' });
  });

  it('게시하면 변경을 적용하고 버전을 올린다. 기준 버전이 낡았으면 409', async () => {
    const { call } = setup();
    const before = (await call('GET', '/api/v1/projects/server/envs/local')).body;

    const published = await call('POST', '/api/v1/projects/server/envs/local/versions', {
      baseVersion: before.version,
      changes: { set: { NEW_KEY: 'v' }, remove: ['LOG_LEVEL'] },
    });
    expect(published).toMatchObject({
      status: 201,
      body: { version: before.version + 1, diff: { added: ['NEW_KEY'], removed: ['LOG_LEVEL'] } },
    });
    const after = (await call('GET', '/api/v1/projects/server/envs/local')).body;
    expect(after.variables).toMatchObject({ NEW_KEY: 'v' });
    expect(after.variables).not.toHaveProperty('LOG_LEVEL');

    const stale = await call('POST', '/api/v1/projects/server/envs/local/versions', {
      baseVersion: before.version,
      changes: { set: { OTHER: 'x' } },
    });
    expect(stale).toMatchObject({ status: 409, body: { code: 'version_conflict' } });
  });

  it('공유 그룹에 없는 참조나 바뀐 것 없는 게시는 422', async () => {
    const { call } = setup();
    const { version } = (await call('GET', '/api/v1/projects/web/envs/local')).body;

    expect(
      await call('POST', '/api/v1/projects/web/envs/local/versions', {
        baseVersion: version,
        changes: { set: { VITE_X: '${shared.NOPE}' } },
      }),
    ).toMatchObject({
      status: 422,
      body: {
        code: 'publish_validation',
        details: {
          issues: [{ code: 'missing_reference', key: 'VITE_X', reference: '${shared.NOPE}' }],
        },
      },
    });
    expect(
      await call('POST', '/api/v1/projects/web/envs/local/versions', {
        baseVersion: version,
        changes: {},
      }),
    ).toMatchObject({ status: 422, body: { code: 'no_changes' } });
  });

  it('사용자 관리는 관리자만, 자기 비활성화와 마지막 관리자 강등은 막는다', async () => {
    expect((await setup({ persona: 'member' }).call('GET', '/api/v1/users')).status).toBe(403);

    const { call } = setup({ persona: 'admin' });
    const { users } = (await call('GET', '/api/v1/users')).body;
    expect(users[0].status).toBe('pending');
    const me = (await call('GET', '/api/v1/me')).body;

    expect((await call('POST', `/api/v1/users/${me.id}/disable`)).body).toMatchObject({
      code: 'cannot_disable_self',
    });
    expect(
      (await call('PUT', `/api/v1/users/${me.id}/role`, { role: 'member' })).body,
    ).toMatchObject({ code: 'last_admin' });
    expect((await call('POST', `/api/v1/users/${users[0].id}/activate`)).body).toMatchObject({
      status: 'active',
    });
  });

  it('프로젝트 목록에는 서버처럼 공유 그룹을 넣지 않는다', async () => {
    const { projects } = (await setup().call('GET', '/api/v1/projects')).body;
    expect(projects.map((p: { name: string }) => p.name)).toEqual(['app', 'server', 'web']);
  });

  it('새 프로젝트를 만들면 세 환경이 비어 있는 채로 생긴다', async () => {
    const { call } = setup();
    expect(await call('POST', '/api/v1/projects', { name: 'admin-web' })).toMatchObject({
      status: 201,
      body: { name: 'admin-web', environments: ['local', 'development', 'production'] },
    });
    expect((await call('GET', '/api/v1/projects/admin-web/envs/production')).body).toMatchObject({
      version: 0,
      variables: {},
    });
    expect((await call('POST', '/api/v1/projects', { name: 'Bad' })).body).toMatchObject({
      code: 'invalid_project_name',
    });
    expect((await call('POST', '/api/v1/projects', { name: 'server' })).body).toMatchObject({
      code: 'project_name_taken',
    });
  });

  it('버전 기록을 최신부터 작성자와 함께 주고, 지난 버전의 값을 준다', async () => {
    const { call } = setup();
    const { versions } = (await call('GET', '/api/v1/projects/server/envs/local/versions')).body;
    const current = (await call('GET', '/api/v1/projects/server/envs/local')).body;

    expect(versions[0]).toMatchObject({
      version: current.version,
      author: { login: expect.any(String) },
    });
    expect(versions.map((v: { version: number }) => v.version)).toEqual(
      Array.from({ length: current.version }, (_, i) => current.version - i),
    );
    expect((await call('GET', '/api/v1/projects/server/envs/local/versions/1')).body).toMatchObject(
      {
        version: 1,
        variables: expect.any(Object),
      },
    );
    expect(
      (await call('GET', '/api/v1/projects/server/envs/local/versions/99')).body,
    ).toMatchObject({
      code: 'version_not_found',
    });
  });

  it('게시하면 기록에 남고, 되돌리면 지난 버전의 값으로 새 버전을 만든다', async () => {
    const { call } = setup();
    const before = (await call('GET', '/api/v1/projects/server/envs/local')).body;
    await call('POST', '/api/v1/projects/server/envs/local/versions', {
      baseVersion: before.version,
      changes: { set: { NEW_KEY: 'v' } },
      message: '새 키',
    });
    const [latest] = (await call('GET', '/api/v1/projects/server/envs/local/versions')).body
      .versions;
    expect(latest).toMatchObject({
      version: before.version + 1,
      message: '새 키',
      author: { login: 'alice' },
    });

    const rolled = await call('POST', '/api/v1/projects/server/envs/local/rollback', {
      toVersion: before.version,
      baseVersion: before.version + 1,
    });
    expect(rolled).toMatchObject({ status: 201, body: { version: before.version + 2 } });
    expect((await call('GET', '/api/v1/projects/server/envs/local')).body.variables).toEqual(
      before.variables,
    );
    const [rollback] = (await call('GET', '/api/v1/projects/server/envs/local/versions')).body
      .versions;
    expect(rollback.message).toMatch(/로 되돌림$/);
  });

  it('키 스키마를 주고, 멤버는 키를 고치고 지우며 공개 접두사는 관리자만 바꾼다', async () => {
    const { call } = setup({ persona: 'member' });
    const schema = (await call('GET', '/api/v1/projects/web/schema')).body;
    expect(schema.publicPrefixes).toEqual(['VITE_']);

    expect(
      (await call('PUT', '/api/v1/projects/web/schema/keys/NEW_KEY', { type: 'number' })).body,
    ).toMatchObject({ key: 'NEW_KEY', type: 'number', visibility: 'secret', required: false });
    expect((await call('DELETE', '/api/v1/projects/web/schema/keys/NEW_KEY')).status).toBe(204);
    expect((await call('PUT', '/api/v1/projects/web/schema/keys/bad-key', {})).body).toMatchObject({
      code: 'invalid_key_name',
    });
    expect(
      (await call('PUT', '/api/v1/projects/web/schema/public-prefixes', { publicPrefixes: [] }))
        .status,
    ).toBe(403);
  });

  it('게시할 때 키 스키마의 필수·타입을 검사한다', async () => {
    const { call } = setup();
    await call('PUT', '/api/v1/projects/app/schema/keys/EXPO_PUBLIC_API_URL', {
      type: 'url',
      required: true,
    });
    expect(
      await call('POST', '/api/v1/projects/app/envs/local/versions', {
        baseVersion: 0,
        changes: { set: { OTHER: 'x' } },
      }),
    ).toMatchObject({
      status: 422,
      body: { details: { issues: [{ code: 'missing_required', key: 'EXPO_PUBLIC_API_URL' }] } },
    });
    expect(
      await call('POST', '/api/v1/projects/app/envs/local/versions', {
        baseVersion: 0,
        changes: { set: { EXPO_PUBLIC_API_URL: 'not a url' } },
      }),
    ).toMatchObject({
      status: 422,
      body: {
        details: {
          issues: [{ code: 'invalid_type', key: 'EXPO_PUBLIC_API_URL', expected: 'url' }],
        },
      },
    });
  });

  it('include=summary면 프로젝트마다 환경별 버전과 누락 칸 수를 담는다', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/v1/projects')).body.projects[0].summary).toBeUndefined();

    const { projects } = (await call('GET', '/api/v1/projects?include=summary')).body;
    const server = projects.find((p: { name: string }) => p.name === 'server');
    expect(server.summary.environments.map((e: { env: string }) => e.env)).toEqual([
      'local',
      'development',
      'production',
    ]);
    // server production에는 REDIS_URL이 없다 (필수지만 production은 예외)
    expect(server.summary).toMatchObject({ missing: 1, missingRequired: 0 });
  });

  it('관리자는 역할을 미리 지정하고 지운다. 이미 있는 사용자는 409다', async () => {
    const { call } = setup();
    expect(
      (await call('PUT', '/api/v1/role-assignments/Erin', { role: 'admin' })).body,
    ).toMatchObject({
      login: 'erin',
      role: 'admin',
    });
    expect((await call('GET', '/api/v1/role-assignments')).body.assignments).toHaveLength(1);
    expect((await call('PUT', '/api/v1/role-assignments/bob', { role: 'admin' })).status).toBe(409);
    expect((await call('DELETE', '/api/v1/role-assignments/erin')).status).toBe(204);
    expect(
      (await setup({ persona: 'member' }).call('GET', '/api/v1/role-assignments')).status,
    ).toBe(403);
  });

  it('배포 대상: 제공자·연결·매핑을 주고, 연결 토큰이 틀리면 422다', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/v1/targets/providers')).body.providers[0]).toMatchObject({
      type: 'coolify',
    });
    expect((await call('GET', '/api/v1/targets/connections')).body.connections).toHaveLength(1);
    expect((await call('GET', '/api/v1/projects/server/targets')).body.mappings[0]).toMatchObject({
      env: 'production',
      resourceName: 'stream-api-prod',
    });
    const bad = await call('POST', '/api/v1/targets/connections', {
      name: 'x',
      type: 'coolify',
      config: { url: 'https://c', token: 'bad' },
    });
    expect(bad).toMatchObject({ status: 422, body: { code: 'target_auth_failed' } });
  });

  it('계획을 보고 동기화하면 원격에 반영되고, 다시 보면 바뀐 것이 없다', async () => {
    const { call } = setup();
    const [mapping] = (await call('GET', '/api/v1/projects/server/targets')).body.mappings;
    const plan = (await call('GET', `/api/v1/targets/mappings/${mapping.id}/plan`)).body;
    expect(plan.add.length + plan.change.length + plan.remove.length).toBeGreaterThan(0);

    const run = (await call('POST', `/api/v1/targets/mappings/${mapping.id}/sync`)).body;
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'manual' });
    expect((await call('GET', `/api/v1/targets/mappings/${mapping.id}/plan`)).body).toMatchObject({
      add: [],
      change: [],
      remove: [],
    });
    expect(
      (await call('GET', `/api/v1/targets/mappings/${mapping.id}/runs`)).body.runs[0],
    ).toMatchObject({ id: run.id });
  });

  it('게시하면 자동 매핑에 바로 반영한다 (worker 흉내)', async () => {
    const { call } = setup();
    const [mapping] = (await call('GET', '/api/v1/projects/server/targets')).body.mappings;
    await call('POST', `/api/v1/targets/mappings/${mapping.id}/sync`);
    const { version } = (await call('GET', '/api/v1/projects/server/envs/production')).body;
    await call('POST', '/api/v1/projects/server/envs/production/versions', {
      baseVersion: version,
      changes: { set: { LOG_LEVEL: 'warn' } },
    });

    const [latest] = (await call('GET', `/api/v1/targets/mappings/${mapping.id}/runs`)).body.runs;
    expect(latest).toMatchObject({ trigger: 'publish', changedKeys: ['LOG_LEVEL'] });
  });
});
