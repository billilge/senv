import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectConfigNotFoundError } from '../config/project-config.js';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { webRepo } from '../testing/repo.js';
import { linkAdd, linkApprove, linkList, linkReject } from './link.js';

const AT = '2026-10-09T09:00:00.000Z';
const link = (overrides: Record<string, unknown> = {}) => ({
  id: 'l1',
  device: { id: 'd1', name: 'test-host' },
  project: 'web',
  path: '/Users/alice/work/web',
  status: 'active',
  approvedAt: AT,
  current: { version: 3, sharedVersion: 1 },
  lastWritten: { version: 3, sharedVersion: 1, at: AT },
  lastState: { state: 'ok', message: null, at: AT },
  overwriteRequested: false,
  createdAt: AT,
  ...overrides,
});

function server() {
  return new FakeApi()
    .reply('POST', '/api/v1/agent/devices', {
      status: 201,
      body: { id: 'd1', name: 'test-host', createdAt: AT, lastSeenAt: null },
    })
    .reply('GET', '/api/v1/agent/devices/d1/links', {
      status: 200,
      body: {
        links: [
          link(),
          link({
            id: 'l2',
            status: 'pending',
            approvedAt: null,
            lastWritten: null,
            lastState: null,
            path: '/tmp/api',
            project: 'api',
          }),
        ],
      },
    })
    .reply('POST', '/api/v1/agent/links/l2/approve', { status: 200, body: link({ id: 'l2' }) })
    .reply('POST', '/api/v1/agent/links/l2/reject', { status: 204 });
}

async function setup(api: FakeApi, cwd?: string) {
  const test = await createTestContext(api, cwd ? { cwd } : {});
  await signedIn(test.credentials);
  return test;
}

describe('senv link', () => {
  it('list: 이 PC의 연결을 상태와 함께 보여준다 (기기가 없으면 먼저 등록한다)', async () => {
    const { context, logs } = await setup(server());

    await linkList(context);

    const output = logs.result.join('\n');
    expect(output).toMatch(/l1\s+활성\s+web\s+\/Users\/alice\/work\/web\s+v3 반영됨/);
    expect(output).toMatch(/l2\s+승인 대기\s+api\s+\/tmp\/api/);
  });

  it('approve·reject: 승인 대기 연결을 처리한다', async () => {
    const api = server();
    const { context, logs } = await setup(api);

    await linkApprove(context, 'l2');
    await linkReject(context, 'l2');

    expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'POST /api/v1/agent/links/l2/approve',
        'POST /api/v1/agent/links/l2/reject',
      ]),
    );
    expect(logs.info.join('\n')).toMatch(/승인했습니다/);
  });

  it('add: 지금 폴더(senv.json이 있는 폴더)를 이 PC의 활성 연결로 만든다', async () => {
    const root = await webRepo();
    const api = server().reply('POST', '/api/v1/agent/devices/d1/links', {
      status: 201,
      body: link({ id: 'l3' }),
    });
    const { context } = await setup(api, join(root));

    await linkAdd(context);

    const request = api.requests.find(
      (r) => r.path === '/api/v1/agent/devices/d1/links' && r.method === 'POST',
    );
    expect(request?.body).toEqual({ project: 'web', path: await realpath(root) });
  });

  it('add: senv.json이 없으면 ProjectConfigNotFoundError다', async () => {
    const { context } = await setup(server());
    await expect(linkAdd(context)).rejects.toBeInstanceOf(ProjectConfigNotFoundError);
  });
});
