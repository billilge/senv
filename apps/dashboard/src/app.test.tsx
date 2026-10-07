import { screen, waitFor, within } from '@testing-library/react';
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

  it('활성 사용자는 위쪽 헤더에서 앱 이름·프로젝트 메뉴와 자기 사용자 메뉴를 본다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user() })
      .reply('GET', '/api/v1/projects', projectsReply);
    const { user: actor } = renderApp('/', api);

    const header = await screen.findByRole('banner');
    expect(within(header).getByRole('link', { name: 'Stream Env Control' })).toHaveAttribute(
      'href',
      '/',
    );
    const tabs = within(header).getByRole('navigation', { name: '주 메뉴' });
    const projectsTab = within(tabs).getByRole('link', { name: /^프로젝트/ });
    expect(projectsTab).toHaveAttribute('href', '/');
    expect(projectsTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toBeInTheDocument();

    await actor.click(within(header).getByRole('button', { name: /alice/ }));
    expect(await screen.findByRole('menuitem', { name: '로그아웃' })).toBeInTheDocument();
  });

  it('로그아웃하면 서버에 알리고 로그인 화면으로 간다', async () => {
    let loggedOut = false;
    const api = new FakeApi()
      .on('GET', '/api/v1/me', () => (loggedOut ? unauthorized : { status: 200, body: user() }))
      .reply('GET', '/api/v1/projects', projectsReply)
      .on('POST', '/api/v1/auth/logout', () => {
        loggedOut = true;
        return { status: 204 };
      });
    const { user: actor, history } = renderApp('/', api);

    await actor.click(await screen.findByRole('button', { name: /alice/ }));
    await actor.click(await screen.findByRole('menuitem', { name: '로그아웃' }));

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
    expect(screen.queryByRole('link', { name: /^사용자 관리/ })).not.toBeInTheDocument();
    unmount();

    const adminApi = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user({ login: 'boss', role: 'admin' }) })
      .reply('GET', '/api/v1/projects', projectsReply);
    renderApp('/', adminApi);
    expect(await screen.findByRole('link', { name: /^사용자 관리/ })).toBeInTheDocument();
  });

  it('프로젝트 탭에는 프로젝트 수를, 관리자의 사용자 관리 탭에는 승인 대기 인원을 붙인다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user({ role: 'admin' }) })
      .reply('GET', '/api/v1/projects', {
        status: 200,
        body: {
          projects: ['server', 'web'].map((name) => ({
            name,
            displayName: name,
            kind: 'app',
            environments: ['local', 'development', 'production'],
          })),
        },
      })
      .reply('GET', '/api/v1/users', {
        status: 200,
        body: { users: [user({ id: 'u2', login: 'bob', status: 'pending' }), user()] },
      });
    renderApp('/', api);

    expect(await screen.findByRole('link', { name: /^프로젝트.*2/ })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^사용자 관리.*1/ })).toBeInTheDocument();
  });
});
