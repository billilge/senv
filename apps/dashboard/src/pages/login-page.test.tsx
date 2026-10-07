import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, unauthorized, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const signedOut = () => new FakeApi().reply('GET', '/api/v1/me', unauthorized);

describe('로그인 화면', () => {
  it('GitHub 로그인 링크는 돌아갈 곳(next)을 담아 서버 로그인 경로로 보낸다', async () => {
    renderApp('/login?next=%2Fdevice%3Fcode%3DBCDF-GHJK', signedOut());
    const link = await screen.findByRole('link', { name: /GitHub로 로그인/ });
    expect(link).toHaveAttribute('href', '/auth/github?next=%2Fdevice%3Fcode%3DBCDF-GHJK');
  });

  it.each([
    ['not_org_member', /조직의 멤버만/],
    ['user_disabled', /비활성화된 사용자/],
    ['invalid_state', /다시 시도/],
    ['github_auth_failed', /GitHub 인증에 실패/],
    ['github_unavailable', /GitHub에 연결할 수 없습니다/],
    ['something_new', /로그인하지 못했습니다/],
  ])('error=%s 이면 그에 맞는 안내를 보여준다', async (code, message) => {
    renderApp(`/login?error=${code}`, signedOut());
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('이미 로그인했으면 가려던 곳으로 보낸다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user() })
      .reply('GET', '/api/v1/projects', { status: 200, body: { projects: [] } });
    const { history } = renderApp('/login?next=%2Fadmin%2Fusers', api);
    await waitFor(() => expect(history.location.pathname).toBe('/admin/users'));
  });
});
