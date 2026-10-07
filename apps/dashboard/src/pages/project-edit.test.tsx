// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const ENVS = ['local', 'development', 'production'] as const;

/** web 프로젝트: local v2에 API_URL, DEBUG가 있다 */
function server(options: { afterPublish?: Record<string, string> } = {}) {
  const api = new FakeApi()
    .reply('GET', '/api/v1/me', { status: 200, body: user() })
    .reply('GET', '/api/v1/projects/web', {
      status: 200,
      body: { name: 'web', displayName: 'Stream 웹', kind: 'app', environments: [...ENVS] },
    });
  const local = {
    project: 'web',
    env: 'local',
    version: 2,
    variables: { API_URL: 'http://old', DEBUG: 'true' },
  };
  api.reply(
    'GET',
    '/api/v1/projects/web/envs/local',
    { status: 200, body: local },
    {
      status: 200,
      body: { ...local, version: 3, variables: options.afterPublish ?? local.variables },
    },
  );
  for (const env of ['development', 'production']) {
    api.reply('GET', `/api/v1/projects/web/envs/${env}`, {
      status: 200,
      body: { project: 'web', env, version: 0, variables: {} },
    });
  }
  return api;
}

const published = (version = 3) => ({
  status: 201,
  body: { version, diff: { added: [], removed: [], changed: [], unchanged: [] } },
});

async function openEditor(api: FakeApi) {
  const view = renderApp('/projects/web', api);
  await view.user.click(await screen.findByRole('button', { name: 'local 편집' }));
  return view;
}

const publishRequest = (api: FakeApi) =>
  api.requests.find((r) => r.method === 'POST' && r.path.endsWith('/versions'));

describe('환경별 편집과 게시', () => {
  it('값을 바꾸고 변경을 확인한 뒤 게시하면, 기준 버전과 변경 집합을 보내고 새 버전을 알려준다', async () => {
    const api = server({ afterPublish: { API_URL: 'https://new', DEBUG: 'true' } }).reply(
      'POST',
      '/api/v1/projects/web/envs/local/versions',
      published(3),
    );
    const { user: actor } = await openEditor(api);

    const input = screen.getByRole('textbox', { name: 'API_URL 값' });
    await actor.clear(input);
    await actor.type(input, 'https://new');
    await actor.click(screen.getByRole('button', { name: '변경 확인' }));

    const review = screen.getByRole('region', { name: '게시할 변경' });
    expect(within(review).getByText('API_URL')).toBeInTheDocument();
    expect(within(review).queryByText('https://new')).not.toBeInTheDocument();
    await actor.type(within(review).getByRole('textbox', { name: '게시 메시지' }), 'API 주소 변경');
    await actor.click(within(review).getByRole('button', { name: '게시' }));

    expect(await screen.findByText(/게시했습니다.*local v3/)).toBeInTheDocument();
    expect(publishRequest(api)?.body).toEqual({
      baseVersion: 2,
      changes: { set: { API_URL: 'https://new' } },
      message: 'API 주소 변경',
    });
    expect(await screen.findByRole('columnheader', { name: /local.*v3/ })).toBeInTheDocument();
  });

  it('키를 추가하고 삭제할 수 있다', async () => {
    const api = server().reply('POST', '/api/v1/projects/web/envs/local/versions', published());
    const { user: actor } = await openEditor(api);

    await actor.type(screen.getByRole('textbox', { name: '새 키' }), 'REDIS_URL');
    await actor.type(screen.getByRole('textbox', { name: '새 값' }), 'redis://localhost');
    await actor.click(screen.getByRole('button', { name: '추가' }));
    await actor.click(screen.getByRole('button', { name: 'DEBUG 삭제' }));
    await actor.click(screen.getByRole('button', { name: '변경 확인' }));
    await actor.click(screen.getByRole('button', { name: '게시' }));

    await screen.findByText(/게시했습니다/);
    expect(publishRequest(api)?.body).toMatchObject({
      changes: { set: { REDIS_URL: 'redis://localhost' }, remove: ['DEBUG'] },
    });
  });

  it('.env 내용을 붙여넣으면 값을 한꺼번에 채운다', async () => {
    const api = server().reply('POST', '/api/v1/projects/web/envs/local/versions', published());
    const { user: actor } = await openEditor(api);

    await actor.click(screen.getByRole('textbox', { name: '.env 붙여넣기' }));
    await actor.paste('API_URL=https://pasted\nNEW_ONE="hello world"\n');
    await actor.click(screen.getByRole('button', { name: '붙여넣은 값 적용' }));
    await actor.click(screen.getByRole('button', { name: '변경 확인' }));
    await actor.click(screen.getByRole('button', { name: '게시' }));

    await screen.findByText(/게시했습니다/);
    expect(publishRequest(api)?.body).toMatchObject({
      changes: { set: { API_URL: 'https://pasted', NEW_ONE: 'hello world' } },
    });
  });

  it('키 이름이 규칙에 맞지 않으면 게시하기 전에 알려준다', async () => {
    const api = server();
    const { user: actor } = await openEditor(api);

    await actor.type(screen.getByRole('textbox', { name: '새 키' }), 'bad-key');
    await actor.type(screen.getByRole('textbox', { name: '새 값' }), 'x');
    await actor.click(screen.getByRole('button', { name: '추가' }));

    expect(screen.getByText(/대문자·숫자·밑줄/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '변경 확인' })).toBeDisabled();
  });

  it('바뀐 것이 없으면 변경 확인을 누를 수 없다', async () => {
    await openEditor(server());
    expect(screen.getByRole('button', { name: '변경 확인' })).toBeDisabled();
  });

  it('그 사이 다른 게시가 있었으면(409) 최신 값을 다시 불러오라고 안내한다', async () => {
    const api = server().reply('POST', '/api/v1/projects/web/envs/local/versions', {
      status: 409,
      body: {
        code: 'version_conflict',
        message: '그 사이 다른 게시가 있었습니다 (기준 v2, 현재 v4)',
        details: { baseVersion: 2, currentVersion: 4 },
      },
    });
    const { user: actor } = await openEditor(api);
    await actor.type(screen.getByRole('textbox', { name: 'API_URL 값' }), '/x');
    await actor.click(screen.getByRole('button', { name: '변경 확인' }));
    await actor.click(screen.getByRole('button', { name: '게시' }));

    expect(await screen.findByText(/현재 v4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '최신 값 불러오기' })).toBeInTheDocument();
  });

  it('서버 검증에 걸리면(422) 문제를 읽기 쉽게 보여준다', async () => {
    const api = server().reply('POST', '/api/v1/projects/web/envs/local/versions', {
      status: 422,
      body: {
        code: 'publish_validation',
        message: '게시할 수 없습니다: 문제 1건',
        details: {
          issues: [{ code: 'missing_reference', key: 'API_URL', reference: '${shared.NOPE}' }],
        },
      },
    });
    const { user: actor } = await openEditor(api);
    // user-event는 `{`를 특수 키로 읽으므로 `{{`로 적는다
    await actor.type(screen.getByRole('textbox', { name: 'API_URL 값' }), '${{shared.NOPE}');
    await actor.click(screen.getByRole('button', { name: '변경 확인' }));
    await actor.click(screen.getByRole('button', { name: '게시' }));

    expect(
      await screen.findByText(/API_URL.*\$\{shared\.NOPE\}.*공유 그룹에 없습니다/),
    ).toBeInTheDocument();
  });

  it('취소하면 편집 내용을 버리고 보기로 돌아간다', async () => {
    const api = server();
    const { user: actor } = await openEditor(api);
    await actor.type(screen.getByRole('textbox', { name: 'API_URL 값' }), 'changed');
    await actor.click(screen.getByRole('button', { name: '취소' }));

    expect(screen.queryByRole('textbox', { name: 'API_URL 값' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'local 편집' })).toBeInTheDocument();
    expect(publishRequest(api)).toBeUndefined();
  });

  it('.env를 붙여넣으면 추가·변경·삭제 후보를 나눠 보여주고, 고른 삭제 후보만 지운다', async () => {
    const api = server().reply('POST', '/api/v1/projects/web/envs/local/versions', published());
    const { user: actor } = await openEditor(api);

    await actor.click(screen.getByRole('textbox', { name: '.env 붙여넣기' }));
    await actor.paste('API_URL=https://pasted\nNEW_ONE=1\n');

    const preview = screen.getByRole('region', { name: '붙여넣은 내용' });
    expect(within(preview).getByText('NEW_ONE').closest('li')).toHaveTextContent('추가');
    expect(within(preview).getByText('API_URL').closest('li')).toHaveTextContent('변경');
    const deleteDebug = within(preview).getByRole('checkbox', { name: 'DEBUG 지우기' });
    expect(deleteDebug).not.toBeChecked();
    await actor.click(deleteDebug);
    await actor.click(screen.getByRole('button', { name: '붙여넣은 값 적용' }));
    await actor.click(screen.getByRole('button', { name: '변경 확인' }));
    await actor.click(screen.getByRole('button', { name: '게시' }));

    await screen.findByText(/게시했습니다/);
    expect(publishRequest(api)?.body).toMatchObject({
      changes: { set: { API_URL: 'https://pasted', NEW_ONE: '1' }, remove: ['DEBUG'] },
    });
  });
});

