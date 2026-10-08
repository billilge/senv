import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EnvironmentName } from '@senv/core';
import type { CliContext } from '../context.js';
import { serializeEnvFile, substitutedKeys } from '../files/env-file.js';
import { isGitIgnored } from '../files/gitignore.js';
import { fetchVariables, resolveTarget } from './target.js';

export interface PullOptions {
  env?: EnvironmentName;
  output?: string;
  /** 출력 파일이 git에서 무시되지 않아도 쓴다 */
  force?: boolean;
}

export class OutputNotIgnoredError extends Error {
  constructor(readonly output: string) {
    super(
      `${output}이(가) git에서 무시되지 않습니다. 값이 커밋될 수 있어 쓰지 않았습니다. .gitignore에 추가하거나 --force를 붙이세요`,
    );
    this.name = 'OutputNotIgnoredError';
  }
}

/** senv pull: 값을 받아 .env 파일로 쓴다 (PRD 6.3) */
export async function pull(context: CliContext, options: PullOptions = {}): Promise<void> {
  const target = await resolveTarget(context, options.env);
  const output = options.output ?? target.config.output;
  // 값을 받기 전에 확인해서, 커밋될 수 있는 파일에는 아예 쓰지 않는다
  if (!options.force && !(await isGitIgnored(target.root, output))) {
    throw new OutputNotIgnoredError(output);
  }

  const delivered = await fetchVariables(context, target);
  const label = `${delivered.project}/${delivered.env} v${delivered.version}`;
  const format = target.config.format;
  const text = serializeEnvFile(format, delivered.variables, [
    `senv: ${label} (shared v${delivered.sharedVersion})`,
    `generated: ${context.now().toISOString()}`,
    '직접 고치지 말고 senv pull로 다시 받으세요. 이 파일은 커밋하지 않습니다.',
  ]);

  const path = join(target.root, output);
  await writeFile(path, text, { mode: 0o600 });
  // 이미 있던 파일은 mode 옵션이 적용되지 않으므로 다시 맞춘다
  await chmod(path, 0o600);

  const count = Object.keys(delivered.variables).length;
  context.out.info(`${count}개 값을 ${output}에 썼습니다 (${label}).`);

  // 파일을 읽는 도구가 값을 치환할 수 있다 (PRD 결정 28, 65)
  const substituted = substitutedKeys(format, delivered.variables);
  if (substituted.length === 0) return;
  context.out.warn(
    format === 'properties'
      ? `${substituted.join(', ')} 값에 \${...}가 있습니다. Spring은 이것을 다른 속성 값으로 바꾸므로, 글자 그대로 써야 하는 값인지 확인하세요.`
      : `${substituted.join(', ')} 값에 $가 있습니다. Vite·Expo 같은 도구는 .env의 $를 치환하므로, 이 값들이 필요하면 senv run으로 실행하세요.`,
  );
}
