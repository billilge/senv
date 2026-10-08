import { lstat, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDotenv, parseProperties } from '@senv/core';
import { describe, expect, it } from 'vitest';
import { webRepo } from '../testing/repo.js';
import { makeTempDir } from '../testing/temp-dir.js';
import {
  checkOutput,
  hashText,
  parseHeader,
  readValueFile,
  renderValueFile,
  writeValueFile,
} from './value-file.js';

const delivered = {
  project: 'web',
  env: 'local' as const,
  version: 3,
  sharedVersion: 1,
  variables: { API_URL: 'http://localhost:3000', GREETING: '안녕' },
};
const NOW = new Date('2026-10-09T09:00:00.000Z');

describe('renderValueFile', () => {
  it('senv 머리글과 형식에 맞는 본문을 쓴다', () => {
    const dotenv = renderValueFile('dotenv', delivered, NOW);
    expect(dotenv.split('\n')[0]).toBe('# senv: web/local v3 (shared v1)');
    expect(parseDotenv(dotenv)).toEqual(delivered.variables);
    expect(parseProperties(renderValueFile('properties', delivered, NOW))).toEqual(
      delivered.variables,
    );
  });
});

describe('parseHeader', () => {
  it('senv 머리글에서 버전을 읽고, 없으면 null', () => {
    expect(parseHeader(renderValueFile('dotenv', delivered, NOW))).toEqual({
      version: 3,
      sharedVersion: 1,
    });
    expect(parseHeader('A=1\n')).toBeNull();
  });
});

describe('writeValueFile', () => {
  it('권한 600으로 쓰고 임시 파일을 남기지 않는다. 기존 파일도 600으로 바꾼다', async () => {
    const dir = await makeTempDir();
    const path = join(dir, '.env.local');
    await writeFile(path, 'OLD=1\n', { mode: 0o644 });

    await writeValueFile(path, 'A=1\n');

    expect(await readFile(path, 'utf8')).toBe('A=1\n');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(['.env.local']);
  });

  it('심볼릭 링크를 따라가지 않고 링크 자리에 파일을 둔다', async () => {
    const dir = await makeTempDir();
    const outside = join(await makeTempDir(), 'target');
    await writeFile(outside, 'KEEP=1\n');
    await symlink(outside, join(dir, '.env.local'));

    await writeValueFile(join(dir, '.env.local'), 'A=1\n');

    expect(await readFile(outside, 'utf8')).toBe('KEEP=1\n');
    expect((await lstat(join(dir, '.env.local'))).isSymbolicLink()).toBe(false);
  });
});

describe('readValueFile', () => {
  it('내용 해시와 senv 머리글 여부를 돌려주고, 파일이 없으면 null', async () => {
    const dir = await makeTempDir();
    const path = join(dir, '.env.local');
    expect(await readValueFile(path)).toBeNull();

    const text = renderValueFile('dotenv', delivered, NOW);
    await writeFile(path, text);
    expect(await readValueFile(path)).toEqual({ hash: hashText(text), senvHeader: true });

    await writeFile(path, 'A=1\n');
    expect(await readValueFile(path)).toEqual({ hash: hashText('A=1\n'), senvHeader: false });
  });
});

describe('checkOutput', () => {
  it('git이 무시하는 일반 파일(또는 아직 없는 파일)이면 ok', async () => {
    const root = await webRepo();
    expect(await checkOutput(root, '.env.local')).toBe('ok');
  });

  it('git이 무시하지 않으면 not_ignored, 심볼릭 링크면 symlink', async () => {
    const root = await webRepo();
    expect(await checkOutput(root, 'values.env')).toBe('not_ignored');
    await symlink(join(root, 'senv.json'), join(root, '.env.local'));
    expect(await checkOutput(root, '.env.local')).toBe('symlink');
  });
});
