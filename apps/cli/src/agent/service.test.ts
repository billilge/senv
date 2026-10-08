import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NotLoggedInError } from '../auth/session.js';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { makeTempDir } from '../testing/temp-dir.js';
import { AgentStateStore } from './agent.js';
import {
  AGENT_LABEL,
  agentServiceFile,
  installAgent,
  type ServiceHost,
  UnsupportedPlatformError,
  uninstallAgent,
} from './service.js';

async function host(platform: NodeJS.Platform, results: Record<string, number> = {}) {
  const calls: string[] = [];
  const value: ServiceHost = {
    platform,
    home: await makeTempDir(),
    uid: 501,
    execPath: '/usr/local/bin/node',
    script: '/opt/senv/dist/cli.js',
    env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', SENV_API_URL: 'https://senv.example.com' },
    exec: async (command, args) => {
      const line = [command, ...args].join(' ');
      calls.push(line);
      return { code: results[line] ?? 0, output: '' };
    },
  };
  return { host: value, calls };
}

const api = () =>
  new FakeApi()
    .reply('POST', '/api/v1/agent/devices', {
      status: 201,
      body: {
        id: 'd1',
        name: 'test-host',
        createdAt: '2026-10-09T09:00:00.000Z',
        lastSeenAt: null,
      },
    })
    .reply('DELETE', '/api/v1/me/devices/d1', { status: 204 });

describe('agentServiceFile', () => {
  it('macOS: 로그인할 때 시작하는 LaunchAgent (PATH·서버 주소를 넘기고 로그를 남긴다)', async () => {
    const { host: mac } = await host('darwin');
    const file = agentServiceFile(mac);

    expect(file.path).toBe(join(mac.home, 'Library/LaunchAgents', `${AGENT_LABEL}.plist`));
    expect(file.content).toContain(`<string>${AGENT_LABEL}</string>`);
    expect(file.content).toContain(
      '<string>/usr/local/bin/node</string>\n      <string>/opt/senv/dist/cli.js</string>\n      <string>agent</string>',
    );
    expect(file.content).toContain('<key>RunAtLoad</key>\n    <true/>');
    expect(file.content).toContain('<string>/opt/homebrew/bin:/usr/bin:/bin</string>');
    expect(file.content).toContain('<string>https://senv.example.com</string>');
    expect(file.content).toContain(join(mac.home, 'Library/Logs/senv-agent.log'));
  });

  it('Linux: systemd 사용자 서비스', async () => {
    const { host: linux } = await host('linux');
    const file = agentServiceFile(linux);

    expect(file.path).toBe(join(linux.home, '.config/systemd/user/senv-agent.service'));
    expect(file.content).toContain('ExecStart="/usr/local/bin/node" "/opt/senv/dist/cli.js" agent');
    expect(file.content).toContain('Restart=on-failure');
    expect(file.content).toContain('Environment="PATH=/opt/homebrew/bin:/usr/bin:/bin"');
    expect(file.content).toContain('WantedBy=default.target');
  });

  it('XML에 쓸 수 없는 글자는 이스케이프한다', async () => {
    const { host: mac } = await host('darwin');
    const file = agentServiceFile({ ...mac, script: '/Users/a&b/<cli>.js' });
    expect(file.content).toContain('/Users/a&amp;b/&lt;cli&gt;.js');
  });

  it('Windows는 아직 지원하지 않는다', async () => {
    const { host: windows } = await host('win32');
    expect(() => agentServiceFile(windows)).toThrow(UnsupportedPlatformError);
  });
});

describe('installAgent', () => {
  it('macOS: 기기를 등록하고 plist(권한 600)를 쓴 뒤 launchctl로 다시 띄운다', async () => {
    const { credentials, context, logs } = await createTestContext(api());
    await signedIn(credentials);
    const { host: mac, calls } = await host('darwin');

    await installAgent(context, mac);

    const file = agentServiceFile(mac);
    expect(await readFile(file.path, 'utf8')).toBe(file.content);
    expect((await stat(file.path)).mode & 0o777).toBe(0o600);
    expect(calls).toEqual([
      `launchctl bootout gui/501/${AGENT_LABEL}`,
      `launchctl bootstrap gui/501 ${file.path}`,
    ]);
    expect((await new AgentStateStore(context.configDir).load()).deviceId).toBe('d1');
    expect(logs.info.join('\n')).toContain('senv link approve');
  });

  it('Linux: systemd 사용자 서비스를 켠다', async () => {
    const { credentials, context } = await createTestContext(api());
    await signedIn(credentials);
    const { host: linux, calls } = await host('linux');

    await installAgent(context, linux);

    expect(calls).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable --now senv-agent.service',
    ]);
  });

  it('로그인하지 않았으면 아무것도 하지 않고 NotLoggedInError다', async () => {
    const { context } = await createTestContext(api());
    const { host: mac, calls } = await host('darwin');
    await expect(installAgent(context, mac)).rejects.toBeInstanceOf(NotLoggedInError);
    expect(calls).toEqual([]);
  });

  it('launchctl이 실패하면 오류를 낸다', async () => {
    const { credentials, context } = await createTestContext(api());
    await signedIn(credentials);
    const { host: mac } = await host('darwin');
    const failing = { ...mac, exec: async () => ({ code: 5, output: 'Bootstrap failed' }) };
    await expect(installAgent(context, failing)).rejects.toThrow(/Bootstrap failed/);
  });
});

describe('uninstallAgent', () => {
  it('서비스를 내리고 파일을 지우며, 서버의 기기와 이 PC의 기록을 지운다', async () => {
    const fake = api();
    const { credentials, context } = await createTestContext(fake);
    await signedIn(credentials);
    const { host: mac, calls } = await host('darwin');
    await installAgent(context, mac);
    calls.length = 0;

    await uninstallAgent(context, mac);

    expect(calls).toEqual([`launchctl bootout gui/501/${AGENT_LABEL}`]);
    await expect(readFile(agentServiceFile(mac).path, 'utf8')).rejects.toThrow();
    expect(
      fake.requests.some((r) => r.method === 'DELETE' && r.path === '/api/v1/me/devices/d1'),
    ).toBe(true);
    expect((await new AgentStateStore(context.configDir).load()).deviceId).toBeNull();
  });
});
