import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const AT = '2026-10-09T09:00:00.000Z';
const recently = () => new Date(Date.now() - 10_000).toISOString();

const device = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  name: 'alice-mbp',
  createdAt: AT,
  lastSeenAt: recently(),
  ...overrides,
});

const link = (overrides: Record<string, unknown> = {}) => ({
  id: 'l1',
  device: { id: 'd1', name: 'alice-mbp' },
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

const project = (name: string) => ({
  name,
  displayName: `${name} 앱`,
  kind: 'app',
  environments: ['local', 'development', 'production'],
});

function server(devices: unknown[], links: unknown[]) {
  return new FakeApi()
    .reply('GET', '/api/v1/me', { status: 200, body: user() })
    .reply('GET', '/api/v1/projects', {
      status: 200,
      body: { projects: [project('web'), project('api')] },
    })
    .reply('GET', '/api/v1/me/devices', { status: 200, body: { devices } })
    .reply('GET', '/api/v1/me/local-links', { status: 200, body: { links } });
}

const linkRow = async (path: string) =>
  (await screen.findByText(path)).closest('li') as HTMLElement;

describe('내 로컬 연결', () => {
  it('사용자 메뉴에서 들어가 내 기기(실행 중 여부)와 연결 상태를 본다', async () => {
    const api = server(
      [device(), device({ id: 'd2', name: 'desk', lastSeenAt: '2026-01-01T00:00:00.000Z' })],
      [
        link(),
        link({
          id: 'l2',
          project: 'api',
          path: '/Users/alice/work/api',
          current: { version: 5, sharedVersion: 1 },
          lastWritten: { version: 4, sharedVersion: 1, at: AT },
        }),
      ],
    );
    const { user: actor } = renderApp('/', api);

    await actor.click(await screen.findByRole('button', { name: /alice/ }));
    await actor.click(await screen.findByRole('menuitem', { name: '내 로컬 연결' }));

    expect(await screen.findByRole('heading', { name: '내 로컬 연결' })).toBeInTheDocument();
    const mbp = (await screen.findByText('alice-mbp', { selector: 'span' })).closest(
      'li',
    ) as HTMLElement;
    expect(within(mbp).getByText('실행 중')).toBeInTheDocument();
    const desk = screen.getByText('desk', { selector: 'span' }).closest('li') as HTMLElement;
    expect(within(desk).queryByText('실행 중')).not.toBeInTheDocument();

    expect(
      within(await linkRow('/Users/alice/work/web')).getByText(/v3 반영됨/),
    ).toBeInTheDocument();
    expect(
      within(await linkRow('/Users/alice/work/api')).getByText(/v5 반영 대기/),
    ).toBeInTheDocument();
  });

  it('기기가 없으면 senv agent install을 안내하고 연결 추가를 막는다', async () => {
    renderApp('/me/local', server([], []));

    expect(await screen.findByText(/senv agent install/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '연결 추가' })).toBeDisabled();
  });

  it('승인 대기 연결은 PC에서 승인하는 명령을, 고친 파일은 이유와 덮어쓰기를 보여준다', async () => {
    const api = server(
      [device()],
      [
        link({
          id: 'l2',
          status: 'pending',
          approvedAt: null,
          lastWritten: null,
          lastState: null,
          path: '/p',
        }),
        link({
          id: 'l3',
          path: '/m',
          lastState: {
            state: 'modified',
            message: '직접 고친 것 같아 덮어쓰지 않았습니다',
            at: AT,
          },
        }),
      ],
    ).reply('POST', '/api/v1/me/local-links/l3/overwrite', {
      status: 200,
      body: link({ id: 'l3', path: '/m', overwriteRequested: true }),
    });
    const { user: actor } = renderApp('/me/local', api);

    expect(within(await linkRow('/p')).getByText('senv link approve l2')).toBeInTheDocument();
    const modified = await linkRow('/m');
    expect(within(modified).getByText(/직접 고친 것 같아/)).toBeInTheDocument();

    await actor.click(within(modified).getByRole('button', { name: '/m 덮어쓰기' }));

    await waitFor(() =>
      expect(
        api.requests.some((r) => r.method === 'POST' && r.path.endsWith('/l3/overwrite')),
      ).toBe(true),
    );
  });

  it('연결 추가: 기기·프로젝트·폴더 경로를 보내고, 절대 경로가 아니면 막는다', async () => {
    const api = server([device()], []).reply('POST', '/api/v1/me/local-links', {
      status: 201,
      body: link({ status: 'pending', approvedAt: null }),
    });
    const { user: actor } = renderApp('/me/local', api);

    await actor.click(await screen.findByRole('button', { name: '연결 추가' }));
    const dialog = await screen.findByRole('dialog');
    await actor.selectOptions(within(dialog).getByRole('combobox', { name: '프로젝트' }), 'api');
    const path = within(dialog).getByRole('textbox', { name: '폴더 경로' });
    await actor.type(path, 'work/api');
    expect(within(dialog).getByText(/절대 경로여야 합니다/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '추가' })).toBeDisabled();

    await actor.clear(path);
    await actor.type(path, '/Users/alice/work/api');
    await actor.click(within(dialog).getByRole('button', { name: '추가' }));

    await waitFor(() =>
      expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
        deviceId: 'd1',
        project: 'api',
        path: '/Users/alice/work/api',
      }),
    );
    expect(await screen.findByText(/senv link approve/)).toBeInTheDocument();
  });

  it('일시정지와 삭제', async () => {
    const api = server([device()], [link()])
      .reply('PATCH', '/api/v1/me/local-links/l1', {
        status: 200,
        body: link({ status: 'paused' }),
      })
      .reply('DELETE', '/api/v1/me/local-links/l1', { status: 204 });
    const { user: actor } = renderApp('/me/local', api);
    const row = await linkRow('/Users/alice/work/web');

    await actor.click(within(row).getByRole('button', { name: '/Users/alice/work/web 일시정지' }));
    await actor.click(within(row).getByRole('button', { name: '/Users/alice/work/web 삭제' }));

    await waitFor(() => {
      expect(api.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ paused: true });
      expect(api.requests.some((r) => r.method === 'DELETE')).toBe(true);
    });
  });
});

describe('프로젝트 화면의 local 열', () => {
  it('내 연결이 있으면 내 PC에 반영된 버전을 보여준다', async () => {
    const api = server([device()], [link({ current: { version: 4, sharedVersion: 1 } })]).reply(
      'GET',
      '/api/v1/projects/web',
      { status: 200, body: project('web') },
    );
    for (const env of ['local', 'development', 'production']) {
      api.reply('GET', `/api/v1/projects/web/envs/${env}`, {
        status: 200,
        body: {
          project: 'web',
          env,
          version: env === 'local' ? 4 : 0,
          variables: env === 'local' ? { API_URL: 'http://localhost:3000' } : {},
        },
      });
    }
    renderApp('/projects/web', api);

    expect(
      await screen.findByRole('columnheader', { name: /local.*내 PC v3, v4 대기/ }),
    ).toBeInTheDocument();
  });
});
