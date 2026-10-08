import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDotenv, parseProperties } from '@senv/core';
import { describe, expect, it } from 'vitest';
import type { Prompt } from '../context.js';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { delivered, webRepo } from '../testing/repo.js';
import { AgentStateStore, runAgentCycle } from './agent.js';

const VARIABLES = { API_URL: 'http://localhost:3000', MODE: 'dev' };
const AT = '2026-10-09T09:00:00.000Z';

function linkView(path: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    device: { id: 'd1', name: 'test-host' },
    project: 'web',
    path,
    status: 'active',
    approvedAt: AT,
    current: { version: 3, sharedVersion: 1 },
    lastWritten: null,
    lastState: null,
    overwriteRequested: false,
    createdAt: AT,
    ...overrides,
  };
}

/** 기기 d1로 등록된 상태의 가짜 서버. 연결 목록과 값, 보고를 받는다 */
function server(links: unknown[] | unknown[][], variables: Record<string, string> = VARIABLES) {
  const rounds = (Array.isArray(links[0]) ? links : [links]) as unknown[][];
  return new FakeApi()
    .reply('POST', '/api/v1/agent/devices', {
      status: 201,
      body: { id: 'd1', name: 'test-host', createdAt: AT, lastSeenAt: null },
    })
    .reply(
      'GET',
      '/api/v1/agent/devices/d1/links',
      ...rounds.map((round) => ({ status: 200, body: { links: round } })),
    )
    .reply('GET', '/api/v1/projects/web/envs/local/variables', delivered('local', variables))
    .on('POST', '/api/v1/agent/links/l1/report', (_request, body) => ({
      status: 200,
      body: { ...linkView('/x'), lastState: body },
    }))
    .reply('POST', '/api/v1/agent/links/l1/approve', { status: 200, body: linkView('/x') })
    .reply('POST', '/api/v1/agent/links/l1/reject', { status: 204 });
}

async function setup(api: FakeApi, answers: Partial<Prompt> = {}, interactive = false) {
  const test = await createTestContext(api, { interactive });
  await signedIn(test.credentials);
  test.context.prompt = { ...test.context.prompt, ...answers };
  return test;
}

const reports = (api: FakeApi) =>
  api.requests.filter((r) => r.path.endsWith('/report')).map((r) => r.body);
const fetchedValues = (api: FakeApi) =>
  api.requests.filter((r) => r.path.endsWith('/variables')).length;

describe('기기 등록', () => {
  it('처음 돌 때 호스트 이름으로 기기를 등록하고, 다음부터는 저장한 ID를 쓴다', async () => {
    const api = server([]);
    const { context } = await setup(api);

    await runAgentCycle(context);
    await runAgentCycle(context);

    const registrations = api.requests.filter((r) => r.path === '/api/v1/agent/devices');
    expect(registrations).toEqual([expect.objectContaining({ body: { name: 'test-host' } })]);
    expect((await new AgentStateStore(context.configDir).load()).deviceId).toBe('d1');
    expect((await stat(join(context.configDir, 'agent.json'))).mode & 0o777).toBe(0o600);
  });

  it('대시보드에서 기기를 지웠으면(404) 기록을 지우고 다음 주기에 다시 등록한다', async () => {
    const api = server([]);
    const { context } = await setup(api);
    await runAgentCycle(context);
    api.reply('GET', '/api/v1/agent/devices/d1/links', {
      status: 404,
      body: { code: 'device_not_found', message: '기기가 없습니다' },
    });

    await runAgentCycle(context);

    expect((await new AgentStateStore(context.configDir).load()).deviceId).toBeNull();
  });
});

