import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffVariables, type EnvironmentName } from '@senv/core';
import type { CliContext } from '../context.js';
import { parseEnvFile } from '../files/env-file.js';
import { parseHeader } from '../files/value-file.js';
import { getDelivered, resolveTarget, type Target } from './target.js';

/** pull이 파일 첫 줄에 쓰는 머리글 (예: `# senv: web/local v3 (shared v1)`) */

export class LocalFileNotFoundError extends Error {
  constructor(readonly file: string) {
    super(`${file}이(가) 없습니다. senv pull로 먼저 받으세요`);
    this.name = 'LocalFileNotFoundError';
  }
}

export interface CompareOptions {
  env?: EnvironmentName;
  /** 비교할 로컬 파일 (기본: senv.json의 output) */
  file?: string;
}

/** senv status: 로컬 파일 버전과 서버 최신 버전을 견준다 (PRD 6.2) */
export async function status(context: CliContext, options: CompareOptions = {}): Promise<void> {
  const target = await resolveTarget(context, options.env);
  const file = options.file ?? target.config.output;
  const label = `${target.config.project}/${target.env}`;
  const remote = await getDelivered(context, target);
  const text = await readLocal(target, file);

  if (text === null) {
    context.out.info(`${label}: ${file}이(가) 없습니다. senv pull로 받으세요`);
    return;
  }
  const local = parseHeader(text);
  if (!local) {
    context.out.info(`${label}: ${file}에 senv 머리글이 없습니다. senv pull로 다시 받으세요`);
    return;
  }
  if (local.version === remote.version && local.sharedVersion === remote.sharedVersion) {
    context.out.info(
      `${label} v${remote.version} (shared v${remote.sharedVersion}): 최신입니다 (${file})`,
    );
    return;
  }
  context.out.info(
    `${label}: 로컬 v${local.version} (shared v${local.sharedVersion}) → 서버 v${remote.version} (shared v${remote.sharedVersion}). senv pull로 받으세요`,
  );
}

/** senv diff: 로컬 파일과 서버 값의 차이를 키 이름으로만 보여준다 (값은 보여주지 않는다) */
export async function diff(context: CliContext, options: CompareOptions = {}): Promise<void> {
  const target = await resolveTarget(context, options.env);
  const file = options.file ?? target.config.output;
  const text = await readLocal(target, file);
  if (text === null) throw new LocalFileNotFoundError(file);
  const remote = await getDelivered(context, target);

  const result = diffVariables(parseEnvFile(target.config.format, text), remote.variables);
  const lines = [
    ...result.added.map((key) => `+ ${key}`),
    ...result.removed.map((key) => `- ${key}`),
    ...result.changed.map((key) => `~ ${key}`),
  ];
  const label = `${target.config.project}/${target.env} v${remote.version}`;
  if (lines.length === 0) {
    context.out.info(`${file}이(가) ${label}의 값과 같습니다.`);
    return;
  }
  context.out.info(`${file} ↔ ${label}: + 서버에만 있음, - 로컬에만 있음, ~ 값이 다름`);
  context.out.result(lines.join('\n'));
}

async function readLocal(target: Target, file: string): Promise<string | null> {
  try {
    return await readFile(join(target.root, file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
