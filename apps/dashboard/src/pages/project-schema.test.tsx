import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const ENVS = ['local', 'development', 'production'] as const;

const key = (name: string, overrides: Record<string, unknown> = {}) => ({
  key: name,
  type: 'string',
  visibility: 'secret',
  required: false,
  optionalIn: [],
  buildTime: false,
  description: '',
  ...overrides,
});

/** web 프로젝트: 스키마에 API_URL(url, public, 필수)이 있고, 값에는 DEBUG가 더 있다 */
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
      body: {
        publicPrefixes: ['VITE_'],
        keys: [
          key('API_URL', {
            type: 'url',
            visibility: 'public',
            required: true,
            description: 'API 주소',
          }),
        ],
      },
    });
  for (const env of ENVS) {
    api.reply('GET', `/api/v1/projects/web/envs/${env}`, {
      status: 200,
      body: {
        project: 'web',
        env,
        version: 1,
        variables: { API_URL: 'https://api', DEBUG: 'true' },
      },
    });
  }
  return api;
}

const putRequest = (api: FakeApi) => api.requests.find((r) => r.method === 'PUT');

describe('키 스키마', () => {
  it('키 스키마 탭에서 키별 타입·공개 여부·필수·설명을 보여준다', async () => {
    const { user: actor, history } = renderApp('/projects/web', server());

    await actor.click(await screen.findByRole('link', { name: '키 스키마' }));

    await waitFor(() => expect(history.location.pathname).toBe('/projects/web/schema'));
    const row = within(
      (await screen.findByRole('rowheader', { name: 'API_URL' })).closest('tr') as HTMLElement,
    );
    expect(row.getByText('url')).toBeInTheDocument();
    expect(row.getByText('public')).toBeInTheDocument();
    expect(row.getByText('필수')).toBeInTheDocument();
    expect(row.getByText('API 주소')).toBeInTheDocument();
    expect(screen.getByText('VITE_')).toBeInTheDocument();
  });

  it('스키마에 없는 키를 알려주고 바로 등록할 수 있다', async () => {
    const api = server().reply('PUT', '/api/v1/projects/web/schema/keys/DEBUG', {
      status: 200,
      body: key('DEBUG', { type: 'boolean' }),
    });
    const { user: actor } = renderApp('/projects/web/schema', api);

    await actor.click(await screen.findByRole('button', { name: 'DEBUG 등록' }));
    const dialog = screen.getByRole('dialog', { name: 'DEBUG 등록' });
    await actor.selectOptions(within(dialog).getByRole('combobox', { name: '타입' }), 'boolean');
    await actor.click(within(dialog).getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(putRequest(api)?.body).toEqual({
        type: 'boolean',
        visibility: 'secret',
        required: false,
        optionalIn: [],
        buildTime: false,
        description: '',
      }),
    );
  });

  it('새 키를 추가한다 (필수면 없어도 되는 환경을 고를 수 있다)', async () => {
    const api = server().reply('PUT', '/api/v1/projects/web/schema/keys/VITE_SENTRY_DSN', {
      status: 200,
      body: key('VITE_SENTRY_DSN'),
    });
    const { user: actor } = renderApp('/projects/web/schema', api);

    await actor.click(await screen.findByRole('button', { name: '키 추가' }));
    const dialog = screen.getByRole('dialog', { name: '키 추가' });
    await actor.type(within(dialog).getByRole('textbox', { name: '키' }), 'VITE_SENTRY_DSN');
    await actor.selectOptions(within(dialog).getByRole('combobox', { name: '타입' }), 'url');
    await actor.selectOptions(
      within(dialog).getByRole('combobox', { name: '공개 여부' }),
      'public',
    );
    await actor.click(within(dialog).getByRole('checkbox', { name: '모든 환경에 필요' }));
    await actor.click(within(dialog).getByRole('checkbox', { name: 'local' }));
    await actor.type(within(dialog).getByRole('textbox', { name: '설명' }), 'Sentry 주소');
    await actor.click(within(dialog).getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(putRequest(api)?.body).toEqual({
        type: 'url',
        visibility: 'public',
        required: true,
        optionalIn: ['local'],
        buildTime: false,
        description: 'Sentry 주소',
      }),
    );
  });

  it('키 이름이 규칙에 맞지 않으면 서버 안내를 대화상자에 보여준다', async () => {
    const api = server().reply('PUT', '/api/v1/projects/web/schema/keys/bad-key', {
      status: 422,
      body: { code: 'invalid_key_name', message: '키 이름은 대문자·숫자·밑줄만 쓸 수 있습니다' },
    });
    const { user: actor } = renderApp('/projects/web/schema', api);

    await actor.click(await screen.findByRole('button', { name: '키 추가' }));
    const dialog = screen.getByRole('dialog', { name: '키 추가' });
    await actor.type(within(dialog).getByRole('textbox', { name: '키' }), 'bad-key');
    await actor.click(within(dialog).getByRole('button', { name: '저장' }));

    expect(await within(dialog).findByText(/대문자·숫자·밑줄/)).toBeInTheDocument();
  });

  it('키 속성을 지운다', async () => {
    const api = server().reply('DELETE', '/api/v1/projects/web/schema/keys/API_URL', {
      status: 204,
    });
    const { user: actor } = renderApp('/projects/web/schema', api);

    await actor.click(await screen.findByRole('button', { name: 'API_URL 삭제' }));

    await waitFor(() =>
      expect(
        api.requests.some((r) => r.method === 'DELETE' && r.path.endsWith('/keys/API_URL')),
      ).toBe(true),
    );
  });

  it('공개 접두사는 관리자만 고친다', async () => {
    const { unmount } = renderApp('/projects/web/schema', server('member'));
    await screen.findByText('VITE_');
    expect(screen.queryByRole('button', { name: '공개 접두사 편집' })).not.toBeInTheDocument();
    unmount();

    const api = server('admin').reply('PUT', '/api/v1/projects/web/schema/public-prefixes', {
      status: 200,
      body: { publicPrefixes: ['VITE_', 'EXPO_PUBLIC_'] },
    });
    const { user: actor } = renderApp('/projects/web/schema', api);
    await actor.click(await screen.findByRole('button', { name: '공개 접두사 편집' }));
    const input = screen.getByRole('textbox', { name: '공개 접두사' });
    await actor.clear(input);
    await actor.type(input, 'VITE_, EXPO_PUBLIC_');
    await actor.click(screen.getByRole('button', { name: '접두사 저장' }));

    await waitFor(() =>
      expect(putRequest(api)?.body).toEqual({ publicPrefixes: ['VITE_', 'EXPO_PUBLIC_'] }),
    );
  });

  it('매트릭스에서 public 값은 가리지 않고, secret 값은 가린다', async () => {
    renderApp('/projects/web', server());
    const apiUrl = within(
      (await screen.findByRole('rowheader', { name: /API_URL/ })).closest('tr') as HTMLElement,
    );
    expect(apiUrl.getAllByText('https://api')).toHaveLength(3);
    const debug = within(
      screen.getByRole('rowheader', { name: /DEBUG/ }).closest('tr') as HTMLElement,
    );
    expect(debug.getAllByText('••••••')).toHaveLength(3);
  });
});
