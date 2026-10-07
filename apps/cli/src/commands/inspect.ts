import type { EnvironmentName } from '@senv/core';
import type { CliContext } from '../context.js';
import { type DeliveredValues, fetchVariables, resolveTarget } from './target.js';

export class KeyNotFoundError extends Error {
  constructor(
    readonly key: string,
    readonly label: string,
  ) {
    super(`${label}에 ${key}이(가) 없습니다`);
    this.name = 'KeyNotFoundError';
  }
}

/** senv list: 키 이름만 보여준다 (값은 보여주지 않는다, PRD 6.2) */
export async function list(context: CliContext, options: { env?: EnvironmentName } = {}) {
  const delivered = await load(context, options.env);
  const keys = Object.keys(delivered.variables).sort();
  if (keys.length === 0) {
    context.out.info(`${label(delivered)}에 값이 없습니다.`);
    return;
  }
  context.out.info(`${label(delivered)}: ${keys.length}개`);
  context.out.result(keys.join('\n'));
}

/** senv get KEY: 값 하나를 그대로 내보낸다 (셸 파이프용) */
export async function get(
  context: CliContext,
  key: string,
  options: { env?: EnvironmentName } = {},
) {
  const delivered = await load(context, options.env);
  const value = delivered.variables[key];
  if (value === undefined) throw new KeyNotFoundError(key, label(delivered));
  context.out.result(value);
}

async function load(context: CliContext, env?: EnvironmentName): Promise<DeliveredValues> {
  return fetchVariables(context, await resolveTarget(context, env));
}

function label(delivered: DeliveredValues): string {
  return `${delivered.project}/${delivered.env} v${delivered.version}`;
}
