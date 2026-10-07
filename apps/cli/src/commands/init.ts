import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { unwrap } from '@senv/api-client';
import { type EnvironmentName, SHARED_PROJECT_NAME } from '@senv/core';
import { CONFIG_FILE, writeProjectConfig } from '../config/project-config.js';
import type { CliContext } from '../context.js';
import { ensureGitIgnored } from '../files/gitignore.js';

export interface InitOptions {
  project?: string;
  env?: EnvironmentName;
  output?: string;
  force?: boolean;
}

export class AlreadyInitializedError extends Error {
  constructor(readonly path: string) {
    super(`이미 ${path}이(가) 있습니다. 덮어쓰려면 --force를 붙이세요`);
    this.name = 'AlreadyInitializedError';
  }
}

/** senv init: senv.json을 만들고 출력 파일을 .gitignore에 넣는다 */
export async function init(context: CliContext, options: InitOptions = {}): Promise<void> {
  const { cwd, out } = context;
  const configPath = join(cwd, CONFIG_FILE);
  if (!options.force && (await exists(configPath))) throw new AlreadyInitializedError(configPath);

  const project = options.project ?? (await chooseProject(context));
  // 서버에 있는 프로젝트인지 확인한다 (없으면 SenvApiError 404)
  await unwrap(context.api.GET('/api/v1/projects/{project}', { params: { path: { project } } }));

  const output = options.output ?? '.env.local';
  await writeProjectConfig(cwd, {
    project,
    defaultEnv: options.env ?? 'local',
    output,
    format: 'dotenv',
  });
  out.info(`${CONFIG_FILE}을 만들었습니다 (프로젝트: ${project}). 이 파일은 커밋하세요.`);

  if (await ensureGitIgnored(cwd, output)) {
    out.info(`${output}을 .gitignore에 추가했습니다.`);
  }
}

async function chooseProject(context: CliContext): Promise<string> {
  const { projects } = await unwrap(context.api.GET('/api/v1/projects'));
  const shared = await unwrap(
    context.api.GET('/api/v1/projects/{project}', {
      params: { path: { project: SHARED_PROJECT_NAME } },
    }),
  );
  return context.prompt.select(
    '어느 프로젝트의 값을 쓸까요?',
    [...projects, shared].map((project) => ({
      value: project.name,
      label: project.name,
      hint: project.kind === 'shared' ? '공유 그룹' : project.displayName,
    })),
  );
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
