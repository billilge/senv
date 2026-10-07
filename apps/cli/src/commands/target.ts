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

export class ExposedSecretError extends Error {
  constructor(readonly keys: string[]) {
    super(
      `secret 값이 클라이언트 번들에 들어가는 이름입니다: ${keys.join(', ')}. 키 스키마에서 public으로 바꾸거나 공개 접두사가 없는 이름으로 바꾸세요`,
    );
    this.name = 'ExposedSecretError';
  }
}

/**
 * pull·run이 받는 값 (서버가 공유 참조를 해석해서 준다). 클라이언트 노출 검사(PRD 6.3)에서 secret이 번들에 들어가는 이름이면 멈추고,
 * 스키마에 없는 공개 키는 경고만 한다.
 */
export async function fetchVariables(
  context: CliContext,
  target: Target,
): Promise<DeliveredValues> {
  const delivered = await getDelivered(context, target);
  // 노출 검사가 없는 이전 서버의 응답도 받는다
  const exposure = delivered.exposure ?? { exposedSecrets: [], unregistered: [] };
  if (exposure.exposedSecrets.length > 0) throw new ExposedSecretError(exposure.exposedSecrets);
  if (exposure.unregistered.length > 0) {
    context.out.warn(
      `${exposure.unregistered.join(', ')}: 클라이언트 번들에 들어가는 이름인데 키 스키마에 없습니다. 대시보드에서 public인지 secret인지 등록하세요`,
    );
  }
  return delivered;
}

/** 노출 검사 없이 값을 받는다 (status·diff·push·doctor는 값을 쓰거나 실행하지 않는다) */
export function getDelivered(context: CliContext, target: Target): Promise<DeliveredValues> {
  return unwrap(
    context.api.GET('/api/v1/projects/{project}/envs/{env}/variables', {
      params: { path: { project: target.config.project, env: target.env } },
    }),
  );
}
