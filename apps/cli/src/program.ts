import { SenvApiError, SenvNetworkError } from '@senv/api-client';
import { ENVIRONMENT_NAMES, type EnvironmentName } from '@senv/core';
import { Argument, Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { runAgent } from './agent/agent.js';
import { agentStatus, installAgent, uninstallAgent } from './agent/service.js';
import { createRealServiceHost } from './agent/service-host.js';
import { NotLoggedInError } from './auth/session.js';
import { login, logout, whoami } from './commands/auth.js';
import { diff, status } from './commands/compare.js';
import { doctor } from './commands/doctor.js';
import { EXPORT_FORMATS, type ExportFormat, exportValues } from './commands/export.js';
import { init } from './commands/init.js';
import { get, list } from './commands/inspect.js';
import { linkAdd, linkApprove, linkList, linkReject } from './commands/link.js';
import { pull } from './commands/pull.js';
import { run } from './commands/run.js';
import { push, set } from './commands/write.js';
import { ENV_FILE_FORMATS, type EnvFileFormat } from './config/project-config.js';
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

function parseInterval(value: string): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 10) {
    throw new InvalidArgumentError('10 이상의 정수(초)여야 합니다');
  }
  return seconds;
}

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
    .option(
      '--output <path>',
      '값을 쓸 파일 (기본: dotenv는 .env.local, properties는 .env.local.properties)',
    )
    .addOption(
      new Option('--format <format>', '값 파일 형식 (properties는 Spring Boot용)')
        .choices(ENV_FILE_FORMATS)
        .default('dotenv'),
    )
    .option('--force', '이미 있는 senv.json을 덮어쓴다')
    .action(
      (opts: {
        project?: string;
        env?: EnvironmentName;
        output?: string;
        format: EnvFileFormat;
        force?: boolean;
      }) => withContext(async (ctx) => init(ctx, opts).then(() => 0)),
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

  program
    .command('status')
    .description('받은 파일의 버전을 서버 최신 버전과 견준다')
    .addOption(envOption())
    .option('--file <path>', '견줄 파일 (기본: senv.json의 output)')
    .action((opts: { env?: EnvironmentName; file?: string }) =>
      withContext(async (ctx) => status(ctx, opts).then(() => 0)),
    );

  program
    .command('diff')
    .description('받은 파일과 서버 값의 차이를 키 이름으로 보여준다 (값은 보여주지 않는다)')
    .addOption(envOption())
    .option('--file <path>', '견줄 파일 (기본: senv.json의 output)')
    .action((opts: { env?: EnvironmentName; file?: string }) =>
      withContext(async (ctx) => diff(ctx, opts).then(() => 0)),
    );

  program
    .command('set')
    .description('값을 바꿔 새 버전으로 게시한다 (예: senv set API_URL=https://… DEBUG=false)')
    .argument('<assignments...>', 'KEY=VALUE')
    .addOption(envOption())
    .option('-m, --message <message>', '게시 메시지')
    .option('-y, --yes', '묻지 않고 게시한다 (production은 프로젝트 이름을 다시 입력해야 한다)')
    .action(
      (assignments: string[], opts: { env?: EnvironmentName; message?: string; yes?: boolean }) =>
        withContext(async (ctx) => set(ctx, assignments, opts).then(() => 0)),
    );

  program
    .command('push')
    .description('로컬 .env에서 서버와 달라진 값을 게시한다 (기존 파일 이관에 쓴다)')
    .addOption(envOption())
    .option('--file <path>', '올릴 파일 (기본: senv.json의 output)')
    .option('--prune', '파일에 없는 키를 서버에서 지운다')
    .option('-m, --message <message>', '게시 메시지')
    .option('-y, --yes', '묻지 않고 게시한다 (production은 프로젝트 이름을 다시 입력해야 한다)')
    .action(
      (opts: {
        env?: EnvironmentName;
        file?: string;
        prune?: boolean;
        message?: string;
        yes?: boolean;
      }) => withContext(async (ctx) => push(ctx, opts).then(() => 0)),
    );

  program
    .command('export')
    .description('값을 원하는 형식으로 표준 출력에 쓴다')
    .addOption(envOption())
    .addOption(
      new Option('--format <format>', '출력 형식').choices(EXPORT_FORMATS).default('dotenv'),
    )
    .action((opts: { env?: EnvironmentName; format: ExportFormat }) =>
      withContext(async (ctx) => exportValues(ctx, opts).then(() => 0)),
    );

  program
    .command('agent')
    .description(
      '로컬 자동 받기: 대시보드에 연결한 폴더에 local 값을 계속 반영한다 (install로 자동 시작)',
    )
    .addArgument(
      new Argument(
        '[action]',
        'run(기본): 지금 실행, install·uninstall: 자동 시작 등록·해제, status: 상태',
      )
        .choices(['run', 'install', 'uninstall', 'status'])
        .default('run'),
    )
    .option('--interval <seconds>', '확인 간격(초, 10 이상)', parseInterval, 30)
    .action((action: 'run' | 'install' | 'uninstall' | 'status', opts: { interval: number }) =>
      withContext(async (ctx) => {
        if (action === 'run') await runAgent(ctx, { interval: opts.interval });
        else if (action === 'install') await installAgent(ctx, createRealServiceHost());
        else if (action === 'uninstall') await uninstallAgent(ctx, createRealServiceHost());
        else await agentStatus(ctx, createRealServiceHost());
        return 0;
      }),
    );

  const link = program.command('link').description('이 PC의 로컬 자동 받기 연결을 보고 승인한다');
  link
    .command('list')
    .description('이 PC의 연결과 상태')
    .action(() => withContext(async (ctx) => linkList(ctx).then(() => 0)));
  link
    .command('approve')
    .description('대시보드에서 추가한 연결을 이 PC에서 승인한다')
    .argument('<id>', '연결 ID (senv link list)')
    .action((id: string) => withContext(async (ctx) => linkApprove(ctx, id).then(() => 0)));
  link
    .command('reject')
    .description('대시보드에서 추가한 연결을 거절해 지운다')
    .argument('<id>', '연결 ID (senv link list)')
    .action((id: string) => withContext(async (ctx) => linkReject(ctx, id).then(() => 0)));
  link
    .command('add')
    .description('지금 폴더(senv.json)를 이 PC의 연결로 추가한다')
    .action(() => withContext(async (ctx) => linkAdd(ctx).then(() => 0)));

  program
    .command('doctor')
    .description('설정·로그인·.gitignore·필수 키·타입·클라이언트 노출을 점검한다')
    .action(() => withContext((ctx) => doctor(ctx)));

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
