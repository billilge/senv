// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const ENVS = ['local', 'development', 'production'] as const;

function projectServer(
  name: string,
  values: Record<(typeof ENVS)[number], { version: number; variables: Record<string, string> }>,
  kind = 'app',
) {
  const api = new FakeApi()
    .reply('GET', '/api/v1/me', { status: 200, body: user() })
    .reply('GET', `/api/v1/projects/${name}`, {
      status: 200,
      body: { name, displayName: `${name} 앱`, kind, environments: [...ENVS] },
    });
  for (const env of ENVS) {
    api.reply('GET', `/api/v1/projects/${name}/envs/${env}`, {
      status: 200,
      body: { project: name, env, ...values[env] },
    });
  }
  return api;
}

const webValues = {
  local: { version: 2, variables: { API_URL: 'http://localhost:3000', DEBUG: 'true' } },
  development: { version: 1, variables: { API_URL: 'https://dev.api', DEBUG: 'true' } },
  production: { version: 0, variables: {} },
};

const row = (key: string) => {
  const cell = screen.getByRole('rowheader', { name: key });
  return cell.closest('tr') as HTMLTableRowElement;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('키 × 환경 매트릭스', () => {
  it('키를 행으로, 환경을 열로 그리고 열 머리글에 현재 버전을 보여준다', async () => {
    renderApp('/projects/web', projectServer('web', webValues));

    expect(await screen.findByRole('columnheader', { name: /local.*v2/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /development.*v1/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /production.*게시 전/ })).toBeInTheDocument();
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'API_URL',
      'DEBUG',
    ]);
  });

  it('값은 가려서 보여주고, 없는 칸은 누락으로 표시한다', async () => {
    renderApp('/projects/web', projectServer('web', webValues));
    await screen.findByRole('rowheader', { name: 'API_URL' });

    const apiUrl = within(row('API_URL'));
    expect(apiUrl.getAllByText('••••••')).toHaveLength(2);
    expect(apiUrl.getByText('누락')).toBeInTheDocument();
    expect(screen.queryByText('http://localhost:3000')).not.toBeInTheDocument();
  });

  it('다른 환경과 값이 같으면 어느 환경과 같은지 알려준다', async () => {
    renderApp('/projects/web', projectServer('web', webValues));
    await screen.findByRole('rowheader', { name: 'DEBUG' });
    expect(within(row('DEBUG')).getAllByText(/development와 같음|local과 같음/)).toHaveLength(2);
    expect(within(row('API_URL')).queryByText(/같음/)).not.toBeInTheDocument();
  });

  it('보기를 누르면 그 칸의 값을 30초 동안 보여준다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const actor = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp('/projects/web', projectServer('web', webValues));

    await actor.click(await screen.findByRole('button', { name: 'API_URL local 값 보기' }));
    expect(screen.getByText('http://localhost:3000')).toBeInTheDocument();
    expect(screen.queryByText('https://dev.api')).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.queryByText('http://localhost:3000')).not.toBeInTheDocument();
  });

  it('아직 아무 값도 없으면 비어 있다고 안내한다', async () => {
    const empty = { version: 0, variables: {} };
    renderApp(
      '/projects/web',
      projectServer('web', { local: empty, development: empty, production: empty }),
    );
    expect(await screen.findByText(/아직 값이 없습니다/)).toBeInTheDocument();
  });

  it('공유 그룹 화면은 ${shared.KEY}로 참조하는 법을 알려준다', async () => {
    renderApp('/projects/shared', projectServer('shared', webValues, 'shared'));
    expect(await screen.findByText(/\$\{shared\.API_URL\}/)).toBeInTheDocument();
  });

  it('없는 프로젝트면 서버의 안내를 보여준다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', { status: 200, body: user() })
      .reply('GET', '/api/v1/projects/ghost', {
        status: 404,
        body: { code: 'project_not_found', message: '프로젝트가 없습니다: ghost' },
      });
    renderApp('/projects/ghost', api);
    expect(await screen.findByText('프로젝트가 없습니다: ghost')).toBeInTheDocument();
  });
});
