import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../testing/temp-dir.js';
import { ensureGitIgnored, isGitIgnored } from './gitignore.js';

const run = promisify(execFile);

async function gitRepo() {
  const dir = await makeTempDir();
  await run('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('isGitIgnored', () => {
  it('git 저장소에서는 .gitignore 패턴(.env* 등)을 git과 똑같이 판단한다', async () => {
    const dir = await gitRepo();
    await writeFile(join(dir, '.gitignore'), '.env*\n!.env.example\n');
    expect(await isGitIgnored(dir, '.env.local')).toBe(true);
    expect(await isGitIgnored(dir, '.env.example')).toBe(false);
    expect(await isGitIgnored(dir, 'config.json')).toBe(false);
  });

  it('git 저장소가 아니면 .gitignore에 같은 줄이 있는지로 판단한다', async () => {
    const dir = await makeTempDir();
    expect(await isGitIgnored(dir, '.env.local')).toBe(false);
    await writeFile(join(dir, '.gitignore'), 'node_modules\n/.env.local\n');
    expect(await isGitIgnored(dir, '.env.local')).toBe(true);
  });
});

describe('ensureGitIgnored', () => {
  it('무시되지 않으면 .gitignore 끝에 추가하고 true를 돌려준다', async () => {
    const dir = await gitRepo();
    await writeFile(join(dir, '.gitignore'), 'node_modules');

    expect(await ensureGitIgnored(dir, '.env.local')).toBe(true);
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe(
      'node_modules\n\n# senv가 만드는 값 파일 (커밋하지 않는다)\n/.env.local\n',
    );
    expect(await isGitIgnored(dir, '.env.local')).toBe(true);
  });

  it('.gitignore가 없으면 만든다', async () => {
    const dir = await gitRepo();
    expect(await ensureGitIgnored(dir, '.env')).toBe(true);
    expect(await isGitIgnored(dir, '.env')).toBe(true);
  });

  it('이미 무시되고 있으면 .gitignore를 건드리지 않고 false를 돌려준다', async () => {
    const dir = await gitRepo();
    await writeFile(join(dir, '.gitignore'), '.env*\n');
    expect(await ensureGitIgnored(dir, '.env.local')).toBe(false);
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('.env*\n');
  });
});
