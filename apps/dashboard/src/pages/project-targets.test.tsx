import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const ENVS = ['local', 'development', 'production'] as const;
const at = '2026-10-08T05:00:00.000Z';

const mapping = (overrides: Record<string, unknown> = {}) => ({
  id: 'm1',
  project: 'server',
  env: 'production',
  connection: { id: 'c1', name: 'coolify-main', type: 'coolify' },
  resourceId: 'app-api',
  resourceName: 'stream-api-prod',
  syncMode: 'auto',
  afterSync: 'auto',
  unmanaged: 'keep',
  include: [],
  exclude: [],
  options: {},
  lastSync: { version: 3, sharedVersion: 1, at },
  lastRun: { status: 'succeeded', trigger: 'publish', action: 'restart', error: null, at },
  driftKeys: [],
  driftCheckedAt: null,
  ...overrides,
});

function server(role: 'member' | 'admin' = 'member', mappings = [mapping()]) {
  const api = new FakeApi()
    .reply('GET', '/api/v1/me', { status: 200, body: user({ role }) })
    .reply('GET', '/api/v1/projects', { status: 200, body: { projects: [] } })
    .reply('GET', '/api/v1/users', { status: 200, body: { users: [] } })
    .reply('GET', '/api/v1/projects/server', {
      status: 200,
      body: { name: 'server', displayName: 'Stream API', kind: 'app', environments: [...ENVS] },
    })
    .reply('GET', '/api/v1/projects/server/targets', { status: 200, body: { mappings } });
  for (const env of ENVS) {
    api.reply('GET', `/api/v1/projects/server/envs/${env}`, {
      status: 200,
      body: { project: 'server', env, version: 3, variables: {} },
    });
  }
  return api;
}

const row = (text: string) => within(screen.getByText(text).closest('li') as HTMLElement);

