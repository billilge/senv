import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { EnvFileFormat } from '../config/project-config.js';
import { serializeEnvFile } from './env-file.js';
import { isGitIgnored } from './gitignore.js';

/**
 * senv가 쓰는 값 파일 (.env.local 등). pull과 로컬 자동 받기 에이전트(M1.1)가 함께 쓴다.
 * 첫 줄 머리글에 버전을 남겨 status·에이전트가 "senv가 만든 파일"인지와 버전을 안다.
 */

export interface DeliveredFile {
  project: string;
  env: string;
  version: number;
  sharedVersion: number;
  variables: Record<string, string>;
}

const HEADER = /^# senv: \S+\/\S+ v(\d+) \(shared v(\d+)\)/;

export function renderValueFile(
  format: EnvFileFormat,
  delivered: DeliveredFile,
  now: Date,
): string {
  const label = `${delivered.project}/${delivered.env} v${delivered.version}`;
  return serializeEnvFile(format, delivered.variables, [
    `senv: ${label} (shared v${delivered.sharedVersion})`,
    `generated: ${now.toISOString()}`,
    '직접 고치지 말고 senv pull로 다시 받으세요. 이 파일은 커밋하지 않습니다.',
  ]);
}

export function parseHeader(text: string): { version: number; sharedVersion: number } | null {
  const match = text.match(HEADER);
  return match ? { version: Number(match[1]), sharedVersion: Number(match[2]) } : null;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * 같은 폴더의 임시 파일(권한 600)에 쓴 뒤 이름을 바꾼다. 개발 서버가 반쯤 쓴 파일을 읽지 않고,
 * 출력 자리에 심볼릭 링크가 있어도 링크가 가리키는 파일을 건드리지 않는다.
 */
export async function writeValueFile(path: string, text: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temp, text, { mode: 0o600, flag: 'wx' });
    await chmod(temp, 0o600);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** 지금 파일의 내용 해시와 senv 머리글 여부. 파일이 없으면 null */
export async function readValueFile(
  path: string,
): Promise<{ hash: string; senvHeader: boolean } | null> {
  try {
    const text = await readFile(path, 'utf8');
    return { hash: hashText(text), senvHeader: parseHeader(text) !== null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** 출력 파일에 써도 되는지: git이 무시해야 하고 심볼릭 링크가 아니어야 한다 */
export async function checkOutput(
  root: string,
  output: string,
): Promise<'ok' | 'not_ignored' | 'symlink'> {
  const link = await lstat(join(root, output)).then(
    (stats) => stats.isSymbolicLink(),
    () => false,
  );
  if (link) return 'symlink';
  return (await isGitIgnored(root, output)) ? 'ok' : 'not_ignored';
}
