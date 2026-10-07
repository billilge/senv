import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const ENVS = ['local', 'development', 'production'] as const;
const at = '2026-10-08T05:30:00.000Z';

const version = (n: number, message: string, login: string | null = 'alice') => ({
  version: n,
  message,
  createdAt: at,
  author: { id: login ? `u-${login}` : 'token_ci', login },
});

/** web 프로젝트 development: v1 {A:1, B:1} → v2 {A:2, C:3} */
function server() {
  const api = new FakeApi()
    .reply('GET', '/api/v1/me', { status: 200, body: user() })
    .reply('GET', '/api/v1/projects', { status: 200, body: { projects: [] } })
    .reply('GET', '/api/v1/projects/web', {
      status: 200,
      body: { name: 'web', displayName: 'Stream 웹', kind: 'app', environments: [...ENVS] },
    })
    .reply('GET', '/api/v1/projects/web/envs/development/versions', {
      status: 200,
      body: { versions: [version(2, 'API 주소 변경', null), version(1, '첫 게시')] },
    })
    .reply('GET', '/api/v1/projects/web/envs/development/versions/1', {
      status: 200,
      body: { project: 'web', env: 'development', version: 1, variables: { A: '1', B: '1' } },
    })
    .reply('GET', '/api/v1/projects/web/envs/development/versions/2', {
      status: 200,
      body: { project: 'web', env: 'development', version: 2, variables: { A: '2', C: '3' } },
    });
  for (const env of ['local', 'production']) {
    api.reply('GET', `/api/v1/projects/web/envs/${env}/versions`, {
      status: 200,
      body: { versions: [] },
    });
  }
  for (const env of ENVS) {
    api.reply('GET', `/api/v1/projects/web/envs/${env}`, {
      status: 200,
      body: { project: 'web', env, version: 0, variables: {} },
    });
  }
  return api;
}

const row = (label: string) => within(screen.getByText(label).closest('li') as HTMLLIElement);

describe('버전 기록', () => {
  it('프로젝트 화면의 버전 기록 탭으로 가면 local 환경의 기록부터 보여준다', async () => {
    const { user: actor, history } = renderApp('/projects/web', server());

    await actor.click(await screen.findByRole('link', { name: '버전 기록' }));

    await waitFor(() => expect(history.location.pathname).toBe('/projects/web/history'));
    expect(await screen.findByText(/아직 게시한 버전이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'local' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('버전을 최신부터 메시지·작성자와 함께 보여주고, 최신 버전에 현재 표시를 단다', async () => {
    renderApp('/projects/web/history?env=development', server());

    expect(await screen.findByText('API 주소 변경')).toBeInTheDocument();
    expect(row('API 주소 변경').getByText('현재')).toBeInTheDocument();
    expect(row('API 주소 변경').getByText(/토큰/)).toBeInTheDocument();
    expect(row('첫 게시').getByText(/alice/)).toBeInTheDocument();
    expect(row('첫 게시').queryByText('현재')).not.toBeInTheDocument();
  });

  it('환경을 바꾸면 그 환경의 기록을 보여준다', async () => {
    const { user: actor, history } = renderApp('/projects/web/history?env=development', server());
    await screen.findByText('API 주소 변경');

    await actor.click(screen.getByRole('button', { name: 'production' }));

    expect(await screen.findByText(/아직 게시한 버전이 없습니다/)).toBeInTheDocument();
    expect(new URLSearchParams(history.location.search).get('env')).toBe('production');
  });

  it('이전과 비교하면 바뀐 키를 보여주고 값은 눌러야 보인다', async () => {
    const { user: actor } = renderApp('/projects/web/history?env=development', server());

    await actor.click(await screen.findByRole('button', { name: 'v2 이전과 비교' }));

    const compare = await screen.findByRole('region', { name: 'v1 → v2 비교' });
    expect(within(compare).getByText('A').closest('li')).toHaveTextContent('변경');
    expect(within(compare).getByText('B').closest('li')).toHaveTextContent('삭제');
    expect(within(compare).getByText('C').closest('li')).toHaveTextContent('추가');
    expect(within(compare).queryByText('2')).not.toBeInTheDocument();

    await actor.click(within(compare).getByRole('button', { name: 'A 값 보기' }));
    expect(within(compare).getByText('1')).toBeInTheDocument();
    expect(within(compare).getByText('2')).toBeInTheDocument();
  });

  it('되돌리면 바뀔 내용을 확인한 뒤 기준 버전과 함께 요청하고 결과를 알려준다', async () => {
    const api = server().reply('POST', '/api/v1/projects/web/envs/development/rollback', {
      status: 201,
      body: { version: 3, diff: { added: ['B'], removed: ['C'], changed: ['A'], unchanged: [] } },
    });
    const { user: actor } = renderApp('/projects/web/history?env=development', api);

    await actor.click(await screen.findByRole('button', { name: 'v1로 되돌리기' }));
    const dialog = await screen.findByRole('dialog', { name: 'v1로 되돌리기' });
    expect(await within(dialog).findByText('C')).toBeInTheDocument();
    await actor.type(within(dialog).getByRole('textbox', { name: '메시지' }), '사고 복구');
    await actor.click(within(dialog).getByRole('button', { name: '되돌리기' }));

    expect(await screen.findByText(/v1로 되돌렸습니다.*development v3/)).toBeInTheDocument();
    expect(api.requests.find((r) => r.path.endsWith('/rollback'))?.body).toEqual({
      toVersion: 1,
      baseVersion: 2,
      message: '사고 복구',
    });
  });

  it('그 사이 다른 게시가 있었으면(409) 대화상자에서 알려준다', async () => {
    const api = server().reply('POST', '/api/v1/projects/web/envs/development/rollback', {
      status: 409,
      body: {
        code: 'version_conflict',
        message: '그 사이 다른 게시가 있었습니다 (기준 v2, 현재 v3)',
      },
    });
    const { user: actor } = renderApp('/projects/web/history?env=development', api);

    await actor.click(await screen.findByRole('button', { name: 'v1로 되돌리기' }));
    const dialog = await screen.findByRole('dialog', { name: 'v1로 되돌리기' });
    await actor.click(within(dialog).getByRole('button', { name: '되돌리기' }));

    expect(await within(dialog).findByText(/현재 v3/)).toBeInTheDocument();
  });
});
