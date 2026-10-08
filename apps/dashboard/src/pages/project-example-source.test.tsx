import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const ENVS = ['local', 'development', 'production'] as const;
const STATUS = '/api/v1/projects/web/example-source';
const INSTALL_URL = 'https://github.com/apps/senv/installations/new';

const source = (overrides: Record<string, unknown> = {}) => ({
  repoId: 102,
  repoFullName: 'billilge/stream-web',
  path: '.env.example',
  fileUrl: 'https://github.com/billilge/stream-web/blob/HEAD/.env.example',
  lastResult: 'ok',
  lastMessage: null,
  lastCheckedAt: '2026-10-09T09:00:00.000Z',
  keys: ['REDIS_URL', 'VITE_API_URL'],
  lastAdded: ['REDIS_URL'],
  lastRemoved: ['OLD_FLAG'],
  skipped: [{ line: 7, reason: 'invalid_key' }],
  ...overrides,
});

const status = (body: Record<string, unknown> = {}) => ({
  status: 200,
  body: { enabled: true, installUrl: INSTALL_URL, source: null, ...body },
});

function server(role: 'member' | 'admin' = 'member') {
  const api = new FakeApi()
    .reply('GET', '/api/v1/me', { status: 200, body: user({ role }) })
    .reply('GET', '/api/v1/projects', { status: 200, body: { projects: [] } })
    .reply('GET', '/api/v1/users', { status: 200, body: { users: [] } })
    .reply('GET', '/api/v1/projects/web', {
      status: 200,
      body: { name: 'web', displayName: 'Stream 웹', kind: 'app', environments: [...ENVS] },
    })
    .reply('GET', '/api/v1/projects/web/schema', {
      status: 200,
      body: { publicPrefixes: ['VITE_'], keys: [] },
    })
    .reply('GET', STATUS, status());
  for (const env of ENVS) {
    api.reply('GET', `/api/v1/projects/web/envs/${env}`, {
      status: 200,
      body: { project: 'web', env, version: 1, variables: {} },
    });
  }
  return api;
}

const panel = async () =>
  within(
    (await screen.findByRole('heading', { name: '.env.example 연결' })).closest(
      'section',
    ) as HTMLElement,
  );

describe('키 스키마 탭의 .env.example 연결 (결정 73~76)', () => {
  it('연결이 없으면 하는 일을 알리고, 관리자에게만 저장소 연결 버튼을 보여준다', async () => {
    renderApp('/projects/web/schema', server('member'));
    expect(await (await panel()).findByText(/기본 브랜치/)).toBeInTheDocument();
    expect((await panel()).queryByRole('button', { name: '저장소 연결' })).toBeNull();
  });

  it('관리자는 App이 설치된 저장소와 파일 경로를 골라 연결한다', async () => {
    const api = server('admin')
      .reply('GET', STATUS, status(), status({ source: source() }))
      .reply('GET', '/api/v1/github/repositories', {
        status: 200,
        body: {
          repositories: [
            { id: 101, fullName: 'billilge/stream-server' },
            { id: 102, fullName: 'billilge/stream-web' },
          ],
        },
      })
      .reply('PUT', STATUS, { status: 200, body: source() });
    const { user: actor } = renderApp('/projects/web/schema', api);

    await actor.click(await (await panel()).findByRole('button', { name: '저장소 연결' }));
    const dialog = screen.getByRole('dialog', { name: '.env.example 연결' });
    await actor.selectOptions(
      await within(dialog).findByRole('combobox', { name: '저장소' }),
      '102',
    );
    const path = within(dialog).getByRole('textbox', { name: '파일 경로' });
    expect(path).toHaveValue('.env.example');
    await actor.clear(path);
    await actor.type(path, 'apps/web/.env.example');
    await actor.click(within(dialog).getByRole('button', { name: '연결' }));

    await waitFor(() =>
      expect(api.requests.find((request) => request.method === 'PUT')?.body).toEqual({
        repoId: 102,
        path: 'apps/web/.env.example',
      }),
    );
    expect(await (await panel()).findByText('billilge/stream-web · .env.example')).toBeVisible();
  });

  it('저장소에 App이 설치되어 있지 않으면 설치 링크를 보여준다', async () => {
    const api = server('admin').reply('GET', '/api/v1/github/repositories', {
      status: 200,
      body: { repositories: [] },
    });
    const { user: actor } = renderApp('/projects/web/schema', api);

    await actor.click(await (await panel()).findByRole('button', { name: '저장소 연결' }));
    const dialog = screen.getByRole('dialog', { name: '.env.example 연결' });
    expect(await within(dialog).findByRole('link', { name: /App 설치/ })).toHaveAttribute(
      'href',
      INSTALL_URL,
    );
  });

  it('연결 상태: 파일 링크, 등록한 키, 예시에서 빠진 키, 읽지 못한 줄을 보여주고 지금 확인한다', async () => {
    const api = server('member')
      .reply('GET', STATUS, status({ source: source() }))
      .reply('POST', `${STATUS}/check`, { status: 200, body: source() });
    const { user: actor } = renderApp('/projects/web/schema', api);
    const box = await panel();

    expect(
      await box.findByRole('link', { name: 'billilge/stream-web · .env.example' }),
    ).toHaveAttribute('href', 'https://github.com/billilge/stream-web/blob/HEAD/.env.example');
    expect(box.getByText('REDIS_URL')).toBeInTheDocument();
    expect(box.getByText('OLD_FLAG')).toBeInTheDocument();
    expect(box.getByText(/7번째 줄/)).toBeInTheDocument();
    expect(box.queryByRole('button', { name: '연결 끊기' })).toBeNull();

    await actor.click(box.getByRole('button', { name: '지금 확인' }));
    await waitFor(() =>
      expect(api.requests.some((request) => request.method === 'POST')).toBe(true),
    );
  });

  it('읽지 못했으면 결과와 이유를 보여준다', async () => {
    const api = server('member').reply(
      'GET',
      STATUS,
      status({
        source: source({
          lastResult: 'not_found',
          lastMessage: '저장소 기본 브랜치에 .env.example이(가) 없습니다',
        }),
      }),
    );
    renderApp('/projects/web/schema', api);
    const box = await panel();
    expect(await box.findByText('파일 없음')).toBeInTheDocument();
    expect(box.getByText(/기본 브랜치에 .env.example이\(가\) 없습니다/)).toBeInTheDocument();
  });

  it('관리자는 연결을 끊는다', async () => {
    const api = server('admin')
      .reply('GET', STATUS, status({ source: source() }), status())
      .reply('DELETE', STATUS, { status: 204 });
    const { user: actor } = renderApp('/projects/web/schema', api);

    await actor.click(await (await panel()).findByRole('button', { name: '연결 끊기' }));
    await waitFor(() =>
      expect(api.requests.some((request) => request.method === 'DELETE')).toBe(true),
    );
    expect(await (await panel()).findByRole('button', { name: '저장소 연결' })).toBeVisible();
  });

  it('GitHub App이 설정되지 않았으면 안내만 보여준다', async () => {
    const api = server('admin').reply('GET', STATUS, status({ enabled: false, installUrl: null }));
    renderApp('/projects/web/schema', api);
    const box = await panel();
    expect(await box.findByText(/GITHUB_APP_ID/)).toBeInTheDocument();
    expect(box.queryByRole('button', { name: '저장소 연결' })).toBeNull();
  });
});