describe('환경 간 복사', () => {
  it('고른 키의 값을 다른 환경의 편집에 담고, 확인한 뒤 그 환경에 게시한다', async () => {
    const api = server().reply('POST', '/api/v1/projects/web/envs/production/versions', {
      status: 201,
      body: { version: 1, diff: { added: ['API_URL'], removed: [], changed: [], unchanged: [] } },
    });
    const { user: actor } = renderApp('/projects/web', api);

    await actor.click(await screen.findByRole('button', { name: '환경 간 복사' }));
    const dialog = screen.getByRole('dialog', { name: '환경 간 복사' });
    await actor.selectOptions(within(dialog).getByRole('combobox', { name: '원본 환경' }), 'local');
    await actor.selectOptions(
      within(dialog).getByRole('combobox', { name: '대상 환경' }),
      'production',
    );
    await actor.click(within(dialog).getByRole('checkbox', { name: 'API_URL' }));
    expect(
      within(dialog).getByText('API_URL', { selector: 'code' }).closest('li'),
    ).toHaveTextContent('추가');
    await actor.click(within(dialog).getByRole('button', { name: '편집에 담기' }));

    expect(screen.getByRole('heading', { name: /production 편집/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'API_URL 값' })).toHaveValue('http://old');
    await actor.click(screen.getByRole('button', { name: '변경 확인' }));
    await actor.click(screen.getByRole('button', { name: '게시' }));

    await screen.findByText(/게시했습니다.*production v1/);
    expect(
      api.requests.find((r) => r.method === 'POST' && r.path.includes('/production/'))?.body,
    ).toEqual({ baseVersion: 0, changes: { set: { API_URL: 'http://old' } } });
  });
});