describe('활성 연결', () => {
  it('폴더의 senv.json 출력 파일에 local 값을 쓰고(600, 머리글) 쓴 버전을 보고한다', async () => {
    const root = await webRepo();
    const api = server([linkView(root)]);
    const { context, logs } = await setup(api);

    await runAgentCycle(context);

    const path = join(root, '.env.local');
    const text = await readFile(path, 'utf8');
    expect(text.split('\n')[0]).toBe('# senv: web/local v3 (shared v1)');
    expect(parseDotenv(text)).toEqual(VARIABLES);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(reports(api)).toEqual([{ state: 'ok', written: { version: 3, sharedVersion: 1 } }]);
    expect(logs.info.join('\n')).toMatch(/web.*v3/);
  });

  it('format이 properties인 폴더는 .env.local.properties로 쓴다', async () => {
    const root = await webRepo({ project: 'web', format: 'properties' });
    const { context } = await setup(server([linkView(root)]));
    await runAgentCycle(context);
    expect(parseProperties(await readFile(join(root, '.env.local.properties'), 'utf8'))).toEqual(
      VARIABLES,
    );
  });

  it('이미 쓴 버전이면 값을 다시 받지 않고, 보고도 하지 않는다', async () => {
    const root = await webRepo();
    const first = linkView(root);
    const second = linkView(root, { lastState: { state: 'ok', message: null, at: AT } });
    const api = server([[first], [second]]);
    const { context } = await setup(api);

    await runAgentCycle(context);
    await runAgentCycle(context);

    expect(fetchedValues(api)).toBe(1);
    expect(reports(api)).toHaveLength(1);
  });

  it('새 버전이 게시되면 다시 쓴다', async () => {
    const root = await webRepo();
    const api = server([
      [linkView(root)],
      [linkView(root, { current: { version: 4, sharedVersion: 1 } })],
    ]);
    const { context } = await setup(api);

    await runAgentCycle(context);
    api.reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      delivered('local', { ...VARIABLES, MODE: 'v4' }, { version: 4 }),
    );
    await runAgentCycle(context);

    expect(parseDotenv(await readFile(join(root, '.env.local'), 'utf8')).MODE).toBe('v4');
  });

  it('쓴 뒤 직접 고친 파일은 덮어쓰지 않고 modified로 알린다. 덮어쓰기를 요청하면 쓴다', async () => {
    const root = await webRepo();
    const changed = { current: { version: 4, sharedVersion: 1 } };
    const api = server([
      [linkView(root)],
      [linkView(root, changed)],
      [linkView(root, { ...changed, overwriteRequested: true })],
    ]);
    const { context, logs } = await setup(api);

    await runAgentCycle(context);
    await writeFile(join(root, '.env.local'), 'MY_OWN=1\n');
    await runAgentCycle(context);
    expect(await readFile(join(root, '.env.local'), 'utf8')).toBe('MY_OWN=1\n');
    expect(reports(api)[1]).toMatchObject({ state: 'modified' });
    expect(logs.warn.join('\n')).toMatch(/직접 고친/);

    await runAgentCycle(context);
    expect(parseDotenv(await readFile(join(root, '.env.local'), 'utf8'))).toEqual(VARIABLES);
  });

  it('senv가 만들지 않은 기존 파일은 처음부터 덮어쓰지 않는다', async () => {
    const root = await webRepo();
    await writeFile(join(root, '.env.local'), 'LEGACY=1\n');
    const api = server([linkView(root)]);
    const { context } = await setup(api);

    await runAgentCycle(context);

    expect(await readFile(join(root, '.env.local'), 'utf8')).toBe('LEGACY=1\n');
    expect(reports(api)).toEqual([expect.objectContaining({ state: 'modified' })]);
  });

  it('지운 파일은 같은 버전이어도 다시 쓴다', async () => {
    const root = await webRepo();
    const api = server([
      [linkView(root)],
      [linkView(root, { lastState: { state: 'ok', message: null, at: AT } })],
    ]);
    const { context } = await setup(api);

    await runAgentCycle(context);
    await rm(join(root, '.env.local'));
    await runAgentCycle(context);

    expect(parseDotenv(await readFile(join(root, '.env.local'), 'utf8'))).toEqual(VARIABLES);
  });
});

