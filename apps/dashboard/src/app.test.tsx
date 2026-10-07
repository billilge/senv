import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, unauthorized, user } from './testing/fake-api';
import { renderApp } from './testing/render-app';

const projectsReply = { status: 200, body: { projects: [] } };

describe('로그인 상태에 따른 화면', () => {
  it('로그인하지 않았으면 /login으로 보내고 GitHub 로그인 링크를 보여준다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/me', unauthorized);
    const { history } = renderApp('/projects/web', api);

    expect(await screen.findByRole('link', { name: /GitHub로 로그인/ })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/login');
    expect(new URLSearchParams(history.location.search).get('next')).toBe('/projects/web');
  });

  it('승인 대기 사용자는 승인을 기다린다는 안내만 본다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/me', {
      status: 200,
      body: user({ status: 'pending' }),
    });
    renderApp('/', api);
    expect(await screen.findByText(/관리자의 승인을 기다리는 중/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '프로젝트' })).not.toBeInTheDocument();
  });

  it('활성 사용자는 위쪽에서 자기 GitHub 사용자명과 로그아웃 버튼을 본다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user() })
      .reply('GET', '/api/v1/projects', projectsReply);
    renderApp('/', api);
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });

  it('로그아웃하면 서버에 알리고 로그인 화면으로 간다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user() }, unauthorized)
      .reply('GET', '/api/v1/projects', projectsReply)
      .reply('POST', '/api/v1/auth/logout', { status: 204 });
    const { user: actor, history } = renderApp('/', api);

    await actor.click(await screen.findByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(history.location.pathname).toBe('/login'));
    expect(api.requests.some((r) => r.method === 'POST' && r.path === '/api/v1/auth/logout')).toBe(
      true,
    );
  });

  it('관리자에게만 사용자 관리 메뉴가 보인다', async () => {
    const memberApi = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user() })
      .reply('GET', '/api/v1/projects', projectsReply);
    const { unmount } = renderApp('/', memberApi);
    await screen.findByText('alice');
    expect(screen.queryByRole('link', { name: '사용자 관리' })).not.toBeInTheDocument();
    unmount();

    const adminApi = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user({ login: 'boss', role: 'admin' }) })
      .reply('GET', '/api/v1/projects', projectsReply);
    renderApp('/', adminApi);
    expect(await screen.findByRole('link', { name: '사용자 관리' })).toBeInTheDocument();
  });
});