describe('프로젝트 배포 탭', () => {
  it('매핑마다 환경·리소스·마지막 동기화 결과를 보여준다', async () => {
    const { user: actor, history } = renderApp('/projects/server', server());

    await actor.click(await screen.findByRole('link', { name: '배포' }));
    await waitFor(() => expect(history.location.pathname).toBe('/projects/server/targets'));

    expect(await screen.findByText('stream-api-prod')).toBeInTheDocument();
    const item = row('stream-api-prod');
    expect(item.getByText('production')).toBeInTheDocument();
    expect(item.getByText(/coolify-main/)).toBeInTheDocument();
    expect(item.getByText(/v3 반영/)).toBeInTheDocument();
    expect(item.getByText('성공')).toBeInTheDocument();
  });

  it('지금 동기화는 바뀔 키와 반영 후 동작을 확인한 뒤 실행한다', async () => {
    const api = server()
      .reply('GET', '/api/v1/targets/mappings/m1/plan', {
        status: 200,
        body: {
          version: 4,
          sharedVersion: 1,
          add: ['NEW'],
          change: ['A'],
          remove: [],
          unchanged: 3,
          action: 'restart',
        },
      })
      .reply('POST', '/api/v1/targets/mappings/m1/sync', {
        status: 200,
        body: {
          id: 'r1',
          trigger: 'manual',
          status: 'succeeded',
          version: 4,
          sharedVersion: 1,
          changedKeys: ['A', 'NEW'],
          action: 'restart',
          providerRef: 'dep-1',
          error: null,
          attempt: 1,
          startedAt: at,
          finishedAt: at,
        },
      });
    const { user: actor } = renderApp('/projects/server/targets', api);

    await actor.click(await screen.findByRole('button', { name: 'stream-api-prod 지금 동기화' }));
    const dialog = await screen.findByRole('dialog', { name: 'stream-api-prod 동기화' });
    expect(await within(dialog).findByText('NEW')).toBeInTheDocument();
    expect(within(dialog).getByText(/반영 후 재시작/)).toBeInTheDocument();
    await actor.click(within(dialog).getByRole('button', { name: '동기화' }));

    expect(
      await screen.findByText(/stream-api-prod에 2개 키를 반영하고 재시작했습니다/),
    ).toBeInTheDocument();
  });

  it('드리프트가 있으면 알리고, 원격 값을 가져올 수 있다', async () => {
    const api = server('member', [mapping({ driftKeys: ['A', 'B'] })]).reply(
      'POST',
      '/api/v1/targets/mappings/m1/import',
      { status: 201, body: { version: 4, keys: ['A', 'B'] } },
    );
    const { user: actor } = renderApp('/projects/server/targets', api);

    expect(await screen.findByText(/Coolify에서 직접 바뀐 키: A, B/)).toBeInTheDocument();
    await actor.click(screen.getByRole('button', { name: 'stream-api-prod 가져오기' }));
    await actor.click(
      within(screen.getByRole('dialog', { name: '원격 값 가져오기' })).getByRole('button', {
        name: '가져오기',
      }),
    );

    expect(await screen.findByText(/2개 키를 production v4로 게시했습니다/)).toBeInTheDocument();
  });

  it('기록을 펼쳐 최근 동기화를 본다 (실패 이유 포함)', async () => {
    const api = server().reply('GET', '/api/v1/targets/mappings/m1/runs', {
      status: 200,
      body: {
        runs: [
          {
            id: 'r2',
            trigger: 'publish',
            status: 'failed',
            version: 4,
            sharedVersion: 1,
            changedKeys: [],
            action: null,
            providerRef: null,
            error: 'Coolify 오류 (502)',
            attempt: 3,
            startedAt: at,
            finishedAt: at,
          },
          {
            id: 'r1',
            trigger: 'manual',
            status: 'succeeded',
            version: 3,
            sharedVersion: 1,
            changedKeys: ['A'],
            action: 'restart',
            providerRef: 'dep-1',
            error: null,
            attempt: 1,
            startedAt: at,
            finishedAt: at,
          },
        ],
      },
    });
    const { user: actor } = renderApp('/projects/server/targets', api);

    await actor.click(await screen.findByRole('button', { name: 'stream-api-prod 기록' }));
    expect(await screen.findByText(/Coolify 오류 \(502\)/)).toBeInTheDocument();
    expect(screen.getByText(/v3 · A/)).toBeInTheDocument();
  });

  it('관리자는 연결의 리소스를 골라 매핑을 추가한다', async () => {
    const api = server('admin', [])
      .reply('GET', '/api/v1/targets/connections', {
        status: 200,
        body: {
          connections: [
            {
              id: 'c1',
              name: 'coolify-main',
              type: 'coolify',
              config: {},
              mappingCount: 0,
              createdAt: at,
              updatedAt: at,
            },
          ],
        },
      })
      .reply('GET', '/api/v1/targets/providers', {
        status: 200,
        body: {
          providers: [
            {
              type: 'coolify',
              displayName: 'Coolify',
              capabilities: {
                readValues: true,
                deleteKeys: true,
                actions: ['restart', 'redeploy'],
                buildTimeFlag: true,
              },
              connectionFields: [],
              mappingOptionFields: [
                { name: 'preview', label: 'Preview 배포에도 넣기', kind: 'boolean' },
              ],
            },
          ],
        },
      })
      .reply('GET', '/api/v1/targets/connections/c1/resources', {
        status: 200,
        body: {
          resources: [{ id: 'app-api', name: 'stream-api-prod', description: 'https://api' }],
        },
      })
      .reply('POST', '/api/v1/projects/server/targets', { status: 201, body: mapping() });
    const { user: actor } = renderApp('/projects/server/targets', api);

    await actor.click(await screen.findByRole('button', { name: '매핑 추가' }));
    const dialog = screen.getByRole('dialog', { name: '매핑 추가' });
    await actor.selectOptions(within(dialog).getByRole('combobox', { name: '연결' }), 'c1');
    await actor.selectOptions(
      await within(dialog).findByRole('combobox', { name: '리소스' }),
      'app-api',
    );
    await actor.selectOptions(within(dialog).getByRole('combobox', { name: '환경' }), 'production');
    await actor.selectOptions(
      within(dialog).getByRole('combobox', { name: '반영 후 동작' }),
      'redeploy',
    );
    await actor.type(within(dialog).getByRole('textbox', { name: '제외할 키' }), 'SENTRY_*');
    await actor.click(within(dialog).getByRole('checkbox', { name: 'Preview 배포에도 넣기' }));
    await actor.click(within(dialog).getByRole('button', { name: '매핑 만들기' }));

    await waitFor(() =>
      expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
        connectionId: 'c1',
        env: 'production',
        resourceId: 'app-api',
        syncMode: 'auto',
        afterSync: 'redeploy',
        unmanaged: 'keep',
        include: [],
        exclude: ['SENTRY_*'],
        options: { preview: true },
      }),
    );
  });

  it('멤버에게는 매핑 추가가 없다', async () => {
    renderApp('/projects/server/targets', server('member'));
    await screen.findByText('stream-api-prod');
    expect(screen.queryByRole('button', { name: '매핑 추가' })).not.toBeInTheDocument();
  });
});
