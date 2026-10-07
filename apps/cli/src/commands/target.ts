import { type ApiSchemas, unwrap } from '@senv/api-client';
import type { EnvironmentName } from '@senv/core';
import { findProjectConfig, type LoadedProjectConfig } from '../config/project-config.js';
import type { CliContext } from '../context.js';

export type DeliveredValues = ApiSchemas['DeliveredValues'];

export interface Target extends LoadedProjectConfig {
  env: EnvironmentName;
}

/** senv.json을 찾아 프로젝트와 환경(--env가 없으면 defaultEnv)을 정한다 */
export async function resolveTarget(context: CliContext, env?: EnvironmentName): Promise<Target> {
  const loaded = await findProjectConfig(context.cwd);
  return { ...loaded, env: env ?? loaded.config.defaultEnv };
}

/** pull·run이 받는 값 (서버가 공유 참조를 해석해서 준다) */
export function fetchVariables(context: CliContext, target: Target): Promise<DeliveredValues> {
  return unwrap(
    context.api.GET('/api/v1/projects/{project}/envs/{env}/variables', {
      params: { path: { project: target.config.project, env: target.env } },
    }),
  );
}
