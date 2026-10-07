import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../testing/temp-dir.js';
import {
  findProjectConfig,
  InvalidProjectConfigError,
  ProjectConfigNotFoundError,
  writeProjectConfig,
} from './project-config.js';

async function writeJson(dir: string, value: unknown) {
  await writeFile(
    join(dir, 'senv.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

describe('findProjectConfig', () => {
  it('현재 폴더의 senv.json을 읽고 빠진 값은 기본값으로 채운다', async () => {
    const dir = await makeTempDir();
    await writeJson(dir, { project: 'web' });

    expect(await findProjectConfig(dir)).toEqual({
      root: dir,
      config: { project: 'web', defaultEnv: 'local', output: '.env.local', format: 'dotenv' },
    });
  });

  it('상위 폴더로 올라가며 가장 가까운 senv.json을 찾는다', async () => {
    const repo = await makeTempDir();
    await writeJson(repo, { project: 'root-project' });
    const pkg = join(repo, 'apps', 'web');
    await mkdir(join(pkg, 'src', 'pages'), { recursive: true });
    await writeJson(pkg, { project: 'web', defaultEnv: 'development', output: '.env' });

    expect(await findProjectConfig(join(pkg, 'src', 'pages'))).toEqual({
      root: pkg,
      config: { project: 'web', defaultEnv: 'development', output: '.env', format: 'dotenv' },
    });
  });

  it('찾지 못하면 senv init을 안내하는 ProjectConfigNotFoundError다', async () => {
    const dir = await makeTempDir();
    const error = await findProjectConfig(dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectConfigNotFoundError);
    expect((error as Error).message).toContain('senv init');
  });

  it.each([
    ['JSON 문법 오류', '{ project: web }'],
    ['project가 없음', { defaultEnv: 'local' }],
    ['project 이름 규칙 위반', { project: 'Web App' }],
    ['고정 환경이 아닌 defaultEnv', { project: 'web', defaultEnv: 'staging' }],
    ['절대 경로 output', { project: 'web', output: '/etc/passwd' }],
    ['폴더 밖을 가리키는 output', { project: 'web', output: '../other/.env' }],
    ['지원하지 않는 format', { project: 'web', format: 'yaml' }],
  ])('%s → InvalidProjectConfigError', async (_label, value) => {
    const dir = await makeTempDir();
    await writeJson(dir, value);
    await expect(findProjectConfig(dir)).rejects.toThrow(InvalidProjectConfigError);
  });

  it('공유 그룹(shared)도 project로 쓸 수 있다', async () => {
    const dir = await makeTempDir();
    await writeJson(dir, { project: 'shared' });
    expect((await findProjectConfig(dir)).config.project).toBe('shared');
  });
});

describe('writeProjectConfig', () => {
  it('2칸 들여쓰기 JSON으로 쓰고, 다시 읽으면 같은 설정이다', async () => {
    const dir = await makeTempDir();
    const config = {
      project: 'web',
      defaultEnv: 'local',
      output: '.env.local',
      format: 'dotenv',
    } as const;

    const path = await writeProjectConfig(dir, config);

    expect(path).toBe(join(dir, 'senv.json'));
    expect(await readFile(path, 'utf8')).toBe(`${JSON.stringify(config, null, 2)}\n`);
    expect((await findProjectConfig(dir)).config).toEqual(config);
  });
});
