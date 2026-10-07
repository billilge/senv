import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SenvApiError } from '@senv/api-client';
import { parseDotenv } from '@senv/core';
import { describe, expect, it } from 'vitest';
import { ProjectConfigNotFoundError } from '../config/project-config.js';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { makeTempDir } from '../testing/temp-dir.js';
import { OutputNotIgnoredError, pull } from './pull.js';

const values = (env: string, variables: Record<string, string>) => ({
  status: 200,
  body: { project: 'web', env, version: 3, sharedVersion: 1, variables },
});

/** senv.json과 .gitignore(.env*)가 있는 git 저장소 */
async function webRepo(config: Record<string, unknown> = { project: 'web' }) {
  const dir = await makeTempDir();
  await promisify(execFile)('git', ['init', '-q'], { cwd: dir });
  await writeFile(join(dir, 'senv.json'), JSON.stringify(config));
  await writeFile(join(dir, '.gitignore'), '.env*\n');
  return dir;
}

async function setup(api: FakeApi, cwd: string) {
  const test = await createTestContext(api, { cwd });
  await signedIn(test.credentials);
  return test;
}

describe('senv pull', () => {
  it('senv.json의 프로젝트·기본 환경 값을 받아 출력 파일에 쓴다 (헤더 포함, 권한 600)', async () => {
    const root = await webRepo();
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      values('local', { VITE_MODE: 'dev', API_URL: 'http://localhost:3000' }),
    );
    const { context, logs } = await setup(api, root);

    await pull(context);

    const path = join(root, '.env.local');
    const text = await readFile(path, 'utf8');
    expect(text.split('\n')[0]).toBe('# senv: web/local v3 (shared v1)');
    expect(parseDotenv(text)).toEqual({ VITE_MODE: 'dev', API_URL: 'http://localhost:3000' });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(logs.info.join('\n')).toContain('2개');
  });

  it('--env와 --output을 반영한다', async () => {
    const root = await webRepo();
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/development/variables',
      values('development', { A: '1' }),
    );
    const { context } = await setup(api, root);
    await pull(context, { env: 'development', output: '.env.development' });
    expect(parseDotenv(await readFile(join(root, '.env.development'), 'utf8'))).toEqual({ A: '1' });
  });

  it('하위 폴더에서 실행해도 senv.json이 있는 폴더 기준으로 쓴다', async () => {
    const root = await webRepo();
    const nested = join(root, 'src', 'pages');
    await mkdir(nested, { recursive: true });
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      values('local', { A: '1' }),
    );
    const { context } = await setup(api, nested);
    await pull(context);
    expect(parseDotenv(await readFile(join(root, '.env.local'), 'utf8'))).toEqual({ A: '1' });
  });

  it('출력 파일이 git에서 무시되지 않으면 쓰지 않고, --force면 쓴다', async () => {
    const root = await webRepo({ project: 'web', output: 'config.env' });
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      values('local', { A: '1' }),
    );
    const { context } = await setup(api, root);

    await expect(pull(context)).rejects.toThrow(OutputNotIgnoredError);
    await expect(readFile(join(root, 'config.env'))).rejects.toThrow();
    expect(api.requests).toEqual([]);

    await pull(context, { force: true });
    expect(parseDotenv(await readFile(join(root, 'config.env'), 'utf8'))).toEqual({ A: '1' });
  });

  it('$가 든 값은 그대로 쓰고, 그 키를 알려주며 senv run을 권한다', async () => {
    const root = await webRepo();
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      values('local', { PASSWORD: 'p$ss', PLAIN: 'ok', TEMPLATE: '${HOME}' }),
    );
    const { context, logs } = await setup(api, root);

    await pull(context);

    expect(parseDotenv(await readFile(join(root, '.env.local'), 'utf8')).PASSWORD).toBe('p$ss');
    const warning = logs.warn.join('\n');
    expect(warning).toContain('PASSWORD');
    expect(warning).toContain('TEMPLATE');
    expect(warning).not.toContain('PLAIN');
    expect(warning).toContain('senv run');
  });

  it('기존 파일을 덮어쓰고 권한을 600으로 되돌린다', async () => {
    const root = await webRepo();
    await writeFile(join(root, '.env.local'), 'OLD=1\n', { mode: 0o644 });
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      values('local', { NEW: '2' }),
    );
    const { context } = await setup(api, root);
    await pull(context);

    expect(parseDotenv(await readFile(join(root, '.env.local'), 'utf8'))).toEqual({ NEW: '2' });
    expect((await stat(join(root, '.env.local'))).mode & 0o777).toBe(0o600);
  });

  it('서버 오류는 그대로 전달하고 기존 파일을 건드리지 않는다', async () => {
    const root = await webRepo();
    await writeFile(join(root, '.env.local'), 'KEEP=1\n');
    const api = new FakeApi().reply('GET', '/api/v1/projects/web/envs/local/variables', {
      status: 409,
      body: { code: 'broken_reference', message: '해석할 수 없는 공유 참조가 있습니다' },
    });
    const { context } = await setup(api, root);

    await expect(pull(context)).rejects.toThrow(SenvApiError);
    expect(await readFile(join(root, '.env.local'), 'utf8')).toBe('KEEP=1\n');
  });

  it('senv.json이 없으면 ProjectConfigNotFoundError다', async () => {
    const { context } = await setup(new FakeApi(), await makeTempDir());
    await expect(pull(context)).rejects.toThrow(ProjectConfigNotFoundError);
  });
});
