import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const project = (name: string, displayName = `${name} 앱`) => ({
  name,
  displayName,
  kind: 'app',
  environments: ['local', 'development', 'production'],
});

const as = (role: 'member' | 'admin') =>
  new FakeApi().reply('GET', '/api/v1/me', { status: 200, body: user({ role }) });

describe('프로젝트 목록', () => {
  it('프로젝트를 이름과 표시 이름으로 보여주고 각 프로젝트와 공유 그룹으로 가는 링크를 준다', async () => {
    const api = as('member').reply('GET', '/api/v1/projects', {
      status: 200,
      body: { projects: [project('server', 'Stream API'), project('web', 'Stream 웹')] },
    });
    renderApp('/', api);

    const server = await screen.findByRole('link', { name: 'server' });
    expect(server).toHaveAttribute('href', '/projects/server');
    expect(screen.getByText('Stream API')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'web' })).toHaveAttribute('href', '/projects/web');
    expect(screen.getByRole('link', { name: /공유 그룹/ })).toHaveAttribute(
      'href',
      '/projects/shared',
    );
  });

  it('프로젝트가 없으면 비어 있다고 안내한다', async () => {
    const api = as('member').reply('GET', '/api/v1/projects', {
      status: 200,
      body: { projects: [] },
    });
    renderApp('/', api);
    expect(await screen.findByText(/아직 프로젝트가 없습니다/)).toBeInTheDocument();
  });

  it('멤버에게는 새 프로젝트 만들기가 보이지 않는다', async () => {
    const api = as('member').reply('GET', '/api/v1/projects', {
      status: 200,
      body: { projects: [project('web')] },
    });
    renderApp('/', api);
    await screen.findByRole('link', { name: 'web' });
    expect(screen.queryByRole('button', { name: '프로젝트 만들기' })).not.toBeInTheDocument();
  });

  it('관리자가 새 프로젝트를 만들면 목록에 나타난다', async () => {
    const api = as('admin')
      .reply(
        'GET',
        '/api/v1/projects',
        { status: 200, body: { projects: [] } },
        { status: 200, body: { projects: [project('app', '모바일 앱')] } },
      )
      .reply('POST', '/api/v1/projects', { status: 201, body: project('app', '모바일 앱') });
    const { user: actor } = renderApp('/', api);

    const form = await screen.findByRole('form', { name: '새 프로젝트' });
    await actor.type(within(form).getByRole('textbox', { name: '이름' }), 'app');
    await actor.type(within(form).getByRole('textbox', { name: '표시 이름' }), '모바일 앱');
    await actor.click(within(form).getByRole('button', { name: '프로젝트 만들기' }));

    expect(await screen.findByRole('link', { name: 'app' })).toBeInTheDocument();
    expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
      name: 'app',
      displayName: '모바일 앱',
    });
  });

  it('이름이 규칙에 맞지 않으면 서버의 안내를 보여준다', async () => {
    const api = as('admin')
      .reply('GET', '/api/v1/projects', { status: 200, body: { projects: [] } })
      .reply('POST', '/api/v1/projects', {
        status: 422,
        body: {
          code: 'invalid_project_name',
          message: '프로젝트 이름은 소문자·숫자·하이픈, 32자 이하여야 합니다: "Web"',
        },
      });
    const { user: actor } = renderApp('/', api);

    const form = await screen.findByRole('form', { name: '새 프로젝트' });
    await actor.type(within(form).getByRole('textbox', { name: '이름' }), 'Web');
    await actor.click(within(form).getByRole('button', { name: '프로젝트 만들기' }));

    expect(await screen.findByText(/32자 이하여야 합니다/)).toBeInTheDocument();
  });
});
