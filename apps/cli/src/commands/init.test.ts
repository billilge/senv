import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SenvApiError } from '@senv/api-client';
import { describe, expect, it } from 'vitest';
import type { Choice } from '../context.js';
import { isGitIgnored } from '../files/gitignore.js';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { makeTempDir } from '../testing/temp-dir.js';
import { AlreadyInitializedError, init } from './init.js';

const project = (name: string, kind = 'app') => ({
  name,
  displayName: `${name} 앱`,
  kind,
  environments: ['local', 'development', 'production'],
});

async function repo() {
  const dir = await makeTempDir();
  await promisify(execFile)('git', ['init', '-q'], { cwd: dir });
  return dir;
}

async function setup(api: FakeApi) {
  const cwd = await repo();
  const test = await createTestContext(api, { cwd });
  await signedIn(test.credentials);
  return { ...test, cwd };
}

const readConfig = async (dir: string) =>
  JSON.parse(await readFile(join(dir, 'senv.json'), 'utf8'));

describe('senv init', () => {
  it('--project로 senv.json을 만들고 출력 파일을 .gitignore에 넣는다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/projects/web', {
      status: 200,
      body: project('web'),
    });
    const { context, cwd, logs } = await setup(api);

    await init(context, { project: 'web' });

    expect(await readConfig(cwd)).toEqual({
      project: 'web',
      defaultEnv: 'local',
      output: '.env.local',
      format: 'dotenv',
    });
    expect(await isGitIgnored(cwd, '.env.local')).toBe(true);
    expect(logs.info.join('\n')).toContain('.gitignore');
  });

  it('--env, --output을 반영한다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/projects/web', {
      status: 200,
      body: project('web'),
    });
    const { context, cwd } = await setup(api);
    await init(context, { project: 'web', env: 'development', output: '.env' });
    expect(await readConfig(cwd)).toMatchObject({ defaultEnv: 'development', output: '.env' });
  });

  it('프로젝트를 주지 않으면 서버의 프로젝트 목록(공유 그룹 포함)에서 고르게 한다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/projects', {
        status: 200,
        body: { projects: [project('server'), project('web')] },
      })
      .reply('GET', '/api/v1/projects/shared', { status: 200, body: project('shared', 'shared') });
    const { context, cwd } = await setup(api);
    let offered: Choice<string>[] = [];
    context.prompt = {
      select: async <T>(_message: string, choices: Choice<T>[]) => {
        offered = choices as Choice<string>[];
        return 'web' as T;
      },
    };

    await init(context);

    expect(offered.map((choice) => choice.value)).toEqual(['server', 'web', 'shared']);
    expect((await readConfig(cwd)).project).toBe('web');
  });

  it('서버에 없는 프로젝트면 senv.json을 만들지 않고 오류를 낸다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/projects/ghost', {
      status: 404,
      body: { code: 'project_not_found', message: '프로젝트가 없습니다: ghost' },
    });
    const { context, cwd } = await setup(api);
    await expect(init(context, { project: 'ghost' })).rejects.toThrow(SenvApiError);
    await expect(readFile(join(cwd, 'senv.json'))).rejects.toThrow();
  });

  it('이미 senv.json이 있으면 덮어쓰지 않고, --force면 덮어쓴다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/projects/web', {
      status: 200,
      body: project('web'),
    });
    const { context, cwd } = await setup(api);
    await writeFile(join(cwd, 'senv.json'), '{"project":"old"}');

    await expect(init(context, { project: 'web' })).rejects.toThrow(AlreadyInitializedError);
    expect((await readConfig(cwd)).project).toBe('old');

    await init(context, { project: 'web', force: true });
    expect((await readConfig(cwd)).project).toBe('web');
  });

  it('출력 파일이 이미 무시되고 있으면 .gitignore를 건드리지 않는다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/projects/web', {
      status: 200,
      body: project('web'),
    });
    const { context, cwd } = await setup(api);
    await writeFile(join(cwd, '.gitignore'), '.env*\n');
    await init(context, { project: 'web' });
    expect(await readFile(join(cwd, '.gitignore'), 'utf8')).toBe('.env*\n');
  });
});
