import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createSenvClient, unwrap } from '@senv/api-client';
import { parseDotenv } from '@senv/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAgentCycle } from '../../apps/cli/src/agent/agent.js';
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

const now = new Date('2026-10-09T09:00:00.000Z');
let t: TestApp;
let baseUrl: string;

beforeAll(async () => {
  t = await createTestApp({ now: () => now });
  await resetDatabase(t.prisma);
  await t.app.get(ProjectsService).ensureSharedProject();
  await t.app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(() => t.close());

/** alice의 PC: 실제 서버에 로그인해 둔 CLI 컨텍스트 (터미널 없음, 자동 시작 서비스처럼) */
async function alicePc(aliceId: string): Promise<CliContext> {
  const configDir = await makeTempDir();
  const credentials = new FileCredentialStore(configDir);
  const pair = await t.app.get(ApiTokenService).issuePair(aliceId);
  await credentials.save({
    apiUrl: baseUrl,
    accessToken: pair.accessToken,
    accessExpiresAt: pair.accessExpiresAt.toISOString(),
    refreshToken: pair.refreshToken,
    refreshExpiresAt: pair.refreshExpiresAt.toISOString(),
  });
  const anonymousApi = createSenvClient({ baseUrl });
  const session = new CliSession({
    apiUrl: baseUrl,
    store: credentials,
    lockPath: join(configDir, 'refresh.lock'),
    now: () => now,
    refresh: (refreshToken) =>
      unwrap(anonymousApi.POST('/api/v1/auth/token/refresh', { body: { refreshToken } })),
  });
  return {
    cwd: configDir,
    env: { PATH: process.env.PATH },
    apiUrl: baseUrl,
    out: { info: () => {}, warn: () => {}, result: () => {} },
    api: createSenvClient({ baseUrl, accessToken: () => session.accessToken() }),
    anonymousApi,
    credentials,
    prompt: {
      select: async () => {
        throw new Error('E2E에서는 대화형 입력을 쓰지 않는다');
      },
      confirm: async () => {
        throw new Error('E2E에서는 대화형 입력을 쓰지 않는다');
      },
      text: async () => {
        throw new Error('E2E에서는 대화형 입력을 쓰지 않는다');
      },
    },
    openBrowser: async () => {},
    sleep: async () => {},
    now: () => now,
    configDir,
    interactive: false,
    hostname: 'alice-mbp',
  };
}

describe('로컬 자동 받기 (M1.1)', () => {
  it('대시보드에서 연결 → PC에서 승인 → 게시할 때마다 .env.local 갱신, 직접 고친 파일은 덮어쓰기 요청 때만', async () => {
    const admin = await createTestUser(t.prisma, { login: 'admin', role: 'admin' });
    const alice = await createTestUser(t.prisma, { login: 'alice' });
    const adminToken = (await t.app.get(ApiTokenService).issuePair(admin.id)).accessToken;
    const adminApi = createSenvClient({ baseUrl, accessToken: () => adminToken });
    await unwrap(adminApi.POST('/api/v1/projects', { body: { name: 'web' } }));
    let version = 0;
    const publish = async (set: Record<string, string>) => {
      await unwrap(
        adminApi.POST('/api/v1/projects/{project}/envs/{env}/versions', {
          params: { path: { project: 'web', env: 'local' } },
          body: { baseVersion: version, changes: { set } },
        }),
      );
      version++;
    };
    await publish({ API_URL: 'http://localhost:3000', MODE: 'v1' });

    // alice의 저장소와 PC (senv agent install이 기기를 등록한다)
    const repo = await makeTempDir();
    await promisify(execFile)('git', ['init', '-q'], { cwd: repo });
    await writeFile(join(repo, 'senv.json'), JSON.stringify({ project: 'web' }));
    await writeFile(join(repo, '.gitignore'), '.env*\n');
    const pc = await alicePc(alice.id);
    await runAgentCycle(pc);

    // 대시보드(세션)에서 그 PC와 폴더를 연결한다
    const { token } = await t.app.get(SessionService).create(alice.id);
    const dashboard = (path: string, init: RequestInit = {}) =>
      fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Cookie: `senv_session=${token}`,
          Origin: TEST_APP_URL,
        },
      });
    const devices = await (await dashboard('/api/v1/me/devices')).json();
    expect(devices.devices).toEqual([expect.objectContaining({ name: 'alice-mbp' })]);
    const created = await dashboard('/api/v1/me/local-links', {
      method: 'POST',
      body: JSON.stringify({ deviceId: devices.devices[0].id, project: 'web', path: repo }),
    });
    expect(created.status).toBe(201);
    const link = await created.json();

    // 승인 전에는 쓰지 않는다. 세션으로는 승인할 수 없다 (결정 61)
    await runAgentCycle(pc);
    await expect(readFile(join(repo, '.env.local'), 'utf8')).rejects.toThrow();
    const bySession = await dashboard(`/api/v1/agent/links/${link.id}/approve`, { method: 'POST' });
    expect(bySession.status).toBe(403);

    const senv = (...args: string[]) =>
      main(['node', 'senv', ...args], {
        createContext: async () => pc,
        stdout: () => {},
        stderr: () => {},
      });
    expect(await senv('link', 'approve', link.id)).toBe(0);

    const values = async () => parseDotenv(await readFile(join(repo, '.env.local'), 'utf8'));
    await runAgentCycle(pc);
    expect(await values()).toEqual({ API_URL: 'http://localhost:3000', MODE: 'v1' });

    await publish({ MODE: 'v2' });
    await runAgentCycle(pc);
    expect((await values()).MODE).toBe('v2');
    const listed = await (await dashboard('/api/v1/me/local-links')).json();
    expect(listed.links[0]).toMatchObject({
      status: 'active',
      lastWritten: { version: 2 },
      lastState: { state: 'ok' },
    });

    // 직접 고친 파일은 덮어쓰지 않고, 대시보드에서 덮어쓰기를 누르면 쓴다 (결정 62)
    await writeFile(join(repo, '.env.local'), 'MINE=1\n');
    await publish({ MODE: 'v3' });
    await runAgentCycle(pc);
    expect(await values()).toEqual({ MINE: '1' });
    const modified = await (await dashboard('/api/v1/me/local-links')).json();
    expect(modified.links[0].lastState.state).toBe('modified');

    await dashboard(`/api/v1/me/local-links/${link.id}/overwrite`, { method: 'POST' });
    await runAgentCycle(pc);
    expect((await values()).MODE).toBe('v3');
  });
});
