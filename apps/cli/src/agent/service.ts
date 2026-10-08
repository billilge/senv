import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SenvApiError, unwrap } from '@senv/api-client';
import { NotLoggedInError } from '../auth/session.js';
import type { CliContext } from '../context.js';
import { AgentStateStore, ensureDevice } from './agent.js';

/**
 * senv agent install·uninstall·status: 로그인할 때 에이전트가 자동으로 시작하게 한다 (M1.1).
 * macOS는 launchd LaunchAgent, Linux는 systemd 사용자 서비스. Windows는 아직 지원하지 않는다.
 */

export const AGENT_LABEL = 'site.billilge.senv.agent';
const SYSTEMD_UNIT = 'senv-agent.service';
/** 서비스에 넘기는 환경변수. git(출력 파일 검사)을 찾을 PATH와 서버 주소 */
const PASSED_ENV = ['PATH', 'SENV_API_URL'] as const;

/** 서비스 등록에 필요한 바깥 세계. 테스트에서는 가짜로 바꾼다 */
export interface ServiceHost {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  /** node 실행 파일 */
  execPath: string;
  /** senv CLI 스크립트 (dist/cli.js) */
  script: string;
  env: NodeJS.ProcessEnv;
  exec(command: string, args: string[]): Promise<{ code: number; output: string }>;
}

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(
      `${platform}에서는 아직 자동 시작을 지원하지 않습니다. 터미널에서 senv agent를 직접 실행하세요`,
    );
    this.name = 'UnsupportedPlatformError';
  }
}

export class ServiceCommandError extends Error {
  constructor(command: string, output: string) {
    super(`${command} 실패: ${output.trim() || '출력 없음'}`);
    this.name = 'ServiceCommandError';
  }
}

export function agentServiceFile(host: ServiceHost): { path: string; content: string } {
  const env = PASSED_ENV.filter((name) => host.env[name]).map(
    (name) => [name, host.env[name] as string] as const,
  );
  if (host.platform === 'darwin') {
    const log = join(host.home, 'Library/Logs/senv-agent.log');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(host.execPath)}</string>
      <string>${xml(host.script)}</string>
      <string>agent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>60</integer>
    <key>EnvironmentVariables</key>
    <dict>
${env.map(([name, value]) => `      <key>${name}</key>\n      <string>${xml(value)}</string>`).join('\n')}
    </dict>
    <key>StandardOutPath</key>
    <string>${xml(log)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(log)}</string>
  </dict>
</plist>
`;
    return { path: join(host.home, 'Library/LaunchAgents', `${AGENT_LABEL}.plist`), content };
  }
  if (host.platform === 'linux') {
    const content = `[Unit]
Description=senv local auto pull agent
After=network-online.target

[Service]
ExecStart="${host.execPath}" "${host.script}" agent
Restart=on-failure
RestartSec=60
${env.map(([name, value]) => `Environment="${name}=${value}"`).join('\n')}

[Install]
WantedBy=default.target
`;
    return { path: join(host.home, '.config/systemd/user', SYSTEMD_UNIT), content };
  }
  throw new UnsupportedPlatformError(host.platform);
}

export async function installAgent(context: CliContext, host: ServiceHost): Promise<void> {
  const file = agentServiceFile(host);
  if (!(await context.credentials.load(context.apiUrl))) {
    throw new NotLoggedInError('먼저 senv login으로 로그인하세요');
  }
  // 대시보드에서 바로 이 PC를 고를 수 있게 지금 등록한다
  await ensureDevice(context);

  await mkdir(dirname(file.path), { recursive: true });
  await writeFile(file.path, file.content, { mode: 0o600 });
  await chmod(file.path, 0o600);

  if (host.platform === 'darwin') {
    // 이미 떠 있으면 내리고 새 설정으로 다시 띄운다
    await host.exec('launchctl', ['bootout', `gui/${host.uid}/${AGENT_LABEL}`]);
    await mustRun(host, 'launchctl', ['bootstrap', `gui/${host.uid}`, file.path]);
  } else {
    await mustRun(host, 'systemctl', ['--user', 'daemon-reload']);
    await mustRun(host, 'systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT]);
  }

  context.out.info(
    [
      '로그인할 때 senv agent가 자동으로 시작합니다.',
      host.platform === 'darwin'
        ? `로그: ${join(host.home, 'Library/Logs/senv-agent.log')}`
        : `로그: journalctl --user -u ${SYSTEMD_UNIT}`,
      '대시보드의 "내 로컬 연결"에서 폴더를 연결하세요. 대시보드에서 추가한 연결은 senv link approve <id>로 승인해야 씁니다 (senv link list로 확인).',
    ].join('\n'),
  );
}

export async function uninstallAgent(context: CliContext, host: ServiceHost): Promise<void> {
  const file = agentServiceFile(host);
  if (host.platform === 'darwin') {
    await host.exec('launchctl', ['bootout', `gui/${host.uid}/${AGENT_LABEL}`]);
    await rm(file.path, { force: true });
  } else {
    await host.exec('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT]);
    await rm(file.path, { force: true });
    await host.exec('systemctl', ['--user', 'daemon-reload']);
  }

  const store = new AgentStateStore(context.configDir);
  const { deviceId } = await store.load();
  if (deviceId) {
    try {
      await unwrap(
        context.api.DELETE('/api/v1/me/devices/{id}', { params: { path: { id: deviceId } } }),
      );
    } catch (error) {
      const gone = error instanceof SenvApiError && error.code === 'device_not_found';
      if (!gone) {
        context.out.warn(
          `서버에서 이 PC를 지우지 못했습니다. 대시보드의 "내 로컬 연결"에서 지우세요: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  await store.clear();
  context.out.info(
    '자동 시작을 껐고 이 PC의 로컬 연결 등록을 지웠습니다. 이미 쓴 파일은 그대로 둡니다.',
  );
}

/** 서비스 상태: 등록 파일, 실행 여부, 기기 ID */
export async function agentStatus(context: CliContext, host: ServiceHost): Promise<void> {
  const file = agentServiceFile(host);
  const running =
    host.platform === 'darwin'
      ? (await host.exec('launchctl', ['print', `gui/${host.uid}/${AGENT_LABEL}`])).code === 0
      : (await host.exec('systemctl', ['--user', 'is-active', '--quiet', SYSTEMD_UNIT])).code === 0;
  const { deviceId } = await new AgentStateStore(context.configDir).load();
  context.out.result(
    [
      `자동 시작: ${running ? '실행 중' : '꺼짐'} (${file.path})`,
      `이 PC의 기기 ID: ${deviceId ?? '아직 등록하지 않음'}`,
    ].join('\n'),
  );
}

async function mustRun(host: ServiceHost, command: string, args: string[]): Promise<void> {
  const result = await host.exec(command, args);
  if (result.code !== 0) throw new ServiceCommandError([command, ...args].join(' '), result.output);
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
