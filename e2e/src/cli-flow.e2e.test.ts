// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createSenvClient, unwrap } from '@senv/api-client';
import { parseDotenv } from '@senv/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileCredentialStore } from '../../apps/cli/src/auth/credentials.js';
import { CliSession } from '../../apps/cli/src/auth/session.js';
import type { CliContext } from '../../apps/cli/src/context.js';
import { main } from '../../apps/cli/src/program.js';
import { makeTempDir } from '../../apps/cli/src/testing/temp-dir.js';
import { ApiTokenService } from '../../apps/server/src/auth/api-token-service.js';
import { SessionService } from '../../apps/server/src/auth/session-service.js';
import { ProjectsService } from '../../apps/server/src/projects/projects-service.js';
import { createTestApp, TEST_APP_URL, type TestApp } from '../../apps/server/src/testing/app.js';
import { resetDatabase } from '../../apps/server/src/testing/database.js';
import { createTestUser } from '../../apps/server/src/testing/users.js';

let now = new Date('2026-10-07T09:00:00.000Z');
let t: TestApp;
let baseUrl: string;

beforeAll(async () => {
  t = await createTestApp({ now: () => now });
  await resetDatabase(t.prisma);
  // 앱이 뜰 때 만든 공유 프로젝트를 방금 지웠으므로 다시 보장한다
  await t.app.get(ProjectsService).ensureSharedProject();
  await t.app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(() => t.close());

/** 브라우저에서 로그인한 alice가 CLI 코드를 승인하는 것을 흉내 낸다 */
async function approveInBrowser(verificationUrl: string, aliceId: string) {
  const userCode = new URL(verificationUrl).searchParams.get('code');
  const { token } = await t.app.get(SessionService).create(aliceId);
  const response = await fetch(`${baseUrl}/api/v1/auth/device/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `senv_session=${token}`,
      Origin: TEST_APP_URL,
    },
    body: JSON.stringify({ userCode, decision: 'approve' }),
  });
  expect(response.status).toBe(204);
}

/** 실제 서버에 붙는 CLI 컨텍스트. 대기는 서버 시계를 앞으로 돌린다 */
async function cliContext(cwd: string, aliceId: string): Promise<CliContext> {
  const credentials = new FileCredentialStore(await makeTempDir());
  const anonymousApi = createSenvClient({ baseUrl });
  const session = new CliSession({
    apiUrl: baseUrl,
    store: credentials,
    lockPath: join(await makeTempDir(), 'refresh.lock'),
    now: () => now,
    refresh: (refreshToken) =>
      unwrap(anonymousApi.POST('/api/v1/auth/token/refresh', { body: { refreshToken } })),
  });
  return {
    cwd,
    env: { PATH: process.env.PATH },
    apiUrl: baseUrl,
    out: { info: () => {}, warn: () => {}, result: () => {} },
    api: createSenvClient({ baseUrl, accessToken: () => session.accessToken() }),
    anonymousApi,
    credentials,
    prompt: {
      select: async () => {
        throw new Error('E2E에서는 대화형 선택을 쓰지 않는다');
      },
    },
    openBrowser: (url) => approveInBrowser(url, aliceId),
    sleep: async (ms) => {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
}

describe('CLI로 처음부터 끝까지', () => {
  it('login → whoami → init → pull → run → logout', async () => {
    // 관리자가 프로젝트를 만들고 값을 게시해 둔다
    const admin = await createTestUser(t.prisma, { login: 'admin', role: 'admin' });
    const alice = await createTestUser(t.prisma, { login: 'alice' });
    const { accessToken } = await t.app.get(ApiTokenService).issuePair(admin.id);
    const adminApi = createSenvClient({ baseUrl, accessToken: () => accessToken });
    await unwrap(adminApi.POST('/api/v1/projects', { body: { name: 'web' } }));
    for (const [project, set] of [
      ['shared', { API_HOST: 'api.stream.dev' }],
      ['web', { VITE_API_URL: 'https://${shared.API_HOST}/v1', VITE_MODE: 'local' }],
    ] as const) {
      await unwrap(
        adminApi.POST('/api/v1/projects/{project}/envs/{env}/versions', {
          params: { path: { project, env: 'local' } },
          body: { baseVersion: 0, changes: { set } },
        }),
      );
    }

    // 개발자 저장소
    const repo = await makeTempDir();
    await promisify(execFile)('git', ['init', '-q'], { cwd: repo });
    const context = await cliContext(repo, alice.id);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const senv = (...args: string[]) =>
      main(['node', 'senv', ...args], {
        createContext: async () => context,
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      });

    expect(await senv('login')).toBe(0);
    expect(stderr.join('')).toContain('alice(으)로 로그인했습니다');

    expect(await senv('whoami')).toBe(0);
    expect(stdout.join('')).toContain('alice');

    expect(await senv('init', '--project', 'web')).toBe(0);
    expect(JSON.parse(await readFile(join(repo, 'senv.json'), 'utf8')).project).toBe('web');

    expect(await senv('pull')).toBe(0);
    expect(parseDotenv(await readFile(join(repo, '.env.local'), 'utf8'))).toEqual({
      VITE_API_URL: 'https://api.stream.dev/v1',
      VITE_MODE: 'local',
    });

    const envDump = join(repo, 'env.json');
    const script = `require('fs').writeFileSync(${JSON.stringify(envDump)}, JSON.stringify({ url: process.env.VITE_API_URL }))`;
    expect(await senv('run', '--', process.execPath, '-e', script)).toBe(0);
    expect(JSON.parse(await readFile(envDump, 'utf8'))).toEqual({
      url: 'https://api.stream.dev/v1',
    });

    expect(await senv('logout')).toBe(0);
    expect(await senv('whoami')).toBe(1);
    expect(stderr.join('')).toContain('senv login');
  });
});
