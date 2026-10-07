import { SenvApiError, SenvNetworkError } from '@senv/api-client';
import { ENVIRONMENT_NAMES, type EnvironmentName } from '@senv/core';
import { Command, CommanderError, Option } from 'commander';
import { NotLoggedInError } from './auth/session.js';
import { login, logout, whoami } from './commands/auth.js';
import { init } from './commands/init.js';
import { get, list } from './commands/inspect.js';
import { pull } from './commands/pull.js';
import { run } from './commands/run.js';
import type { CliContext } from './context.js';

export const VERSION = '0.1.0';
export const DEFAULT_API_URL = 'https://senv.stream.billilge.site';

export interface MainOptions {
  /** 명령을 실행할 때 컨텍스트를 만든다 (운영은 실제, 테스트는 가짜) */
  createContext: () => Promise<CliContext>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  debug?: boolean;
}

/** 인자 형식 오류(잘못된 --env 등)는 2, 그 밖의 실패는 1 */
const USAGE_ERRORS = new Set([
  'commander.invalidArgument',
  'commander.missingArgument',
  'commander.optionMissingArgument',
  'commander.missingMandatoryOptionValue',
]);

const envOption = () =>
  new Option('--env <env>', '환경 (기본: senv.json의 defaultEnv)').choices(ENVIRONMENT_NAMES);

/** senv 명령줄을 실행하고 종료 코드를 돌려준다 */
export async function main(argv: string[], options: MainOptions): Promise<number> {
  const { stdout, stderr } = options;
  let context: CliContext | undefined;
  let exitCode = 0;

  /** 명령마다 컨텍스트를 만들고, 출력은 이 명령줄의 stdout·stderr로 보낸다 */
  const withContext = async (action: (context: CliContext) => Promise<number | undefined>) => {
    context = await options.createContext();
    context.out = {
      info: (message) => stderr(`${message}\n`),
      warn: (message) => stderr(`경고: ${message}\n`),
      result: (text) => stdout(`${text}\n`),
    };
    exitCode = (await action(context)) ?? 0;
  };

  const program = new Command('senv')
    .description('Stream Env Control CLI: 환경변수를 받아 쓰고 실행한다')
    .version(VERSION)
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({ writeOut: stdout, writeErr: stderr });

  program
    .command('login')
    .description('브라우저에서 GitHub로 로그인한다')
    .option('--no-browser', '브라우저를 자동으로 열지 않는다')
    .action((opts: { browser: boolean }) =>
      withContext(async (ctx) => login(ctx, { browser: opts.browser }).then(() => 0)),
    );

  program
    .command('logout')
    .description('이 기기에서 로그아웃하고 토큰을 폐기한다')
    .action(() => withContext(async (ctx) => logout(ctx).then(() => 0)));

  program
    .command('whoami')
    .description('로그인한 사용자를 보여준다')
    .action(() => withContext(async (ctx) => whoami(ctx).then(() => 0)));

  program
    .command('init')
    .description('senv.json을 만들고 출력 파일을 .gitignore에 넣는다')
    .option('--project <name>', '프로젝트 이름 (없으면 목록에서 고른다)')
    .addOption(envOption())
    .option('--output <path>', '값을 쓸 파일 (기본: .env.local)')
    .option('--force', '이미 있는 senv.json을 덮어쓴다')
    .action((opts: { project?: string; env?: EnvironmentName; output?: string; force?: boolean }) =>
      withContext(async (ctx) => init(ctx, opts).then(() => 0)),
    );

  program
    .command('pull')
    .description('값을 받아 .env 파일로 쓴다')
    .addOption(envOption())
    .option('--output <path>', '값을 쓸 파일 (기본: senv.json의 output)')
    .option('--force', '출력 파일이 git에서 무시되지 않아도 쓴다')
    .action((opts: { env?: EnvironmentName; output?: string; force?: boolean }) =>
      withContext(async (ctx) => pull(ctx, opts).then(() => 0)),
    );

  program
    .command('run')
    .description('파일 없이 값을 환경변수로 넣어 명령을 실행한다 (예: senv run -- pnpm dev)')
    .addOption(envOption())
    .argument('[command...]', '실행할 명령')
    .passThroughOptions()
    .action((command: string[], opts: { env?: EnvironmentName }) =>
      withContext((ctx) => run(ctx, command, opts)),
    );

  program
    .command('list')
    .description('키 이름을 보여준다 (값은 보여주지 않는다)')
    .addOption(envOption())
    .action((opts: { env?: EnvironmentName }) =>
      withContext(async (ctx) => list(ctx, opts).then(() => 0)),
    );

  program
    .command('get')
    .description('값 하나를 내보낸다')
    .argument('<key>', '키 이름')
    .addOption(envOption())
    .action((key: string, opts: { env?: EnvironmentName }) =>
      withContext(async (ctx) => get(ctx, key, opts).then(() => 0)),
    );

  try {
    await program.parseAsync(argv);
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.version' || error.code === 'commander.helpDisplayed') return 0;
      return USAGE_ERRORS.has(error.code) ? 2 : error.exitCode || 1;
    }
    return report(error);
  }

  function report(error: unknown): number {
    if (error instanceof NotLoggedInError) {
      stderr(`${error.message}\n`);
    } else if (error instanceof SenvApiError) {
      stderr(`오류: ${error.message} (${error.code})\n`);
    } else if (error instanceof SenvNetworkError) {
      stderr(`서버에 연결할 수 없습니다: ${context?.apiUrl ?? DEFAULT_API_URL}\n`);
    } else if (error instanceof Error) {
      stderr(`오류: ${error.message}\n`);
    } else {
      stderr(`오류: ${String(error)}\n`);
    }
    if (options.debug && error instanceof Error && error.stack) stderr(`${error.stack}\n`);
    return 1;
  }
}