describe('쓰지 않는 경우 (값을 받기 전에 검사한다)', () => {
  it.each([
    ['폴더가 없음', async () => '/nonexistent/senv-test/web', 'no_config'],
    [
      'senv.json이 없음 (상위 폴더의 senv.json은 보지 않는다)',
      async () => {
        const sub = join(await webRepo(), 'sub');
        await mkdir(sub);
        return sub;
      },
      'no_config',
    ],
    ['프로젝트가 다름', async () => webRepo({ project: 'api' }), 'project_mismatch'],
    [
      'git이 무시하지 않는 출력',
      async () => webRepo({ project: 'web', output: 'values.env' }),
      'not_ignored',
    ],
  ])('%s → %s', async (_label, folder, state) => {
    const path = await folder();
    const api = server([linkView(path)]);
    const { context } = await setup(api);

    await runAgentCycle(context);

    expect(fetchedValues(api)).toBe(0);
    expect(reports(api)).toEqual([expect.objectContaining({ state })]);
  });

  it('출력 파일이 심볼릭 링크면 symlink', async () => {
    const root = await webRepo();
    await symlink(join(root, 'senv.json'), join(root, '.env.local'));
    const api = server([linkView(root)]);
    const { context } = await setup(api);

    await runAgentCycle(context);

    expect(fetchedValues(api)).toBe(0);
    expect(reports(api)).toEqual([expect.objectContaining({ state: 'symlink' })]);
  });

  it('공개 접두사에 secret이 있으면 쓰지 않고 exposure, 다른 연결은 계속 처리한다', async () => {
    const root = await webRepo();
    const api = server([linkView(root)]).reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      delivered('local', VARIABLES, {
        exposure: { exposedSecrets: ['VITE_KEY'], unregistered: [] },
      }),
    );
    const { context } = await setup(api);

    await runAgentCycle(context);

    await expect(readFile(join(root, '.env.local'), 'utf8')).rejects.toThrow();
    expect(reports(api)).toEqual([expect.objectContaining({ state: 'exposure' })]);
  });

  it('일시정지한 연결은 건드리지 않는다', async () => {
    const root = await webRepo();
    const api = server([linkView(root, { status: 'paused' })]);
    const { context } = await setup(api);
    await runAgentCycle(context);
    expect(fetchedValues(api)).toBe(0);
    expect(reports(api)).toEqual([]);
  });
});

describe('승인 대기 연결 (결정 61)', () => {
  it('터미널이 아니면 승인하지 않고 senv link approve를 안내한다', async () => {
    const root = await webRepo();
    const api = server([linkView(root, { status: 'pending', approvedAt: null })]);
    const { context, logs } = await setup(api);

    await runAgentCycle(context);

    expect(api.requests.some((r) => r.path.endsWith('/approve'))).toBe(false);
    expect(fetchedValues(api)).toBe(0);
    expect(logs.warn.join('\n')).toContain('senv link approve l1');
  });

  it('터미널이면 경로와 파일을 보여주고 묻는다. 예면 승인하고 바로 쓴다', async () => {
    const root = await webRepo();
    const questions: string[] = [];
    const api = server([linkView(root, { status: 'pending', approvedAt: null })]).reply(
      'POST',
      '/api/v1/agent/links/l1/approve',
      { status: 200, body: linkView(root) },
    );
    const { context } = await setup(
      api,
      {
        confirm: async (message) => {
          questions.push(message);
          return true;
        },
      },
      true,
    );

    await runAgentCycle(context);

    expect(questions[0]).toContain(join(root, '.env.local'));
    expect(parseDotenv(await readFile(join(root, '.env.local'), 'utf8'))).toEqual(VARIABLES);
  });

  it('아니오면 거절해서 연결을 지운다', async () => {
    const root = await webRepo();
    const api = server([linkView(root, { status: 'pending', approvedAt: null })]);
    const { context } = await setup(api, { confirm: async () => false }, true);

    await runAgentCycle(context);

    expect(api.requests.some((r) => r.path.endsWith('/reject'))).toBe(true);
    expect(fetchedValues(api)).toBe(0);
  });
});
