import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import {
  ENVIRONMENT_NAMES,
  type EnvironmentName,
  isValidProjectName,
  SHARED_PROJECT_NAME,
} from '@senv/core';
import { z } from 'zod';

export const CONFIG_FILE = 'senv.json';

/** pull이 쓰는 파일 형식. properties는 Spring Boot용이다 (PRD 결정 65) */
export const ENV_FILE_FORMATS = ['dotenv', 'properties'] as const;
export type EnvFileFormat = (typeof ENV_FILE_FORMATS)[number];

/** output을 주지 않았을 때 형식별 기본 파일 */
export const DEFAULT_OUTPUT: Record<EnvFileFormat, string> = {
  dotenv: '.env.local',
  properties: '.env.local.properties',
};

/** 저장소(모노레포면 패키지 폴더)의 senv.json. 값은 담지 않으므로 커밋한다 (PRD 6.1) */
export interface ProjectConfig {
  project: string;
  defaultEnv: EnvironmentName;
  /** pull이 쓰는 파일. senv.json이 있는 폴더 기준 상대 경로 */
  output: string;
  format: EnvFileFormat;
}

export interface LoadedProjectConfig {
  config: ProjectConfig;
  /** senv.json이 있는 폴더 */
  root: string;
}

export class ProjectConfigNotFoundError extends Error {
  constructor(readonly cwd: string) {
    super(`${CONFIG_FILE}을 찾을 수 없습니다. 먼저 senv init을 실행하세요`);
    this.name = 'ProjectConfigNotFoundError';
  }
}

export class InvalidProjectConfigError extends Error {
  constructor(
    readonly path: string,
    readonly problems: string[],
  ) {
    super(`${path}이(가) 올바르지 않습니다:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    this.name = 'InvalidProjectConfigError';
  }
}

const configSchema = z
  .object({
    project: z.string().refine((name) => name === SHARED_PROJECT_NAME || isValidProjectName(name), {
      error: '소문자·숫자·하이픈, 32자 이하의 프로젝트 이름이어야 합니다',
    }),
    defaultEnv: z
      .enum(ENVIRONMENT_NAMES, { error: 'local, development, production 중 하나여야 합니다' })
      .default('local'),
    output: z
      .string()
      .min(1)
      .refine(isInsideRoot, { error: 'senv.json이 있는 폴더 안의 상대 경로여야 합니다' })
      .optional(),
    format: z
      .enum(ENV_FILE_FORMATS, { error: 'dotenv 또는 properties여야 합니다' })
      .default('dotenv'),
  })
  .transform((config) => ({ ...config, output: config.output ?? DEFAULT_OUTPUT[config.format] }));

/** cwd부터 상위 폴더로 올라가며 가장 가까운 senv.json을 찾아 읽는다 */
export async function findProjectConfig(cwd: string): Promise<LoadedProjectConfig> {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const path = join(dir, CONFIG_FILE);
    const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (text !== undefined) return { root: dir, config: parseConfig(path, text) };
    if (dirname(dir) === dir) throw new ProjectConfigNotFoundError(cwd);
  }
}

export async function writeProjectConfig(dir: string, config: ProjectConfig): Promise<string> {
  const path = join(dir, CONFIG_FILE);
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

function parseConfig(path: string, text: string): ProjectConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new InvalidProjectConfigError(path, ['JSON 형식이 아닙니다']);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidProjectConfigError(
      path,
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(전체)'}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/** 절대 경로나 ..로 폴더 밖을 가리키는 경로를 막는다 */
function isInsideRoot(path: string): boolean {
  if (isAbsolute(path)) return false;
  const normalized = normalize(path);
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.startsWith('..\\');
}
