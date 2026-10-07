import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const admin = user({ id: 'u1', login: 'alice', role: 'admin' });
const pending = user({ id: 'u2', login: 'bob', name: 'Bob', status: 'pending' });
const member = user({ id: 'u3', login: 'carol', name: null });

const asAdmin = () => new FakeApi().reply('GET', '/api/v1/me', { status: 200, body: admin });

const row = (login: string) => {
  const cell = screen.getByRole('rowheader', { name: new RegExp(login) });
  return within(cell.closest('tr') as HTMLTableRowElement);
};

describe('사용자 관리', () => {
  it('서버가 준 순서(승인 대기 먼저)대로 사용자와 상태·역할을 보여준다', async () => {
    const api = asAdmin().reply('GET', '/api/v1/users', {
      status: 200,
      body: { users: [pending, admin, member] },
    });
    renderApp('/admin/users', api);

    await screen.findByRole('rowheader', { name: /bob/ });
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      expect.stringContaining('bob'),
      expect.stringContaining('alice'),
      expect.stringContaining('carol'),
    ]);
    expect(screen.getByText(/승인 대기 1명/)).toBeInTheDocument();
    expect(row('bob').getByText('승인 대기')).toBeInTheDocument();
    expect(row('alice').getByText('관리자')).toBeInTheDocument();
    expect(row('alice').getByText('나')).toBeInTheDocument();
    expect(row('carol').getByText('멤버')).toBeInTheDocument();
  });

  it('승인하면 승인 요청을 보내고 목록을 새로 불러온다', async () => {
    const api = asAdmin()
      .reply(
        'GET',
        '/api/v1/users',
        { status: 200, body: { users: [pending, admin] } },
        { status: 200, body: { users: [admin, { ...pending, status: 'active' }] } },
      )
      .reply('POST', '/api/v1/users/u2/activate', {
        status: 200,
        body: { ...pending, status: 'active' },
      });
    const { user: actor } = renderApp('/admin/users', api);

    await actor.click(await screen.findByRole('button', { name: 'bob 승인' }));

    expect(await screen.findByRole('button', { name: 'bob 비활성화' })).toBeInTheDocument();
    expect(screen.queryByText(/승인 대기 \d+명/)).not.toBeInTheDocument();
    expect(
      api.requests.some((r) => r.method === 'POST' && r.path === '/api/v1/users/u2/activate'),
    ).toBe(true);
  });

  it('비활성화한 사용자는 다시 활성화할 수 있다', async () => {
    const disabled = { ...member, status: 'disabled' };
    const api = asAdmin()
      .reply(
        'GET',
        '/api/v1/users',
        { status: 200, body: { users: [admin, member] } },
        { status: 200, body: { users: [admin, disabled] } },
      )
      .reply('POST', '/api/v1/users/u3/disable', { status: 200, body: disabled });
    const { user: actor } = renderApp('/admin/users', api);

    await actor.click(await screen.findByRole('button', { name: 'carol 비활성화' }));

    expect(await screen.findByRole('button', { name: 'carol 다시 활성화' })).toBeInTheDocument();
    expect(row('carol').getByText('비활성')).toBeInTheDocument();
  });

  it('멤버를 관리자로 지정하면 역할 변경을 보낸다', async () => {
    const promoted = { ...member, role: 'admin' };
    const api = asAdmin()
      .reply(
        'GET',
        '/api/v1/users',
        { status: 200, body: { users: [admin, member] } },
        { status: 200, body: { users: [admin, promoted] } },
      )
      .reply('PUT', '/api/v1/users/u3/role', { status: 200, body: promoted });
    const { user: actor } = renderApp('/admin/users', api);

    await actor.click(await screen.findByRole('button', { name: 'carol 관리자로 지정' }));

    expect(await screen.findByRole('button', { name: 'carol 멤버로 변경' })).toBeInTheDocument();
    expect(api.requests.find((r) => r.method === 'PUT')?.body).toEqual({ role: 'admin' });
  });

  it('서버가 거부하면(마지막 관리자 등) 그 안내를 보여준다', async () => {
    const api = asAdmin()
      .reply('GET', '/api/v1/users', { status: 200, body: { users: [admin, member] } })
      .reply('PUT', '/api/v1/users/u1/role', {
        status: 422,
        body: {
          code: 'last_admin',
          message: '마지막 활성 관리자는 강등하거나 비활성화할 수 없습니다',
        },
      });
    const { user: actor } = renderApp('/admin/users', api);

    await actor.click(await screen.findByRole('button', { name: 'alice 멤버로 변경' }));

    expect(await screen.findByText(/마지막 활성 관리자는/)).toBeInTheDocument();
  });

  it('관리자가 아니면 서버의 안내를 보여준다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user() })
      .reply('GET', '/api/v1/users', {
        status: 403,
        body: { code: 'admin_required', message: '관리자만 할 수 있습니다' },
      });
    renderApp('/admin/users', api);
    expect(await screen.findByText('관리자만 할 수 있습니다')).toBeInTheDocument();
  });

  it('아직 로그인하지 않은 GitHub 사용자명에 역할을 미리 지정하고 지울 수 있다', async () => {
    const assignment = { login: 'dave', role: 'admin', createdAt: '2026-10-08T05:00:00.000Z' };
    const api = asAdmin()
      .reply('GET', '/api/v1/users', { status: 200, body: { users: [admin] } })
      .reply(
        'GET',
        '/api/v1/role-assignments',
        { status: 200, body: { assignments: [] } },
        { status: 200, body: { assignments: [assignment] } },
        { status: 200, body: { assignments: [] } },
      )
      .reply('PUT', '/api/v1/role-assignments/dave', { status: 200, body: assignment })
      .reply('DELETE', '/api/v1/role-assignments/dave', { status: 204 });
    const { user: actor } = renderApp('/admin/users', api);

    const section = within(await screen.findByRole('region', { name: '역할 미리 지정' }));
    await actor.type(section.getByRole('textbox', { name: 'GitHub 사용자명' }), 'dave');
    await actor.selectOptions(section.getByRole('combobox', { name: '역할' }), 'admin');
    await actor.click(section.getByRole('button', { name: '지정' }));

    expect(await section.findByText('dave')).toBeInTheDocument();
    expect(api.requests.find((r) => r.method === 'PUT')?.body).toEqual({ role: 'admin' });

    await actor.click(section.getByRole('button', { name: 'dave 지정 취소' }));
    await waitFor(() => expect(section.queryByText('dave')).not.toBeInTheDocument());
  });

  it('이미 로그인한 사용자를 지정하면 서버 안내를 보여준다', async () => {
    const api = asAdmin()
      .reply('GET', '/api/v1/users', { status: 200, body: { users: [admin] } })
      .reply('GET', '/api/v1/role-assignments', { status: 200, body: { assignments: [] } })
      .reply('PUT', '/api/v1/role-assignments/alice', {
        status: 409,
        body: {
          code: 'user_exists',
          message: '이미 로그인한 사용자입니다. 사용자 목록에서 역할을 바꾸세요: alice',
        },
      });
    const { user: actor } = renderApp('/admin/users', api);

    const section = within(await screen.findByRole('region', { name: '역할 미리 지정' }));
    await actor.type(section.getByRole('textbox', { name: 'GitHub 사용자명' }), 'alice');
    await actor.click(section.getByRole('button', { name: '지정' }));

    expect(await section.findByText(/이미 로그인한 사용자입니다/)).toBeInTheDocument();
  });
});
