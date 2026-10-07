import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const coolify = {
  type: 'coolify',
  displayName: 'Coolify',
  capabilities: {
    readValues: true,
    deleteKeys: true,
    actions: ['restart', 'redeploy'],
    buildTimeFlag: true,
  },
  connectionFields: [
    { name: 'url', label: 'Coolify 주소', kind: 'url', required: true },
    { name: 'token', label: 'API 토큰', kind: 'secret', required: true },
  ],
  mappingOptionFields: [{ name: 'preview', label: 'Preview 배포에도 넣기', kind: 'boolean' }],
};

const connection = {
  id: 'c1',
  name: 'coolify-main',
  type: 'coolify',
  config: { url: 'https://coolify.example' },
  mappingCount: 2,
  createdAt: '2026-10-08T05:00:00.000Z',
  updatedAt: '2026-10-08T05:00:00.000Z',
};

const asAdmin = () =>
  new FakeApi()
    .reply('GET', '/api/v1/me', { status: 200, body: user({ role: 'admin' }) })
    .reply('GET', '/api/v1/projects', { status: 200, body: { projects: [] } })
    .reply('GET', '/api/v1/users', { status: 200, body: { users: [] } })
    .reply('GET', '/api/v1/targets/providers', { status: 200, body: { providers: [coolify] } });

describe('배포 대상 연결 (관리자)', () => {
  it('헤더의 배포 대상 탭에서 연결 목록을 본다 (주소, 매핑 수)', async () => {
    const api = asAdmin().reply('GET', '/api/v1/targets/connections', {
      status: 200,
      body: { connections: [connection] },
    });
    const { user: actor, history } = renderApp('/', api);

    await actor.click(await screen.findByRole('link', { name: /^배포 대상/ }));
    await waitFor(() => expect(history.location.pathname).toBe('/admin/targets'));

    const row = within((await screen.findByText('coolify-main')).closest('li') as HTMLElement);
    expect(row.getByText('https://coolify.example')).toBeInTheDocument();
    expect(row.getByText(/매핑 2개/)).toBeInTheDocument();
  });

  it('제공자가 내준 필드로 연결을 추가한다 (비밀 필드는 가린다)', async () => {
    const api = asAdmin()
      .reply(
        'GET',
        '/api/v1/targets/connections',
        { status: 200, body: { connections: [] } },
        { status: 200, body: { connections: [connection] } },
      )
      .reply('POST', '/api/v1/targets/connections', { status: 201, body: connection });
    const { user: actor } = renderApp('/admin/targets', api);

    await actor.click(await screen.findByRole('button', { name: '연결 추가' }));
    const dialog = screen.getByRole('dialog', { name: '연결 추가' });
    await actor.type(within(dialog).getByRole('textbox', { name: '이름' }), 'coolify-main');
    await actor.type(
      within(dialog).getByRole('textbox', { name: 'Coolify 주소' }),
      'https://coolify.example',
    );
    const token = within(dialog).getByLabelText('API 토큰');
    expect(token).toHaveAttribute('type', 'password');
    await actor.type(token, 'secret-token');
    await actor.click(within(dialog).getByRole('button', { name: '연결 확인 후 저장' }));

    expect(await screen.findByText('coolify-main')).toBeInTheDocument();
    expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
      name: 'coolify-main',
      type: 'coolify',
      config: { url: 'https://coolify.example', token: 'secret-token' },
    });
  });

  it('자격 증명이 거부되면 대화상자에 안내한다', async () => {
    const api = asAdmin()
      .reply('GET', '/api/v1/targets/connections', { status: 200, body: { connections: [] } })
      .reply('POST', '/api/v1/targets/connections', {
        status: 422,
        body: { code: 'target_auth_failed', message: 'Coolify가 API 토큰을 거부했습니다' },
      });
    const { user: actor } = renderApp('/admin/targets', api);

    await actor.click(await screen.findByRole('button', { name: '연결 추가' }));
    const dialog = screen.getByRole('dialog', { name: '연결 추가' });
    await actor.type(within(dialog).getByRole('textbox', { name: '이름' }), 'x');
    await actor.type(within(dialog).getByRole('textbox', { name: 'Coolify 주소' }), 'https://c');
    await actor.type(within(dialog).getByLabelText('API 토큰'), 'bad');
    await actor.click(within(dialog).getByRole('button', { name: '연결 확인 후 저장' }));

    expect(await within(dialog).findByText(/토큰을 거부했습니다/)).toBeInTheDocument();
  });

  it('연결을 확인하고 지운다', async () => {
    const api = asAdmin()
      .reply(
        'GET',
        '/api/v1/targets/connections',
        { status: 200, body: { connections: [{ ...connection, mappingCount: 0 }] } },
        { status: 200, body: { connections: [] } },
      )
      .reply('POST', '/api/v1/targets/connections/c1/test', { status: 204 })
      .reply('DELETE', '/api/v1/targets/connections/c1', { status: 204 });
    const { user: actor } = renderApp('/admin/targets', api);

    await actor.click(await screen.findByRole('button', { name: 'coolify-main 연결 확인' }));
    expect(await screen.findByText(/coolify-main: 연결됨/)).toBeInTheDocument();
    await actor.click(screen.getByRole('button', { name: 'coolify-main 삭제' }));
    await waitFor(() => expect(screen.queryByText('coolify-main')).not.toBeInTheDocument());
  });

  it('멤버에게는 배포 대상 탭이 없다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user() })
      .reply('GET', '/api/v1/projects', { status: 200, body: { projects: [] } });
    renderApp('/', api);
    await screen.findByRole('link', { name: /^프로젝트/ });
    expect(screen.queryByRole('link', { name: /^배포 대상/ })).not.toBeInTheDocument();
  });
});
