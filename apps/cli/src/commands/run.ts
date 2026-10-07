import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import type { EnvironmentName } from '@senv/core';
import type { CliContext } from '../context.js';
import { fetchVariables, resolveTarget } from './target.js';

export class MissingCommandError extends Error {
  constructor() {
    super('실행할 명령이 없습니다. 예: senv run -- pnpm dev');
    this.name = 'MissingCommandError';
  }
}

export class CommandNotFoundError extends Error {
  constructor(readonly command: string) {
    super(`명령을 찾을 수 없습니다: ${command}`);
    this.name = 'CommandNotFoundError';
  }
}

const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * senv run -- <명령>: 파일을 쓰지 않고 값을 환경변수로 넣어 실행한다 (PRD 6장 권장 사용법).
 * 셸 환경변수는 두고 같은 이름이면 senv 값을 쓴다. 명령의 종료 코드를 돌려준다.
 */
export async function run(
  context: CliContext,
  command: string[],
  options: { env?: EnvironmentName } = {},
): Promise<number> {
  const [file, ...args] = command;
  if (!file) throw new MissingCommandError();

  // 값을 받지 못하면 명령을 실행하지 않는다 (빈 값으로 실행되는 것을 막는다)
  const delivered = await fetchVariables(context, await resolveTarget(context, options.env));

  return new Promise<number>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: context.cwd,
      env: { ...context.env, ...delivered.variables },
      stdio: 'inherit',
      // Windows는 pnpm 같은 .cmd 명령을 셸 없이 찾지 못한다
      shell: process.platform === 'win32',
    });

    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    for (const signal of FORWARDED_SIGNALS) process.on(signal, forward);
    const cleanup = () => {
      for (const signal of FORWARDED_SIGNALS) process.off(signal, forward);
    };

    child.once('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(error.code === 'ENOENT' ? new CommandNotFoundError(file) : error);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      // 시그널로 끝났으면 셸 관례대로 128 + 시그널 번호
      resolve(code ?? 128 + (signal ? constants.signals[signal] : 0));
    });
  });
}
